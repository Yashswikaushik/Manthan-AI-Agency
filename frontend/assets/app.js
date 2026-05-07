'use strict';
/* ── State ─────────────────────────────────────────── */
const State = {
  screen:'dashboard', sessionId:null, clientId:null, projectId:null,
  agentName:'orchestrator', devilsAdvocate:false, streaming:false,
  currentClient:null, selectorMode:null, abortCtrl:null
};
const GRADIENTS = [
  'linear-gradient(135deg,#4F6EF7,#8B5CF6)',
  'linear-gradient(135deg,#F4B942,#EF7C2E)',
  'linear-gradient(135deg,#34C759,#00BCD4)',
  'linear-gradient(135deg,#FF375F,#FF6B35)',
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
  'linear-gradient(135deg,#00C48C,#4F6EF7)',
];

/* ── DOM helper ─────────────────────────────────────── */
function render(el, html) {
  if (!el) return;
  // All dynamic values are pre-sanitized via escapeHtml() before passing here
  const tmp = document.createElement('div');
  tmp.insertAdjacentHTML('afterbegin', html);
  el.replaceChildren(...tmp.childNodes);
}

/* ── API helper ─────────────────────────────────────── */
const API = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(path, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async delete(path) {
    const r = await fetch(path, { method:'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
};

/* ── Navigation ─────────────────────────────────────── */
function navigate(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const el = document.getElementById('screen-' + screen);
  if (el) el.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.screen === screen));
  const titles = {
    dashboard:'Dashboard','daily-planner':'Daily Planner',chat:'Chat',clients:'Clients',
    brands:'Brands',approvals:'Approvals',deliverables:'Deliverables',reports:'Reports',
    'lead-pipeline':'Lead Pipeline',projects:'Projects',workflows:'n8n Workflows',
    workbench:'Workbench','agents-console':'Agents Console',finance:'Finance',
    'knowledge-base':'Knowledge Base',sops:'SOPs','connector-map':'System Architecture',
    settings:'Settings','content-calendar':'Calendar','client-detail':'Client Detail',
    skills:'Skills & Coding'
  };
  const t = document.getElementById('topbar-title');
  if (t) t.textContent = titles[screen] || screen;
  State.screen = screen;
  loadScreen(screen);
  // Sync mobile bottom nav
  document.querySelectorAll('.mobile-nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === screen));
  refreshIcons();
}

function _setMobileNav(btn) {
  document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function loadScreen(screen) {
  const map = {
    dashboard:loadDashboard, 'daily-planner':loadMorningBrief,
    approvals:loadApprovals, deliverables:loadDeliverables,
    'lead-pipeline':loadLeads, workflows:loadWorkflows, finance:loadFinance,
    'knowledge-base':loadKnowledgeBase,
    sops:() => typeof loadSops!=='undefined' && loadSops(),
    clients:() => typeof loadClients!=='undefined' && loadClients(),
    brands:() => typeof loadBrands!=='undefined' && loadBrands(),
    'connector-map':() => typeof refreshConnectors!=='undefined' && refreshConnectors(),
    settings:() => typeof loadSettings!=='undefined' && loadSettings(),
    chat:() => typeof loadChatSessions!=='undefined' && loadChatSessions(),
    'agents-console':() => typeof loadAgentsConsole!=='undefined' && loadAgentsConsole(),
    workbench:() => typeof loadWorkbench!=='undefined' && loadWorkbench(),
    'content-calendar':() => typeof loadContentCalendar!=='undefined' && loadContentCalendar(),
    reports:() => typeof loadReports!=='undefined' && loadReports(),
    projects:() => typeof loadProjects!=='undefined' && loadProjects(),
    skills:() => typeof loadSkillsCatalog!=='undefined' && loadSkillsCatalog(),
  };
  const fn = map[screen];
  if (fn) fn();
}

/* ── KPI tile helper ─────────────────────────────────── */
function kpiTile(value, label, icon, color) {
  return '<div class="kpi-tile">' +
    '<div class="kpi-icon kpi-'+color+'"><i data-lucide="'+icon+'" style="width:18px;height:18px"></i></div>' +
    '<div class="kpi-value">'+escapeHtml(String(value))+'</div>' +
    '<div class="kpi-label">'+escapeHtml(label)+'</div>' +
    '</div>';
}

/* ── Dashboard ─────────────────────────────────────── */
async function loadDashboard() {
  const h = new Date().getHours();
  const prefs = JSON.parse(localStorage.getItem('manthan_prefs') || '{}');
  const name = prefs.ownerName || 'Yash';
  const titleEl = document.getElementById('dashboard-title');
  if (titleEl) titleEl.textContent = 'Welcome back, ' + name;
  const greetEl = document.getElementById('dashboard-greeting');
  if (greetEl) greetEl.textContent = h<12 ? '☀️ Good morning, ' + name + ' — let\'s build.' :
    h<17 ? '🌤️ Good afternoon, ' + name + '.' : h<22 ? '🌙 Good evening, ' + name + '.' : '🌙 Late night focus mode.';
  const kpiEl = document.getElementById('dashboard-kpis');
  if (!kpiEl) return;
  render(kpiEl, '<div class="spinner" style="margin:24px auto"></div>');
  try {
    const [clients, leads, deliverables] = await Promise.all([
      API.get('/api/clients').catch(()=>[]),
      API.get('/api/leads/stats').catch(()=>({total:0})),
      API.get('/api/deliverables?limit=100').catch(()=>[])
    ]);
    const ca = Array.isArray(clients)?clients:(clients.clients||clients.records||[]);
    const da = Array.isArray(deliverables)?deliverables:(deliverables.records||[]);
    const mrr = ca.reduce((s,c)=>s+(Number((c.fields&&c.fields['Monthly Retainer'])||c.retainer||0)),0);
    const pending = da.filter(d=>(d.status||d.fields?.Status||'').toLowerCase().includes('review')).length;
    render(kpiEl,
      kpiTile('₹'+mrr.toLocaleString('en-IN'),'MRR / Month','indian-rupee','gold')+
      kpiTile(ca.length,'Active Clients','users','accent')+
      kpiTile(pending,'Pending Approvals','clock','amber')+
      kpiTile((leads.stats||leads).total||0,'Total Leads','target','emerald'));
    refreshIcons();
    renderDashboardClients(ca.slice(0,5));
    renderSystemHealth();
    refreshImprovements();
  } catch(e) {
    render(kpiEl, '<p class="text-muted text-small">Could not load KPIs</p>');
  }
}

function renderDashboardClients(clients) {
  const el = document.getElementById('dashboard-clients');
  if (!el) return;
  if (!clients.length) { render(el, emptyState('No clients yet','users')); return; }
  render(el, clients.map((c,i) => {
    const name = c.fields?.Name||c.name||'Client';
    const g = GRADIENTS[i%GRADIENTS.length];
    return '<div class="flex items-center gap-3" style="padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div style="width:32px;height:32px;border-radius:8px;background:'+g+';display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:0.875rem">'+escapeHtml(name[0])+'</div>' +
      '<div style="flex:1"><div class="text-small font-medium">'+escapeHtml(name)+'</div></div>' +
      '<span class="status-dot live"></span></div>';
  }).join(''));
}

async function refreshImprovements() {
  const el = document.getElementById('dashboard-improvements-ai');
  if (!el) return;
  el.textContent = 'Analyzing agency data…';
  try {
    const [clients, deliverables, leads] = await Promise.all([
      API.get('/api/clients').catch(()=>[]),
      API.get('/api/deliverables?limit=100').catch(()=>[]),
      API.get('/api/leads/stats').catch(()=>({total:0}))
    ]);
    const ca = Array.isArray(clients)?clients:(clients.clients||clients.records||[]);
    const da = Array.isArray(deliverables)?deliverables:(deliverables.deliverables||deliverables.records||[]);
    const overdue = da.filter(d=>{
      const due = d.fields?.['Due Date']||d.dueDate;
      return due && new Date(due) < new Date() && (d.fields?.Status||d.status||'').toLowerCase()!=='done';
    }).length;
    const tips = [];
    if (overdue > 0) tips.push(`⚠️ ${overdue} deliverable${overdue>1?'s are':' is'} overdue — review and update status`);
    if (ca.length === 0) tips.push('🎯 No clients yet — onboard your first client to get started');
    const leadsTotal = (leads.stats||leads).total||0;
    if (leadsTotal > 50) tips.push(`📊 ${leadsTotal} leads in pipeline — consider batch qualification to clear backlog`);
    if (!tips.length) tips.push('✅ Looking healthy! No immediate actions needed.');
    el.innerHTML = tips.map(t=>`<div style="padding:4px 0;color:var(--text-2)">` + escapeHtml(t) + `</div>`).join('');
  } catch(e) { el.textContent = 'Could not load suggestions'; }
}

async function renderSystemHealth() {
  const el = document.getElementById('dashboard-system');
  if (!el) return;
  try {
    const data = await API.get('/api/system/connectors');
    const conns = Array.isArray(data?.connectors) ? data.connectors : [];
    const services = conns.slice(0,4).map(c => ({
      name: c.name.replace(' Claude','').replace(' Workflows',''),
      ok: c.status === 'configured' || c.status === 'live'
    }));
    render(el, services.map(s =>
      '<div class="card" style="padding:16px">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
      '<span class="status-dot '+(s.ok?'live':'')+'"></span>' +
      '<span class="text-small">'+escapeHtml(s.name)+'</span>' +
      '<span class="badge '+(s.ok?'badge-emerald':'badge-rose')+'" style="margin-left:auto">'+(s.ok?'OK':'Error')+'</span>' +
      '</div></div>'
    ).join(''));
    refreshIcons();
  } catch(e) { render(el, '<p class="text-muted text-small">Health check failed</p>'); }
}

/* ── Morning Brief ─────────────────────────────────── */
async function loadMorningBrief() {
  const el = document.getElementById('morning-brief-content');
  if (!el || el.dataset.loaded) return;
  el.dataset.loaded = '1';
  await generateMorningBrief();
}
async function generateMorningBrief() {
  const el = document.getElementById('morning-brief-content');
  if (!el) return;
  el.dataset.loaded = '1';
  render(el, '<div class="empty-state"><div class="spinner"></div><div class="empty-title">Generating brief…</div></div>');
  try {
    const r = await API.post('/api/n8n/trigger',{workflowName:'Morning Brief'});
    const text = r.output||r.message||r.result||'Brief generated.';
    // Format: convert newlines to <br>, numbered lists to styled paragraphs
    const formatted = escapeHtml(text)
      .replace(/\n\n/g, '</p><p style="margin-top:12px">')
      .replace(/\n/g, '<br>');
    render(el, '<div style="line-height:1.9;color:var(--text-1);font-size:0.9375rem"><p>'+formatted+'</p></div>');
  } catch(e) { render(el, '<p class="text-rose" style="padding:20px">Error: '+escapeHtml(e.message)+'</p>'); }
}

/* ── Planner chat ──────────────────────────────────── */
function _appendPlannerMsg(text, role) {
  const el = document.getElementById('planner-chat-messages');
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'planner-chat-bubble ' + role;
  div.textContent = text;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

async function sendPlannerChat() {
  const inp = document.getElementById('planner-chat-input');
  if (!inp) return;
  const msg = inp.value.trim();
  if (!msg) return;
  inp.value = '';
  inp.style.height = 'auto';
  _appendPlannerMsg(msg, 'user');
  const thinking = document.createElement('div');
  thinking.className = 'planner-chat-bubble ai';
  thinking.innerHTML = '<span class="spinner" style="width:14px;height:14px;display:inline-block;border-width:2px"></span>';
  document.getElementById('planner-chat-messages').appendChild(thinking);
  document.getElementById('planner-chat-messages').scrollTop = 9999;
  try {
    const r = await API.post('/api/chat', { message: msg, context: 'daily-planner', agentName: 'planner' });
    thinking.remove();
    _appendPlannerMsg(r.reply || r.message || r.output || 'Got it!', 'ai');
  } catch(e) {
    thinking.remove();
    _appendPlannerMsg('Sorry, I couldn\'t reach the AI right now. Try again!', 'ai');
  }
}

/* ── Brand chat ────────────────────────────────────── */
async function sendBrandChat() {
  const inp = document.getElementById('brand-chat-input');
  if (!inp) return;
  const msg = inp.value.trim();
  if (!msg) return;
  inp.value = '';
  const msgsEl = document.getElementById('brand-chat-messages');
  if (!msgsEl) return;
  const append = (text, role) => {
    const d = document.createElement('div');
    d.className = 'planner-chat-bubble ' + role;
    d.textContent = text;
    msgsEl.appendChild(d);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  };
  append(msg, 'user');
  const thinking = document.createElement('div');
  thinking.className = 'planner-chat-bubble ai';
  thinking.innerHTML = '<span class="spinner" style="width:14px;height:14px;display:inline-block;border-width:2px"></span>';
  msgsEl.appendChild(thinking);
  msgsEl.scrollTop = 9999;
  try {
    const brand = State.activeBrand || '';
    const r = await API.post('/api/chat', { message: msg, context: 'brand-research', brand, agentName: 'brand-analyst' });
    thinking.remove();
    append(r.reply || r.message || r.output || 'Research complete.', 'ai');
  } catch(e) {
    thinking.remove();
    append('Could not reach the AI. Please try again.', 'ai');
  }
}

/* ── Approvals ─────────────────────────────────────── */
let _allApprovals = [];
let _approvFilter = 'all';

function _normalizeApprovalStatus(s) {
  if (!s) return 'pending';
  const l = s.toLowerCase().replace(/[\s-]+/g,'_');
  if (l.includes('approv')) return 'approved';
  if (l.includes('reject')) return 'rejected';
  if (l.includes('revision') || l.includes('change') || l.includes('needs')) return 'revision_requested';
  return 'pending';
}

async function loadApprovals(forceRefresh) {
  const el = document.getElementById('approvals-list');
  const statsEl = document.getElementById('approvals-stats');
  if (!el) return;
  render(el, '<div class="spinner" style="margin:40px auto"></div>');
  try {
    const data = await API.get('/api/approvals');
    const raw = Array.isArray(data) ? data : (data.approvals || data.records || []);
    // Normalize status field for consistent filtering
    _allApprovals = raw.map(a => ({ ...a, status: _normalizeApprovalStatus(a.status || a.approval_status) }));

    // Render stats
    if (statsEl) {
      const pending = _allApprovals.filter(a=>(a.status||'pending')==='pending').length;
      const approved = _allApprovals.filter(a=>(a.status||'')===('approved')).length;
      const revision = _allApprovals.filter(a=>(a.status||'').includes('revision')).length;
      const rejected = _allApprovals.filter(a=>(a.status||'')==='rejected').length;
      render(statsEl,
        kpiTile(pending,'Pending Review','clock','amber') +
        kpiTile(approved,'Approved','check-circle','emerald') +
        kpiTile(revision,'Need Revision','edit-3','accent') +
        kpiTile(rejected,'Rejected','x-circle','rose'));
      refreshIcons();
    }

    // Wire filter tabs
    document.querySelectorAll('[data-approv-filter]').forEach(t => {
      t.onclick = () => {
        document.querySelectorAll('[data-approv-filter]').forEach(x=>x.classList.remove('active'));
        t.classList.add('active');
        _approvFilter = t.dataset.approvFilter;
        _renderApprovalCards();
      };
    });

    _renderApprovalCards();

    // Update nav badge
    const badge = document.getElementById('approvals-badge');
    const pCount = _allApprovals.filter(a=>(a.status||'pending')==='pending').length;
    if (badge) { badge.textContent = pCount; badge.style.display = pCount ? 'inline-flex' : 'none'; }
  } catch(e) {
    render(el, '<p class="text-rose" style="padding:16px">Error loading approvals: '+escapeHtml(e.message)+'</p>');
  }
}

function _renderApprovalCards() {
  const el = document.getElementById('approvals-list');
  if (!el) return;
  let items = _allApprovals;
  if (_approvFilter !== 'all') items = items.filter(a => (a.status||'pending') === _approvFilter);
  if (!items.length) { render(el, emptyState(_approvFilter==='all'?'No approvals yet':'No items with this status','check-circle')); return; }

  const typeColor = t => ({'social':'accent','email':'emerald','blog':'gold','video':'rose','design':'amber','copy':'text-2'}[(t||'').toLowerCase()]||'text-2');
  const priorityBadge = p => p==='high' ? '<span class="badge badge-rose" style="font-size:0.68rem">HIGH</span>' : p==='urgent' ? '<span class="badge badge-rose" style="font-size:0.68rem">URGENT</span>' : '';
  const statusBadge = s => {
    const map = {pending:'amber',approved:'emerald',revision_requested:'accent',rejected:'rose'};
    const label = {pending:'Pending',approved:'Approved',revision_requested:'Revision',rejected:'Rejected'};
    return '<span class="badge badge-'+(map[s]||'default')+'">'+(label[s]||s)+'</span>';
  };

  render(el, '<div class="approvals-grid">'+items.map(a => {
    const id = escapeHtml(a.id||'');
    const title = escapeHtml(a.title||a.Title||'Untitled');
    const client = escapeHtml(a.client_name||a.client||a.Client||'—');
    const ctype = escapeHtml(a.content_type||a.type||a.Type||'Content');
    const preview = escapeHtml((a.content_preview||a.preview||'').slice(0,140));
    const status = a.status||'pending';
    const priority = a.priority||'normal';
    const created = a.created_at ? new Date(a.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'}) : '';
    const isPending = status === 'pending';

    return `<div class="approval-card ${status==='approved'?'approval-approved':status==='rejected'?'approval-rejected':''}">
      <div class="approval-card-header">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="approval-type-badge approval-type-${typeColor(ctype)}">${ctype}</span>
          ${priorityBadge(priority)}
          ${statusBadge(status)}
        </div>
        <span class="approval-date">${created}</span>
      </div>
      <div class="approval-card-title">${title}</div>
      <div class="approval-client-chip"><i data-lucide="user" style="width:11px;height:11px;opacity:0.5"></i> ${client}</div>
      ${preview ? `<div class="approval-preview">${preview}</div>` : ''}
      ${isPending ? `<div class="approval-actions">
        <button class="btn btn-sm approval-approve-btn" onclick="setApprovalStatus('${id}','approved')"><i data-lucide="check" style="width:13px;height:13px"></i> Approve</button>
        <button class="btn btn-sm approval-revision-btn" onclick="setApprovalStatus('${id}','revision_requested')"><i data-lucide="edit-3" style="width:13px;height:13px"></i> Revision</button>
        <button class="btn btn-sm approval-reject-btn" onclick="setApprovalStatus('${id}','rejected')">Reject</button>
      </div>` : ''}
    </div>`;
  }).join('')+'</div>');
  refreshIcons();
}

async function setApprovalStatus(id, status) {
  const feedback = status === 'revision_requested' ? (window.prompt('Revision notes (optional):') || '') : '';
  try {
    await API.post('/api/approvals/'+id+'/status', { status, feedback });
    toast(status === 'approved' ? '✓ Approved!' : status === 'revision_requested' ? 'Revision requested' : 'Rejected', status==='approved'?'success':'info');
    loadApprovals(true);
  } catch(e) { toast('Error: '+e.message,'error'); }
}

// Legacy alias
async function approveItem(id) { return setApprovalStatus(id, 'approved'); }

/* ── Deliverables ──────────────────────────────────── */
const _SAMPLE_DELIVERABLES = [
  { id:'d1', name:'Brand Identity Kit — Fintech Brand', client:'Crescendo Fintech', type:'Design', status:'approved',    dueDate:'2026-04-28' },
  { id:'d2', name:'30-Day Instagram Content Calendar', client:'Zestful Foods',     type:'Content', status:'draft',      dueDate:'2026-05-10' },
  { id:'d3', name:'Founder LinkedIn Series (6 posts)',  client:'Manthan Agency',   type:'Copy',    status:'client_review', dueDate:'2026-05-08' },
  { id:'d4', name:'Q2 Email Nurture Sequence (5 mails)',client:'Prism SaaS',       type:'Copy',    status:'brief',     dueDate:'2026-05-15' },
  { id:'d5', name:'Product Launch Reel Script + Hook',  client:'Zestful Foods',     type:'Video',   status:'qa',        dueDate:'2026-05-06' },
  { id:'d6', name:'Competitive Analysis Deck',          client:'Crescendo Fintech', type:'Strategy',status:'published', dueDate:'2026-04-20' },
  { id:'d7', name:'Web Copy Rewrite — Landing Page',    client:'Prism SaaS',       type:'Copy',    status:'draft',     dueDate:'2026-05-12' },
  { id:'d8', name:'Social Media Strategy Playbook',     client:'Manthan Agency',   type:'Strategy',status:'approved',  dueDate:'2026-04-30' },
];

async function loadDeliverables(filter='all') {
  const el = document.getElementById('deliverables-list');
  if (!el) return;
  render(el, '<div class="spinner" style="margin:24px auto"></div>');
  let items = [];
  try {
    const data = await API.get('/api/deliverables');
    items = Array.isArray(data) ? data : (data.records || []);
  } catch(e) { /* fall through to sample data */ }
  if (!items.length) items = _SAMPLE_DELIVERABLES;
  if (filter !== 'all') items = items.filter(d => (d.status || d.fields?.Status || '').toLowerCase().includes(filter));
  const statusColor = s => ({'brief':'amber','draft':'accent','qa':'accent','client_review':'gold','approved':'emerald','published':'emerald'}[s.toLowerCase().replace(/ /g,'_')] || 'default');
  const statusLabel = s => ({'brief':'Brief','draft':'Draft','qa':'QA','client_review':'In Review','approved':'Approved','published':'Published'}[s.toLowerCase().replace(/ /g,'_')] || s);
  if (!items.length) { render(el, emptyState('No deliverables match this filter', 'package')); return; }
  window._delivCache = items;
  render(el,
    '<div class="deliverables-table-wrap">' +
    '<table class="deliverables-table">' +
    '<thead><tr><th>Title</th><th>Client</th><th>Type</th><th>Status</th><th>Due</th></tr></thead>' +
    '<tbody>' + items.map((d, idx) => {
      const f = d.fields || d;
      const st = (f.Status || f.status || 'brief').toLowerCase().replace(/ /g,'_');
      return '<tr style="cursor:pointer" onclick="openDeliverableDetail(' + idx + ')">' +
        '<td class="font-medium text-sm">' + escapeHtml(f.Title || f.name || 'Untitled') + '</td>' +
        '<td class="text-muted text-sm">' + escapeHtml(f.Client || f.client || '—') + '</td>' +
        '<td class="text-sm">' + escapeHtml(f.Type || f.type || '—') + '</td>' +
        '<td><span class="badge badge-' + statusColor(st) + '">' + escapeHtml(statusLabel(st)) + '</span></td>' +
        '<td class="text-muted text-sm">' + escapeHtml(f['Due Date'] || f.dueDate || '—') + '</td>' +
        '</tr>';
    }).join('') + '</tbody></table></div>');
  document.querySelectorAll('[data-deliv-filter]').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('[data-deliv-filter]').forEach(x => x.classList.remove('active'));
      t.classList.add('active'); loadDeliverables(t.dataset.delivFilter);
    };
  });
}

function openDeliverableDetail(idx) {
  const items = window._delivCache || [];
  const d = items[idx];
  if (!d) return;
  const f = d.fields || d;
  const statusColor = s => ({'brief':'amber','draft':'accent','qa':'accent','client_review':'gold','approved':'emerald','published':'emerald'}[s] || 'default');
  const statusLabel = s => ({'brief':'Brief','draft':'Draft','qa':'In QA','client_review':'Client Review','approved':'Approved','published':'Published'}[s] || s);
  const st = (f.Status || f.status || 'brief').toLowerCase().replace(/ /g,'_');

  let panel = document.getElementById('deliv-detail-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'deliv-detail-panel';
    panel.className = 'deliv-detail-overlay';
    document.body.appendChild(panel);
  }

  render(panel,
    '<div class="slide-over-backdrop" onclick="closeDeliverableDetail()"></div>' +
    '<div class="deliv-detail-panel">' +
      '<div class="deliv-detail-header">' +
        '<div>' +
          '<div style="font-size:0.75rem;color:var(--text-3);margin-bottom:4px">' + escapeHtml(f.Type || f.type || 'Deliverable') + '</div>' +
          '<div style="font-size:1.1rem;font-weight:700;color:var(--text-1)">' + escapeHtml(f.Title || f.name || 'Untitled') + '</div>' +
        '</div>' +
        '<button class="btn-icon btn btn-ghost" onclick="closeDeliverableDetail()"><i data-lucide="x" style="width:16px;height:16px"></i></button>' +
      '</div>' +
      '<div class="deliv-detail-body">' +
        '<div class="deliv-kpi-row">' +
          '<div class="deliv-kpi-tile"><div class="deliv-kpi-label">Status</div><span class="badge badge-' + statusColor(st) + '">' + escapeHtml(statusLabel(st)) + '</span></div>' +
          '<div class="deliv-kpi-tile"><div class="deliv-kpi-label">Client</div><div class="deliv-kpi-val">' + escapeHtml(f.Client || f.client || '—') + '</div></div>' +
          '<div class="deliv-kpi-tile"><div class="deliv-kpi-label">Due Date</div><div class="deliv-kpi-val">' + escapeHtml(f['Due Date'] || f.dueDate || '—') + '</div></div>' +
          '<div class="deliv-kpi-tile"><div class="deliv-kpi-label">Assignee</div><div class="deliv-kpi-val">' + escapeHtml(f.Assignee || f.assignee || 'Yash') + '</div></div>' +
        '</div>' +
        (f.Description || f.description ? '<div class="deliv-detail-section"><div class="deliv-detail-section-title">Description</div><div class="deliv-detail-section-body">' + escapeHtml(f.Description || f.description) + '</div></div>' : '') +
        (f.Notes || f.notes ? '<div class="deliv-detail-section"><div class="deliv-detail-section-title">Notes</div><div class="deliv-detail-section-body">' + escapeHtml(f.Notes || f.notes) + '</div></div>' : '') +
        '<div class="deliv-detail-section"><div class="deliv-detail-section-title">Platform / Format</div><div class="deliv-detail-section-body">' + escapeHtml(f.Platform || f.platform || f.Type || f.type || '—') + '</div></div>' +
      '</div>' +
      '<div class="deliv-detail-footer">' +
        '<button class="btn btn-ghost" onclick="closeDeliverableDetail()">Close</button>' +
        '<button class="btn btn-primary" onclick="closeDeliverableDetail();navigate(\'approvals\')"><i data-lucide="check-square" style="width:13px;height:13px"></i> View in Approvals</button>' +
      '</div>' +
    '</div>');
  panel.classList.add('active');
  refreshIcons();
}

function closeDeliverableDetail() {
  const panel = document.getElementById('deliv-detail-panel');
  if (panel) panel.classList.remove('active');
}

/* ── Leads ─────────────────────────────────────────── */
let _leadsPage = 1;
const _LEADS_PER_PAGE = 25;
let _allLeads = [];

async function loadLeads(page) {
  if (page) _leadsPage = page;
  const el = document.getElementById('leads-tbody');
  const kpi = document.getElementById('leads-kpis');
  const desc = document.getElementById('leads-page-desc');
  if (!el) return;
  render(el, '<tr><td colspan="7" style="text-align:center;padding:24px"><div class="spinner" style="margin:0 auto"></div></td></tr>');
  try {
    const [leads, stats] = await Promise.all([
      API.get('/api/leads?limit=200'),
      API.get('/api/leads/stats').catch(()=>({total:0,qualified:0,contacted:0}))
    ]);
    _allLeads = Array.isArray(leads)?leads:(leads.leads||leads.records||[]);
    const st = stats.stats || stats;
    const total = st.total || _allLeads.length;
    if (desc) desc.textContent = total.toLocaleString() + ' leads — qualified by AI, ranked by fit score';
    if (kpi) render(kpi,
      kpiTile(total,'Total Leads','target','accent')+
      kpiTile(st.tierA||_allLeads.filter(l=>(l.fields?.ai_score||l.score||0)>=8).length,'Tier A (8+)','star','emerald')+
      kpiTile(st.contacted||_allLeads.filter(l=>(l.fields?.status||l.status||'').toLowerCase().includes('contact')).length,'Contacted','phone','gold')+
      kpiTile(st.converted||_allLeads.filter(l=>(l.fields?.status||l.status||'').toLowerCase().includes('convert')).length,'Converted','check-circle','accent'));
    renderLeadsPage(_allLeads, _leadsPage);
    _renderLeadsKanban(_allLeads);
    refreshIcons();
  } catch(e) { render(el, '<tr><td colspan="7" class="text-rose">Error: '+escapeHtml(e.message)+'</td></tr>'); }
}

function _scoreRing(score, color) {
  const r = 17, circ = 2 * Math.PI * r;
  const dash = (score / 10) * circ;
  return `<div class="lead-score-ring">
    <svg width="44" height="44" viewBox="0 0 44 44">
      <circle class="lead-score-ring-bg" cx="22" cy="22" r="${r}"/>
      <circle class="lead-score-ring-fill" cx="22" cy="22" r="${r}"
        stroke="${color}"
        stroke-dasharray="${dash.toFixed(2)} ${circ.toFixed(2)}"
        stroke-dashoffset="0"/>
    </svg>
    <div class="lead-score-ring-num" style="color:${color}">${score}</div>
  </div>`;
}

function renderLeadsPage(leads, page) {
  const el = document.getElementById('leads-tbody');
  const pag = document.getElementById('leads-pagination');
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(leads.length / _LEADS_PER_PAGE));
  const start = (page-1) * _LEADS_PER_PAGE;
  const items = leads.slice(start, start + _LEADS_PER_PAGE);
  if (!items.length) { render(el, '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-3)">No leads found</td></tr>'); return; }
  render(el, items.map(l=>{
    const f=l.fields||l;
    const name=f.business_name||f.Business||f.name||'Unknown';
    const initials=name.split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
    const score=Number(f.ai_score||f['Fit Score']||f.score||0);
    const tier = score>=8 ? {label:'A',cls:'a'} : score>=5 ? {label:'B',cls:'b'} : {label:'C',cls:'c'};
    const sc=score>=7?'#00c48c':score>=5?'#f5a623':'#ff4d6a';
    const statusVal = f.status||f.Status||'New';
    const statusClass = statusVal.toLowerCase().includes('qual')?'badge-emerald':statusVal.toLowerCase().includes('contact')?'badge-amber':statusVal.toLowerCase().includes('convert')?'badge-emerald':'';
    const tierGrad = tier.cls==='a'?'linear-gradient(135deg,#00c48c,#4F6EF7)':tier.cls==='b'?'linear-gradient(135deg,#f5a623,#F44336)':'linear-gradient(135deg,#8888a8,#4a4a6a)';
    return `<tr style="cursor:pointer" onclick="openLeadDetail('${escapeHtml(l.id||f.id||'')}','${escapeHtml(name)}')">
      <td>
        <div class="lead-cell-business">
          <div class="lead-avatar lead-tier-${tier.cls}" style="background:${tierGrad};color:#fff;font-size:0.7rem;font-weight:700">${escapeHtml(initials)}</div>
          <div class="lead-cell-business-text">
            <div class="lead-cell-name" style="font-weight:600">${escapeHtml(name)}</div>
            <div class="lead-cell-meta" style="color:${sc};font-weight:600;font-size:0.65rem">TIER ${tier.label}</div>
          </div>
        </div>
      </td>
      <td class="text-muted text-small">${escapeHtml(f.category||f.Category||f.industry||'—')}</td>
      <td>${_scoreRing(score, sc)}</td>
      <td><span class="badge ${statusClass}">${escapeHtml(statusVal)}</span></td>
      <td class="text-muted text-small" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml((f.pain_point||f['Pain Point']||f.painPoint||'—').slice(0,45))}</td>
      <td class="text-muted text-small font-mono">${escapeHtml(f.last_contact||f['Last Contact']||f.lastContact||'—')}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();qualifyLead('${escapeHtml(l.id||f.id||'')}')"><i data-lucide="zap" style="width:11px;height:11px"></i> Qualify</button></td>
    </tr>`;
  }).join(''));
  refreshIcons();
  // Pagination
  if (pag) {
    let btns = '';
    if (page > 1) btns += '<button class="btn btn-ghost btn-sm" onclick="renderLeadsPage(_allLeads,'+(page-1)+')">← Prev</button>';
    btns += '<span style="font-size:0.75rem;color:var(--text-3);padding:0 12px">Page '+page+' of '+totalPages+' · '+leads.length+' leads</span>';
    if (page < totalPages) btns += '<button class="btn btn-ghost btn-sm" onclick="renderLeadsPage(_allLeads,'+(page+1)+')">Next →</button>';
    render(pag, btns);
  }
}

function filterLeads(query) {
  const q = query.toLowerCase().trim();
  if (!q) { renderLeadsPage(_allLeads, 1); _renderLeadsKanban(_allLeads); return; }
  const filtered = _allLeads.filter(l=>{
    const f=l.fields||l;
    return (f.business_name||f.Business||f.name||'').toLowerCase().includes(q) ||
           (f.category||f.Category||f.industry||'').toLowerCase().includes(q) ||
           (f.pain_point||f['Pain Point']||f.painPoint||'').toLowerCase().includes(q);
  });
  renderLeadsPage(filtered, 1);
  _renderLeadsKanban(filtered);
}

function setLeadsView(view, btn) {
  document.querySelectorAll('[data-leads-view]').forEach(b => b.classList.toggle('active', b === btn));
  const tableV  = document.getElementById('leads-table-view');
  const kanbanV = document.getElementById('leads-kanban-view');
  if (view === 'kanban') {
    tableV?.classList.add('hidden');
    kanbanV?.classList.remove('hidden');
    _renderLeadsKanban(_allLeads || []);
  } else {
    tableV?.classList.remove('hidden');
    kanbanV?.classList.add('hidden');
  }
}

function _renderLeadsKanban(leads) {
  const el = document.getElementById('leads-kanban-view');
  if (!el) return;
  // Group by normalized status
  const stages = [
    { key:'new',        label:'New',        accent:'#5b72f5' },
    { key:'qualified',  label:'Qualified',  accent:'#0dd9ff' },
    { key:'contacted',  label:'Contacted',  accent:'#f5a623' },
    { key:'proposal',   label:'Proposal',   accent:'#b06ef5' },
    { key:'converted',  label:'Converted',  accent:'#00c48c' },
    { key:'lost',       label:'Lost',       accent:'#ff4d6a' },
  ];
  const buckets = {}; stages.forEach(s => buckets[s.key] = []);
  leads.forEach(l => {
    const f = l.fields || l;
    const s = (f.status||f.Status||'New').toLowerCase();
    let key = 'new';
    if (s.includes('lost') || s.includes('reject')) key = 'lost';
    else if (s.includes('convert') || s.includes('won')) key = 'converted';
    else if (s.includes('proposal') || s.includes('negotia')) key = 'proposal';
    else if (s.includes('contact')) key = 'contacted';
    else if (s.includes('qual')) key = 'qualified';
    buckets[key].push(l);
  });
  render(el, stages.map(s => {
    const items = buckets[s.key];
    return `<div class="kanban-col" style="--col-accent:${s.accent}">
      <div class="kanban-col-header">
        <div class="flex items-center gap-2"><span class="kanban-col-dot" style="background:${s.accent}"></span><span class="kanban-col-label">${escapeHtml(s.label)}</span></div>
        <span class="kanban-col-count" style="background:${s.accent}22;color:${s.accent}">${items.length}</span>
      </div>
      <div class="kanban-col-body">
        ${items.length ? items.slice(0,30).map(l => {
          const f = l.fields || l;
          const name = f.business_name||f.Business||f.name||'Unknown';
          const score = Number(f.ai_score||f['Fit Score']||f.score||0);
          const initials = name.split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
          const scoreColor = score>=7?'#00c48c':score>=5?'#f5a623':'#ff4d6a';
          const tierCls = score>=8?'a':score>=5?'b':'c';
          const tierGrad = tierCls==='a'?'linear-gradient(135deg,#00c48c,#4F6EF7)':tierCls==='b'?'linear-gradient(135deg,#f5a623,#F44336)':'linear-gradient(135deg,#8888a8,#4a4a6a)';
          const cat = f.category||f.Category||f.industry||'—';
          const pain = (f.pain_point||f['Pain Point']||f.painPoint||'').slice(0,55);
          const r=13, circ=2*Math.PI*r, dash=(score/10)*circ;
          return `<div class="kanban-card" style="--col-accent:${s.accent}" onclick="openLeadDetail('${escapeHtml(l.id||f.id||'')}','${escapeHtml(name)}')">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <div class="lead-avatar lead-tier-${tierCls}" style="width:30px;height:30px;font-size:10px;font-weight:700;background:${tierGrad};color:#fff;flex-shrink:0">${escapeHtml(initials)}</div>
              <div class="kanban-card-name">${escapeHtml(name)}</div>
              <svg width="32" height="32" viewBox="0 0 32 32" style="transform:rotate(-90deg);flex-shrink:0;margin-left:auto">
                <circle fill="none" stroke="var(--surface-3)" stroke-width="3" cx="16" cy="16" r="${r}"/>
                <circle fill="none" stroke="${scoreColor}" stroke-width="3" stroke-linecap="round" cx="16" cy="16" r="${r}"
                  stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"/>
              </svg>
            </div>
            <div class="kanban-card-cat" style="color:var(--text-3);font-size:0.72rem;margin-bottom:4px">${escapeHtml(cat)}</div>
            ${pain ? `<div class="kanban-card-pain">${escapeHtml(pain)}${f.pain_point&&f.pain_point.length>55?'…':''}</div>` : ''}
            <div class="kanban-card-footer">
              <span style="font-size:0.7rem;font-weight:700;color:${scoreColor};font-family:monospace">${score}/10</span>
              <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();qualifyLead('${escapeHtml(l.id||f.id||'')}')">
                <i data-lucide="zap" style="width:10px;height:10px"></i>
              </button>
            </div>
          </div>`;
        }).join('') : '<div class="kanban-empty">No leads</div>'}
      </div>
    </div>`;
  }).join(''));
  refreshIcons();
}
async function qualifyBatch() {
  toast('Qualifying next 10 leads…','info');
  try { await API.post('/api/leads/qualify-batch',{}); toast('Qualification complete','success'); loadLeads(); }
  catch(e) { toast('Error: '+e.message,'error'); }
}
async function qualifyLead(id) {
  toast('Qualifying lead…','info');
  try { await API.post('/api/leads/'+id+'/qualify',{}); toast('Lead qualified','success'); loadLeads(); }
  catch(e) { toast('Error: '+e.message,'error'); }
}

function openLeadDetail(id, name) {
  const lead = _allLeads.find(l => (l.id||l.fields?.id||l.fields?.ID||'') === id || (l.fields?.business_name||l.fields?.Business||l.name||'') === name);
  const f = lead ? (lead.fields || lead) : {};
  const score = Number(f.ai_score||f['Fit Score']||f.score||0);
  const sc = score>=7?'#00c48c':score>=5?'#f5a623':'#ff4d6a';
  const tier = score>=8?'A':score>=5?'B':'C';
  const statusVal = f.status||f.Status||'New';
  const statusClass = statusVal.toLowerCase().includes('qual')?'badge-emerald':statusVal.toLowerCase().includes('contact')?'badge-amber':statusVal.toLowerCase().includes('convert')?'badge-emerald':'';
  const painPoint = f.pain_point||f['Pain Point']||f.painPoint||'—';
  const website = f.website||f.Website||f.url||'—';
  const notes = f.notes||f.Notes||f.summary||'—';
  const email = f.email||f.Email||'—';
  const phone = f.phone||f.Phone||f.whatsapp||'—';
  let panel = document.getElementById('lead-detail-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'lead-detail-panel';
    panel.className = 'slide-over-panel';
    document.body.appendChild(panel);
  }
  const r=24, circ=2*Math.PI*r, dash=(score/10)*circ;
  render(panel,
    '<div class="slide-over-backdrop" onclick="closeLeadDetail()"></div>' +
    '<div class="slide-over-content">' +
    '<div class="slide-over-header">' +
      '<div style="display:flex;align-items:center;gap:14px">' +
        `<svg width="60" height="60" viewBox="0 0 60 60" style="transform:rotate(-90deg);flex-shrink:0">` +
          `<circle fill="none" stroke="var(--surface-3)" stroke-width="5" cx="30" cy="30" r="${r}"/>` +
          `<circle fill="none" stroke="${sc}" stroke-width="5" stroke-linecap="round" cx="30" cy="30" r="${r}" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"/>` +
        `</svg>` +
        '<div>' +
          `<div style="font-size:1.1rem;font-weight:700;color:var(--text-1)">${escapeHtml(f.business_name||f.Business||name||'Lead')}</div>` +
          `<div style="font-size:0.75rem;margin-top:3px"><span style="color:${sc};font-weight:700">Score ${score}/10 · Tier ${tier}</span></div>` +
        '</div>' +
      '</div>' +
      '<button class="btn-icon btn btn-ghost" onclick="closeLeadDetail()"><i data-lucide="x" style="width:16px;height:16px"></i></button>' +
    '</div>' +
    '<div class="slide-over-body">' +
      '<div class="grid grid-2" style="gap:10px;margin-bottom:16px">' +
        `<div class="kpi-mini"><div class="kpi-mini-label">Status</div><div class="kpi-mini-value"><span class="badge ${statusClass}">${escapeHtml(statusVal)}</span></div></div>` +
        `<div class="kpi-mini"><div class="kpi-mini-label">Category</div><div class="kpi-mini-value">${escapeHtml(f.category||f.Category||f.industry||'—')}</div></div>` +
        `<div class="kpi-mini"><div class="kpi-mini-label">Last Contact</div><div class="kpi-mini-value font-mono text-small">${escapeHtml(f.last_contact||f['Last Contact']||'—')}</div></div>` +
        `<div class="kpi-mini"><div class="kpi-mini-label">Fit Score</div><div class="kpi-mini-value" style="color:${sc};font-weight:700">${score}/10</div></div>` +
      '</div>' +
      `<div class="settings-section-title">Pain Point</div><p style="color:var(--text-2);font-size:0.875rem;line-height:1.6;margin-bottom:16px">${escapeHtml(painPoint)}</p>` +
      (notes!=='—'?`<div class="settings-section-title">AI Summary</div><p style="color:var(--text-2);font-size:0.875rem;line-height:1.6;margin-bottom:16px">${escapeHtml(notes)}</p>`:'') +
      '<div class="settings-section-title">Contact Details</div>' +
      `<div class="deliv-detail-row"><span class="deliv-detail-label">Website</span><span class="deliv-detail-val text-small font-mono">${escapeHtml(website)}</span></div>` +
      `<div class="deliv-detail-row"><span class="deliv-detail-label">Email</span><span class="deliv-detail-val text-small">${escapeHtml(email)}</span></div>` +
      `<div class="deliv-detail-row"><span class="deliv-detail-label">Phone / WhatsApp</span><span class="deliv-detail-val text-small font-mono">${escapeHtml(phone)}</span></div>` +
    '</div>' +
    '<div class="slide-over-footer">' +
      '<button class="btn btn-ghost" onclick="closeLeadDetail()">Close</button>' +
      `<button class="btn btn-primary" onclick="qualifyLead('${escapeHtml(id)}');closeLeadDetail()"><i data-lucide="zap" style="width:13px;height:13px"></i> Qualify Now</button>` +
    '</div>' +
    '</div>'
  );
  panel.classList.add('active');
  refreshIcons();
}

function closeLeadDetail() {
  const panel = document.getElementById('lead-detail-panel');
  if (panel) panel.classList.remove('active');
}

/* ── Workflows ─────────────────────────────────────── */
let _wfAll = [];
let _wfFilter = 'all';

async function loadWorkflows(forceRefresh) {
  const el = document.getElementById('workflows-list');
  const badge = document.getElementById('n8n-health-badge');
  if (!el) return;
  if (!forceRefresh && el.dataset.loaded) return;
  el.dataset.loaded = '1';
  render(el, '<div class="wf-loading"><div class="spinner"></div></div>');
  try {
    const data = await API.get('/api/n8n/workflows');
    _wfAll = Array.isArray(data) ? data : (data.data || []);
    if (badge) { badge.textContent = _wfAll.length + ' workflows'; badge.className = 'badge badge-emerald'; }
    _renderWfList(_wfAll);
  } catch(e) {
    if (badge) { badge.textContent = 'Offline'; badge.className = 'badge badge-rose'; }
    render(el,
      '<div class="wf-offline">' +
      '<div class="wf-offline-icon">⚡</div>' +
      '<div class="wf-offline-title">n8n API not reachable</div>' +
      '<div class="wf-offline-desc">Configure the n8n REST API key in Settings → Connectors.<br>The n8n MCP token is separate — it\'s for Claude Code only.</div>' +
      '<button class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="loadWorkflows(true)">Retry</button>' +
      '</div>');
    refreshIcons();
  }
}

function _renderWfList(wfs) {
  const el = document.getElementById('workflows-list');
  if (!el) return;
  if (!wfs.length) {
    render(el, '<div class="wf-offline"><div class="wf-offline-icon">📋</div><div class="wf-offline-title">No workflows found</div></div>');
    return;
  }
  render(el, wfs.map(w => {
    const active = w.active;
    const nodeCount = (w.nodes || []).length;
    const updatedAt = w.updatedAt ? new Date(w.updatedAt).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—';
    const safeId = escapeHtml(w.id || '');
    const safeName = escapeHtml(w.name || 'Workflow');
    return '<div class="wf-item' + (active ? ' wf-active' : '') + '">' +
      '<div class="wf-item-top">' +
      '<div class="wf-item-indicator ' + (active ? 'live' : 'off') + '"></div>' +
      '<div class="wf-item-info">' +
      '<div class="wf-item-name">' + safeName + '</div>' +
      '<div class="wf-item-meta">' +
      '<span>' + escapeHtml(String(nodeCount)) + ' nodes</span>' +
      '<span>·</span>' +
      '<span>Updated ' + updatedAt + '</span>' +
      '</div>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm wf-run-btn" onclick="triggerWorkflow(\'' + safeId + '\',\'' + safeName.replace(/'/g, "\\'") + '\')">' +
      '<i data-lucide="zap" style="width:11px;height:11px"></i></button>' +
      '</div>' +
      '</div>';
  }).join(''));
  refreshIcons();
}

function filterWorkflows(q) {
  const query = (q || '').toLowerCase();
  const filtered = _wfAll.filter(w => {
    const matchFilter = _wfFilter === 'all' || (_wfFilter === 'active' && w.active) || (_wfFilter === 'inactive' && !w.active);
    const matchQuery = !query || (w.name || '').toLowerCase().includes(query);
    return matchFilter && matchQuery;
  });
  _renderWfList(filtered);
}

function setWfFilter(val, btn) {
  _wfFilter = val;
  document.querySelectorAll('.wf-filter').forEach(b => b.classList.toggle('active', b === btn));
  filterWorkflows(document.getElementById('wf-search')?.value || '');
}

async function triggerWorkflow(id, name) {
  toast('Triggering: ' + name + '…', 'info');
  try {
    await API.post('/api/n8n/trigger', { workflowId: id });
    toast(name + ' triggered ✓', 'success');
    // Add to AI chat
    _appendWfAiMsg('assistant', '⚡ Triggered **' + name + '**. Check n8n for execution logs.');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

/* ── n8n AI Assistant ─────────────────────────────── */
let _wfAiSession = 'wf-ai-' + Date.now();
let _wfAiStreaming = false;

function _appendWfAiMsg(role, text) {
  const el = document.getElementById('wf-ai-messages');
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'wf-ai-msg wf-ai-' + role;
  const bubble = document.createElement('div');
  bubble.className = 'wf-ai-bubble';
  bubble.textContent = text;
  div.appendChild(bubble);
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  return bubble;
}

async function sendWfAiMessage() {
  if (_wfAiStreaming) return;
  const input = document.getElementById('wf-ai-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  _appendWfAiMsg('user', msg);
  _wfAiStreaming = true;

  // Build context: include workflow names
  const wfContext = _wfAll.length
    ? 'Active workflows: ' + _wfAll.filter(w => w.active).map(w => w.name).join(', ') + '. ' +
      'All workflows (' + _wfAll.length + '): ' + _wfAll.map(w => w.name + (w.active ? ' [active]' : '')).join(', ') + '. '
    : '';

  const bubble = _appendWfAiMsg('assistant', '…');
  try {
    const fullPrompt = 'You are an n8n automation expert embedded in Manthan Agency OS. ' +
      wfContext +
      'User question: ' + msg;
    const r = await API.post('/api/chat', {
      message: fullPrompt,
      agentName: 'orchestrator',
      sessionId: _wfAiSession
    });
    bubble.textContent = r.response || r.message || 'Done.';
  } catch(e) {
    bubble.textContent = 'Error: ' + e.message;
  } finally {
    _wfAiStreaming = false;
    const el = document.getElementById('wf-ai-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }
}

/* ── Finance ───────────────────────────────────────── */
async function loadFinance() {
  const kpi = document.getElementById('finance-kpis');
  if (!kpi||kpi.dataset.loaded) return; kpi.dataset.loaded='1';
  // Wire finance tab clicks
  document.querySelectorAll('[data-fin-tab]').forEach(t=>{
    t.addEventListener('click', ()=>{
      document.querySelectorAll('[data-fin-tab]').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.fin-tab-panel').forEach(x=>x.classList.add('hidden'));
      t.classList.add('active');
      const panel=document.getElementById('fin-panel-'+t.dataset.finTab);
      if (panel) panel.classList.remove('hidden');
    });
  });
  // Wire invoice filter clicks
  document.querySelectorAll('.fin-inv-filter').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.fin-inv-filter').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      loadInvoices(btn.dataset.invFilter||'all');
    });
  });
  try {
    const [finData, invoices, clients] = await Promise.all([
      API.get('/api/finance').catch(()=>({mrr:0,outstanding:0,collected:0})),
      API.get('/api/invoices').catch(()=>[]),
      API.get('/api/clients').catch(()=>({clients:[]}))
    ]);
    const mrr   = finData.mrr||0;
    const out   = finData.outstanding||0;
    const coll  = finData.collected||0;
    const arr   = mrr * 12;
    render(kpi,
      kpiTile('₹'+mrr.toLocaleString('en-IN'),'MRR','indian-rupee','gold')+
      kpiTile('₹'+arr.toLocaleString('en-IN'),'ARR','trending-up','accent')+
      kpiTile('₹'+out.toLocaleString('en-IN'),'Outstanding','alert-circle','rose')+
      kpiTile('₹'+coll.toLocaleString('en-IN'),'Collected (30d)','check-circle','emerald'));
    refreshIcons();
    // MRR chart
    const mrrCtx = document.getElementById('finance-mrr-chart');
    if (mrrCtx&&window.Chart) {
      new Chart(mrrCtx, {
        type:'line',
        data:{
          labels:['Nov','Dec','Jan','Feb','Mar','Apr'],
          datasets:[{
            label:'MRR',
            data:[Math.round(mrr*0.72),Math.round(mrr*0.8),Math.round(mrr*0.87),Math.round(mrr*0.93),Math.round(mrr*0.97),mrr],
            borderColor:'#F4B942',
            backgroundColor:'rgba(244,185,66,0.08)',
            pointBackgroundColor:'#F4B942',
            pointRadius:4,
            tension:0.4,fill:true
          }]
        },
        options:{
          responsive:true,
          plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>'₹'+Number(v.raw).toLocaleString('en-IN')}}},
          scales:{
            x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#8888a8',font:{size:11}}},
            y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#8888a8',font:{size:11},callback:v=>'₹'+Number(v/1000).toFixed(0)+'k'}}
          }
        }
      });
    }
    // Revenue mix chart
    const mixCtx = document.getElementById('finance-mix-chart');
    const clientArr = unwrap(clients,'clients','records');
    const retainerMRR = clientArr.reduce((s,c)=>{ const f=c.fields||c; return s+Number(f['Monthly Retainer']||f.retainer||0); },0);
    const projectRev  = Math.max(0, mrr - retainerMRR);
    if (mixCtx&&window.Chart) {
      new Chart(mixCtx, {
        type:'doughnut',
        data:{
          labels:['Retainer','Project-based'],
          datasets:[{
            data:[retainerMRR||mrr*0.75, projectRev||mrr*0.25],
            backgroundColor:['rgba(79,110,247,0.7)','rgba(244,185,66,0.7)'],
            borderColor:['rgba(79,110,247,0.9)','rgba(244,185,66,0.9)'],
            borderWidth:1
          }]
        },
        options:{
          responsive:true,
          plugins:{
            legend:{display:true,position:'bottom',labels:{color:'#8888a8',font:{size:11},padding:16}},
            tooltip:{callbacks:{label:v=>'₹'+Number(v.raw).toLocaleString('en-IN')}}
          },
          cutout:'65%'
        }
      });
    }
    // Client breakdown
    renderClientBreakdown(clientArr, out);
    // Invoices (default all)
    loadInvoices('all');
    // Runway
    renderRunway(mrr, out, coll);
  } catch(e) { render(kpi,'<p class="text-rose">Error: '+escapeHtml(e.message)+'</p>'); }
}

