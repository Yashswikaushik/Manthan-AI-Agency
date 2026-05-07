require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../memory/db');
const { v4: uuidv4 } = require ? (() => { try { return require('crypto').randomUUID; } catch(e) { return () => Math.random().toString(36).slice(2); } })() : (() => Math.random().toString(36).slice(2));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Tool executor registry — populated at startup
const toolExecutors = {};

function registerTool(name, executor) {
  toolExecutors[name] = executor;
}

// Load all tools on first use
let toolsLoaded = false;
function loadTools() {
  if (toolsLoaded) return;
  toolsLoaded = true;
  try {
    registerTool('web_search', require('../tools/web-search').search);
    registerTool('scrape_url', require('../tools/url-scraper').scrape);
    registerTool('airtable_read', require('../tools/airtable').read);
    registerTool('airtable_create', require('../tools/airtable').create);
    registerTool('airtable_update', require('../tools/airtable').update);
    registerTool('airtable_delete', require('../tools/airtable').remove);
    registerTool('notion_create_page', require('../tools/notion').createPage);
    registerTool('notion_update_page', require('../tools/notion').updatePage);
    registerTool('notion_search', require('../tools/notion').search);
    registerTool('whatsapp_send', require('../tools/whatsapp').send);
    registerTool('calendar_read', require('../tools/calendar').readEvents);
    registerTool('save_file', require('../tools/file-generator').save);
    registerTool('send_email', require('../tools/email-sender').send);
    registerTool('n8n_trigger', require('../tools/n8n').triggerWorkflow);
    registerTool('n8n_list', require('../tools/n8n').listWorkflows);
  } catch (e) {
    console.error('[runner] tool load error:', e.message);
  }
}

// Claude tool definitions
const TOOL_DEFINITIONS = [
  {
    name: 'web_search',
    description: 'Search the web using Brave Search. Use for competitor research, market intel, lead research, trends.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results (default 5, max 10)' }
      },
      required: ['query']
    }
  },
  {
    name: 'scrape_url',
    description: 'Scrape and extract content from a URL using Firecrawl.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to scrape' }
      },
      required: ['url']
    }
  },
  {
    name: 'airtable_read',
    description: 'Read records from Airtable. Tables: Leads, Clients, Invoices, Projects, Brand Profiles, Deliverables, Approval Queue, Content Calendar, Agency Growth.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name' },
        filterFormula: { type: 'string', description: 'Airtable filter formula e.g. {status}="Active"' },
        maxRecords: { type: 'number', description: 'Max records to fetch (default 20)' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Specific fields to return' }
      },
      required: ['table']
    }
  },
  {
    name: 'airtable_create',
    description: 'Create a new record in Airtable.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        fields: { type: 'object', description: 'Record fields as key-value pairs' }
      },
      required: ['table', 'fields']
    }
  },
  {
    name: 'airtable_update',
    description: 'Update an existing Airtable record by record ID.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        recordId: { type: 'string' },
        fields: { type: 'object' }
      },
      required: ['table', 'recordId', 'fields']
    }
  },
  {
    name: 'notion_create_page',
    description: 'Create a new page in the Notion Manthan Clients database.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        properties: { type: 'object', description: 'Notion page properties' },
        content: { type: 'string', description: 'Page body content in markdown' }
      },
      required: ['title']
    }
  },
  {
    name: 'notion_search',
    description: 'Search Notion pages and databases.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' }
      },
      required: ['query']
    }
  },
  {
    name: 'whatsapp_send',
    description: 'Send a WhatsApp message to Yash.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message text (max 4096 chars)' },
        to: { type: 'string', description: 'Phone number (defaults to Yash)' }
      },
      required: ['message']
    }
  },
  {
    name: 'calendar_read',
    description: 'Read upcoming calendar events from Google Calendar.',
    input_schema: {
      type: 'object',
      properties: {
        daysAhead: { type: 'number', description: 'Number of days ahead to fetch (default 7)' },
        maxResults: { type: 'number', description: 'Max events (default 10)' }
      }
    }
  },
  {
    name: 'save_file',
    description: 'Save content to a file in the workspace directory.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string' },
        content: { type: 'string' },
        format: { type: 'string', description: 'txt, md, json, csv, html' }
      },
      required: ['filename', 'content']
    }
  },
  {
    name: 'send_email',
    description: 'Send an email via Gmail.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        htmlBody: { type: 'string' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'n8n_trigger',
    description: 'Trigger an n8n workflow by ID.',
    input_schema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'n8n workflow ID' },
        data: { type: 'object', description: 'Data payload to pass to workflow' }
      },
      required: ['workflowId']
    }
  }
];

function filterTools(toolNames) {
  if (!toolNames || toolNames.includes('all')) return TOOL_DEFINITIONS;
  return TOOL_DEFINITIONS.filter(t => toolNames.includes(t.name));
}

async function executeTool(toolName, input) {
  const executor = toolExecutors[toolName];
  if (!executor) throw new Error(`Tool ${toolName} not registered`);
  return await executor(input);
}

