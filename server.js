require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
require('dns').setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./backend/memory/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend
app.use(express.static(path.join(__dirname, 'frontend')));

// ── Lazy-load modules (avoid crash if env vars missing at startup) ─────────────
function getRunner() { return require('./backend/agents/runner'); }
function getAgents() { return require('./backend/config/agents'); }
function getAirtable() { return require('./backend/tools/airtable'); }
function getN8n() { return require('./backend/tools/n8n'); }
function getWhatsapp() { return require('./backend/tools/whatsapp'); }
function getWhatsappWebhook() { return require('./backend/tools/whatsapp-webhook'); }
function getConvStore() { return require('./backend/memory/conversation-store'); }
function getClientCtx() { return require('./backend/memory/client-context'); }
function getPdfGen() { return require('./backend/tools/pdf-generator'); }

// ── Client helper: local SQLite + Airtable fallback ───────────────────────────
async function getClientsWithFallback() {
  const local = getClientCtx().getAllClients();
  try {
    const records = await getAirtable().read({ table: 'Clients', maxRecords: 50 });
    if (records.length > 0) {
      const normalized = records.map(r => ({
        id: 'at_' + r.id,
        airtableId: r.id,
        name: r.fields.client_name || r.fields.Name || '',
        brandName: r.fields.business_name || '',
        industry: r.fields.industry || '',
        retainer: Number(r.fields.monthly_retainer || 0),
        status: r.fields.status || 'Active',
        healthScore: Number(r.fields.health_score || 0),
        engagementType: r.fields.engagement_type || '',
        services: r.fields.services || '',
        notes: r.fields.notes || '',
        whatsappNumber: r.fields.whatsapp_number || '',
        source: 'airtable',
        // fields wrapper for frontend code that reads c.fields?.Name etc.
        fields: {
          Name: r.fields.client_name || '',
          'Business Name': r.fields.business_name || '',
          'Monthly Retainer': Number(r.fields.monthly_retainer || 0),
          Industry: r.fields.industry || '',
          Status: r.fields.status || 'Active',
          'Health Score': Number(r.fields.health_score || 0),
          'Engagement Type': r.fields.engagement_type || '',
          Services: r.fields.services || '',
          Notes: r.fields.notes || '',
          'Start Date': r.fields.start_date || '',
          'Contract End': r.fields.contract_end_date || '',
          'Contract Value': Number(r.fields.contract_value || 0),
          WhatsApp: r.fields.whatsapp_number || '',
          Email: r.fields.email || '',
          Phone: r.fields.phone || '',
          'Active Channels': Array.isArray(r.fields.active_platforms)
            ? r.fields.active_platforms.join(', ')
            : (r.fields.active_platforms || ''),
          '90 Day Goals': r.fields['90_day_goals'] || '',
        }
      }));
      // Add local clients that aren't duplicated in Airtable
      const atNames = new Set(normalized.map(c => c.name.toLowerCase().trim()));
      const extras = local.filter(c => {
        const n = (c.name || '').toLowerCase().trim();
        return n.length > 2 && !atNames.has(n) && Number(JSON.parse(c.rate_card || '{}')?.monthly_retainer || 0) > 0;
      });
      return [...normalized, ...extras];
    }
  } catch(e) {
    // Airtable unavailable, fall through to local
  }
  return local;
}

// Utility: generate simple ID
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Utility: create notification
function notify(type, title, message, clientId = null) {
  try {
    const db = getDb();
    db.prepare(`INSERT INTO notifications (type,title,message,client_id) VALUES (?,?,?,?)`
    ).run(type, title, message, clientId);
  } catch(e) {}
}

// ──────────────────────────────────────────────────────────────────────────────
// CHAT & AGENTS
// ──────────────────────────────────────────────────────────────────────────────