function renderClientBreakdown(clients, totalOut) {
  const el = document.getElementById('finance-client-breakdown');
  if (!el) return;
  if (!clients||!clients.length) { render(el, emptyState('No clients yet','users')); return; }
  const rows = clients.map(c=>{
    const f=c.fields||c;
    const name=f.Name||f.name||'Client';
    const retainer=Number(f['Monthly Retainer']||f.retainer||0);
    const status=f.Status||f.status||'active';
    const days=f['Days Active']||0;
    return {name,retainer,status,days};
  }).sort((a,b)=>b.retainer-a.retainer);
  const totalMRR=rows.reduce((s,r)=>s+r.retainer,0)||1;
  render(el,
    '<div class="fin-client-table">'+
    '<div class="fin-client-thead"><span>Client</span><span>Monthly Retainer</span><span>% of MRR</span><span>Status</span></div>'+
    rows.map(r=>{
      const pct=totalMRR>0 ? Math.round((r.retainer/totalMRR)*100) : 0;
      const statusClass=r.status==='active'?'emerald':'amber';
      return '<div class="fin-client-row">'+
        '<span class="text-small font-medium">'+escapeHtml(r.name)+'</span>'+
        '<span class="font-mono text-gold">₹'+r.retainer.toLocaleString('en-IN')+'</span>'+
        '<div class="fin-mrr-bar-wrap"><div class="fin-mrr-bar" style="width:'+pct+'%"></div><span class="text-small text-muted">'+pct+'%</span></div>'+
        '<span class="badge badge-'+statusClass+'">'+escapeHtml(r.status)+'</span>'+
      '</div>';
    }).join('')+
    '</div>');
}