async function runAgent(agentModule, messages, options = {}) {
  loadTools();
  const {
    clientId = null,
    sessionId = null,
    stream = false,
    onChunk = null,
    onToolUse = null
  } = options;

  const runId = Date.now();
  const db = getDb();
  const startTime = Date.now();

  const tools = filterTools(agentModule.tools);
  let allMessages = [...messages];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let finalText = '';

  // Log run start
  const runStmt = db.prepare(`
    INSERT INTO agent_runs (agent_name, client_id, session_id, status, input_summary, created_at)
    VALUES (?, ?, ?, 'running', ?, CURRENT_TIMESTAMP)
  `);
  const runRow = runStmt.run(
    agentModule.name,
    clientId,
    sessionId,
    allMessages[allMessages.length - 1]?.content?.slice(0, 200) || ''
  );

  try {
    // Agentic loop — max 10 iterations to prevent infinite loops
    for (let iteration = 0; iteration < 10; iteration++) {
      const requestParams = {
        model: agentModule.model || 'claude-sonnet-4-6',
        max_tokens: agentModule.maxTokens || 8192,
        system: agentModule.systemPrompt,
        messages: allMessages,
        tools: tools.length > 0 ? tools : undefined
      };

      if (stream && onChunk && iteration === 0) {
        // Stream the first response
        const streamResponse = await client.messages.stream(requestParams);
        let streamText = '';
        let inputBlock = null;

        for await (const event of streamResponse) {
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const chunk = event.delta.text;
            streamText += chunk;
            if (onChunk) onChunk(chunk);
          }
          if (event.type === 'message_delta' && event.usage) {
            totalTokensOut += event.usage.output_tokens || 0;
          }
        }

        const finalMsg = await streamResponse.finalMessage();
        totalTokensIn += finalMsg.usage?.input_tokens || 0;
        totalTokensOut = finalMsg.usage?.output_tokens || 0;

        const hasToolUse = finalMsg.content.some(b => b.type === 'tool_use');
        if (!hasToolUse) {
          finalText = streamText;
          break;
        }

        // Process tool calls from streamed response
        allMessages.push({ role: 'assistant', content: finalMsg.content });
        const toolResults = await executeToolBlocks(finalMsg.content, onToolUse);
        allMessages.push({ role: 'user', content: toolResults });

      } else {
        // Non-streaming
        const response = await client.messages.create(requestParams);
        totalTokensIn += response.usage?.input_tokens || 0;
        totalTokensOut += response.usage?.output_tokens || 0;

        const textBlocks = response.content.filter(b => b.type === 'text');
        const toolBlocks = response.content.filter(b => b.type === 'tool_use');

        if (textBlocks.length > 0) {
          finalText = textBlocks.map(b => b.text).join('\n');
        }

        if (response.stop_reason === 'end_turn' || toolBlocks.length === 0) {
          break;
        }

        allMessages.push({ role: 'assistant', content: response.content });
        const toolResults = await executeToolBlocks(response.content, onToolUse);
        allMessages.push({ role: 'user', content: toolResults });
      }
    }

    // Update run as success
    db.prepare(`
      UPDATE agent_runs SET status='success', output_summary=?, tokens_in=?, tokens_out=?, duration_ms=?
      WHERE id=?
    `).run(finalText.slice(0, 300), totalTokensIn, totalTokensOut, Date.now() - startTime, runRow.lastInsertRowid);

    // Update agent memory — learning loop
    if (clientId) {
      updateAgentMemory(agentModule.name, clientId, finalText, totalTokensIn + totalTokensOut);
    }

    return {
      output: finalText,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      tokensTotal: totalTokensIn + totalTokensOut
    };

  } catch (error) {
    db.prepare(`
      UPDATE agent_runs SET status='error', error_message=?, duration_ms=? WHERE id=?
    `).run(error.message, Date.now() - startTime, runRow.lastInsertRowid);
    throw error;
  }
}

async function executeToolBlocks(contentBlocks, onToolUse) {
  const results = [];
  for (const block of contentBlocks) {
    if (block.type !== 'tool_use') continue;
    let result;
    try {
      if (onToolUse) onToolUse({ name: block.name, input: block.input });
      const rawResult = await executeTool(block.name, block.input);
      result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
    } catch (err) {
      result = `Error executing ${block.name}: ${err.message}`;
    }
    results.push({
      type: 'tool_result',
      tool_use_id: block.id,
      content: result.slice(0, 50000) // cap at 50K chars
    });
  }
  return results;
}

function updateAgentMemory(agentName, clientId, output, tokens) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO agent_memory (agent_name, client_id, memory_type, key, value, updated_at)
      VALUES (?, ?, 'run_stats', 'last_run', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(agent_name, client_id, key) DO UPDATE SET
        value=excluded.value, updated_at=CURRENT_TIMESTAMP
    `).run(agentName, clientId, JSON.stringify({ tokens, outputLen: output.length, at: new Date().toISOString() }));
  } catch (e) {
    // non-critical
  }
}

module.exports = { runAgent, TOOL_DEFINITIONS };