// POST /api/chat/stream — SSE streaming chat
app.post('/api/chat/stream', async (req, res) => {
  const { messages, agentName = 'orchestrator', clientId, sessionId = newId(), devilsAdvocate = false } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const agentConfigs = getAgents();
    let agentModule = agentConfigs.find(a => a.name === agentName);

    if (!agentModule) {
      // Try loading from agents/ directory directly
      try {
        agentModule = require(`./backend/agents/${agentName}`);
      } catch(e) {
        agentModule = require('./backend/agents/orchestrator');
      }
    } else {
      agentModule = require(`./backend/agents/${agentModule.name}`);
    }

    // Devil's advocate mode — append instruction to system prompt
    if (devilsAdvocate && agentModule.systemPrompt) {
      agentModule = {
        ...agentModule,
        systemPrompt: agentModule.systemPrompt + `\n\nDEVIL'S ADVOCATE MODE: After your main response, add a section "🔴 Devil's Advocate:" where you strongly challenge your own recommendations and surface the biggest risks and counterarguments.`
      };
    }

    // Add client context to messages if clientId provided
    let enrichedMessages = [...messages];
    if (clientId) {
      const ctx = getClientCtx().getClientContext(clientId);
      if (ctx?.context_md) {
        enrichedMessages = [
          { role: 'user', content: `[Client Context]\n${ctx.context_md}` },
          { role: 'assistant', content: 'Understood. I have the client context loaded.' },
          ...messages
        ];
      }
    }

    // Save user message to conversation store
    const convStore = getConvStore();
    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg?.role === 'user') {
      convStore.saveMessage({ sessionId, role: 'user', content: lastUserMsg.content, agentName, clientId });
    }

    const { runAgent } = getRunner();
    let fullResponse = '';

    const result = await runAgent(agentModule, enrichedMessages, {
      clientId,
      sessionId,
      stream: true,
      onChunk: (chunk) => {
        fullResponse += chunk;
        send({ type: 'chunk', content: chunk });
      },
      onToolUse: (tool) => {
        send({ type: 'tool_use', name: tool.name, input: tool.input });
      }
    });

    // Save assistant response
    convStore.saveMessage({
      sessionId,
      role: 'assistant',
      content: result.output || fullResponse,
      agentName,
      clientId,
      tokensUsed: result.tokensTotal
    });

    send({ type: 'done', tokensTotal: result.tokensTotal, sessionId });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// POST /api/chat — non-streaming
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, agentName = 'orchestrator', clientId, sessionId = newId(), devilsAdvocate = false } = req.body;
    let agentModule;
    try {
      agentModule = require(`./backend/agents/${agentName}`);
    } catch(e) {
      agentModule = require('./backend/agents/orchestrator');
    }

    if (devilsAdvocate && agentModule.systemPrompt) {
      agentModule = { ...agentModule, systemPrompt: agentModule.systemPrompt + `\n\nDEVIL'S ADVOCATE MODE: After your response, add "🔴 Devil's Advocate:" and strongly challenge your own recommendations.` };
    }

    const { runAgent } = getRunner();
    const result = await runAgent(agentModule, messages, { clientId, sessionId });
    res.json({ output: result.output, tokensTotal: result.tokensTotal, sessionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agent/:name — run any agent by name
app.post('/api/agent/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { messages, clientId, sessionId = newId() } = req.body;
    const agentModule = require(`./backend/agents/${name}`);
    const { runAgent } = getRunner();
    const result = await runAgent(agentModule, messages, { clientId, sessionId });
    res.json({ output: result.output, tokensTotal: result.tokensTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/workbench/:tool — 9 workbench tools
app.post('/api/workbench/:tool', async (req, res) => {
  try {
    const { tool } = req.params;
    const input = req.body;
    const toolMap = {
      'web-search': () => require('./backend/tools/web-search').search(input),
      'url-scraper': () => require('./backend/tools/url-scraper').scrape(input),
      'hook-writer': () => {
        const agent = require('./backend/agents/hook-writer');
        const { runAgent } = getRunner();
        return runAgent(agent, [{ role: 'user', content: input.prompt || JSON.stringify(input) }]);
      },
      'caption-writer': () => {
        const agent = require('./backend/agents/caption-writer');
        const { runAgent } = getRunner();
        return runAgent(agent, [{ role: 'user', content: input.prompt || JSON.stringify(input) }]);
      },
      'email-writer': () => {
        const agent = require('./backend/agents/email-writer');
        const { runAgent } = getRunner();
        return runAgent(agent, [{ role: 'user', content: input.prompt || JSON.stringify(input) }]);
      },
      'brand-research': () => {
        const agent = require('./backend/agents/brand-intelligence');
        const { runAgent } = getRunner();
        return runAgent(agent, [{ role: 'user', content: input.prompt || JSON.stringify(input) }]);
      },
      'lead-qualifier': () => {
        const agent = require('./backend/agents/lead-qualifier');
        const { runAgent } = getRunner();
        return runAgent(agent, [{ role: 'user', content: input.prompt || JSON.stringify(input) }]);
      },
      'repurposing': () => {
        const agent = require('./backend/agents/repurposing');
        const { runAgent } = getRunner();
        return runAgent(agent, [{ role: 'user', content: input.prompt || JSON.stringify(input) }]);
      },
      'sop-generator': () => {
        const agent = require('./backend/agents/sop-generator');
        const { runAgent } = getRunner();
        return runAgent(agent, [{ role: 'user', content: input.prompt || JSON.stringify(input) }]);
      }
    };
    const fn = toolMap[tool];
    if (!fn) return res.status(404).json({ error: `Unknown tool: ${tool}` });
    const result = await fn();
    res.json({ result: typeof result === 'object' ? result : { output: result } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// CLIENTS
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/clients', async (req, res) => {
  try {
    const clients = await getClientsWithFallback();
    res.json({ clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', async (req, res) => {
  try {
    const clientData = { id: newId(), ...req.body, created_at: new Date().toISOString() };
    getClientCtx().setClientContext(clientData);
    // Trigger onboarding agent async
    const agent = require('./backend/agents/client-onboarding');
    const { runAgent } = getRunner();
    runAgent(agent, [{
      role: 'user',
      content: `Onboard new client: ${JSON.stringify(clientData)}`
    }], { clientId: clientData.id }).catch(e => console.error('[onboarding]', e.message));
    notify('client', `New client onboarded: ${clientData.name}`, `Client ${clientData.name} added to Manthan OS`);
    res.json({ client: clientData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const client = getClientCtx().getClientContext(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const existing = getClientCtx().getClientContext(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Client not found' });
    getClientCtx().setClientContext({ ...existing, ...req.body, id: req.params.id });
    res.json({ client: getClientCtx().getClientContext(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id/deliverables', async (req, res) => {
  try {
    const db = getDb();
    const deliverables = db.prepare(
      `SELECT * FROM deliverables WHERE client_id=? ORDER BY due_date ASC`
    ).all(req.params.id);
    res.json({ deliverables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// LEADS
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/leads', async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    const filterFormula = status ? `{status}="${status}"` : undefined;
    const records = await getAirtable().read({
      table: 'Leads',
      filterFormula,
      maxRecords: parseInt(limit),
      fields: ['business_name', 'phone', 'category', 'address', 'ai_score', 'status', 'email', 'last_contact', 'pain_point', 'pitch_angle']
    });
    res.json({ leads: records, count: records.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leads/stats', async (req, res) => {
  try {
    const all = await getAirtable().read({ table: 'Leads', maxRecords: 100 });
    const stats = {
      total: all.length,
      tierA: all.filter(r => (r.fields.ai_score || 0) >= 8).length,
      tierB: all.filter(r => (r.fields.ai_score || 0) >= 6 && (r.fields.ai_score || 0) < 8).length,
      contacted: all.filter(r => r.fields.status === 'Contacted').length,
      converted: all.filter(r => r.fields.status === 'Converted').length,
      pipeline: all.filter(r => r.fields.status === 'In Pipeline').length
    };
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leads/qualify-batch', async (req, res) => {
  try {
    const { count = 10 } = req.body;
    const agent = require('./backend/agents/lead-qualifier');
    const { runAgent } = getRunner();
    const result = await runAgent(agent, [{
      role: 'user',
      content: `Qualify the next ${count} unqualified leads (ai_score is empty or 0, status is not Contacted/Converted). Research each one, score them, and update Airtable.`
    }], { sessionId: `qualify_batch_${Date.now()}` });
    res.json({ output: result.output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// APPROVALS
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/approvals', async (req, res) => {
  try {
    const db = getDb();
    const localApprovals = db.prepare(
      `SELECT * FROM approvals ORDER BY created_at DESC LIMIT 50`
    ).all();

    // Also fetch from Airtable
    let airtableApprovals = [];
    try {
      const records = await getAirtable().read({
        table: 'Approval Queue',
        maxRecords: 30,
        fields: ['title', 'client_name', 'content_type', 'platform', 'approval_status', 'priority', 'content_preview', 'whatsapp_sent']
      });
      airtableApprovals = records.map(r => ({
        id: `at_${r.id}`,
        source: 'airtable',
        airtable_record_id: r.id,
        ...r.fields,
        status: r.fields.approval_status || 'pending'
      }));
    } catch(e) {}

    res.json({ approvals: [...localApprovals, ...airtableApprovals] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/approvals/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, feedback, reviewedBy = 'Yash', reviewedVia = 'dashboard' } = req.body;
    const db = getDb();

    if (id.startsWith('at_')) {
      // Update Airtable
      const airtableId = id.replace('at_', '');
      await getAirtable().update({
        table: 'Approval Queue',
        recordId: airtableId,
        fields: {
          approval_status: status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Revision Requested',
          client_feedback: feedback,
          reviewed_date: new Date().toISOString()
        }
      });
    } else {
      // Update local DB
      db.prepare(`
        UPDATE approvals SET status=?, client_feedback=?, reviewed_by=?, reviewed_via=?, reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(status, feedback, reviewedBy, reviewedVia, id);
    }

    // Log to audit trail
    db.prepare(`
      INSERT INTO notifications (type, title, message, created_at)
      VALUES ('approval_audit', ?, ?, CURRENT_TIMESTAMP)
    `).run(
      `Approval ${status}: ${id}`,
      `Reviewed by ${reviewedBy} via ${reviewedVia}. Feedback: ${feedback || 'none'}`
    );

    res.json({ success: true, id, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// n8n BRIDGE
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/n8n/workflows', async (req, res) => {
  try {
    const workflows = await getN8n().listWorkflows();
    res.json({ workflows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/n8n/executions', async (req, res) => {
  try {
    const { workflowId, limit = 10 } = req.query;
    const executions = await getN8n().getExecutions({ workflowId, limit: parseInt(limit) });
    res.json({ executions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/n8n/workflow/:id/trigger', async (req, res) => {
  try {
    const result = await getN8n().triggerWorkflow({ workflowId: req.params.id, data: req.body });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generic n8n trigger (by workflowName) — used by Daily Planner & Reports
// Tries n8n → Claude AI → local data-driven brief
app.post('/api/n8n/trigger', async (req, res) => {
  const { workflowName } = req.body;

  // Gather real data regardless of AI path
  const clients = await getClientsWithFallback().catch(() => []);
  const db = getDb();
  const mrr = clients.reduce((s, c) => s + (c.retainer || 0), 0);
  const pendingApprovals = db.prepare(`SELECT COUNT(*) as n FROM approvals WHERE status='pending' OR status='Pending'`).get() || {n:0};
  const deliverablesDue = db.prepare(`SELECT COUNT(*) as n FROM deliverables WHERE status IN ('brief','draft','in_progress') AND due_date IS NOT NULL AND due_date <= date('now','+7 days')`).get() || {n:0};
  const now = new Date();
  const hour = now.getHours();
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
  const greeting = hour < 12 ? 'Good morning ☀️' : hour < 17 ? 'Good afternoon 🌤' : 'Good evening 🌙';

  // Try n8n webhook
  if (process.env.N8N_WEBHOOK_URL) {
    try {
      const result = await getN8n().triggerWorkflow({ workflowName, data: req.body });
      return res.json(result);
    } catch (e) { /* fall through */ }
  }

  // Try Claude AI
  if (process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('test')) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const ac = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const clientList = clients.slice(0, 5).map(c => `- ${c.name} (₹${(c.retainer||0).toLocaleString('en-IN')}/mo)`).join('\n');
      const prompt = `You are the OS for Manthan AI Agency. Write a practical ${dayName} brief for Yash (solo founder, Bengaluru).
Agency: MRR ₹${mrr.toLocaleString('en-IN')}, ${clients.length} clients, ${pendingApprovals.n} pending approvals, ${deliverablesDue.n} deliverables due this week.
Clients: ${clientList}
Format: opening line, 3 numbered priorities, 1 client health note, closing. Under 200 words, plain text, speak directly to Yash.`;
      const message = await ac.messages.create({ model:'claude-haiku-4-5', max_tokens:400, messages:[{role:'user',content:prompt}] });
      return res.json({ output: message.content[0]?.text || '', source: 'claude' });
    } catch (e) { /* fall through to data-driven */ }
  }

  // Data-driven brief (no external API required)
  const topClients = clients.slice(0, 3).map(c => c.name).join(', ');
  const priorities = [
    pendingApprovals.n > 0 ? `Review and action ${pendingApprovals.n} pending approval${pendingApprovals.n>1?'s':''}` : `Check in with ${clients[0]?.name || 'top client'} — send a progress update`,
    deliverablesDue.n > 0 ? `${deliverablesDue.n} deliverable${deliverablesDue.n>1?'s':''}  due this week — prioritize by client retainer value` : 'Plan this week\'s content calendar across all active clients',
    `Revenue focus: ₹${mrr.toLocaleString('en-IN')} MRR across ${clients.length} clients — identify one upsell opportunity today`
  ];
  const brief = `${greeting}, Yash — happy ${dayName}.

Here's your agency snapshot for today:

1. ${priorities[0]}
2. ${priorities[1]}
3. ${priorities[2]}

Your active clients (${topClients}${clients.length > 3 ? ` +${clients.length-3} more` : ''}) are all in the system. MRR is at ₹${mrr.toLocaleString('en-IN')} — stay focused on retention and delivery quality.

Make it count. 💪`;

  res.json({ output: brief, source: 'local' });
});

app.get('/api/n8n/health', async (req, res) => {
  try {
    const health = await getN8n().getHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message, status: 'unreachable' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// FINANCIALS & INVOICES
// ──────────────────────────────────────────────────────────────────────────────

// /api/finance — shape expected by frontend finance KPI section
app.get('/api/finance', async (req, res) => {
  try {
    const db = getDb();
    const clients = await getClientsWithFallback();
    const mrr = clients.reduce((sum, c) => sum + (c.retainer || JSON.parse(c.rate_card || '{}')?.monthly_retainer || 0), 0);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const invoiceStats = db.prepare(`
      SELECT
        SUM(CASE WHEN status='pending' OR status='sent' THEN amount ELSE 0 END) as outstanding,
        SUM(CASE WHEN status='paid' AND created_at >= ? THEN amount ELSE 0 END) as collected
      FROM invoices
    `).get(thirtyDaysAgo);
    res.json({
      mrr,
      arr: mrr * 12,
      outstanding: invoiceStats.outstanding || 0,
      collected: invoiceStats.collected || 0,
      clientCount: clients.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/financials', async (req, res) => {
  try {
    const db = getDb();
    const snapshots = db.prepare(`SELECT * FROM financials ORDER BY year DESC, month DESC LIMIT 12`).all();
    const clients = await getClientsWithFallback();
    const mrr = clients.reduce((sum, c) => {
      const rate = c.retainer || JSON.parse(c.rate_card || '{}')?.monthly_retainer || 0;
      return sum + rate;
    }, 0);
    res.json({ snapshots, currentMrr: mrr, clientCount: clients.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/financials/mrr', async (req, res) => {
  try {
    const clients = await getClientsWithFallback();
    const mrrBreakdown = clients.map(c => ({
      clientId: c.id,
      clientName: c.name,
      retainer: c.retainer || JSON.parse(c.rate_card || '{}')?.monthly_retainer || 0
    }));
    const totalMrr = mrrBreakdown.reduce((s, c) => s + c.retainer, 0);
    res.json({ totalMrr, breakdown: mrrBreakdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices', async (req, res) => {
  try {
    const db = getDb();
    const invoices = db.prepare(`SELECT * FROM invoices ORDER BY created_at DESC`).all();
    res.json({ invoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices', async (req, res) => {
  try {
    const db = getDb();
    const invoice = {
      id: newId(),
      invoice_number: `INV-${new Date().getFullYear()}-${String(db.prepare('SELECT COUNT(*) as c FROM invoices').get().c + 1).padStart(3, '0')}`,
      ...req.body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    db.prepare(`
      INSERT INTO invoices (id, invoice_number, client_id, client_name, amount, currency, status, due_date, line_items, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(invoice.id, invoice.invoice_number, invoice.client_id, invoice.client_name, invoice.amount, invoice.currency || 'INR', invoice.status || 'draft', invoice.due_date, JSON.stringify(invoice.line_items || []), invoice.notes, invoice.created_at, invoice.updated_at);
    notify('invoice', `Invoice created: ${invoice.invoice_number}`, `${invoice.client_name} — ₹${invoice.amount}`);
    res.json({ invoice });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices/:id/pdf', async (req, res) => {
  try {
    const db = getDb();
    const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const { generateInvoice } = getPdfGen();
    const result = await generateInvoice({
      invoice,
      clientName: invoice.client_name,
      lineItems: JSON.parse(invoice.line_items || '[]')
    });
    res.download(result.path, result.filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SYSTEM
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/system/health', (req, res) => {
  const db = getDb();
  const agentRuns = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success FROM agent_runs WHERE created_at > datetime('now', '-24 hours')`).get();
  // Build connector status map keyed by env var name (for frontend connector grid)
  const envKeys = [
    'ANTHROPIC_API_KEY','BRAVE_SEARCH_API_KEY','FIRECRAWL_API_KEY',
    'AIRTABLE_API_KEY','NOTION_API_KEY',
    'N8N_WEBHOOK_URL','N8N_API_KEY',
    'WHATSAPP_ACCESS_TOKEN','GMAIL_CLIENT_ID',
    'GOOGLE_CALENDAR_ID'
  ];
  const connectors = {};
  envKeys.forEach(k => { connectors[k] = !!(process.env[k] && process.env[k].length > 4); });
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    agentRuns24h: agentRuns.total,
    agentSuccessRate: agentRuns.total > 0 ? Math.round((agentRuns.success / agentRuns.total) * 100) : 100,
    memory: process.memoryUsage(),
    ...connectors
  });
});

app.get('/api/system/connectors', async (req, res) => {
  const connectors = [
    { id: 'anthropic', name: 'Anthropic Claude', type: 'ai', status: process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing' },
    { id: 'airtable', name: 'Airtable', type: 'database', status: process.env.AIRTABLE_API_KEY ? 'configured' : 'missing' },
    { id: 'n8n', name: 'n8n Workflows', type: 'automation', status: process.env.N8N_API_KEY ? 'configured' : 'missing' },
    { id: 'notion', name: 'Notion', type: 'knowledge', status: process.env.NOTION_API_KEY ? 'configured' : 'missing' },
    { id: 'whatsapp', name: 'WhatsApp', type: 'messaging', status: process.env.WHATSAPP_ACCESS_TOKEN ? 'configured' : 'missing' },
    { id: 'brave', name: 'Brave Search', type: 'search', status: process.env.BRAVE_SEARCH_API_KEY ? 'configured' : 'missing' },
    { id: 'firecrawl', name: 'Firecrawl', type: 'scraping', status: process.env.FIRECRAWL_API_KEY ? 'configured' : 'missing' },
    { id: 'gmail', name: 'Gmail', type: 'email', status: process.env.GMAIL_CLIENT_ID ? 'configured' : 'missing' },
    { id: 'calendar', name: 'Google Calendar', type: 'calendar', status: process.env.GOOGLE_CALENDAR_ID ? 'configured' : 'missing' }
  ];

  // Check n8n live
  try {
    const health = await getN8n().getHealth();
    const n8nConn = connectors.find(c => c.id === 'n8n');
    if (n8nConn) { n8nConn.status = 'live'; n8nConn.detail = health; }
  } catch(e) {
    const n8nConn = connectors.find(c => c.id === 'n8n');
    if (n8nConn && n8nConn.status === 'configured') n8nConn.status = 'error';
  }

  res.json({ connectors });
});

app.get('/api/webhook/events', (req, res) => {
  const db = getDb();
  const events = db.prepare(`SELECT * FROM webhook_events ORDER BY created_at DESC LIMIT 50`).all();
  res.json({ events });
});

// WhatsApp webhook verification (GET)
app.get('/api/whatsapp/webhook', (req, res) => {
  const { verifyWebhook } = getWhatsappWebhook();
  verifyWebhook(req, res);
});

// WhatsApp inbound messages (POST)
app.post('/api/whatsapp/webhook', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately
  try {
    const { processInbound } = getWhatsappWebhook();
    const parsed = await processInbound(req.body);
    if (parsed?.text) {
      notify('whatsapp_inbound', 'WhatsApp message received', parsed.text);
    }
  } catch(e) {
    console.error('[whatsapp-webhook]', e.message);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// MEMORY & CONVERSATIONS
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/memory/clients/:id', (req, res) => {
  try {
    const client = getClientCtx().getClientContext(req.params.id);
    res.json({ client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/memory/clients/:id', (req, res) => {
  try {
    const existing = getClientCtx().getClientContext(req.params.id) || {};
    getClientCtx().setClientContext({ ...existing, ...req.body, id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/conversation/:sessionId', (req, res) => {
  try {
    const messages = getConvStore().getMessages(req.params.sessionId);
    res.json({ messages, sessionId: req.params.sessionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/conversation/:sessionId', (req, res) => {
  try {
    getConvStore().deleteSession(req.params.sessionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/notifications', (req, res) => {
  const db = getDb();
  const notifications = db.prepare(
    `SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50`
  ).all();
  const unread = db.prepare(`SELECT COUNT(*) as c FROM notifications WHERE read=0`).get().c;
  res.json({ notifications, unread });
});

app.post('/api/notifications/mark-read', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE notifications SET read=1, read_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
  } else {
    db.prepare(`UPDATE notifications SET read=1, read_at=CURRENT_TIMESTAMP WHERE read=0`).run();
  }
  res.json({ success: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELIVERABLES
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/deliverables', (req, res) => {
  const db = getDb();
  const { clientId, status } = req.query;
  let query = `SELECT * FROM deliverables`;
  const params = [];
  const conditions = [];
  if (clientId) { conditions.push(`client_id=?`); params.push(clientId); }
  if (status) { conditions.push(`status=?`); params.push(status); }
  if (conditions.length > 0) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ` ORDER BY due_date ASC`;
  res.json({ deliverables: db.prepare(query).all(...params) });
});

app.post('/api/deliverables', (req, res) => {
  try {
    const db = getDb();
    const d = { id: newId(), ...req.body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    db.prepare(`
      INSERT INTO deliverables (id,client_id,client_name,title,type,platform,status,content,hashtags,image_prompt,brief,due_date,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(d.id, d.client_id, d.client_name, d.title, d.type, d.platform, d.status || 'brief', d.content, d.hashtags, d.image_prompt, d.brief, d.due_date, d.created_at, d.updated_at);
    res.json({ deliverable: d });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/deliverables/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM deliverables WHERE id=?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    // Save version if content changed
    if (req.body.content && req.body.content !== existing.content) {
      const nextVersion = (existing.current_version || 1) + 1;
      db.prepare(`
        INSERT OR IGNORE INTO content_versions (deliverable_id, version, content, changed_by, change_summary)
        VALUES (?,?,?,?,?)
      `).run(req.params.id, existing.current_version, existing.content, 'user', 'Previous version');
      req.body.current_version = nextVersion;
    }

    const updates = Object.entries({ ...req.body, updated_at: new Date().toISOString() })
      .map(([k]) => `${k}=?`).join(',');
    const values = [...Object.values({ ...req.body, updated_at: new Date().toISOString() }), req.params.id];
    db.prepare(`UPDATE deliverables SET ${updates} WHERE id=?`).run(...values);
    res.json({ deliverable: db.prepare('SELECT * FROM deliverables WHERE id=?').get(req.params.id) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/deliverables/:id/versions', (req, res) => {
  const db = getDb();
  const versions = db.prepare(
    `SELECT * FROM content_versions WHERE deliverable_id=? ORDER BY version DESC`
  ).all(req.params.id);
  res.json({ versions });
});

// ──────────────────────────────────────────────────────────────────────────────
// KNOWLEDGE BASE
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/knowledge-base', (req, res) => {
  const db = getDb();
  const entries = db.prepare(`SELECT * FROM saved_outputs WHERE output_type='knowledge' ORDER BY created_at DESC LIMIT 50`).all();
  res.json({ entries });
});

app.post('/api/knowledge-base', (req, res) => {
  try {
    const db = getDb();
    const entry = {
      id: newId(),
      session_id: req.body.sessionId,
      title: req.body.title,
      content: req.body.content,
      agent_name: 'knowledge-capture',
      client_id: req.body.clientId,
      output_type: 'knowledge',
      created_at: new Date().toISOString()
    };
    db.prepare(`INSERT INTO saved_outputs (session_id,title,content,agent_name,client_id,output_type) VALUES (?,?,?,?,?,?)`
    ).run(entry.session_id, entry.title, entry.content, entry.agent_name, entry.client_id, entry.output_type);
    res.json({ entry });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────────────────────────────────────────
// SOPs (Standard Operating Procedures)
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/sops', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM sops ORDER BY updated_at DESC`).all();
    res.json({ sops: rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sops', (req, res) => {
  try {
    const db = getDb();
    const id = newId();
    const { title, category='ops', description='', owner='Yash', steps='[]', tags='[]' } = req.body;
    db.prepare(`INSERT INTO sops (id,title,category,description,owner,steps,tags) VALUES (?,?,?,?,?,?,?)`
    ).run(id, title, category, description, owner,
      typeof steps==='string' ? steps : JSON.stringify(steps),
      typeof tags==='string' ? tags : JSON.stringify(tags));
    const sop = db.prepare(`SELECT * FROM sops WHERE id=?`).get(id);
    res.json({ sop });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/sops/:id', (req, res) => {
  try {
    const db = getDb();
    const { title, category, description, owner, steps, tags } = req.body;
    db.prepare(`UPDATE sops SET title=?,category=?,description=?,owner=?,steps=?,tags=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).run(title, category, description, owner,
      typeof steps==='string' ? steps : JSON.stringify(steps),
      typeof tags==='string' ? tags : JSON.stringify(tags),
      req.params.id);
    const sop = db.prepare(`SELECT * FROM sops WHERE id=?`).get(req.params.id);
    res.json({ sop });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/sops/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM sops WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────────────────────────────────────────
// CONTENT CALENDAR (Airtable proxy)
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/content-calendar', async (req, res) => {
  try {
    const records = await getAirtable().read({
      table: 'Content Calendar',
      maxRecords: 50,
      fields: ['post_title', 'client_name', 'platform', 'content_type', 'scheduled_date', 'calendar_status', 'caption', 'hashtags', 'image_prompt', 'approval_status']
    });
    res.json({ items: records });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────────────────────────────────────────
// SAVED OUTPUTS (chat export, save to Notion)
// ──────────────────────────────────────────────────────────────────────────────

app.post('/api/outputs/save', async (req, res) => {
  try {
    const db = getDb();
    const { content, title, sessionId, clientId, agentName, saveToNotion = false } = req.body;
    db.prepare(`INSERT INTO saved_outputs (session_id,title,content,agent_name,client_id,output_type) VALUES (?,?,?,?,?,'output')`
    ).run(sessionId, title, content, agentName, clientId);

    let notionPageId = null;
    if (saveToNotion) {
      try {
        const notion = require('./backend/tools/notion');
        const page = await notion.createPage({ title: title || 'Agent Output', content });
        notionPageId = page.id;
      } catch(e) {}
    }
    res.json({ success: true, notionPageId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────────────────────────────────────────
// CONVERSATIONS / SESSIONS
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/conversations/sessions', (req, res) => {
  try {
    const convStore = getConvStore();
    const sessions = convStore.getAllSessions();

    // Enrich with first user message as title
    const db = getDb();
    const enriched = sessions.map(s => {
      const firstUser = db.prepare(
        `SELECT content, agent_name FROM conversations WHERE session_id=? AND role='user' ORDER BY created_at ASC, id ASC LIMIT 1`
      ).get(s.sessionId);
      return {
        ...s,
        title: firstUser ? String(firstUser.content).slice(0, 60) : 'New conversation',
        agentName: firstUser?.agent_name || 'orchestrator'
      };
    });

    res.json({ sessions: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/conversations/sessions/:sessionId/rename', (req, res) => {
  try {
    const db = getDb();
    const { title } = req.body;
    db.prepare(
      `UPDATE conversations SET content=? WHERE session_id=? AND id=(SELECT MIN(id) FROM conversations WHERE session_id=? AND role='user')`
    ).run(title, req.params.sessionId, req.params.sessionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversations/delete', (req, res) => {
  try {
    const db = getDb();
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    db.prepare('DELETE FROM conversations WHERE session_id=?').run(sessionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AGENTS CONSOLE
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/agents', (req, res) => {
  try {
    const agents = getAgents();
    const db = getDb();

    // Enrich with run stats from DB
    const enriched = agents.map(a => {
      let stats = { runCount: 0, successCount: 0, lastRunAt: null, avgDurationMs: 0 };
      try {
        const row = db.prepare(`
          SELECT COUNT(*) as total,
                 SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success,
                 MAX(created_at) as lastRunAt,
                 AVG(duration_ms) as avgDur
          FROM agent_runs WHERE agent_name=?
        `).get(a.name);
        if (row) {
          stats = { runCount: row.total, successCount: row.success || 0, lastRunAt: row.lastRunAt, avgDurationMs: Math.round(row.avgDur || 0) };
        }
      } catch(e) {}

      // Check for system prompt override
      let systemPromptOverride = null;
      try {
        const fs = require('fs');
        const overridePath = require('path').join(__dirname, 'backend', 'config', 'agent-overrides.json');
        if (fs.existsSync(overridePath)) {
          const overrides = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
          systemPromptOverride = overrides[a.name]?.systemPrompt || null;
        }
      } catch(e) {}

      // Get recent runs
      let recentRuns = [];
      try {
        recentRuns = db.prepare(`
          SELECT id, status, duration_ms, tokens_used, created_at, error_message
          FROM agent_runs WHERE agent_name=? ORDER BY created_at DESC LIMIT 5
        `).all(a.name);
      } catch(e) {}

      return { ...a, stats, recentRuns, systemPromptOverride };
    });

    res.json({ agents: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/agents/:name/config', (req, res) => {
  try {
    const { name } = req.params;
    const { systemPrompt, model } = req.body;
    const fs = require('fs');
    const overridePath = require('path').join(__dirname, 'backend', 'config', 'agent-overrides.json');

    let overrides = {};
    if (fs.existsSync(overridePath)) {
      overrides = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    }

    overrides[name] = { ...overrides[name] };
    if (systemPrompt !== undefined) {
      if (systemPrompt === null || systemPrompt === '') delete overrides[name].systemPrompt;
      else overrides[name].systemPrompt = systemPrompt;
    }
    if (model !== undefined) overrides[name].model = model;
    overrides[name].updatedAt = new Date().toISOString();
    if (Object.keys(overrides[name]).length === 1 && overrides[name].updatedAt) delete overrides[name];

    fs.writeFileSync(overridePath, JSON.stringify(overrides, null, 2));
    res.json({ success: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST version for compatibility
app.post('/api/agents/:name/config', (req, res) => {
  req.method = 'PUT';
  // Re-use same handler by forwarding
  const { name } = req.params;
  const { systemPrompt, model } = req.body;
  const fs = require('fs');
  const overridePath = require('path').join(__dirname, 'backend', 'config', 'agent-overrides.json');
  try {
    let overrides = {};
    if (fs.existsSync(overridePath)) overrides = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    overrides[name] = { ...overrides[name] };
    if (systemPrompt !== undefined) overrides[name].systemPrompt = systemPrompt;
    if (model !== undefined) overrides[name].model = model;
    overrides[name].updatedAt = new Date().toISOString();
    fs.writeFileSync(overridePath, JSON.stringify(overrides, null, 2));
    res.json({ success: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents/:name/runs', (req, res) => {
  try {
    const db = getDb();
    const runs = db.prepare(
      `SELECT session_id, created_at, agent_name,
        CASE WHEN content LIKE '%Error%' THEN 'error' ELSE 'success' END as status
       FROM conversations WHERE agent_name=? AND role='assistant'
       ORDER BY created_at DESC LIMIT 10`
    ).all(req.params.name);
    res.json({ runs });
  } catch (err) {
    res.json({ runs: [] });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PROJECTS (Airtable)
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  try {
    const { clientId, status } = req.query;
    let filterFormula;
    if (clientId && status) filterFormula = `AND({client_id}="${clientId}",{status}="${status}")`;
    else if (clientId) filterFormula = `{client_id}="${clientId}"`;
    else if (status) filterFormula = `{status}="${status}"`;

    const records = await getAirtable().read({
      table: 'Projects',
      filterFormula,
      maxRecords: 50,
      fields: ['name', 'client_id', 'client_name', 'status', 'description', 'due_date', 'budget', 'created_at']
    });
    res.json({ projects: records });
  } catch (err) {
    // Return empty array if Projects table doesn't exist yet
    res.json({ projects: [], warning: err.message });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name, client_id, client_name, status = 'Not Started', description, due_date, budget } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const record = await getAirtable().create({
      table: 'Projects',
      fields: { name, client_id, client_name, status, description, due_date, budget, created_at: new Date().toISOString() }
    });

    notify('project', `Project created: ${name}`, `${client_name || 'No client'} — ${status}`);
    res.json({ project: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const record = await getAirtable().update({
      table: 'Projects',
      recordId: req.params.id,
      fields: req.body
    });
    res.json({ project: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SYSTEM ENV UPDATE (Settings page)
// ──────────────────────────────────────────────────────────────────────────────

app.post('/api/system/env-update', (req, res) => {
  try {
    // Accept both {updates:{KEY:val}} and flat {KEY:val} formats
    const updates = (req.body.updates && typeof req.body.updates === 'object')
      ? req.body.updates
      : req.body;
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'updates object required' });
    }

    const fs = require('fs');
    const envPath = require('path').join(__dirname, '.env');

    let envContent = '';
    try { envContent = fs.readFileSync(envPath, 'utf8'); } catch(e) { envContent = ''; }

    const lines = envContent.split('\n');
    const updated = new Set();

    const newLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return line;
      const key = trimmed.slice(0, eqIdx).trim();
      if (key in updates) {
        updated.add(key);
        return `${key}=${updates[key]}`;
      }
      return line;
    });

    // Append keys not already present
    for (const [key, value] of Object.entries(updates)) {
      if (!updated.has(key)) {
        newLines.push(`${key}=${value}`);
      }
    }

    fs.writeFileSync(envPath, newLines.join('\n'));

    // Re-apply to process.env
    for (const [key, value] of Object.entries(updates)) {
      process.env[key] = value;
    }

    res.json({ success: true, updatedKeys: Object.keys(updates) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test a connector by key
app.post('/api/system/connectors/test', async (req, res) => {
  const { connectorId } = req.body;
  try {
    let result = { status: 'ok', detail: '' };
    switch (connectorId) {
      case 'anthropic': {
        const Anthropic = require('@anthropic-ai/sdk');
        const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        await c.models.list();
        result.detail = 'API key valid';
        break;
      }
      case 'airtable': {
        const records = await getAirtable().read({ table: 'Clients', maxRecords: 1 });
        result.detail = `Connected — ${records.length} record(s) accessible`;
        break;
      }
      case 'n8n': {
        const health = await getN8n().getHealth();
        result.detail = JSON.stringify(health).slice(0, 80);
        break;
      }
      case 'notion': {
        const notion = require('./backend/tools/notion');
        await notion.searchPages({ query: 'test', maxResults: 1 });
        result.detail = 'Notion API responding';
        break;
      }
      default:
        result = { status: 'unknown', detail: `No test available for connector: ${connectorId}` };
    }
    res.json(result);
  } catch (err) {
    res.status(200).json({ status: 'error', detail: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// CALENDAR EVENTS (Google Calendar proxy)
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/calendar/events', async (req, res) => {
  try {
    const { maxResults = 30, daysAhead = 30 } = req.query;
    const calendar = require('./backend/tools/calendar');
    const events = await calendar.readEvents({ daysAhead: parseInt(daysAhead), maxResults: parseInt(maxResults) });
    res.json(Array.isArray(events) ? events : []);
  } catch (err) {
    res.status(200).json([]);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// REPORTS (real data aggregation)
// ──────────────────────────────────────────────────────────────────────────────

app.get('/api/reports/summary', async (req, res) => {
  try {
    const db = getDb();

    // Agency health
    const clients = await getClientsWithFallback();
    const mrr = clients.reduce((s, c) => s + (c.retainer || JSON.parse(c.rate_card || '{}')?.monthly_retainer || 0), 0);

    // Deliverables this month
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const delivThisMonth = db.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as completed FROM deliverables WHERE created_at >= ?`
    ).get(firstOfMonth);

    // Agent activity
    const topAgents = db.prepare(`
      SELECT agent_name, COUNT(*) as runs, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as successes
      FROM agent_runs GROUP BY agent_name ORDER BY runs DESC LIMIT 5
    `).all();

    // Pending approvals
    const pendingApprovals = db.prepare(`SELECT COUNT(*) as c FROM approvals WHERE status='pending'`).get().c;

    // Invoice stats
    const invoiceStats = db.prepare(`
      SELECT SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) as paid,
             SUM(CASE WHEN status='pending' OR status='sent' THEN amount ELSE 0 END) as outstanding,
             COUNT(*) as total
      FROM invoices
    `).get();

    // Lead stats
    let leadStats = { total: 0, converted: 0, pipeline: 0 };
    try {
      const all = await getAirtable().read({ table: 'Leads', maxRecords: 100, fields: ['status', 'ai_score'] });
      leadStats = {
        total: all.length,
        converted: all.filter(r => r.fields.status === 'Converted').length,
        pipeline: all.filter(r => r.fields.status === 'In Pipeline').length,
        tierA: all.filter(r => (r.fields.ai_score || 0) >= 8).length
      };
    } catch(e) {}

    res.json({
      mrr,
      clientCount: clients.length,
      deliverablesThisMonth: delivThisMonth.total,
      deliverablesCompleted: delivThisMonth.completed,
      pendingApprovals,
      invoicePaid: invoiceStats.paid || 0,
      invoiceOutstanding: invoiceStats.outstanding || 0,
      topAgents,
      leadStats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// CUSTOM CONNECTORS
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/connectors/custom', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT id, name, type, icon, url, auth_type, auth_header, description, enabled, last_tested, last_status, created_at FROM custom_connectors ORDER BY created_at DESC`).all();
    res.json({ connectors: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/connectors/custom', (req, res) => {
  try {
    const { name, type, icon, url, auth_type, auth_header, token, description } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'name and url required' });
    const id = 'cc_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    const db = getDb();
    db.prepare(`INSERT INTO custom_connectors (id, name, type, icon, url, auth_type, auth_header, token, description) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, name, type || 'rest_api', icon || '🔌', url, auth_type || 'bearer', auth_header || 'Authorization', token || '', description || '');
    res.json({ id, ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/connectors/custom/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM custom_connectors WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/connectors/custom/:id/test', async (req, res) => {
  try {
    const db = getDb();
    const c = db.prepare(`SELECT * FROM custom_connectors WHERE id = ?`).get(req.params.id);
    if (!c) return res.status(404).json({ error: 'connector not found' });
    const axios = require('axios');
    const headers = {};
    if (c.auth_type === 'bearer' && c.token) headers[c.auth_header || 'Authorization'] = 'Bearer ' + c.token;
    else if (c.auth_type === 'api_key' && c.token) headers[c.auth_header || 'X-API-Key'] = c.token;
    let status = 'ok', code = 200;
    try {
      const r = await axios.get(c.url, { headers, timeout: 10000, validateStatus: () => true });
      code = r.status;
      status = (r.status >= 200 && r.status < 400) ? 'ok' : 'error_' + r.status;
    } catch (err) { status = 'error: ' + err.message.slice(0,80); code = 0; }
    db.prepare(`UPDATE custom_connectors SET last_tested = CURRENT_TIMESTAMP, last_status = ? WHERE id = ?`).run(status, req.params.id);
    res.json({ status, code });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────────────────────────────────────────
// CALENDAR EVENTS (local DB)
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/local-calendar', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM calendar_events ORDER BY start_time ASC`).all();
    res.json({ events: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/local-calendar', (req, res) => {
  try {
    const { title, start_time, end_time, type, client_id, location, description } = req.body;
    if (!title || !start_time) return res.status(400).json({ error: 'title and start_time required' });
    const id = 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    const db = getDb();
    db.prepare(`INSERT INTO calendar_events (id, title, start_time, end_time, type, client_id, location, description) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, title, start_time, end_time || null, type || 'meeting', client_id || null, location || null, description || null);
    res.json({ id, ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/local-calendar/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM calendar_events WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────────────────────────────────────────
// FILE UPLOADS (KB + Chat attachments)
// ──────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let multer;
try { multer = require('multer'); } catch (e) { console.warn('[server] multer not installed — file uploads disabled until `npm install multer`'); }

if (multer) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, Date.now() + '_' + safe);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

  app.post('/api/files/upload', upload.single('file'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
      const { context, client_id, tags } = req.body;
      const id = 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      const db = getDb();
      db.prepare(`INSERT INTO uploaded_files (id, filename, mime_type, size, path, context, client_id, tags) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, req.file.originalname, req.file.mimetype, req.file.size, req.file.filename, context || 'kb', client_id || null, tags || '[]');
      res.json({ id, filename: req.file.originalname, size: req.file.size, ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

app.get('/api/files', (req, res) => {
  try {
    const { context = 'kb', client_id } = req.query;
    const db = getDb();
    let rows;
    if (client_id) rows = db.prepare(`SELECT id, filename, mime_type, size, context, client_id, created_at FROM uploaded_files WHERE context = ? AND client_id = ? ORDER BY created_at DESC`).all(context, client_id);
    else rows = db.prepare(`SELECT id, filename, mime_type, size, context, client_id, created_at FROM uploaded_files WHERE context = ? ORDER BY created_at DESC`).all(context);
    res.json({ files: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/files/:id', (req, res) => {
  try {
    const db = getDb();
    const f = db.prepare(`SELECT path FROM uploaded_files WHERE id = ?`).get(req.params.id);
    if (f && f.path) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, f.path)); } catch (e) {}
    }
    db.prepare(`DELETE FROM uploaded_files WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────────────────────────────────────────
// SANDBOXED TERMINAL EXECUTION (Claude Code style)
// Uses spawn() with parsed arguments — no shell interpolation, allowlist enforced
// ──────────────────────────────────────────────────────────────────────────────
const { spawn } = require('child_process');
const SANDBOX_DIR = path.join(__dirname, 'sandbox');
if (!fs.existsSync(SANDBOX_DIR)) fs.mkdirSync(SANDBOX_DIR, { recursive: true });

const TERMINAL_ALLOWLIST = new Set([
  'node','npm','npx','ls','cat','echo','pwd','date','whoami','wc','grep',
  'head','tail','sort','uniq','python','python3','pip','pip3','tree','find',
  'git','curl','jq','which','env','printenv','df','du'
]);
// Subset of git that is read-only:
const GIT_READONLY = new Set(['status','log','diff','branch','show','remote','config','ls-files','blame']);

// Simple shell tokenizer: handles quoted strings without shell interpolation
function tokenize(input) {
  const tokens = [];
  let cur = '', q = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (q) {
      if (ch === q) { q = null; }
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (cur) { tokens.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

app.post('/api/terminal/exec', (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') return res.status(400).json({ error: 'command required' });
  if (command.length > 1000) return res.status(400).json({ error: 'command too long' });

  // Block obvious shell metacharacters that would only matter under a shell.
  if (/[;&|`$<>]/.test(command) && !command.startsWith('echo ')) {
    return res.status(403).json({ error: 'Shell metacharacters (; & | ` $ < >) are not allowed in sandbox.' });
  }

  const tokens = tokenize(command);
  if (!tokens.length) return res.status(400).json({ error: 'empty command' });
  const program = tokens[0];
  const args = tokens.slice(1);

  if (!TERMINAL_ALLOWLIST.has(program)) {
    return res.status(403).json({ error: `Command "${program}" not in allowlist. Allowed: ${[...TERMINAL_ALLOWLIST].join(', ')}` });
  }
  // Restrict git to read-only subcommands
  if (program === 'git' && (!args.length || !GIT_READONLY.has(args[0]))) {
    return res.status(403).json({ error: 'Only read-only git subcommands allowed: ' + [...GIT_READONLY].join(', ') });
  }

  const child = spawn(program, args, {
    cwd: SANDBOX_DIR,
    timeout: 15000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '', stderr = '';
  let totalBytes = 0;
  const MAX_BYTES = 1024 * 1024;
  child.stdout.on('data', d => { totalBytes += d.length; if (totalBytes < MAX_BYTES) stdout += d.toString(); });
  child.stderr.on('data', d => { totalBytes += d.length; if (totalBytes < MAX_BYTES) stderr += d.toString(); });
  child.on('error', err => res.json({ command, stdout, stderr: err.message, exitCode: -1, cwd: SANDBOX_DIR }));
  child.on('close', code => {
    res.json({ command, stdout, stderr, exitCode: code ?? 0, cwd: SANDBOX_DIR, truncated: totalBytes >= MAX_BYTES });
  });
});

app.get('/api/terminal/info', (req, res) => {
  res.json({
    sandbox: SANDBOX_DIR,
    allowlist: [...TERMINAL_ALLOWLIST],
    timeout: 15000,
    maxOutputBytes: 1024 * 1024
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// FRONTEND FALLBACK (SPA)
// ──────────────────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ──────────────────────────────────────────────────────────────────────────────
// START SERVER
// ──────────────────────────────────────────────────────────────────────────────
async function start() {
  // Initialize DB
  getDb();

  // Start scheduler
  try {
    const { startScheduler } = require('./backend/scheduler/jobs');
    startScheduler();
  } catch(e) {
    console.error('[server] Scheduler failed to start:', e.message);
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Manthan Agency OS running at http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Frontend:    http://localhost:${PORT}`);
    console.log(`   API:         http://localhost:${PORT}/api\n`);
  });
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