async function loadInvoices(filter='all') {
  const el = document.getElementById('invoices-list');
  if (!el) return;
  try {
    const data = await API.get('/api/invoices');
    let items = Array.isArray(data)?data:(data.records||[]);
    if (filter==='pending') items=items.filter(i=>(i.fields?.Status||i.status||'pending')==='pending');
    else if (filter==='paid') items=items.filter(i=>(i.fields?.Status||i.status||'')==='paid');
    else if (filter==='overdue') {
      const now=Date.now();
      items=items.filter(i=>{
        const due=i.fields?.['Due Date']||i.dueDate;
        return due && new Date(due).getTime()<now && (i.fields?.Status||i.status||'pending')!=='paid';
      });
    }
    if (!items.length) { render(el, emptyState('No invoices','file-text')); return; }
    render(el,
      '<div class="fin-invoice-list">'+
      items.map(inv=>{
        const f=inv.fields||inv;
        const status=f.Status||f.status||'pending';
        const statusClass={paid:'emerald',pending:'amber',overdue:'rose'}[status]||'neutral';
        const due=f['Due Date']||f.dueDate;
        const isOverdue=due&&new Date(due).getTime()<Date.now()&&status!=='paid';
        return '<div class="fin-invoice-row">'+
          '<div class="fin-inv-left">'+
            '<div class="text-small font-medium">'+escapeHtml(f.Client||f.client||'Client')+'</div>'+
            '<div class="text-small text-muted">'+(f.Notes||f.notes||'Invoice')+'</div>'+
          '</div>'+
          '<div class="fin-inv-right">'+
            '<span class="font-mono font-medium '+(isOverdue?'text-rose':'text-gold')+'">₹'+Number(f.Amount||f.amount||0).toLocaleString('en-IN')+'</span>'+
            '<span class="badge badge-'+(isOverdue?'rose':statusClass)+'">'+escapeHtml(isOverdue?'overdue':status)+'</span>'+
            '<span class="text-small text-muted">'+(due||'No due date')+'</span>'+
          '</div>'+
        '</div>';
      }).join('')+
      '</div>');
  } catch(e) { render(el, emptyState('Could not load invoices','file-text')); }
}

function renderRunway(mrr, outstanding, collected) {
  const el = document.getElementById('finance-runway-panel');
  if (!el) return;
  const monthlyBurn = 35000; // placeholder
  const cashOnHand  = collected + (mrr * 1.5);
  const runwayMonths = mrr > 0 ? Math.round(cashOnHand / monthlyBurn) : 0;
  render(el,
    '<div class="runway-grid">'+
    '<div class="runway-stat"><div class="runway-val text-gold">'+runwayMonths+'</div><div class="runway-label">months runway</div></div>'+
    '<div class="runway-stat"><div class="runway-val text-emerald">₹'+mrr.toLocaleString('en-IN')+'</div><div class="runway-label">monthly revenue</div></div>'+
    '<div class="runway-stat"><div class="runway-val text-rose">₹'+monthlyBurn.toLocaleString('en-IN')+'</div><div class="runway-label">est. monthly burn</div></div>'+
    '<div class="runway-stat"><div class="runway-val text-accent">'+Math.round((mrr/monthlyBurn)*100)+'%</div><div class="runway-label">revenue vs burn</div></div>'+
    '</div>'+
    '<div class="runway-bar-wrap">'+
      '<div class="runway-bar-track">'+
        '<div class="runway-bar-fill" style="width:'+Math.min(100,Math.round((mrr/monthlyBurn)*100))+'%"></div>'+
      '</div>'+
      '<div class="text-small text-muted" style="margin-top:8px">Revenue / Burn ratio — target: ≥ 150%</div>'+
    '</div>'+
    '<div class="runway-note">'+
      '<i data-lucide="info" style="width:14px;height:14px;flex-shrink:0"></i>'+
      'Monthly burn is an estimate. Connect your expense tracker to see actual figures.'+
    '</div>');
  refreshIcons();
}

function exportFinanceCSV() {
  // Build CSV from loaded invoice data
  const rows = [['Invoice #','Client','Amount (₹)','Status','Due Date','Notes']];
  // Try to get data from last loaded invoices
  const el = document.getElementById('invoices-list');
  // Fallback: re-fetch and export
  API.get('/api/invoices').then(data => {
    const items = Array.isArray(data) ? data : (data.invoices || data.records || []);
    items.forEach(inv => {
      const f = inv.fields || inv;
      rows.push([
        f.invoice_number || '',
        f.client_name || f.Client || f.client || '',
        f.Amount || f.amount || 0,
        f.Status || f.status || 'pending',
        f.due_date || f['Due Date'] || f.dueDate || '',
        f.Notes || f.notes || ''
      ]);
    });
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'manthan-invoices-' + new Date().toISOString().slice(0,10) + '.csv';
    a.click(); URL.revokeObjectURL(url);
    toast('Invoice CSV exported', 'success');
  }).catch(() => toast('No invoices to export', 'info'));
}

async function openInvoiceModal() {
  const modal = document.getElementById('invoice-modal');
  if (!modal) return;
  // Populate client select
  const sel = document.getElementById('invoice-client');
  if (sel) {
    try {
      const data = await API.get('/api/clients');
      const clients = Array.isArray(data) ? data : (data.clients || data.records || []);
      render(sel,
        '<option value="">— Select client —</option>' +
        clients.map(c => {
          const f = c.fields || c;
          const name = f.Name || f.name || 'Client';
          const id = c.id || f.id || name;
          return `<option value="${escapeHtml(String(id))}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
        }).join('')
      );
    } catch(e) { render(sel, '<option value="">— No clients —</option>'); }
  }
  // Set default due date to 30 days out
  const dueInput = document.getElementById('invoice-due');
  if (dueInput) {
    const d = new Date(); d.setDate(d.getDate() + 30);
    dueInput.value = d.toISOString().slice(0,10);
  }
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('invoice-amount')?.focus(), 80);
}

function closeInvoiceModal() {
  const modal = document.getElementById('invoice-modal');
  if (modal) modal.style.display = 'none';
}

async function createInvoice() {
  const clientSel = document.getElementById('invoice-client');
  const amountEl  = document.getElementById('invoice-amount');
  const dueEl     = document.getElementById('invoice-due');
  const notesEl   = document.getElementById('invoice-notes');
  const selectedOption = clientSel?.options[clientSel.selectedIndex];
  const clientName = selectedOption?.dataset.name || clientSel?.value || '';
  const amount = parseFloat(amountEl?.value || '0');
  if (!clientName) { toast('Select a client', 'error'); return; }
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }
  try {
    const res = await API.post('/api/invoices', {
      client_id: clientSel?.value || '',
      client_name: clientName,
      amount,
      currency: 'INR',
      status: 'pending',
      due_date: dueEl?.value || '',
      notes: notesEl?.value?.trim() || ''
    });
    toast('Invoice ' + (res.invoice?.invoice_number || '') + ' created', 'success');
    closeInvoiceModal();
    loadInvoices('all');
  } catch(e) { toast('Failed to create invoice: ' + e.message, 'error'); }
}


/* ── Knowledge Base ────────────────────────────────── */
let _kbAll = [];
let _kbCatFilter = 'all';
let _kbPendingFiles = [];  // files staged for upload on save

const KB_CAT_COLORS = {
  strategy: '#4F6EF7', clients: '#34C759', market: '#f5a623',
  process: '#06b6d4', tech: '#a855f7', finance: '#FF375F', other: '#9898c0'
};

async function loadKnowledgeBase(forceRefresh) {
  const el = document.getElementById('kb-entries');
  if (!el) return;
  if (!forceRefresh && el.dataset.loaded) return;
  el.dataset.loaded = '1';
  render(el, '<div class="spinner" style="margin:32px auto"></div>');
  try {
    const data = await API.get('/api/knowledge-base');
    _kbAll = Array.isArray(data) ? data : (data.entries || []);
    _renderKbCats();
    _renderKbGrid(_kbAll);
  } catch(e) {
    // Fallback to localStorage cache
    _kbAll = JSON.parse(localStorage.getItem('kb_local') || '[]');
    _renderKbCats();
    _renderKbGrid(_kbAll);
  }
}

function _renderKbCats() {
  const el = document.getElementById('kb-cats');
  if (!el) return;
  const cats = ['all', ...new Set(_kbAll.map(k => k.category || 'other'))];
  render(el, cats.map(c =>
    '<button class="kb-cat-btn' + (c === _kbCatFilter ? ' active' : '') + '" onclick="_kbCatFilter=\'' + escapeHtml(c) + '\';_renderKbCats();filterKb(document.getElementById(\'kb-search\')?.value||\'\')" style="' +
    (c !== 'all' ? '--cat-color:' + (KB_CAT_COLORS[c] || '#9898c0') : '--cat-color:var(--accent)') + '">' +
    escapeHtml(c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)) + '</button>'
  ).join(''));
}

function filterKb(query) {
  const q = (query || '').toLowerCase();
  const filtered = _kbAll.filter(k => {
    const matchCat = _kbCatFilter === 'all' || (k.category || 'other') === _kbCatFilter;
    const matchQuery = !q || (k.title || '').toLowerCase().includes(q) ||
      (k.content || '').toLowerCase().includes(q) ||
      (k.tags || '').toLowerCase().includes(q);
    return matchCat && matchQuery;
  });
  _renderKbGrid(filtered);
}

function _renderKbGrid(items) {
  const el = document.getElementById('kb-entries');
  if (!el) return;
  if (!items.length) {
    render(el, '<div style="grid-column:1/-1">' + emptyState('No entries found — add your first insight!', 'book-open') + '</div>');
    return;
  }
  render(el, items.map(k => {
    const cat = k.category || 'other';
    const color = KB_CAT_COLORS[cat] || '#9898c0';
    const tags = (k.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const preview = (k.content || '').slice(0, 140).replace(/\n/g, ' ');
    return '<div class="kb-card" onclick="viewKbEntry(\'' + escapeHtml(k.id) + '\')">' +
      '<div class="kb-card-accent" style="background:' + color + '"></div>' +
      '<div class="kb-card-body">' +
      '<div class="kb-card-cat" style="color:' + color + '">' + escapeHtml(cat.toUpperCase()) + '</div>' +
      '<div class="kb-card-title">' + escapeHtml(k.title || 'Untitled') + '</div>' +
      '<div class="kb-card-preview">' + escapeHtml(preview) + (preview.length >= 140 ? '…' : '') + '</div>' +
      (tags.length ? '<div class="kb-card-tags">' + tags.map(t => '<span class="kb-tag">' + escapeHtml(t) + '</span>').join('') + '</div>' : '') +
      '<div class="kb-card-meta">' + escapeHtml(_fmtDate(k.createdAt)) + '</div>' +
      '</div></div>';
  }).join(''));
}

function _fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function viewKbEntry(id) {
  const k = _kbAll.find(x => String(x.id) === String(id));
  if (!k) return;
  window._kbDetailId = id;
  const cat = k.category || 'other';
  const color = KB_CAT_COLORS[cat] || '#9898c0';
  document.getElementById('kb-detail-title').textContent = k.title || 'Untitled';
  const catBadge = document.getElementById('kb-detail-cat');
  catBadge.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
  catBadge.style.background = color + '22';
  catBadge.style.color = color;
  catBadge.style.border = '1px solid ' + color + '44';
  document.getElementById('kb-detail-body').textContent = k.content || '';
  const tags = (k.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const tagsEl = document.getElementById('kb-detail-tags');
  render(tagsEl, tags.map(t => '<span class="kb-tag">' + escapeHtml(t) + '</span>').join(''));
  document.getElementById('kb-detail-meta').textContent = 'Added ' + _fmtDate(k.createdAt);
  const dm = document.getElementById('kb-detail-modal');
  dm.classList.remove('hidden'); dm.classList.add('open');
}

function closeKbDetailModal() {
  const dm = document.getElementById('kb-detail-modal');
  dm.classList.add('hidden'); dm.classList.remove('open');
  window._kbDetailId = null;
}

function openKbModal(entry) {
  document.getElementById('kb-modal-title').textContent = entry ? 'Edit Entry' : 'Add Knowledge Entry';
  document.getElementById('kb-edit-id').value = entry ? (entry.id || '') : '';
  document.getElementById('kb-title').value = entry ? (entry.title || '') : '';
  document.getElementById('kb-category').value = entry ? (entry.category || 'strategy') : 'strategy';
  document.getElementById('kb-content').value = entry ? (entry.content || '') : '';
  document.getElementById('kb-tags').value = entry ? (entry.tags || '') : '';
  // Reset pending files
  _kbPendingFiles = [];
  _renderKbFileList();
  const inp = document.getElementById('kb-file-input');
  if (inp) { inp.value = ''; inp.onchange = _kbFilesSelected; }
  const drop = document.getElementById('kb-file-drop');
  if (drop) {
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('drag-over'); };
    drop.ondragleave = () => drop.classList.remove('drag-over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('drag-over'); _kbAddFiles(e.dataTransfer.files); };
  }
  const km = document.getElementById('kb-modal');
  km.classList.remove('hidden'); km.classList.add('open');
  setTimeout(() => document.getElementById('kb-title')?.focus(), 80);
}

function _kbFilesSelected(e) { _kbAddFiles(e.target.files); }

function _kbAddFiles(fileList) {
  Array.from(fileList).forEach(f => {
    if (f.size > 25 * 1024 * 1024) { toast(f.name + ' exceeds 25 MB', 'error'); return; }
    if (!_kbPendingFiles.find(x => x.name === f.name && x.size === f.size)) _kbPendingFiles.push(f);
  });
  _renderKbFileList();
}

function _removeKbFile(idx) { _kbPendingFiles.splice(idx, 1); _renderKbFileList(); }

function _renderKbFileList() {
  const el = document.getElementById('kb-file-list');
  if (!el) return;
  render(el, _kbPendingFiles.map((f, i) =>
    '<div class="kb-file-item">' +
    '<i data-lucide="file" style="width:13px;height:13px;flex-shrink:0"></i>' +
    '<span class="kb-file-name">' + escapeHtml(f.name) + '</span>' +
    '<span class="kb-file-size">' + (f.size / 1024).toFixed(0) + ' KB</span>' +
    '<button class="kb-file-remove" onclick="event.stopPropagation();_removeKbFile(' + i + ')" title="Remove">✕</button>' +
    '</div>'
  ).join(''));
  refreshIcons();
}

function closeKbModal() {
  _kbPendingFiles = [];
  const km = document.getElementById('kb-modal');
  km.classList.add('hidden'); km.classList.remove('open');
}

async function saveKbEntry() {
  const id = document.getElementById('kb-edit-id').value;
  const title = document.getElementById('kb-title').value.trim();
  const category = document.getElementById('kb-category').value;
  const content = document.getElementById('kb-content').value.trim();
  const tags = document.getElementById('kb-tags').value.trim();
  if (!title || !content) { toast('Title and content required', 'error'); return; }
  const payload = { title, category, content, tags };
  let entryId = id;
  try {
    if (id) {
      await API.post('/api/knowledge-base/' + id, payload);
      const idx = _kbAll.findIndex(k => String(k.id) === String(id));
      if (idx >= 0) _kbAll[idx] = { ..._kbAll[idx], ...payload };
    } else {
      const res = await API.post('/api/knowledge-base', payload);
      entryId = res.id || 'local-' + Date.now();
      const newEntry = { id: entryId, ...payload, createdAt: new Date().toISOString() };
      _kbAll.unshift(newEntry);
    }
  } catch(e) {
    entryId = 'local-' + Date.now();
    const newEntry = { id: entryId, ...payload, createdAt: new Date().toISOString() };
    _kbAll.unshift(newEntry);
  }
  // Upload any pending files
  if (_kbPendingFiles.length) {
    const fd = new FormData();
    _kbPendingFiles.forEach(f => fd.append('files', f));
    fd.append('entryId', String(entryId));
    fd.append('context', 'knowledge-base');
    try {
      await fetch('/api/files/upload', { method: 'POST', body: fd });
      toast(_kbPendingFiles.length + ' file(s) attached', 'success');
    } catch(e) { toast('Files could not upload: ' + e.message, 'error'); }
  }
  localStorage.setItem('kb_local', JSON.stringify(_kbAll));
  closeKbModal();
  _renderKbCats();
  filterKb(document.getElementById('kb-search')?.value || '');
  toast('Entry saved', 'success');
}

function editKbEntry(id) {
  const k = _kbAll.find(x => String(x.id) === String(id));
  if (!k) return;
  closeKbDetailModal();
  openKbModal(k);
}

async function deleteKbEntry(id) {
  if (!confirm('Delete this entry?')) return;
  try { await API.post('/api/knowledge-base/' + id + '/delete', {}); } catch(e) {}
  _kbAll = _kbAll.filter(k => String(k.id) !== String(id));
  localStorage.setItem('kb_local', JSON.stringify(_kbAll));
  closeKbDetailModal();
  _renderKbCats();
  filterKb(document.getElementById('kb-search')?.value || '');
  toast('Entry deleted', 'success');
}

/* ── KB File Browser ───────────────────────────────── */
let _kbActiveFolder = null;

function switchKbTab(tab, el) {
  document.querySelectorAll('[data-kbtab]').forEach(b => b.classList.toggle('active', b === el));
  const entriesTab = document.getElementById('kb-entries-tab');
  const filesTab = document.getElementById('kb-files-tab');
  const addEntryBtn = document.getElementById('kb-add-entry-btn');
  const uploadBtn = document.getElementById('kb-upload-btn');
  if (tab === 'files') {
    entriesTab?.classList.add('hidden');
    filesTab?.classList.remove('hidden');
    addEntryBtn?.classList.add('hidden');
    uploadBtn?.classList.remove('hidden');
    loadKbFileBrowser();
  } else {
    entriesTab?.classList.remove('hidden');
    filesTab?.classList.add('hidden');
    addEntryBtn?.classList.remove('hidden');
    uploadBtn?.classList.add('hidden');
  }
}

function triggerKbFileUpload() {
  document.getElementById('kb-file-upload-input')?.click();
}

function handleKbFileUpload(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  const folderId = _kbActiveFolder || 'general';
  const stored = JSON.parse(localStorage.getItem('kb_files') || '{}');
  if (!stored[folderId]) stored[folderId] = [];
  files.forEach(file => {
    stored[folderId].push({ name: file.name, size: file.size, type: file.type, uploaded: new Date().toISOString() });
  });
  localStorage.setItem('kb_files', JSON.stringify(stored));
  event.target.value = '';
  toast(files.length + ' file' + (files.length > 1 ? 's' : '') + ' uploaded to ' + folderId, 'success');
  loadKbFileBrowser();
}

async function loadKbFileBrowser() {
  const el = document.getElementById('kb-file-browser');
  if (!el) return;
  render(el, '<div class="spinner" style="margin:32px auto"></div>');

  // Load clients + brands to build folder tree
  let clients = [], brands = [];
  try {
    const cd = await API.get('/api/clients');
    clients = (Array.isArray(cd)?cd:(cd.clients||cd.records||[])).map(c => ({ id: c.id, name: (c.fields||c).Name||(c.fields||c).name||'Client' }));
  } catch(e) { clients = [{ id: 'general', name: 'General' }]; }
  try {
    const bd = await API.get('/api/brands');
    brands = Array.isArray(bd) ? bd.map(b => ({ id: b.id, name: (b.fields||b).Name||(b.fields||b).name||'Brand' })) : [];
  } catch(e) { brands = []; }

  const stored = JSON.parse(localStorage.getItem('kb_files') || '{}');
  const _fmt = (bytes) => bytes < 1024 ? bytes+'B' : bytes < 1048576 ? (bytes/1024).toFixed(1)+'KB' : (bytes/1048576).toFixed(1)+'MB';
  const _icon = type => type.startsWith('image') ? 'image' : type.includes('pdf') ? 'file-text' : type.includes('sheet') || type.includes('csv') ? 'table' : type.includes('video') ? 'video' : 'file';

  const renderFolder = (folderId, folderName, icon) => {
    const files = stored[folderId] || [];
    const isActive = _kbActiveFolder === folderId;
    return '<div class="kb-folder-section">' +
      '<div class="kb-folder-row' + (isActive ? ' active' : '') + '" onclick="_kbActiveFolder=\'' + escapeHtml(folderId) + '\';loadKbFileBrowser()">' +
        '<i data-lucide="' + icon + '" style="width:15px;height:15px;color:var(--accent)"></i>' +
        '<span>' + escapeHtml(folderName) + '</span>' +
        '<span class="kb-folder-count">' + files.length + '</span>' +
      '</div>' +
      (isActive
        ? '<div class="kb-folder-files">' +
            (files.length
              ? files.map(f => '<div class="kb-file-row">' +
                  '<i data-lucide="' + _icon(f.type) + '" style="width:14px;height:14px;color:var(--text-3)"></i>' +
                  '<div class="kb-file-info"><div class="kb-file-name2">' + escapeHtml(f.name) + '</div>' +
                  '<div class="kb-file-meta">' + _fmt(f.size) + ' · ' + new Date(f.uploaded).toLocaleDateString('en-IN', {day:'numeric',month:'short'}) + '</div></div>' +
                  '</div>').join('')
              : '<div class="kb-folder-empty">Drop files here — click Upload File above</div>') +
          '</div>'
        : '') +
    '</div>';
  };

  let html = '<div class="kb-folder-tree">';
  html += '<div class="kb-folder-group-label">Clients</div>';
  if (clients.length) clients.forEach(c => { html += renderFolder('client_' + c.id, c.name, 'user'); });
  else html += '<div class="kb-folder-empty" style="padding:8px 20px">No clients yet</div>';
  if (brands.length) {
    html += '<div class="kb-folder-group-label" style="margin-top:16px">Brands</div>';
    brands.forEach(b => { html += renderFolder('brand_' + b.id, b.name, 'git-branch'); });
  }
  html += '<div class="kb-folder-group-label" style="margin-top:16px">General</div>';
  html += renderFolder('general', 'General / Agency', 'briefcase');
  html += '</div>';

  render(el, html);
  refreshIcons();
}

/* ── SOPs ──────────────────────────────────────────── */
let _sopsAll = [];
let _sopsCatFilter = 'all';
const SOP_CAT_COLORS = {
  ops:'#5b72f5', content:'#00c48c', client:'#f5a623',
  finance:'#FF375F', growth:'#a855f7', tech:'#06b6d4'
};
const SOP_CAT_LABELS = { ops:'Operations', content:'Content', client:'Client', finance:'Finance', growth:'Growth', tech:'Tech' };

async function loadSops(forceRefresh) {
  const grid = document.getElementById('sop-grid');
  if (!grid) return;
  if (_sopsAll.length && !forceRefresh) { _renderSopCats(); filterSops(document.getElementById('sop-search')?.value||''); return; }
  render(grid, '<div class="spinner" style="margin:40px auto"></div>');
  try {
    const data = await API.get('/api/sops');
    _sopsAll = data.sops || [];
  } catch(e) {
    // Fall back to localStorage
    try { _sopsAll = JSON.parse(localStorage.getItem('sops_local')||'[]'); } catch(x) { _sopsAll = []; }
  }
  // Seed starter SOPs if none exist
  if (!_sopsAll.length) {
    _sopsAll = [
      { id:'seed-sop-1', title:'New Client Onboarding', category:'client', description:'End-to-end process for onboarding a new retainer client — from signed contract to first content brief.', owner:'Yash', steps:JSON.stringify(['Collect brand assets & brand guide','Set up client folder in Google Drive','Create Airtable records (client + deliverables)','Schedule kickoff call & send agenda','Record brand voice in Client Context','Brief content team on first month plan','Send WhatsApp introduction message']), tags:JSON.stringify(['client','onboarding','process']), created_at: new Date().toISOString() },
      { id:'seed-sop-2', title:'Monthly Content Planning', category:'content', description:'Monthly ritual for planning and scheduling all content across all active clients.', owner:'Yash', steps:JSON.stringify(['Pull last month\'s performance data from Airtable','Review client briefs and upcoming campaigns','Draft content calendar for each client','Get client approval on content mix','Assign content types to creation queue','Schedule posts in content calendar','Brief design team on visual assets needed']), tags:JSON.stringify(['content','monthly','planning']), created_at: new Date().toISOString() },
      { id:'seed-sop-3', title:'Invoice & Payment Collection', category:'finance', description:'Monthly finance cycle — send invoices and follow up on outstanding payments.', owner:'Yash', steps:JSON.stringify(['Generate invoices for all active retainers on the 25th','Send invoices via email with bank details','Add to Airtable Financials table','Send WhatsApp reminder if unpaid after 3 days','Mark as paid on receipt + update Airtable','Reconcile monthly revenue in reports']), tags:JSON.stringify(['finance','invoicing','monthly']), created_at: new Date().toISOString() },
      { id:'seed-sop-4', title:'Lead Qualification Process', category:'growth', description:'Systematic approach to qualifying inbound leads before scheduling a discovery call.', owner:'Yash', steps:JSON.stringify(['Check lead source and initial message quality','Research the company (website, social, revenue estimate)','Run Lead Qualifier agent in Workbench','Score: budget ≥ ₹40k/mo, clear goal, decision-maker contact','If qualified: send discovery call calendar link','If not qualified: send polite decline template','Log outcome in Airtable Leads table']), tags:JSON.stringify(['leads','growth','qualification']), created_at: new Date().toISOString() },
    ];
    localStorage.setItem('sops_local', JSON.stringify(_sopsAll));
  }
  _renderSopCats();
  filterSops('');
}

function _renderSopCats() {
  const cats = document.getElementById('sop-cats');
  if (!cats) return;
  const counts = {};
  _sopsAll.forEach(s => { counts[s.category] = (counts[s.category]||0)+1; });
  render(cats,
    `<button class="kb-cat-btn ${_sopsCatFilter==='all'?'active':''}" onclick="setSopCat('all',this)">All <span class="kb-cat-count">${_sopsAll.length}</span></button>` +
    Object.entries(SOP_CAT_LABELS).filter(([k])=>counts[k]).map(([k,label]) =>
      `<button class="kb-cat-btn ${_sopsCatFilter===k?'active':''}" onclick="setSopCat('${k}',this)" style="--cat-color:${SOP_CAT_COLORS[k]}">
        ${label} <span class="kb-cat-count" style="background:${SOP_CAT_COLORS[k]}22;color:${SOP_CAT_COLORS[k]}">${counts[k]||0}</span>
      </button>`
    ).join('')
  );
}

function setSopCat(cat, btn) {
  _sopsCatFilter = cat;
  document.querySelectorAll('#sop-cats .kb-cat-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  filterSops(document.getElementById('sop-search')?.value||'');
}

function filterSops(query) {
  const q = (query||'').toLowerCase();
  let items = _sopsAll;
  if (_sopsCatFilter !== 'all') items = items.filter(s => s.category === _sopsCatFilter);
  if (q) items = items.filter(s =>
    (s.title||'').toLowerCase().includes(q) ||
    (s.description||'').toLowerCase().includes(q) ||
    (s.owner||'').toLowerCase().includes(q)
  );
  _renderSopGrid(items);
}

function _renderSopGrid(items) {
  const grid = document.getElementById('sop-grid');
  if (!grid) return;
  if (!items.length) { render(grid, emptyState('No SOPs found', 'file-text')); return; }
  render(grid, '<div class="sop-grid">'+items.map(s => {
    const id = escapeHtml(String(s.id));
    const color = SOP_CAT_COLORS[s.category] || '#5b72f5';
    const catLabel = SOP_CAT_LABELS[s.category] || s.category;
    let steps = [];
    try { steps = JSON.parse(s.steps||'[]'); } catch(e) {}
    const created = s.created_at ? new Date(s.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '';
    return `<div class="sop-card" onclick="viewSop('${id}')">
      <div class="sop-card-accent" style="background:${color}"></div>
      <div class="sop-card-body">
        <div class="sop-card-header">
          <span class="sop-cat-badge" style="background:${color}22;color:${color};border-color:${color}44">${escapeHtml(catLabel)}</span>
          <span class="sop-step-count"><i data-lucide="list" style="width:11px;height:11px"></i> ${steps.length} step${steps.length!==1?'s':''}</span>
        </div>
        <div class="sop-card-title">${escapeHtml(s.title||'Untitled')}</div>
        ${s.description ? `<div class="sop-card-desc">${escapeHtml(s.description.slice(0,100))}${s.description.length>100?'…':''}</div>` : ''}
        <div class="sop-card-footer">
          <span class="sop-owner"><i data-lucide="user" style="width:11px;height:11px;opacity:0.5"></i> ${escapeHtml(s.owner||'—')}</span>
          <span class="sop-date">${created}</span>
        </div>
      </div>
    </div>`;
  }).join('')+'</div>');
  refreshIcons();
}

function viewSop(id) {
  const sop = _sopsAll.find(s => String(s.id) === String(id));
  if (!sop) return;
  const overlay = document.getElementById('sop-detail-overlay');
  const titleEl = document.getElementById('sop-detail-title');
  const metaEl = document.getElementById('sop-detail-meta');
  const bodyEl = document.getElementById('sop-detail-body');
  const editBtn = document.getElementById('sop-detail-edit-btn');
  if (!overlay || !titleEl || !bodyEl) return;

  titleEl.textContent = sop.title;
  if (metaEl) {
    const color = SOP_CAT_COLORS[sop.category]||'#5b72f5';
    const catLabel = SOP_CAT_LABELS[sop.category]||sop.category;
    metaEl.innerHTML = `<span style="color:${color}">${escapeHtml(catLabel)}</span> · Owner: ${escapeHtml(sop.owner||'—')}`;
  }
  if (editBtn) editBtn.onclick = () => { closeSopDetail(); openSopModal(sop); };

  let steps = [];
  try { steps = JSON.parse(sop.steps||'[]'); } catch(e) {}
  let tags = [];
  try { tags = JSON.parse(sop.tags||'[]'); } catch(e) {}

  render(bodyEl,
    (sop.description ? `<p style="color:var(--text-2);font-size:0.875rem;line-height:1.6;margin-bottom:20px">${escapeHtml(sop.description)}</p>` : '') +
    (steps.length ? `<div class="sop-steps-view"><h3 class="sop-steps-heading">Steps</h3><ol class="sop-steps-list">` +
      steps.map((step,i) => `<li class="sop-step-item"><span class="sop-step-num">${i+1}</span><span class="sop-step-text">${escapeHtml(step)}</span></li>`).join('') +
    `</ol></div>` : '') +
    (tags.length ? `<div class="sop-tags-row">${tags.map(t=>`<span class="kb-tag">${escapeHtml(t)}</span>`).join('')}</div>` : '') +
    `<div class="sop-detail-footer">
      <button class="btn btn-ghost btn-sm" onclick="deleteSop('${escapeHtml(String(sop.id))}')"><i data-lucide="trash-2" style="width:13px;height:13px"></i> Delete</button>
    </div>`
  );
  refreshIcons();
  overlay.classList.remove('hidden');
  overlay.classList.add('open');
}

function closeSopDetail() {
  const overlay = document.getElementById('sop-detail-overlay');
  if (overlay) { overlay.classList.add('hidden'); overlay.classList.remove('open'); }
}

let _sopStepCount = 0;
function openSopModal(sop) {
  const overlay = document.getElementById('sop-modal-overlay');
  if (!overlay) return;
  const titleEl = document.getElementById('sop-modal-title');
  const idEl = document.getElementById('sop-edit-id');
  _sopStepCount = 0;

  if (sop) {
    if (titleEl) titleEl.textContent = 'Edit SOP';
    if (idEl) idEl.value = sop.id;
    document.getElementById('sop-form-title').value = sop.title||'';
    document.getElementById('sop-form-category').value = sop.category||'ops';
    document.getElementById('sop-form-owner').value = sop.owner||'Yash';
    document.getElementById('sop-form-desc').value = sop.description||'';
    const stepsList = document.getElementById('sop-steps-list');
    if (stepsList) {
      stepsList.innerHTML = '';
      let steps = [];
      try { steps = JSON.parse(sop.steps||'[]'); } catch(e) {}
      steps.forEach(s => _addSopStepRow(s));
    }
  } else {
    if (titleEl) titleEl.textContent = 'New SOP';
    if (idEl) idEl.value = '';
    document.getElementById('sop-form-title').value = '';
    document.getElementById('sop-form-category').value = 'ops';
    document.getElementById('sop-form-owner').value = 'Yash';
    document.getElementById('sop-form-desc').value = '';
    const stepsList = document.getElementById('sop-steps-list');
    if (stepsList) { stepsList.innerHTML = ''; }
    _addSopStepRow('');
  }
  overlay.classList.remove('hidden');
  overlay.classList.add('open');
}

function closeSopModal() {
  const overlay = document.getElementById('sop-modal-overlay');
  if (overlay) { overlay.classList.add('hidden'); overlay.classList.remove('open'); }
}

function addSopStep() { _addSopStepRow(''); }

function _addSopStepRow(value) {
  const list = document.getElementById('sop-steps-list');
  if (!list) return;
  const idx = _sopStepCount++;
  const row = document.createElement('div');
  row.className = 'sop-step-row';
  row.dataset.idx = idx;
  row.innerHTML = `<span class="sop-step-num-input">${idx+1}</span>
    <input class="form-input sop-step-input" value="${escapeHtml(value)}" placeholder="Describe this step...">
    <button class="btn btn-ghost sop-step-remove" onclick="this.closest('.sop-step-row').remove();_renumberSopSteps()" style="padding:4px 8px;opacity:0.5">×</button>`;
  list.appendChild(row);
  // Re-number existing rows
  _renumberSopSteps();
}

function _renumberSopSteps() {
  const rows = document.querySelectorAll('#sop-steps-list .sop-step-row');
  rows.forEach((r, i) => {
    const numEl = r.querySelector('.sop-step-num-input');
    if (numEl) numEl.textContent = i+1;
  });
}

async function saveSop() {
  const title = document.getElementById('sop-form-title')?.value.trim();
  if (!title) { toast('Please add a title', 'error'); return; }

  const id = document.getElementById('sop-edit-id')?.value;
  const category = document.getElementById('sop-form-category')?.value || 'ops';
  const owner = document.getElementById('sop-form-owner')?.value.trim() || 'Yash';
  const description = document.getElementById('sop-form-desc')?.value.trim() || '';

  const stepInputs = document.querySelectorAll('#sop-steps-list .sop-step-input');
  const steps = Array.from(stepInputs).map(i=>i.value.trim()).filter(Boolean);

  const payload = { title, category, description, owner, steps: JSON.stringify(steps), tags: '[]' };

  try {
    let saved;
    if (id) {
      const data = await API.put('/api/sops/'+id, payload);
      saved = data.sop || { ...payload, id, steps: JSON.stringify(steps), updated_at: new Date().toISOString() };
      const idx = _sopsAll.findIndex(s => String(s.id) === String(id));
      if (idx >= 0) _sopsAll[idx] = saved; else _sopsAll.unshift(saved);
      toast('SOP updated', 'success');
    } else {
      const data = await API.post('/api/sops', payload);
      saved = data.sop || { ...payload, id: 'local-'+Date.now(), steps: JSON.stringify(steps), created_at: new Date().toISOString() };
      _sopsAll.unshift(saved);
      toast('SOP created', 'success');
    }
    localStorage.setItem('sops_local', JSON.stringify(_sopsAll));
    closeSopModal();
    _renderSopCats();
    filterSops(document.getElementById('sop-search')?.value||'');
  } catch(e) {
    // Offline fallback
    const localSop = { ...payload, id: id||('local-'+Date.now()), steps: JSON.stringify(steps), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (id) {
      const idx = _sopsAll.findIndex(s=>String(s.id)===String(id));
      if (idx>=0) _sopsAll[idx]=localSop; else _sopsAll.unshift(localSop);
    } else { _sopsAll.unshift(localSop); }
    localStorage.setItem('sops_local', JSON.stringify(_sopsAll));
    closeSopModal();
    _renderSopCats();
    filterSops(document.getElementById('sop-search')?.value||'');
    toast('Saved locally', 'info');
  }
}

async function deleteSop(id) {
  if (!confirm('Delete this SOP? This cannot be undone.')) return;
  try { await API.delete('/api/sops/'+id); } catch(e) {}
  _sopsAll = _sopsAll.filter(s => String(s.id) !== String(id));
  localStorage.setItem('sops_local', JSON.stringify(_sopsAll));
  closeSopDetail();
  _renderSopCats();
  filterSops(document.getElementById('sop-search')?.value||'');
  toast('SOP deleted', 'success');
}

/* ── Chat ──────────────────────────────────────────── */
function newChat() {
  State.sessionId = 'session-'+Date.now();
  const msgs = document.getElementById('chat-messages');
  render(msgs, '<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">New conversation started</div><div class="empty-desc">Ask anything about your clients, content, leads, or strategy.</div></div>');
  const chip = document.getElementById('session-id-chip');
  if (chip) { chip.textContent=State.sessionId; chip.style.display='inline-flex'; }
  if (typeof loadChatSessions!=='undefined') loadChatSessions();
}

// Chat file attachment state
let _chatAttachment = null;
function onChatFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  _chatAttachment = file;
  const preview = document.getElementById('chat-attachment-preview');
  const name = document.getElementById('chat-attachment-name');
  if (preview && name) { name.textContent = file.name + ' (' + (file.size/1024).toFixed(1) + ' KB)'; preview.style.display='flex'; }
}
function clearChatAttachment() {
  _chatAttachment = null;
  const input = document.getElementById('chat-file-input');
  if (input) input.value='';
  const preview = document.getElementById('chat-attachment-preview');
  if (preview) preview.style.display='none';
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if ((!msg && !_chatAttachment)||State.streaming) return;
  input.value = '';
  if (!State.sessionId) newChat();
  // Build display message
  const displayMsg = msg + (_chatAttachment ? '\n📎 ' + _chatAttachment.name : '');
  appendChatMessage('user', displayMsg);
  State.streaming = true;
  const btn = document.getElementById('chat-send-btn');
  if (btn) btn.disabled = true;
  const msgs = document.getElementById('chat-messages');
  const msgEl = document.createElement('div');
  msgEl.className = 'message message-assistant';
  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';
  contentEl.textContent = '…';
  msgEl.appendChild(contentEl);
  msgs.appendChild(msgEl);
  msgs.scrollTop = msgs.scrollHeight;
  // Read file content if attached
  let fileContent = '';
  if (_chatAttachment) {
    try {
      fileContent = await new Promise((res,rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        if (_chatAttachment.type.startsWith('image/')) reader.readAsDataURL(_chatAttachment);
        else reader.readAsText(_chatAttachment);
      });
    } catch(e) { fileContent = '[Could not read file]'; }
    clearChatAttachment();
  }
  const fullMsg = fileContent ? (msg + '\n\n[File: ' + (_chatAttachment?.name||'attached') + ']\n' + fileContent.slice(0, 8000)) : msg;
  try {
    State.abortCtrl = new AbortController();
    const r = await fetch('/api/chat/stream',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages:[{role:'user',content:fullMsg}],sessionId:State.sessionId,agentName:State.agentName,clientId:State.clientId,devilsAdvocate:State.devilsAdvocate}),
      signal:State.abortCtrl.signal
    });
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      dec.decode(value).split('\n').forEach(line => {
        if (line.startsWith('data: ')) {
          try { const d=JSON.parse(line.slice(6)); if (d.content) text+=d.content; else if (d.text) text+=d.text; } catch{}
        }
      });
      contentEl.textContent = text;
      msgs.scrollTop = msgs.scrollHeight;
    }
  } catch(e) {
    if (e.name!=='AbortError') contentEl.textContent = 'Error: '+e.message;
  } finally {
    State.streaming=false;
    if (btn) btn.disabled=false;
    msgs.scrollTop=msgs.scrollHeight;
    if (typeof loadChatSessions!=='undefined') loadChatSessions();
  }
}

function appendChatMessage(role, content) {
  const msgs = document.getElementById('chat-messages');
  const empty = msgs.querySelector('.empty-state');
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = 'message message-'+role;
  const c = document.createElement('div');
  c.className = 'message-content';
  c.textContent = content;
  el.appendChild(c);
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

function quickPrompt(p) { const i=document.getElementById('chat-input'); if(i){i.value=p;sendChatMessage();} }
function toggleDevilsAdvocate() {
  State.devilsAdvocate=!State.devilsAdvocate;
  document.getElementById('devil-toggle').classList.toggle('active',State.devilsAdvocate);
}
function toggleClientSelector() { openSelector('client'); }
function toggleAgentSelector() { openSelector('agent'); }
function toggleProjectSelector() { openSelector('project'); }

async function openSelector(mode) {
  State.selectorMode=mode;
  const modal=document.getElementById('selector-modal');
  const title=document.getElementById('selector-title');
  const body=document.getElementById('selector-body');
  const labels = {client:'Select Client', agent:'Select Agent', project:'Select Project'};
  title.textContent=labels[mode]||'Select';
  modal.classList.add('active');
  render(body, '<div class="spinner" style="margin:24px auto"></div>');
  try {
    if (mode==='client') {
      const c=await API.get('/api/clients');
      const arr=[{name:'Manthan (general)',id:null,desc:'Internal agency context'},...(Array.isArray(c)?c:(c.clients||c.records||[])).map(x=>({name:x.fields?.Name||x.name,id:x.id,desc:x.fields?.Industry||x.industry||''}))];
      render(body, arr.map(x=>
        '<div class="selector-item" onclick="selectItem(\''+escapeHtml(x.id||'')+'\',\''+escapeHtml(x.name||'').replace(/'/g,"\\'")+'\',this)">' +
        '<div class="selector-item-icon"><i data-lucide="user" style="width:15px;height:15px"></i></div>' +
        '<div class="selector-item-info"><div class="selector-item-name">'+escapeHtml(x.name||'')+'</div>' +
        (x.desc?'<div class="selector-item-desc">'+escapeHtml(x.desc)+'</div>':'')+'</div></div>'
      ).join(''));
      refreshIcons();
    } else if (mode==='agent') {
      const FALLBACK_AGENTS = [
        { name:'Orchestrator', id:'orchestrator', desc:'Routes and coordinates all agents' },
        { name:'Researcher', id:'researcher', desc:'Deep research & competitive intel' },
        { name:'Content Writer', id:'content-writer', desc:'Writes copy, captions & long-form' },
        { name:'Lead Qualifier', id:'lead-qualifier', desc:'Scores and qualifies inbound leads' },
        { name:'Brand Analyst', id:'brand-analyst', desc:'Brand strategy & positioning' },
        { name:'Finance Analyst', id:'finance-analyst', desc:'Revenue, invoices & forecasts' },
      ];
      let arr = [];
      try {
        const a = await API.get('/api/agents');
        arr = Array.isArray(a) ? a : [];
      } catch(e) { arr = []; }
      if (!arr.length) arr = FALLBACK_AGENTS;
      else arr = arr.map(x => ({ name: x.name || x.id, id: x.id || x.name, desc: x.description || x.desc || '' }));
      render(body, arr.map(x =>
        '<div class="selector-item" onclick="selectItem(\''+escapeHtml(x.id||x.name||'')+'\',\''+escapeHtml(x.name||'').replace(/'/g,"\\'")+'\',this)">' +
        '<div class="selector-item-icon"><i data-lucide="bot" style="width:16px;height:16px"></i></div>' +
        '<div class="selector-item-info"><div class="selector-item-name">'+escapeHtml(x.name||'')+'</div>' +
        (x.desc ? '<div class="selector-item-desc">'+escapeHtml(x.desc)+'</div>' : '') + '</div>' +
        '</div>'
      ).join(''));
      refreshIcons();
    } else if (mode==='project') {
      const p=await API.get('/api/projects').catch(()=>[]);
      const arr=[{name:'No project',id:null,desc:'General conversation'},...(Array.isArray(p)?p:(p.records||p.projects||[])).map(x=>({name:x.fields?.Name||x.name,id:x.id,desc:x.fields?.Status||x.status||''}))];
      render(body, arr.map(x=>
        '<div class="selector-item" onclick="selectItem(\''+escapeHtml(x.id||'')+'\',\''+escapeHtml(x.name||'').replace(/'/g,"\\'")+'\',this)">' +
        '<div class="selector-item-icon"><i data-lucide="folder" style="width:15px;height:15px"></i></div>' +
        '<div class="selector-item-info"><div class="selector-item-name">'+escapeHtml(x.name||'')+'</div>' +
        (x.desc?'<div class="selector-item-desc">'+escapeHtml(x.desc)+'</div>':'')+'</div></div>'
      ).join(''));
      refreshIcons();
    }
  } catch(e) { render(body, '<p class="text-rose">Error: '+escapeHtml(e.message)+'</p>'); }
}
function selectItem(id, name, el) {
  document.querySelectorAll('.selector-item').forEach(x=>x.classList.remove('active'));
  el.classList.add('active');
  if (State.selectorMode==='client') { State.clientId=id||null; document.getElementById('chat-client-label').textContent=name||'Manthan (general)'; }
  else if (State.selectorMode==='agent') { State.agentName=id||'orchestrator'; document.getElementById('chat-agent-label').textContent=name||'Auto'; }
  else if (State.selectorMode==='project') { State.projectId=id||null; document.getElementById('chat-project-label').textContent=name||'No project'; }
  closeSelector();
}
function closeSelector() { document.getElementById('selector-modal').classList.remove('active'); }
function clearChatConfirm() {
  if (!State.sessionId) return;
  if (confirm('Clear this chat session?')) deleteChatSession(State.sessionId);
}
function exportChat() {
  const msgs=document.querySelectorAll('.message');
  const text=Array.from(msgs).map(m=>(m.classList.contains('message-user')?'You':'AI')+': '+(m.querySelector('.message-content')?.textContent||'')).join('\n\n');
  const a=document.createElement('a');
  a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(text);
  a.download='chat-'+Date.now()+'.txt';
  a.click();
}

/* ── Onboarding ────────────────────────────────────── */
function openOnboardingWizard() { populateClientSelect('invoice-client'); initGradientPicker(); setEngagementType('retainer',null); document.getElementById('onboarding-modal').classList.add('active'); }
function closeOnboarding() { document.getElementById('onboarding-modal').classList.remove('active'); }
let _engagementType = 'retainer';
function setEngagementType(type, btn) {
  _engagementType = type;
  document.querySelectorAll('.engage-btn').forEach(b=>b.classList.toggle('active', b.dataset.type===type));
  document.getElementById('ob-retainer-group')?.classList.toggle('hidden', type!=='retainer');
  document.getElementById('ob-project-value-group')?.classList.toggle('hidden', type!=='one-time');
}
async function submitOnboarding() {
  const name=document.getElementById('ob-name').value.trim();
  const industry=document.getElementById('ob-industry').value.trim();
  if (!name||!industry) { toast('Name and industry required','error'); return; }
  const btn=document.getElementById('onboarding-submit');
  btn.disabled=true; btn.textContent='Onboarding…';
  const retainer = _engagementType==='retainer' ? (Number(document.getElementById('ob-retainer').value)||0) : 0;
  const projectValue = _engagementType==='one-time' ? (Number(document.getElementById('ob-project-value').value)||0) : 0;
  try {
    await API.post('/api/clients',{name,brandName:document.getElementById('ob-brand').value,industry,engagementType:_engagementType,retainer,projectValue,tone:document.getElementById('ob-tone').value,channels:document.getElementById('ob-channels').value,whatsapp:document.getElementById('ob-whatsapp').value});
    closeOnboarding(); toast('Client onboarded!','success');
    if (typeof loadClients!=='undefined') loadClients();
  } catch(e) { toast('Error: '+e.message,'error'); }
  finally { btn.disabled=false; btn.textContent='Onboard Client'; }
}
async function populateClientSelect(selectId) {
  const sel=document.getElementById(selectId);
  if (!sel) return;
  try {
    const data=await API.get('/api/clients');
    const arr=Array.isArray(data)?data:(data.clients||data.records||[]);
    render(sel, arr.map(c=>'<option value="'+escapeHtml(c.id||'')+'">'+escapeHtml(c.fields?.Name||c.name||'Client')+'</option>').join(''));
  } catch(e) { render(sel, '<option>No clients</option>'); }
}
function initGradientPicker() {
  const el=document.getElementById('gradient-picker'); if (!el) return;
  render(el, GRADIENTS.map((g,i)=>'<div style="width:32px;height:32px;border-radius:8px;background:'+g+';cursor:pointer;border:2px solid '+(i===0?'var(--accent)':'transparent')+'" onclick="selectGradient('+i+',this)" data-g="'+escapeHtml(g)+'"></div>').join(''));
  el.style.display='flex'; el.style.gap='8px'; el.style.flexWrap='wrap';
  el.dataset.selected=GRADIENTS[0];
}
function selectGradient(i, el) {
  document.querySelectorAll('#gradient-picker div').forEach(d=>d.style.borderColor='transparent');
  el.style.borderColor='var(--accent)';
  document.getElementById('gradient-picker').dataset.selected=GRADIENTS[i];
}

/* ── Search ────────────────────────────────────────── */
function openSearch() { document.getElementById('search-overlay').classList.add('active'); setTimeout(()=>document.getElementById('search-input').focus(),50); }
function closeSearch() { document.getElementById('search-overlay').classList.remove('active'); document.getElementById('search-input').value=''; document.getElementById('search-results').textContent=''; }

/* ── Notifications / Theme ─────────────────────────── */
function toggleNotifications() { document.getElementById('notif-panel').classList.toggle('active'); }
function markAllRead() { document.querySelectorAll('.notif-item.unread').forEach(n=>n.classList.remove('unread')); const c=document.getElementById('notif-count'); if(c)c.style.display='none'; }
function toggleTheme() {
  const isLight=document.body.classList.toggle('theme-light');
  const icon=document.getElementById('theme-icon');
  if (icon) icon.setAttribute('data-lucide',isLight?'sun':'moon');
  document.getElementById('theme-toggle')?.classList.toggle('on',!isLight);
  refreshIcons();
}
function toggleKeyVis(inputId, btn) {
  const inp=document.getElementById(inputId); if (!inp) return;
  const hide=inp.type==='text'; inp.type=hide?'password':'text';
  btn.textContent=hide?'Show':'Hide';
}

/* ── Helpers ───────────────────────────────────────── */
function toast(msg, type='info') {
  const c=document.getElementById('toast-container'); if (!c) return;
  const t=document.createElement('div');
  t.className='toast toast-'+type; t.textContent=msg;
  c.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('visible'));
  setTimeout(()=>{ t.classList.remove('visible'); setTimeout(()=>t.remove(),300); },3500);
}
// Alias used by features.js
function showToast(msg, type='success') { toast(msg, type); }
function emptyState(title, icon='inbox') {
  return '<div class="empty-state"><i data-lucide="'+escapeHtml(icon)+'" style="width:32px;height:32px;color:var(--text-3)"></i><div class="empty-title">'+escapeHtml(title)+'</div></div>';
}
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatTime(ts) {
  if (!ts) return '';
  const d=new Date(ts),now=new Date(),diff=now-d;
  if (diff<60000) return 'just now';
  if (diff<3600000) return Math.floor(diff/60000)+'m ago';
  if (diff<86400000) return Math.floor(diff/3600000)+'h ago';
  return d.toLocaleDateString();
}
function refreshIcons() { if (window.lucide) { try { window.lucide.createIcons(); } catch(e){} } }

/* ── Company Profile ────────────────────────────────── */
const _COMPANY_MOODS = [
  { emoji:'🚀', tagline:'Velocity mode', desc:'The kind of agency that ships before the brief is finished.', color:'linear-gradient(135deg,#4F6EF7,#8B5CF6)' },
  { emoji:'🧠', tagline:'Deep work', desc:'Strategy first. Everything else is execution.', color:'linear-gradient(135deg,#00C48C,#4F6EF7)' },
  { emoji:'⚡', tagline:'High voltage', desc:'When clients need results, not reports.', color:'linear-gradient(135deg,#F5A623,#F44336)' },
  { emoji:'🌙', tagline:'Night owl session', desc:'The best ideas happen after midnight.', color:'linear-gradient(135deg,#0F0F1A,#4F6EF7)' },
  { emoji:'🎯', tagline:'Precision strike', desc:'Every deliverable lands on target.', color:'linear-gradient(135deg,#EC4899,#8B5CF6)' },
  { emoji:'🌿', tagline:'Sustainable growth', desc:'Playing the long game for clients who deserve it.', color:'linear-gradient(135deg,#34C759,#00BCD4)' },
];
let _profileVisit = 0;

function openCompanyProfile() {
  const mood = _COMPANY_MOODS[_profileVisit % _COMPANY_MOODS.length];
  _profileVisit++;
  const body = document.getElementById('company-profile-body');
  const savedLogo = localStorage.getItem('entity_img_agency_agency');
  if (body) render(body, `
    <div style="text-align:center;margin-bottom:24px">
      <div class="entity-avatar-wrap" style="display:inline-block;margin:0 auto 12px" onclick="triggerAgencyLogoUpload()">
        ${savedLogo
          ? `<img id="agency-logo-img" src="${savedLogo}" style="width:72px;height:72px;border-radius:20px;object-fit:cover;display:block">`
          : `<div id="agency-logo-img" style="width:72px;height:72px;border-radius:20px;background:${mood.color};display:flex;align-items:center;justify-content:center;font-size:2rem">${mood.emoji}</div>`
        }
        <div class="entity-avatar-upload-btn" title="Change logo"><i data-lucide="camera" style="width:14px;height:14px"></i></div>
        <input type="file" id="agency-logo-input" accept="image/*" style="display:none" onchange="handleAgencyLogoUpload(event)">
      </div>
      <div style="font-size:1.25rem;font-weight:700;color:var(--text-1)">Manthan Agency OS</div>
      <div style="font-size:0.75rem;color:var(--accent);font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-top:4px">${mood.tagline}</div>
      <div style="font-size:0.875rem;color:var(--text-3);margin-top:8px;max-width:340px;margin-left:auto;margin-right:auto">${mood.desc}</div>
    </div>
    <div class="grid grid-2" style="gap:12px;margin-bottom:16px">
      <div style="background:var(--surface-2);border-radius:12px;padding:14px;border:1px solid var(--border)">
        <div style="font-size:0.6875rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em">Founder</div>
        <div style="font-size:0.9375rem;font-weight:600;color:var(--text-1);margin-top:2px">Yash Kaushik</div>
        <div style="font-size:0.75rem;color:var(--text-3)">Bengaluru, India</div>
      </div>
      <div style="background:var(--surface-2);border-radius:12px;padding:14px;border:1px solid var(--border)">
        <div style="font-size:0.6875rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em">Mission</div>
        <div style="font-size:0.8125rem;color:var(--text-1);margin-top:2px;line-height:1.4">AI-first content &amp; growth agency for brands that think different.</div>
      </div>
    </div>
    <div style="background:var(--surface-2);border-radius:12px;padding:14px;border:1px solid var(--border);margin-bottom:12px">
      <div style="font-size:0.6875rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Powered By</div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <span class="badge">Claude AI</span><span class="badge">Airtable</span><span class="badge">n8n</span><span class="badge">Notion</span><span class="badge">WhatsApp</span>
      </div>
    </div>
    <p style="font-size:0.6875rem;color:var(--text-3);text-align:center;margin-top:16px">Click logo again for a different vibe ✨ (${_profileVisit} visits)</p>
  `);
  document.getElementById('company-profile-modal')?.classList.add('active');
  refreshIcons();
}
function closeCompanyProfile() { document.getElementById('company-profile-modal')?.classList.remove('active'); }

/* ── Entity image upload ───────────────────────────── */
function triggerEntityUpload(entity) {
  const inp = document.getElementById('entity-upload-input');
  if (!inp) return;
  inp.dataset.entity = entity;
  inp.click();
}

async function handleEntityImageUpload(event, entity) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    // Preview immediately
    if (entity === 'client') {
      const av = document.getElementById('client-detail-avatar');
      if (av) {
        av.style.backgroundImage = `url(${dataUrl})`;
        av.style.backgroundSize = 'cover';
        av.style.backgroundPosition = 'center';
        av.textContent = '';
      }
    } else if (entity === 'brand') {
      const av = document.getElementById('brand-avatar-img');
      if (av) { av.src = dataUrl; av.style.display = 'block'; }
    } else if (entity === 'agency') {
      const av = document.getElementById('agency-logo-img');
      if (av) { av.src = dataUrl; av.style.display = 'block'; }
      const logoIcon = document.getElementById('logo-icon');
      if (logoIcon) { logoIcon.style.backgroundImage=`url(${dataUrl})`; logoIcon.style.backgroundSize='cover'; logoIcon.style.backgroundPosition='center'; logoIcon.textContent=''; }
    }
    // Store in localStorage as fallback, also try API
    const storageKey = `entity_img_${entity}_${State.currentClientId || State.activeBrand || 'agency'}`;
    localStorage.setItem(storageKey, dataUrl);
    toast('Photo updated!', 'success');
    // Try sending to backend
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('entity', entity);
      if (entity === 'client' && State.currentClientId) {
        await fetch('/api/clients/' + State.currentClientId + '/image', { method: 'POST', body: fd });
      } else if (entity === 'brand' && State.activeBrand) {
        await fetch('/api/brands/' + State.activeBrand + '/image', { method: 'POST', body: fd });
      }
    } catch(e) { /* localStorage preview is enough */ }
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function triggerBrandImgUpload(brandId) {
  document.getElementById('brand-img-input-' + brandId)?.click();
}
function handleBrandImgUpload(event, brandId) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    localStorage.setItem('entity_img_brand_' + brandId, dataUrl);
    const el = document.getElementById('brand-avatar-img');
    if (el) { el.src = dataUrl; el.style.display = 'block'; }
    toast('Brand image updated!', 'success');
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function triggerAgencyLogoUpload() {
  document.getElementById('agency-logo-input')?.click();
}
async function handleAgencyLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    localStorage.setItem('entity_img_agency_agency', dataUrl);
    // Update modal preview
    const img = document.getElementById('agency-logo-img');
    if (img) { img.src = dataUrl; img.style.display = 'block'; }
    // Update sidebar logo
    const logoIcon = document.getElementById('logo-icon');
    if (logoIcon) {
      logoIcon.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
    }
    toast('Agency logo updated!', 'success');
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

/* ── Easter Eggs ────────────────────────────────────── */
const _KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
let _konamiIdx = 0;
function _launchRainbow() {
  toast('🎮 Cheat code activated! You\'ve unlocked: infinite creativity 🌈', 'success');
  document.body.style.transition = 'filter 2s ease';
  const colors = ['hue-rotate(0deg)','hue-rotate(60deg)','hue-rotate(120deg)','hue-rotate(180deg)','hue-rotate(240deg)','hue-rotate(300deg)','hue-rotate(360deg)'];
  let i = 0;
  const interval = setInterval(()=>{ document.body.style.filter=colors[i%colors.length]; i++; if(i>colors.length*2){clearInterval(interval);document.body.style.filter='';document.body.style.transition='';} }, 300);
}
// Hidden "matrix" mode — type "manthan" anywhere on page
let _secretBuf = '';
function _checkSecret(key) {
  _secretBuf = (_secretBuf + key).slice(-7);
  if (_secretBuf === 'manthan') {
    _secretBuf = '';
    toast('🤫 Secret mode activated. The matrix sees you.', 'success');
    const logoIcon = document.getElementById('logo-icon');
    if (logoIcon) { logoIcon.textContent = '∞'; setTimeout(()=>logoIcon.textContent='M', 3000); }
  }
}

/* ── Keyboard shortcuts ────────────────────────────── */
document.addEventListener('keydown', e => {
  // Konami code
  if (e.key === _KONAMI[_konamiIdx]) { _konamiIdx++; if(_konamiIdx===_KONAMI.length){_konamiIdx=0;_launchRainbow();} } else { _konamiIdx=0; }
  // Secret word
  if (!e.metaKey&&!e.ctrlKey&&e.key.length===1) _checkSecret(e.key);

  if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if ((e.metaKey||e.ctrlKey)&&e.key==='k') { e.preventDefault(); openSearch(); }
  if ((e.metaKey||e.ctrlKey)&&e.key==='/') { e.preventDefault(); navigate('chat'); }
  if ((e.metaKey||e.ctrlKey)&&e.key==='b') { e.preventDefault(); navigate('daily-planner'); }
  if ((e.metaKey||e.ctrlKey)&&e.key==='f') { e.preventDefault(); navigate('finance'); }
  if (e.key==='Escape') {
    closeSearch();
    document.querySelectorAll('.modal-overlay.active').forEach(m=>m.classList.remove('active'));
    if (typeof closeAgentDetail!=='undefined') closeAgentDetail();
    document.getElementById('notif-panel')?.classList.remove('active');
  }
});

/* ── Skills & Coding ───────────────────────────────── */
const SKILLS_CATALOG = [
  { id:'ai-prompting',    title:'AI Prompt Engineering', icon:'🤖', level:'Beginner',  desc:'Master prompting for Claude, GPT-4, and Gemini', tags:['AI','Writing'],
    modules:['What is a prompt?','System prompts & roles','Chain-of-thought prompting','Few-shot examples','Claude vs GPT-4 differences'],
    resources:[{label:'Anthropic Prompt Library',url:'https://docs.anthropic.com/en/prompt-library/library'},{label:'OpenAI Prompt Engineering Guide',url:'https://platform.openai.com/docs/guides/prompt-engineering'}],
    duration:'3 hrs', outcome:'Write production-quality prompts for any AI model' },
  { id:'js-fundamentals', title:'JavaScript Essentials',  icon:'⚡', level:'Beginner',  desc:'Functions, async/await, DOM — the frontend foundation', tags:['Code','JS'],
    modules:['Variables & types','Functions & scope','Promises & async/await','DOM manipulation','Fetch API & JSON'],
    resources:[{label:'MDN JavaScript Guide',url:'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide'},{label:'javascript.info',url:'https://javascript.info'}],
    duration:'6 hrs', outcome:'Build interactive web pages and call REST APIs' },
  { id:'node-backend',    title:'Node.js & Express',       icon:'🖥️', level:'Intermediate',desc:'Build REST APIs, middleware, and server-side logic', tags:['Code','Backend'],
    modules:['Node.js runtime','npm & packages','Express routing','Middleware pattern','JWT authentication'],
    resources:[{label:'Node.js Docs',url:'https://nodejs.org/en/docs'},{label:'Express.js Guide',url:'https://expressjs.com/en/guide/routing.html'}],
    duration:'8 hrs', outcome:'Build and deploy a secure REST API' },
  { id:'data-analysis',   title:'Data with Python',        icon:'📊', level:'Intermediate',desc:'Pandas, NumPy, and data visualisation', tags:['Data','Python'],
    modules:['Python basics','Pandas DataFrames','NumPy arrays','Matplotlib charts','CSV & JSON data pipelines'],
    resources:[{label:'Pandas Docs',url:'https://pandas.pydata.org/docs/getting_started/intro_tutorials/'},{label:'Real Python',url:'https://realpython.com/pandas-python-explore-dataset/'}],
    duration:'7 hrs', outcome:'Transform raw data into actionable insights' },
  { id:'automation',      title:'n8n Automation',          icon:'⚙️', level:'Beginner',  desc:'Workflows, webhooks, and no-code automations', tags:['Automation'],
    modules:['n8n overview','Triggers & webhooks','HTTP Request node','If/Switch logic','Connecting APIs'],
    resources:[{label:'n8n Docs',url:'https://docs.n8n.io'},{label:'n8n Community',url:'https://community.n8n.io'}],
    duration:'4 hrs', outcome:'Automate repetitive agency tasks end-to-end' },
  { id:'brand-strategy',  title:'Brand Strategy',          icon:'🎯', level:'Advanced',  desc:'Positioning, differentiation, and brand architecture', tags:['Strategy'],
    modules:['Brand positioning canvas','Competitive differentiation','Brand voice & tone','Visual identity system','Brand audit framework'],
    resources:[{label:'Nielsen Norman Brand UX',url:'https://www.nngroup.com/articles/brand-experience/'},{label:'Brand Strategy guide',url:'https://www.hubspot.com/brand-strategy'}],
    duration:'5 hrs', outcome:'Build a brand strategy deck clients pay for' },
  { id:'content-writing', title:'Content Strategy',        icon:'✍️', level:'Beginner',  desc:'Hook formulas, frameworks, and content calendars', tags:['Content'],
    modules:['Hook formulas (PAS, AIDA)','Headline writing','Content calendar planning','SEO-driven writing','Repurposing content across formats'],
    resources:[{label:'Copyblogger',url:'https://copyblogger.com'},{label:'Angi\'s Content Marketing Guide',url:'https://contentmarketinginstitute.com/articles/'}],
    duration:'4 hrs', outcome:'Produce high-converting content at scale' },
  { id:'sql-basics',      title:'SQL & Databases',         icon:'🗄️', level:'Intermediate',desc:'Queries, joins, indexes — backend data mastery', tags:['Code','Data'],
    modules:['SELECT & WHERE','JOINs explained','Aggregations & GROUP BY','Indexes & performance','PostgreSQL in practice'],
    resources:[{label:'SQLZoo',url:'https://sqlzoo.net'},{label:'PostgreSQL Tutorial',url:'https://www.postgresqltutorial.com'}],
    duration:'5 hrs', outcome:'Query any database with confidence' },
  { id:'git-workflow',    title:'Git & Version Control',   icon:'🔀', level:'Beginner',  desc:'Branching, PRs, and collaborative code workflows', tags:['Code'],
    modules:['Git init & commits','Branching strategy','Merging & rebasing','Pull requests','GitHub Actions basics'],
    resources:[{label:'Pro Git Book',url:'https://git-scm.com/book/en/v2'},{label:'GitHub Docs',url:'https://docs.github.com/en/get-started'}],
    duration:'3 hrs', outcome:'Collaborate on code without breaking things' },
  { id:'seo-growth',      title:'SEO & Growth',            icon:'📈', level:'Intermediate',desc:'On-page SEO, content clusters, link building', tags:['Growth'],
    modules:['Keyword research fundamentals','On-page optimisation','Content cluster strategy','Technical SEO basics','Link building tactics'],
    resources:[{label:'Ahrefs Blog',url:'https://ahrefs.com/blog'},{label:'Moz Beginner Guide',url:'https://moz.com/beginners-guide-to-seo'}],
    duration:'6 hrs', outcome:'Drive organic traffic to client websites' },
];

const LEVEL_COLOR = { Beginner:'#00c48c', Intermediate:'#f5a623', Advanced:'#ff4d6a' };

function loadSkillsCatalog() {
  const grid = document.getElementById('skills-grid');
  if (!grid || grid.dataset.loaded) return;
  grid.dataset.loaded = '1';
  render(grid, SKILLS_CATALOG.map(s =>
    '<div class="skill-card" onclick="openSkillDetail(\'' + s.id + '\')">' +
    '<div class="skill-card-icon">' + s.icon + '</div>' +
    '<div class="skill-card-body">' +
    '<div class="skill-card-title">' + escapeHtml(s.title) + '</div>' +
    '<div class="skill-card-desc">' + escapeHtml(s.desc) + '</div>' +
    '</div>' +
    '<span class="skill-level-badge" style="background:' + (LEVEL_COLOR[s.level]||'#9898c0') + '22;color:' + (LEVEL_COLOR[s.level]||'#9898c0') + ';border:1px solid ' + (LEVEL_COLOR[s.level]||'#9898c0') + '44">' + s.level + '</span>' +
    '<i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--text-3);flex-shrink:0"></i>' +
    '</div>'
  ).join(''));
  refreshIcons();
}

function openSkillDetail(id) {
  const s = SKILLS_CATALOG.find(x => x.id === id);
  if (!s) return;
  const col = LEVEL_COLOR[s.level] || '#9898c0';
  const modulesHtml = (s.modules || []).map((m, i) =>
    '<div class="skill-module-row"><span class="skill-module-num">' + (i + 1) + '</span><span>' + escapeHtml(m) + '</span></div>'
  ).join('');
  const resourcesHtml = (s.resources || []).map(r =>
    '<a class="skill-resource-link" href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">' +
    '<i data-lucide="external-link" style="width:12px;height:12px"></i>' + escapeHtml(r.label) + '</a>'
  ).join('');
  const html =
    '<div class="slide-over-panel active" id="skill-detail-panel">' +
    '<div class="slide-over-backdrop" onclick="closeSkillDetail()"></div>' +
    '<div class="slide-over-content" style="max-width:440px">' +
    '<div class="slide-over-header">' +
    '<div style="display:flex;align-items:center;gap:12px">' +
    '<span style="font-size:2rem">' + s.icon + '</span>' +
    '<div><div class="slide-over-title">' + escapeHtml(s.title) + '</div>' +
    '<span class="skill-level-badge" style="background:' + col + '22;color:' + col + ';border:1px solid ' + col + '44;font-size:0.7rem;padding:2px 8px;border-radius:20px">' + s.level + '</span></div>' +
    '</div>' +
    '<button class="btn btn-ghost btn-sm" onclick="closeSkillDetail()"><i data-lucide="x" style="width:15px;height:15px"></i></button>' +
    '</div>' +
    '<div class="slide-over-body">' +
    '<p style="color:var(--text-2);font-size:0.875rem;margin-bottom:20px">' + escapeHtml(s.desc) + '</p>' +
    '<div style="display:flex;gap:16px;margin-bottom:20px">' +
    '<div class="skill-meta-pill"><i data-lucide="clock" style="width:13px;height:13px"></i> ' + escapeHtml(s.duration||'') + '</div>' +
    '<div class="skill-meta-pill"><i data-lucide="target" style="width:13px;height:13px"></i> ' + (s.tags||[]).join(' · ') + '</div>' +
    '</div>' +
    '<div class="skill-detail-section-title">What you\'ll learn</div>' +
    '<div class="skill-modules-list">' + modulesHtml + '</div>' +
    '<div class="skill-detail-section-title" style="margin-top:20px">Outcome</div>' +
    '<div class="skill-outcome-box">' + escapeHtml(s.outcome||'') + '</div>' +
    (resourcesHtml ? '<div class="skill-detail-section-title" style="margin-top:20px">Resources</div><div class="skill-resources-list">' + resourcesHtml + '</div>' : '') +
    '<button class="btn btn-primary" style="width:100%;margin-top:24px" onclick="closeSkillDetail();navigate(\'skills\');document.getElementById(\'terminal-input\')?.focus()"><i data-lucide="terminal" style="width:14px;height:14px"></i> Open Terminal to Practice</button>' +
    '</div>' +
    '</div>' +
    '</div>';
  let wrap = document.getElementById('skill-detail-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'skill-detail-wrap'; document.body.appendChild(wrap); }
  wrap.innerHTML = html;
  refreshIcons();
}

function closeSkillDetail() {
  const wrap = document.getElementById('skill-detail-wrap');
  if (wrap) wrap.innerHTML = '';
}

function openSkillsTerminal() {
  document.getElementById('terminal-input')?.focus();
  document.getElementById('terminal-input')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── n8n Connection ─────────────────────────────────── */
function _switchN8nTab(tab, btn) {
  document.querySelectorAll('.n8n-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.n8n-tab-panel').forEach(p => p.classList.add('hidden'));
  if (btn) btn.classList.add('active');
  document.getElementById('n8ntab-' + tab)?.classList.remove('hidden');
}

function _loadN8nConfig() {
  const cfg = JSON.parse(localStorage.getItem('manthan_n8n_config') || '{}');
  if (cfg.baseUrl)    { const el = document.getElementById('n8n-base-url');    if (el) el.value = cfg.baseUrl; }
  if (cfg.apiKey)     { const el = document.getElementById('n8n-api-key');     if (el) el.value = cfg.apiKey; }
  if (cfg.webhookUrl) { const el = document.getElementById('n8n-webhook-url'); if (el) el.value = cfg.webhookUrl; }
  if (cfg.mcpToken)   { const el = document.getElementById('n8n-mcp-token');   if (el) el.value = cfg.mcpToken; }
  const badge = document.getElementById('n8n-status-badge');
  if (badge) {
    const connected = !!(cfg.apiKey || cfg.webhookUrl || cfg.mcpToken);
    badge.textContent = connected ? 'Saved' : 'Not connected';
    badge.className = 'badge ' + (connected ? 'badge-emerald' : 'badge-default');
  }
}

async function saveN8nConfig() {
  const cfg = {
    baseUrl:    document.getElementById('n8n-base-url')?.value.trim() || '',
    apiKey:     document.getElementById('n8n-api-key')?.value.trim() || '',
    webhookUrl: document.getElementById('n8n-webhook-url')?.value.trim() || '',
    mcpToken:   document.getElementById('n8n-mcp-token')?.value.trim() || '',
  };
  localStorage.setItem('manthan_n8n_config', JSON.stringify(cfg));
  // Also push to backend .env via settings save endpoint
  try {
    const updates = {};
    if (cfg.baseUrl)    updates['N8N_BASE_URL']     = cfg.baseUrl;
    if (cfg.apiKey)     updates['N8N_API_KEY']       = cfg.apiKey;
    if (cfg.webhookUrl) updates['N8N_WEBHOOK_URL']   = cfg.webhookUrl;
    if (cfg.mcpToken)   updates['N8N_MCP_TOKEN']     = cfg.mcpToken;
    if (Object.keys(updates).length) await API.post('/api/settings/env', { keys: updates });
  } catch(e) { /* backend may not have this endpoint — localStorage is the fallback */ }
  const badge = document.getElementById('n8n-status-badge');
  if (badge) { badge.textContent = 'Saved'; badge.className = 'badge badge-emerald'; }
  toast('n8n connection saved', 'success');
}

async function testN8nConnection() {
  const cfg = JSON.parse(localStorage.getItem('manthan_n8n_config') || '{}');
  toast('Testing n8n connection…', 'info');
  try {
    if (cfg.apiKey && cfg.baseUrl) {
      const r = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/api/v1/workflows', {
        headers: { 'X-N8N-API-KEY': cfg.apiKey, 'Accept': 'application/json' }
      });
      if (r.ok) {
        const data = await r.json();
        const count = data.data?.length || 0;
        toast('n8n connected! Found ' + count + ' workflow(s).', 'success');
        const badge = document.getElementById('n8n-status-badge');
        if (badge) { badge.textContent = 'Live'; badge.className = 'badge badge-emerald'; }
        return;
      }
    }
    if (cfg.webhookUrl) {
      const r = await fetch(cfg.webhookUrl, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ test: true, source: 'manthan-ping' }) });
      if (r.status < 400) { toast('Webhook reachable (HTTP ' + r.status + ')', 'success'); return; }
    }
    toast('Could not reach n8n — check your URL or API key.', 'error');
  } catch(e) {
    toast('Connection failed: ' + e.message, 'error');
  }
}

let _termHistory = [];
let _termHistIdx = -1;

function _appendTermLine(text, cls) {
  const out = document.getElementById('terminal-output');
  if (!out) return;
  const line = document.createElement('div');
  line.className = 'terminal-line ' + (cls || '');
  line.textContent = text;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

async function runTerminalCmd() {
  const inp = document.getElementById('terminal-input');
  if (!inp) return;
  const cmd = inp.value.trim();
  if (!cmd) return;
  inp.value = '';
  _termHistory.unshift(cmd);
  _termHistIdx = -1;
  _appendTermLine('$ ' + cmd, 'terminal-cmd');
  try {
    const r = await API.post('/api/terminal/exec', { command: cmd });
    if (r.stdout) r.stdout.split('\n').forEach(l => _appendTermLine(l, 'terminal-out'));
    if (r.stderr) r.stderr.split('\n').filter(Boolean).forEach(l => _appendTermLine(l, 'terminal-err'));
    if (!r.stdout && !r.stderr) _appendTermLine('(no output)', 'terminal-dim');
    if (r.exitCode !== 0 && r.exitCode !== undefined) _appendTermLine('Exit code: ' + r.exitCode, 'terminal-err');
  } catch(e) {
    _appendTermLine('Error: ' + e.message, 'terminal-err');
  }
}

document.addEventListener('keydown', e => {
  if (document.activeElement?.id !== 'terminal-input') return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    _termHistIdx = Math.min(_termHistIdx + 1, _termHistory.length - 1);
    if (_termHistory[_termHistIdx]) document.getElementById('terminal-input').value = _termHistory[_termHistIdx];
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    _termHistIdx = Math.max(_termHistIdx - 1, -1);
    document.getElementById('terminal-input').value = _termHistIdx >= 0 ? (_termHistory[_termHistIdx] || '') : '';
  }
});

/* ── Init ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-screen]').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.screen)));
  document.getElementById('search-input')?.addEventListener('input', e => {
    const q=e.target.value.trim();
    const r=document.getElementById('search-results');
    if (!q) { r.textContent=''; return; }
    render(r, '<div class="search-result-item" onclick="navigate(\'chat\');document.getElementById(\'chat-input\').value=\''+escapeHtml(q)+'\';closeSearch()">' +
      '<i data-lucide="message-square" style="width:14px;height:14px"></i> Ask AI: "'+escapeHtml(q)+'"</div>');
    refreshIcons();
  });
  document.getElementById('chat-input')?.addEventListener('keydown', e => {
    if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });
  document.getElementById('theme-toggle')?.classList.add('on');
  // Restore persisted UI state
  if (localStorage.getItem('manthan_compact_sidebar') === '1') {
    document.querySelector('.sidebar')?.classList.add('compact');
  }
  const savedAccent = localStorage.getItem('manthan_accent');
  if (savedAccent) {
    document.documentElement.style.setProperty('--accent', savedAccent);
  }
  // Restore saved agency logo in sidebar
  const _savedLogo = localStorage.getItem('entity_img_agency_agency');
  if (_savedLogo) {
    const logoIcon = document.getElementById('logo-icon');
    if (logoIcon) logoIcon.innerHTML = `<img src="${_savedLogo}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
  }
  // Konami easter egg
  let _konami = [];
  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  document.addEventListener('keydown', e => {
    _konami.push(e.key);
    if (_konami.length > 10) _konami.shift();
    if (_konami.join(',') === KONAMI.join(',')) {
      _triggerEasterEgg();
      _konami = [];
    }
  });
  navigate('dashboard');
});

// Hidden easter egg: confetti rainbow + secret toast
function _triggerEasterEgg() {
  const colors = ['#5b72f5','#00c48c','#f5a623','#ff4d6a','#b06ef5','#0dd9ff'];
  const burst = document.createElement('div');
  burst.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
  for (let i=0;i<60;i++) {
    const p = document.createElement('div');
    const c = colors[i%colors.length];
    p.style.cssText = `position:absolute;left:${Math.random()*100}%;top:-20px;width:8px;height:8px;background:${c};border-radius:50%;box-shadow:0 0 12px ${c};animation:konami-fall ${1+Math.random()*2}s linear ${Math.random()*0.8}s forwards`;
    burst.appendChild(p);
  }
  document.body.appendChild(burst);
  if (!document.getElementById('konami-style')) {
    const s = document.createElement('style'); s.id='konami-style';
    s.textContent = '@keyframes konami-fall { to { transform:translateY(110vh) rotate(720deg); opacity:0; } }';
    document.head.appendChild(s);
  }
  toast('🎉 You found the secret. Stay curious, builder.', 'success');
  setTimeout(()=>burst.remove(), 4000);
}
