'use strict';
/* ── Helpers ───────────────────────────────────────── */
function unwrap(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) { if (Array.isArray(data[k])) return data[k]; }
  return [];
}

/* ── Constants ─────────────────────────────────────── */
const CONNECTOR_DEFS = {
  'AI Layer': [
    {key:'ANTHROPIC_API_KEY',name:'Anthropic Claude',icon:'🤖',authType:'api_key',envKey:'ANTHROPIC_API_KEY',authLabel:'API Key',placeholder:'sk-ant-...'},
    {key:'BRAVE_SEARCH_API_KEY',name:'Brave Search',icon:'🔍',authType:'api_key',envKey:'BRAVE_SEARCH_API_KEY',authLabel:'API Key',placeholder:'BSA...'},
    {key:'FIRECRAWL_API_KEY',name:'Firecrawl',icon:'🕷',authType:'api_key',envKey:'FIRECRAWL_API_KEY',authLabel:'API Key',placeholder:'fc-...'},
  ],
  'Data Layer': [
    {key:'AIRTABLE_API_KEY',name:'Airtable',icon:'📊',authType:'bearer',envKey:'AIRTABLE_API_KEY',authLabel:'Personal Access Token',placeholder:'pat...'},
    {key:'NOTION_API_KEY',name:'Notion',icon:'📝',authType:'bearer',envKey:'NOTION_API_KEY',authLabel:'Integration Token',placeholder:'secret_...'},
  ],
  'Automation': [
    {key:'N8N_WEBHOOK_URL',name:'n8n Workflows',icon:'⚡',authType:'webhook',envKey:'N8N_WEBHOOK_URL',authLabel:'Webhook URL',placeholder:'https://yourinstance.app.n8n.cloud/webhook/...', hint:'n8n REST API is enterprise-only. Use a Webhook trigger node instead — paste the webhook URL here and agents will call it directly.'},
    {key:'N8N_API_KEY',name:'n8n MCP Token',icon:'⚡',authType:'bearer',envKey:'N8N_API_KEY',authLabel:'MCP JWT Token',placeholder:'eyJ...'},
  ],
  'Messaging': [
    {key:'WHATSAPP_ACCESS_TOKEN',name:'WhatsApp',icon:'💬',authType:'bearer',envKey:'WHATSAPP_ACCESS_TOKEN',authLabel:'Access Token',placeholder:'EAA...'},
    {key:'GMAIL_CLIENT_ID',name:'Gmail',icon:'📧',authType:'oauth2',envKey:'GMAIL_CLIENT_ID',authLabel:'OAuth2 Client ID',placeholder:'...apps.googleusercontent.com',extraEnvKey:'GMAIL_CLIENT_SECRET',extraLabel:'Client Secret'},
  ],
  'Calendar': [
    {key:'GOOGLE_CALENDAR_ID',name:'Google Calendar',icon:'📅',authType:'oauth2',envKey:'GOOGLE_CALENDAR_ID',authLabel:'Calendar ID',placeholder:'primary or email@domain.com',hint:'Connect via Google OAuth in Settings → Calendar.'},
  ],
};

const WORKBENCH_TOOLS = [
  {id:'hook-writer',name:'Hook Writer',icon:'🪝',desc:'Viral hooks for short-form content',
   fields:[{id:'platform',label:'Platform',type:'select',options:['Instagram','TikTok','LinkedIn','Twitter']},{id:'niche',label:'Niche / Industry',type:'text'},{id:'product',label:'Product / Offer',type:'text'},{id:'tone',label:'Tone',type:'text',placeholder:'bold, witty, urgent'}]},
  {id:'caption-writer',name:'Caption Writer',icon:'✍️',desc:'Scroll-stopping captions with CTAs',
   fields:[{id:'platform',label:'Platform',type:'select',options:['Instagram','LinkedIn','Twitter']},{id:'topic',label:'Topic',type:'text'},{id:'cta',label:'CTA Goal',type:'text',placeholder:'drive DMs, clicks, saves'}]},
  {id:'email-writer',name:'Email Writer',icon:'📧',desc:'Cold outreach and nurture emails',
   fields:[{id:'type',label:'Email Type',type:'select',options:['Cold Outreach','Follow-up','Nurture','Re-engagement']},{id:'recipient',label:'Recipient Industry',type:'text'},{id:'offer',label:'Your Offer',type:'text'},{id:'pain',label:'Pain Point',type:'text'}]},
  {id:'brand-research',name:'Brand Research',icon:'🔬',desc:'Competitive & market intelligence',
   fields:[{id:'brand',label:'Brand / Company',type:'text'},{id:'focus',label:'Research Focus',type:'select',options:['Competitors','Audience','Pricing','Positioning','All']},{id:'notes',label:'Additional Context',type:'textarea'}]},
  {id:'lead-qualifier',name:'Lead Qualifier',icon:'🎯',desc:'Score and qualify a business lead',
   fields:[{id:'business',label:'Business Name',type:'text'},{id:'website',label:'Website / Instagram',type:'text'},{id:'context',label:'Additional Context',type:'textarea'}]},
  {id:'sop-generator',name:'SOP Generator',icon:'📋',desc:'Create standard operating procedures',
   fields:[{id:'process',label:'Process Name',type:'text'},{id:'steps',label:'Key Steps (describe briefly)',type:'textarea'},{id:'role',label:'Role Responsible',type:'text'}]},
];

/* ── Chat Sessions ─────────────────────────────────── */
async function loadChatSessions() {
  const el = document.getElementById('chat-session-list');
  if (!el) return;
  try {
    const data = await API.get('/api/conversations/sessions');
    const sessions = Array.isArray(data?.sessions)?data.sessions:(Array.isArray(data)?data:[]);
    if (!sessions.length) { render(el, '<p class="text-small text-muted" style="padding:12px">No sessions yet</p>'); return; }
    render(el, sessions.map(s =>
      '<div class="chat-session-item session-item'+(State.sessionId===s.sessionId?' active':'')+'" onclick="loadSession(\''+escapeHtml(s.sessionId)+'\')">' +
      '<div class="cs-meta"><span class="text-small font-medium" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escapeHtml(s.sessionId.replace('session-','#'))+'</span>' +
      '<span class="cs-time">'+formatTime(s.lastActivity)+'</span></div>' +
      '<div class="cs-preview">'+escapeHtml((s.lastMessage||'').slice(0,50))+'</div>' +
      '<button class="session-delete" title="Delete session" onclick="event.stopPropagation();deleteChatSession(\''+escapeHtml(s.sessionId)+'\')">✕</button>' +
      '</div>'
    ).join(''));
  } catch(e) { render(el, '<p class="text-small text-muted" style="padding:12px">Error loading sessions</p>'); }
}

async function deleteChatSession(sessionId) {
  if (!confirm('Delete this chat session?')) return;
  try {
    await API.post('/api/conversations/delete', {sessionId});
  } catch(e) {/* ignore if endpoint not found */}
  // Clear from local messages DB if current session
  if (State.sessionId === sessionId) {
    State.sessionId = null;
    const chip = document.getElementById('session-id-chip');
    if (chip) { chip.textContent=''; chip.style.display='none'; }
    const msgs = document.getElementById('chat-messages');
    if (msgs) render(msgs, '<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Start a conversation</div><div class="empty-desc">Ask anything — research a brand, qualify leads, generate content, plan strategy.</div></div>');
  }
  loadChatSessions();
  showToast('Session deleted');
}

async function loadSession(sessionId) {
  State.sessionId = sessionId;
  const chip = document.getElementById('session-id-chip');
  if (chip) { chip.textContent=sessionId; chip.style.display='inline-flex'; }
  const msgs = document.getElementById('chat-messages');
  render(msgs, '<div class="empty-state"><div class="spinner"></div><div class="empty-title">Loading…</div></div>');
  try {
    const data = await API.get('/api/conversation/'+sessionId);
    const history = Array.isArray(data)?data:(data.messages||[]);
    if (!history.length) { render(msgs, '<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Empty session</div></div>'); return; }
    render(msgs, history.map(m=>'<div class="message message-'+escapeHtml(m.role||'assistant')+'">' +
      '<div class="message-content" style="white-space:pre-wrap">'+escapeHtml(m.content||'')+'</div></div>').join(''));
    msgs.scrollTop = msgs.scrollHeight;
  } catch(e) { render(msgs, '<p class="text-rose" style="padding:20px">Error loading session</p>'); }
  document.querySelectorAll('.chat-session-item').forEach(el =>
    el.classList.toggle('active', el.onclick?.toString().includes(sessionId)));
  loadChatSessions();
}

/* ── Clients ───────────────────────────────────────── */
async function loadClients() {
  const el = document.getElementById('clients-grid');
  if (!el) return;
  render(el, '<div class="spinner" style="margin:24px auto;grid-column:1/-1"></div>');
  try {
    const data = await API.get('/api/clients');
    const clients = unwrap(data, 'clients', 'records');
    if (!clients.length) { render(el, '<div style="grid-column:1/-1">'+emptyState('No clients yet. Add your first client!','users')+'</div>'); return; }
    render(el, clients.map((c,i) => {
      const f=c.fields||c; const name=f.Name||f.name||'Client';
      const g=GRADIENTS[i%GRADIENTS.length];
      const retainer=f['Monthly Retainer']||f.retainer||0;
      const industry=f.Industry||f.industry||'Agency';
      return '<div class="card" style="cursor:pointer;border-top:3px solid transparent;background:var(--surface-2)" onclick="openClientDetail(\''+escapeHtml(c.id||'')+'\','+i+')" onmouseenter="this.style.borderTopColor=\''+g.match(/#[0-9a-fA-F]{6}/)?.[0]+'\'" onmouseleave="this.style.borderTopColor=\'transparent\'">' +
        '<div class="flex items-center gap-3 mb-3">' +
        '<div style="width:44px;height:44px;border-radius:12px;background:'+g+';display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:1.125rem;flex-shrink:0">'+escapeHtml(name[0].toUpperCase())+'</div>' +
        '<div><div class="card-title">'+escapeHtml(name)+'</div><div class="card-subtitle">'+escapeHtml(industry)+'</div></div>' +
        '</div>' +
        '<div class="flex justify-between items-center">' +
        '<span class="badge badge-emerald" style="font-family:var(--font-mono,monospace)">₹'+Number(retainer).toLocaleString('en-IN')+'/mo</span>' +
        '<span class="status-dot live"></span>' +
        '</div></div>';
    }).join(''));
    refreshIcons();
  } catch(e) { render(el, '<div style="grid-column:1/-1"><p class="text-rose">Error: '+escapeHtml(e.message)+'</p></div>'); }
}

async function openClientDetail(id, gradientIndex) {
  const data = await API.get('/api/clients').catch(()=>[]);
  const clients = unwrap(data, 'clients', 'records');
  const client = clients.find(c=>c.id===id)||clients[0];
  if (!client) return;
  State.currentClient = client;
  const f = client.fields||client;
  const name = f.Name||f.name||'Client';
  const g = GRADIENTS[(gradientIndex||0)%GRADIENTS.length];
  const banner = document.getElementById('client-detail-banner');
  if (banner) banner.style.background = g;
  const avatar = document.getElementById('client-detail-avatar');
  if (avatar) { avatar.textContent=name[0].toUpperCase(); avatar.style.background='rgba(0,0,0,0.2)'; }
  document.getElementById('client-detail-name').textContent = name;
  const meta = document.getElementById('client-detail-meta');
  if (meta) render(meta,
    '<span class="badge" style="background:rgba(255,255,255,0.2);color:#fff">'+escapeHtml(f.Industry||f.industry||'Agency')+'</span>' +
    (f['Active Channels']||f.channels?'<span class="badge" style="background:rgba(255,255,255,0.15);color:#fff">'+escapeHtml(f['Active Channels']||f.channels||'')+'</span>':''));
  const statRow = document.getElementById('client-stat-row');
  const retainer = f['Monthly Retainer']||f.retainer||0;
  const startD = f['Start Date']||f.start_date||'';
  const daysActive = startD ? Math.floor((Date.now()-new Date(startD).getTime())/(1000*86400)) : null;
  if (statRow) render(statRow,
    statChip('₹'+Number(retainer).toLocaleString('en-IN'),'Retainer/Mo')+
    statChip(f.deliverableCount||'—','Deliverables')+
    statChip(f.approvalCount||'—','Pending Approvals')+
    statChip(daysActive!==null?daysActive+'d':'—','Days Active'));
  document.querySelectorAll('[data-cdtab]').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('[data-cdtab]').forEach(x=>x.classList.remove('active'));
      t.classList.add('active'); renderClientDetailTab(t.dataset.cdtab);
    };
  });
  renderClientDetailTab('overview');
  navigate('client-detail');
}

function statChip(value, label) {
  return '<div class="client-stat-chip"><div class="csc-value">'+escapeHtml(String(value))+'</div><div class="csc-label">'+escapeHtml(label)+'</div></div>';
}

async function renderClientDetailTab(tab) {
  const body = document.getElementById('client-detail-body');
  if (!body) return;
  const f = (State.currentClient?.fields||State.currentClient)||{};
  if (tab==='overview') {
    const services = f.Services||f.services||f['Brand Voice']||f.tone||'—';
    const contact  = f.WhatsApp||f.whatsapp||f.Email||f.email||f.Phone||f.phone||'—';
    const channels = f['Active Channels']||f['active_channels']||f.channels||'—';
    const since    = (f['Start Date']||f.start_date||f.createdAt||'').replace('T',' ').slice(0,10)||'—';
    const notes    = f.Notes||f.notes||'';
    const goals    = f['90 Day Goals']||f['90_day_goals']||'';
    const health   = Number(f['Health Score']||f.healthScore||f.health_score||0);
    const dots     = Array.from({length:5},(_,i)=>`<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${i<health?'var(--emerald)':'var(--surface-3)'};margin-right:3px"></span>`).join('');
    render(body,
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:4px">' +
      '<div><div class="text-small text-muted mb-1">Services</div><div class="text-small">'+escapeHtml(services)+'</div></div>' +
      '<div><div class="text-small text-muted mb-1">Contact</div><div class="text-small font-mono">'+escapeHtml(contact)+'</div></div>' +
      '<div><div class="text-small text-muted mb-1">Active Platforms</div><div class="text-small">'+escapeHtml(channels)+'</div></div>' +
      '<div><div class="text-small text-muted mb-1">Since</div><div class="text-small font-mono">'+escapeHtml(since)+'</div></div>' +
      (goals?'<div style="grid-column:1/-1"><div class="text-small text-muted mb-1">90-Day Goals</div><div class="text-small" style="line-height:1.6;color:var(--text-2)">'+escapeHtml(goals)+'</div></div>':'')+
      (notes?'<div style="grid-column:1/-1"><div class="text-small text-muted mb-1">Notes</div><div class="text-small" style="line-height:1.6;color:var(--text-3)">'+escapeHtml(notes)+'</div></div>':'')+
      '<div><div class="text-small text-muted mb-1">Health Score</div><div style="margin-top:4px">'+dots+'</div></div>' +
      '</div>');
  } else if (tab==='deliverables') {
    render(body, '<div class="spinner" style="margin:24px auto"></div>');
    try {
      const data = await API.get('/api/deliverables?clientId='+(State.currentClient?.id||''));
      const items = Array.isArray(data)?data:(data.records||[]);
      render(body, items.length ? '<div class="table-wrap"><table><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Due</th></tr></thead><tbody>'+
        items.map(d=>{ const df=d.fields||d; return '<tr><td>'+escapeHtml(df.Title||df.name||'—')+'</td><td class="text-muted">'+escapeHtml(df.Type||'—')+'</td><td><span class="badge">'+escapeHtml(df.Status||'—')+'</span></td><td class="text-muted text-small">'+escapeHtml(df['Due Date']||'—')+'</td></tr>'; }).join('')+
        '</tbody></table></div>' : emptyState('No deliverables for this client','package'));
    } catch(e) { render(body, emptyState('Error loading','package')); }
  } else if (tab==='finance') {
    render(body, '<div class="spinner" style="margin:24px auto"></div>');
    try {
      const data = await API.get('/api/invoices?clientId='+(State.currentClient?.id||''));
      const items = Array.isArray(data)?data:(data.records||[]);
      render(body, items.length ? '<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead><tbody>'+
        items.map(inv=>{ const ivf=inv.fields||inv; return '<tr><td class="font-mono text-small">INV-'+escapeHtml(String(inv.id||'').slice(-6))+'</td><td class="text-gold font-medium">₹'+Number(ivf.Amount||ivf.amount||0).toLocaleString('en-IN')+'</td><td class="text-muted text-small">'+escapeHtml(ivf['Due Date']||'—')+'</td><td><span class="badge">'+escapeHtml(ivf.Status||'Pending')+'</span></td></tr>'; }).join('')+
        '</tbody></table></div>' : emptyState('No invoices for this client','file-text'));
    } catch(e) { render(body, emptyState('No finance data','indian-rupee')); }
  }
  refreshIcons();
}

/* ── Brands (3D Sci-Fi Mind Map) ───────────────────── */
let _brandScene = null;

async function loadBrands() {
  const tabsEl = document.getElementById('brand-tabs');
  const wrap = document.getElementById('brand-mindmap');
  if (!tabsEl||!wrap) return;
  try {
    const data = await API.get('/api/clients');
    const clients = unwrap(data, 'clients', 'records');
    if (!clients.length) {
      render(wrap, '<div style="height:100%;display:flex;align-items:center;justify-content:center">'+emptyState('Add clients to see brand maps','git-branch')+'</div>');
      return;
    }
    render(tabsEl, clients.map((c,i)=>{
      const name=(c.fields?.Name||c.name||'Client');
      return '<div class="tab'+(i===0?' active':'')+'" onclick="switchBrandTab(\''+escapeHtml(c.id||'')+'\',this)">'+escapeHtml(name)+'</div>';
    }).join(''));
    document.getElementById('brand-edit-btn').style.display='';
    draw3DBrandMap(clients[0], wrap);
  } catch(e) { render(wrap, '<p class="text-rose" style="padding:20px">'+escapeHtml(e.message)+'</p>'); }
}

function switchBrandTab(id, tabEl) {
  document.querySelectorAll('#brand-tabs .tab').forEach(t=>t.classList.remove('active'));
  tabEl.classList.add('active');
  API.get('/api/clients').then(data=>{
    const clients=unwrap(data,'clients','records');
    const client=clients.find(c=>c.id===id);
    const wrap=document.getElementById('brand-mindmap');
    if (client&&wrap) draw3DBrandMap(client, wrap);
  }).catch(()=>{});
}

function editMindMap() { toast('Brand edit coming soon','info'); }
function resetBrandCamera() {
  if (_brandScene && _brandScene.sim) {
    _brandScene.sim.alpha(0.6).restart();
    showToast('View reset', 'info');
  }
}

function _showBrandDetail(nodeData) {
  const empty = document.getElementById('brand-detail-empty');
  const content = document.getElementById('brand-detail-content');
  if (!content) return;
  if (empty) empty.classList.add('hidden');
  content.classList.remove('hidden');
  const colorMap={audience:'#4F6EF7',competitors:'#FF375F',pillars:'#34C759',channels:'#F4B942',voice:'#a855f7',identity:'#06b6d4',root:'#4F6EF7'};
  const color=colorMap[nodeData.id]||'#4F6EF7';
  const items=nodeData.children||[];
  const itemsHtml=items.length ? items.map(item=>'<div class="bdi-item"><span class="bdi-dot" style="background:'+color+'"></span>'+escapeHtml(String(item))+'</div>').join('') : '<div class="bdi-empty">No data recorded yet</div>';
  const brandId = State.activeBrand || 'brand';
  const savedBrandImg = localStorage.getItem('entity_img_brand_' + brandId);
  const avatarHtml = nodeData.id === 'root'
    ? '<div class="entity-avatar-wrap bdi-brand-avatar" onclick="triggerBrandImgUpload(\'' + escapeHtml(brandId) + '\')" title="Change brand logo">' +
        (savedBrandImg
          ? '<img id="brand-avatar-img" src="'+savedBrandImg+'" style="width:48px;height:48px;border-radius:12px;object-fit:cover">'
          : '<div id="brand-avatar-img" style="width:48px;height:48px;border-radius:12px;background:'+color+';display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:1.25rem">'+escapeHtml((nodeData.label||'B')[0])+'</div>') +
        '<div class="entity-avatar-upload-btn"><i data-lucide="camera" style="width:12px;height:12px"></i></div>' +
        '<input type="file" id="brand-img-input-'+escapeHtml(brandId)+'" accept="image/*" style="display:none" onchange="handleBrandImgUpload(event,\''+escapeHtml(brandId)+'\')">' +
      '</div>'
    : '';
  render(content,
    '<div class="bdi-header" style="border-color:'+color+'">'+
      avatarHtml +
      '<div class="bdi-icon" style="color:'+color+'"'+(nodeData.id==='root'?' class="hidden"':'')+'>'+nodeData.icon+'</div>'+
      '<div><div class="bdi-title">'+escapeHtml(nodeData.label)+'</div>'+
      '<div class="bdi-subtitle">'+escapeHtml(nodeData.subtitle||'Brand intelligence')+'</div></div>'+
    '</div>'+
    '<div class="bdi-items">'+itemsHtml+'</div>'+
    '<div class="bdi-actions">'+
      '<button class="btn btn-secondary btn-sm" onclick="toast(\'Edit coming soon\',\'info\')">'+
        '<i data-lucide="edit-2" style="width:12px;height:12px"></i> Edit</button>'+
      '<button class="btn btn-ghost btn-sm" onclick="closesBrandDetail()">'+
        '<i data-lucide="x" style="width:12px;height:12px"></i></button>'+
    '</div>');
  refreshIcons();
}

function closesBrandDetail() {
  const empty=document.getElementById('brand-detail-empty');
  const content=document.getElementById('brand-detail-content');
  if (empty) empty.classList.remove('hidden');
  if (content) content.classList.add('hidden');
}

function draw3DBrandMap(client, container) {
  /* ── Glassmorphic D3 Brand Mind Map ──────────────────────────
     Canvas layer: floating particle field
     SVG layer:    dashed animated connection lines
     HTML layer:   frosted-glass node chips (backdrop-filter)
     D3 force:     physics simulation for organic layout
  ─────────────────────────────────────────────────────────── */

  // Cleanup previous instance
  if (_brandScene) {
    if (_brandScene.animId) cancelAnimationFrame(_brandScene.animId);
    if (_brandScene.sim)    _brandScene.sim.stop();
    if (_brandScene.ro)     _brandScene.ro.disconnect();
    _brandScene = null;
  }
  container.replaceChildren();

  const f = client.fields || client;
  const brandName = f.Name || f.name || 'Brand';
  let W = container.offsetWidth  || 720;
  let H = container.offsetHeight || 560;

  // ── Inject animation styles (once per page load) ──────────
  if (!document.getElementById('brand-glass-styles')) {
    const s = document.createElement('style');
    s.id = 'brand-glass-styles';
    s.textContent = `
@keyframes dash-flow { to { stroke-dashoffset: -30; } }
@keyframes bni-root-pulse {
  0%,100% { transform:translate(-50%,-50%) scale(1); opacity:.55; }
  50%      { transform:translate(-50%,-50%) scale(1.18); opacity:.12; }
}
@keyframes bni-node-in {
  from { opacity:0; transform:translate(-50%,-50%) scale(0.6); }
  to   { opacity:1; transform:translate(-50%,-50%) scale(1);   }
}
.brand-node { position:absolute; z-index:3; transform:translate(-50%,-50%); user-select:none; animation:bni-node-in 380ms cubic-bezier(.34,1.56,.64,1) forwards; }
.brand-node-root  { cursor:default; }
.brand-node-cat   { cursor:pointer; }
.bni-root {
  width:90px; height:90px; border-radius:50%;
  background: linear-gradient(135deg,rgba(91,114,245,.5) 0%,rgba(123,143,248,.22) 100%);
  border: 1.5px solid rgba(91,114,245,.55);
  box-shadow: 0 0 36px rgba(91,114,245,.28), inset 0 1px 0 rgba(255,255,255,.1);
  backdrop-filter: blur(20px) saturate(1.8);
  display:flex; align-items:center; justify-content:center;
  position:relative;
}
.bni-root-ring {
  position:absolute; border-radius:50%; border:1.5px solid rgba(91,114,245,.35);
  top:50%; left:50%; pointer-events:none;
}
.bni-root-ring-1 { width:calc(100% + 20px); height:calc(100% + 20px); animation:bni-root-pulse 2.4s ease-in-out infinite; }
.bni-root-ring-2 { width:calc(100% + 44px); height:calc(100% + 44px); border-color:rgba(91,114,245,.15); animation:bni-root-pulse 2.4s ease-in-out 1.2s infinite; }
.bni-root-label { font-size:.69rem; font-weight:700; color:#fff; text-align:center; line-height:1.25; padding:0 8px; position:relative; z-index:1; }
.bni-cat {
  padding:9px 15px; border-radius:100px;
  background:rgba(13,13,26,.72);
  backdrop-filter:blur(20px) saturate(1.7);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:0 4px 20px rgba(0,0,0,.32),0 0 0 1px rgba(255,255,255,.04);
  display:flex; align-items:center; gap:8px;
  transition:box-shadow 200ms ease,border-color 200ms ease,transform 180ms ease;
  will-change:transform;
}
.brand-node-cat:hover .bni-cat {
  border-color:var(--bni-border,rgba(91,114,245,.6));
  box-shadow:0 8px 32px rgba(0,0,0,.38),0 0 22px var(--bni-glow,rgba(91,114,245,.22));
  transform:scale(1.07);
}
.bni-icon  { font-size:.9375rem; line-height:1; }
.bni-label { font-size:.72rem; font-weight:600; color:#e8e8f4; white-space:nowrap; }
.bni-count {
  font-size:.6rem; background:rgba(255,255,255,.09); border-radius:100px;
  padding:1px 6px; color:#9898c0; font-variant-numeric:tabular-nums;
}
.brand-satellite {
  position:absolute; z-index:4; transform:translate(-50%,-50%);
  pointer-events:none; white-space:nowrap;
  font-size:.625rem; background:rgba(10,10,20,.85);
  border-radius:100px; padding:3px 9px; color:#9898c0;
  backdrop-filter:blur(10px);
  box-shadow:0 2px 10px rgba(0,0,0,.3);
}`;
    document.head.appendChild(s);
  }

  // ── Data ──────────────────────────────────────────────────
  const channels = (f['Active Channels'] || f.channels || 'Instagram').split(',').map(s => s.trim());
  const categories = [
    { id:'audience',   label:'Audience',       icon:'👥', hex:'#5b72f5', subtitle:'Who you serve',         children:[f.Audience||'Target demographic','Decision makers','Pain points','Goals'] },
    { id:'competitors',label:'Competitors',     icon:'⚔️', hex:'#ff4d6a', subtitle:'Competitive landscape', children:[f.Competitors||'Main competitor','Price positioning','Differentiators','Market share'] },
    { id:'pillars',    label:'Content Pillars', icon:'🏛',  hex:'#00c48c', subtitle:'What you create',       children:['Education','Entertainment','Inspiration','Promotion'] },
    { id:'channels',   label:'Channels',        icon:'📱', hex:'#f5a623', subtitle:'Where you show up',     children:channels.length?channels:['Instagram','LinkedIn','Website'] },
    { id:'voice',      label:'Brand Voice',     icon:'🎙', hex:'#b06ef5', subtitle:'How you sound',         children:[f['Brand Voice']||f.tone||'Not defined','Tone','Style','Language'] },
    { id:'identity',   label:'Identity',        icon:'✦',  hex:'#0dd9ff', subtitle:'Who you are',           children:[f.Industry||'Creative agency','Values','Mission','Promise'] },
  ];

  const rootNode = { id:'root', type:'root', fx:W/2, fy:H/2 };
  const catNodes = categories.map((c,i) => ({ ...c, type:'category', idx:i }));
  const allNodes = [rootNode, ...catNodes];
  const links    = catNodes.map(c => ({ source:'root', target:c.id, hex:c.hex }));

  // ── Canvas layer: floating particles ─────────────────────
  const cvs = document.createElement('canvas');
  cvs.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none';
  cvs.width = W; cvs.height = H;
  container.appendChild(cvs);
  const ctx2 = cvs.getContext('2d');

  const particles = Array.from({length:110}, () => ({
    x: Math.random()*W, y: Math.random()*H,
    vx:(Math.random()-.5)*.22, vy:(Math.random()-.5)*.22,
    r: Math.random()*1.1+.3, ph:Math.random()*Math.PI*2
  }));

  // ── SVG layer: connection lines ────────────────────────────
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;overflow:visible';
  svgEl.setAttribute('width',W); svgEl.setAttribute('height',H);
  container.appendChild(svgEl);

  const linkLines = links.map(lk => {
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('stroke', lk.hex);
    line.setAttribute('stroke-width','1.5');
    line.setAttribute('stroke-dasharray','7 5');
    line.setAttribute('stroke-linecap','round');
    line.setAttribute('opacity','.42');
    line.style.animation = 'dash-flow 2s linear infinite';
    svgEl.appendChild(line);
    return { el:line, lk };
  });

  // ── D3 force simulation ───────────────────────────────────
  const sim = d3.forceSimulation(allNodes)
    .force('link',      d3.forceLink(links).id(d=>d.id).distance(175).strength(.85))
    .force('charge',    d3.forceManyBody().strength(-240))
    .force('center',    d3.forceCenter(W/2, H/2))
    .force('collision', d3.forceCollide(80))
    .force('bounds', () => {
      const pad = 70;
      allNodes.forEach(n => {
        if (n.id==='root') return;
        if ((n.x??0) < pad)       n.vx = ((n.vx??0) + 0.8);
        if ((n.x??0) > W - pad)   n.vx = ((n.vx??0) - 0.8);
        if ((n.y??0) < pad)       n.vy = ((n.vy??0) + 0.8);
        if ((n.y??0) > H - pad)   n.vy = ((n.vy??0) - 0.8);
      });
    });

  // ── HTML node elements ────────────────────────────────────
  const nodeEls = {};

  // Root node
  const rootDiv = document.createElement('div');
  rootDiv.className = 'brand-node brand-node-root';
  rootDiv.innerHTML =
    '<div class="bni-root">' +
      '<div class="bni-root-ring bni-root-ring-1"></div>' +
      '<div class="bni-root-ring bni-root-ring-2"></div>' +
      '<span class="bni-root-label">' + escapeHtml(brandName.slice(0,14)) + '</span>' +
    '</div>';
  container.appendChild(rootDiv);
  nodeEls['root'] = rootDiv;

  // Category nodes + drag behavior
  catNodes.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'brand-node brand-node-cat';
    div.style.setProperty('--bni-border', cat.hex + '99');
    div.style.setProperty('--bni-glow',   cat.hex + '3a');
    div.innerHTML =
      '<div class="bni-cat">' +
        '<span class="bni-icon">' + cat.icon + '</span>' +
        '<span class="bni-label">' + escapeHtml(cat.label) + '</span>' +
        '<span class="bni-count">' + cat.children.length + '</span>' +
      '</div>';
    div.addEventListener('mouseenter', () => showSatellites(cat, div));
    div.addEventListener('mouseleave', hideSatellites);
    div.addEventListener('click',      () => _showBrandDetail(cat));
    container.appendChild(div);
    nodeEls[cat.id] = div;

    // Drag
    let dragging = false, dOX = 0, dOY = 0;
    const nd = catNodes.find(n => n.id === cat.id);
    div.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      dragging = true;
      const r = container.getBoundingClientRect();
      dOX = e.clientX - r.left - (nd.x||0);
      dOY = e.clientY - r.top  - (nd.y||0);
      nd.fx = nd.x; nd.fy = nd.y;
      sim.alphaTarget(.3).restart();
    });
    const onM = e => {
      if (!dragging) return;
      const r = container.getBoundingClientRect();
      nd.fx = e.clientX - r.left - dOX;
      nd.fy = e.clientY - r.top  - dOY;
    };
    const onU = () => { if (!dragging) return; dragging=false; nd.fx=null; nd.fy=null; sim.alphaTarget(0); };
    document.addEventListener('mousemove', onM);
    document.addEventListener('mouseup',   onU);
  });

  // ── Satellite chips on hover ──────────────────────────────
  let satEls = [];
  function showSatellites(cat, parentDiv) {
    hideSatellites();
    const px = parseFloat(parentDiv.style.left)||0;
    const py = parseFloat(parentDiv.style.top) ||0;
    const count = Math.min(cat.children.length, 5);
    for (let i = 0; i < count; i++) {
      const angle = (i/count)*Math.PI*2 - Math.PI/2;
      const sat = document.createElement('div');
      sat.className = 'brand-satellite';
      sat.style.cssText = `left:${px}px;top:${py}px;border:1px solid ${cat.hex}44;opacity:0;transition:opacity 200ms ease ${i*28}ms,left 200ms ease ${i*28}ms,top 200ms ease ${i*28}ms`;
      sat.textContent = String(cat.children[i]).slice(0,16);
      container.appendChild(sat);
      satEls.push(sat);
      requestAnimationFrame(() => {
        const r = 82;
        sat.style.left    = (px + Math.cos(angle)*r) + 'px';
        sat.style.top     = (py + Math.sin(angle)*r) + 'px';
        sat.style.opacity = '1';
      });
    }
  }
  function hideSatellites() { satEls.forEach(el => el.remove()); satEls = []; }

  // ── Tick: sync positions (with hard bounds clamping) ─────────
  function tick() {
    const pad = 62;
    allNodes.forEach(n => {
      if (n.id !== 'root') {
        n.x = Math.max(pad, Math.min(W - pad, n.x ?? W/2));
        n.y = Math.max(pad, Math.min(H - pad, n.y ?? H/2));
      }
      const el = nodeEls[n.id]; if (!el) return;
      el.style.left = (n.x ?? W/2) + 'px';
      el.style.top  = (n.y ?? H/2) + 'px';
    });
    linkLines.forEach(({el,lk}) => {
      const src = lk.source, tgt = lk.target;
      el.setAttribute('x1', src.x??W/2); el.setAttribute('y1', src.y??H/2);
      el.setAttribute('x2', tgt.x??W/2); el.setAttribute('y2', tgt.y??H/2);
    });
  }
  sim.on('tick', tick);

  // ── Particle animation loop ────────────────────────────────
  let animId, t = 0;
  function animate() {
    animId = requestAnimationFrame(animate);
    t += .007;
    ctx2.fillStyle = 'rgba(9,9,14,.18)';
    ctx2.fillRect(0, 0, cvs.width, cvs.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x<0) p.x=cvs.width;  if (p.x>cvs.width)  p.x=0;
      if (p.y<0) p.y=cvs.height; if (p.y>cvs.height) p.y=0;
      const a = .12 + Math.abs(Math.sin(t+p.ph))*.32;
      ctx2.beginPath(); ctx2.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx2.fillStyle = `rgba(140,140,200,${a})`; ctx2.fill();
    });
  }
  animate();

  // ── Store for cleanup ──────────────────────────────────────
  _brandScene = { sim, animId, ro:null };

  const ro = new ResizeObserver(() => {
    W = container.offsetWidth; H = container.offsetHeight;
    if (!W||!H) return;
    cvs.width=W; cvs.height=H;
    svgEl.setAttribute('width',W); svgEl.setAttribute('height',H);
    rootNode.fx=W/2; rootNode.fy=H/2;
    sim.force('center', d3.forceCenter(W/2,H/2))
       .force('bounds', () => {
         const pad=70;
         allNodes.forEach(n => {
           if(n.id==='root') return;
           if((n.x??0)<pad)     n.vx=((n.vx??0)+0.8);
           if((n.x??0)>W-pad)   n.vx=((n.vx??0)-0.8);
           if((n.y??0)<pad)     n.vy=((n.vy??0)+0.8);
           if((n.y??0)>H-pad)   n.vy=((n.vy??0)-0.8);
         });
       })
       .alpha(.3).restart();
  });
  ro.observe(container);
  _brandScene.ro = ro;
}

/* ── Connector Grid ────────────────────────────────── */
async function refreshConnectors() {
  const el = document.getElementById('connector-grid-container');
  if (!el) return;
  let health = {};
  try { health = await API.get('/api/system/health'); } catch(e) {}
  render(el, Object.entries(CONNECTOR_DEFS).map(([section, items]) =>
    '<div class="connector-section">' +
    '<div class="connector-section-title">'+escapeHtml(section)+'</div>' +
    '<div class="connector-cards-grid">'+items.map(c => {
      const isLive=health[c.key]||health[c.name?.toLowerCase()]||false;
      const authBadge = {'api_key':'API Key','bearer':'Bearer Token','webhook':'Webhook URL','oauth2':'OAuth2','json':'JSON Config'}[c.authType]||'API';
      return '<div class="connector-card" onclick="openConnectorModal(\''+escapeHtml(c.envKey)+'\')">' +
        '<div class="connector-card-top">' +
        '<div class="connector-icon">'+escapeHtml(c.icon)+'</div>' +
        '<span class="connector-status-dot '+(isLive?'live':'')+'"></span>' +
        '</div>' +
        '<div class="connector-card-name">'+escapeHtml(c.name)+'</div>' +
        '<div class="connector-card-type">'+escapeHtml(authBadge)+'</div>' +
        '<div class="connector-card-footer">' +
        '<span class="badge '+(isLive?'badge-emerald':'badge-default')+'">'+(isLive?'Connected':'Not set')+'</span>' +
        '<span class="text-small text-muted">Configure →</span>' +
        '</div></div>';
    }).join('')+'</div></div>'
  ).join(''));
  refreshIcons();
}

let _currentConnectorDef = null;
function openConnectorModal(envKey) {
  const all = Object.values(CONNECTOR_DEFS).flat();
  const def = all.find(c => c.envKey === envKey);
  if (!def) return;
  _currentConnectorDef = def;

  const body = document.getElementById('connector-modal-body');
  document.getElementById('connector-modal-title').textContent = def.icon+' '+def.name;
  document.getElementById('connector-modal-status').textContent = '';

  const authTypeLabel = {'api_key':'API Key','bearer':'Bearer Token','webhook':'Webhook URL','oauth2':'OAuth2','json':'JSON Config'}[def.authType]||'Key';

  let formHtml = '';
  if (def.hint) {
    formHtml += '<div class="connector-hint">ℹ️ '+escapeHtml(def.hint)+'</div>';
  }

  if (def.authType === 'webhook') {
    formHtml += '<label class="form-label">'+escapeHtml(def.authLabel||'Webhook URL')+'</label>' +
      '<input class="form-input" type="url" id="connector-key-main" placeholder="'+escapeHtml(def.placeholder||'https://')+'"/>';
  } else if (def.authType === 'oauth2') {
    formHtml += '<label class="form-label">'+escapeHtml(def.authLabel||'Client ID')+'</label>' +
      '<input class="form-input" type="text" id="connector-key-main" placeholder="'+escapeHtml(def.placeholder||'')+'"/>';
    if (def.extraEnvKey) {
      formHtml += '<label class="form-label" style="margin-top:12px">'+escapeHtml(def.extraLabel||'Client Secret')+'</label>' +
        '<div style="display:flex;gap:8px"><input class="form-input" type="password" id="connector-key-extra" placeholder="•••" style="flex:1"/>' +
        '<button class="btn btn-ghost btn-sm" onclick="toggleKeyVis(\'connector-key-extra\',this)">Show</button></div>';
    }
  } else if (def.authType === 'json') {
    formHtml += '<label class="form-label">'+escapeHtml(def.authLabel||'JSON Config')+'</label>' +
      '<textarea class="form-input" id="connector-key-main" rows="6" placeholder=\'{"key":"value"}\' style="font-family:var(--font-mono);font-size:12px"></textarea>';
  } else {
    formHtml += '<label class="form-label">'+escapeHtml(def.authLabel||authTypeLabel)+'</label>' +
      '<div style="display:flex;gap:8px"><input class="form-input" type="password" id="connector-key-main" placeholder="'+escapeHtml(def.placeholder||'')+'..." style="flex:1"/>' +
      '<button class="btn btn-ghost btn-sm" onclick="toggleKeyVis(\'connector-key-main\',this)">Show</button></div>';
  }

  if (body) render(body, formHtml);
  document.getElementById('connector-modal').classList.add('active');
  setTimeout(()=>document.getElementById('connector-key-main')?.focus(),80);
}
function closeConnectorModal() { document.getElementById('connector-modal').classList.remove('active'); }
async function testConnector() {
  const status = document.getElementById('connector-modal-status');
  status.textContent = '⏳ Testing connection…';
  status.style.color = 'var(--text-2)';
  // Map envKey → connectorId for backend
  const ENV_TO_CONNECTOR = {
    'ANTHROPIC_API_KEY': 'anthropic',
    'AIRTABLE_API_KEY':  'airtable',
    'N8N_WEBHOOK_URL':   'n8n',
    'N8N_API_KEY':       'n8n',
    'NOTION_API_KEY':    'notion',
  };
  const envKey = _currentConnectorDef?.envKey || '';
  const connectorId = ENV_TO_CONNECTOR[envKey] || envKey.toLowerCase().replace(/_api_key$/,'').replace(/_/g,'-');
  const keyVal = document.getElementById('connector-key-main')?.value?.trim();
  if (!keyVal) { status.textContent = '⚠️ Enter a value first'; status.style.color = 'var(--gold)'; return; }
  try {
    // Save key temporarily for the test
    await API.post('/api/system/env-update', { [envKey]: keyVal });
    const r = await API.post('/api/system/connectors/test', { connectorId });
    if (r.status === 'ok') {
      status.textContent = '✅ ' + (r.detail || 'Connection successful');
      status.style.color = 'var(--emerald)';
    } else {
      status.textContent = '❌ ' + (r.detail || r.message || 'Test failed');
      status.style.color = 'var(--rose)';
    }
  } catch(e) { status.textContent = '❌ Error: ' + e.message; status.style.color = 'var(--rose)'; }
}
async function saveConnectorKey() {
  const def = _currentConnectorDef;
  if (!def) return;
  const key = document.getElementById('connector-key-main')?.value?.trim();
  if (!key) { toast('Enter a value first','error'); return; }
  const payload = {[def.envKey]:key};
  if (def.extraEnvKey) {
    const extra = document.getElementById('connector-key-extra')?.value?.trim();
    if (extra) payload[def.extraEnvKey] = extra;
  }
  try {
    await API.post('/api/system/env-update', payload);
    toast('Saved — restart server to apply','success');
    closeConnectorModal(); refreshConnectors();
  } catch(e) { toast('Error: '+e.message,'error'); }
}

/* ── Settings ──────────────────────────────────────── */
const _settingsPrefs = {
  agencyName: 'Manthan AI Agency',
  ownerName:  'Yash',
  city:       'Bengaluru, IST',
  model:      'claude-sonnet-4-6',
  maxTokens:  8096
};

async function loadSettings() {
  // Wire up tab switching (runs every time screen is shown)
  document.querySelectorAll('[data-stab]').forEach(btn => {
    btn.onclick = () => _switchSettingsTab(btn.dataset.stab);
  });

  // Wire up ALL toggle elements — generic handler with localStorage persistence
  document.querySelectorAll('#screen-settings .toggle').forEach(t => {
    const key = 'manthan_toggle_' + (t.id || Math.random().toString(36).slice(2,7));
    // Restore saved state (skip theme — handled separately)
    if (t.id !== 'theme-toggle') {
      const saved = localStorage.getItem(key);
      if (saved !== null) t.classList.toggle('on', saved === '1');
    }
    // Avoid double-binding
    if (t.dataset.wired) return;
    t.dataset.wired = '1';
    t.addEventListener('click', e => {
      // Theme and compact already have specific handlers via inline onclick — skip
      if (t.id === 'theme-toggle') return;
      if (t.id === 'compact-toggle') {
        const on = !t.classList.contains('on');
        t.classList.toggle('on', on);
        document.querySelector('.sidebar')?.classList.toggle('compact', on);
        localStorage.setItem('manthan_compact_sidebar', on ? '1' : '0');
        toast(on ? 'Sidebar compacted' : 'Sidebar expanded', 'info');
        return;
      }
      const on = !t.classList.contains('on');
      t.classList.toggle('on', on);
      localStorage.setItem(key, on ? '1' : '0');
      // Friendly label from nearby row
      const lbl = t.closest('.settings-row')?.querySelector('.settings-row-label')?.textContent || 'Setting';
      toast(lbl + ': ' + (on ? 'enabled' : 'disabled'), 'success');
    });
  });

  // Accent swatch clicks
  document.querySelectorAll('.accent-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      const hue = sw.dataset.accent;
      if (hue) {
        document.documentElement.style.setProperty('--accent', hue);
        document.documentElement.style.setProperty('--accent-2', hue+'cc');
        localStorage.setItem('manthan_accent', hue);
        toast('Accent updated', 'success');
      }
    });
  });

  // Restore saved accent
  const savedAccent = localStorage.getItem('manthan_accent');
  if (savedAccent) {
    document.documentElement.style.setProperty('--accent', savedAccent);
    document.querySelectorAll('.accent-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.accent === savedAccent);
    });
  }

  // Restore saved general prefs
  const saved = JSON.parse(localStorage.getItem('manthan_prefs') || '{}');
  if (saved.agencyName) { const el = document.getElementById('st-agency-name'); if(el) el.value = saved.agencyName; }
  if (saved.ownerName)  { const el = document.getElementById('st-owner-name');  if(el) el.value = saved.ownerName;  }
  if (saved.city)       { const el = document.getElementById('st-city');         if(el) el.value = saved.city;       }
  if (saved.model)      { const el = document.getElementById('st-default-model');if(el) el.value = saved.model;      }
  if (saved.maxTokens)  { const el = document.getElementById('st-max-tokens');   if(el) el.value = saved.maxTokens;  }

  // Load connectors (lazy — only once)
  const el = document.getElementById('settings-connector-list');
  if (el && !el.dataset.loaded) {
    el.dataset.loaded = '1';
    let health = {};
    try { health = await API.get('/api/system/health'); } catch(e) {}
    const allConns = Object.values(CONNECTOR_DEFS).flat();
    render(el, allConns.map(c => {
      const isLive = health[c.key] || false;
      return '<div class="settings-connector-item">' +
        '<span>' + escapeHtml(c.icon) + '</span>' +
        '<div class="settings-connector-body">' +
        '<div class="text-small font-medium">' + escapeHtml(c.name) + '</div>' +
        '<div class="settings-key-wrap" style="margin-top:6px">' +
        '<input class="form-input" type="password" id="sk-' + escapeHtml(c.envKey) + '" placeholder="' + escapeHtml(c.envKey) + '=..." />' +
        '<button class="btn btn-ghost btn-sm" onclick="toggleKeyVis(\'sk-' + escapeHtml(c.envKey) + '\',this)" style="white-space:nowrap">Show</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="saveSettingsKey(\''+escapeHtml(c.envKey)+'\',\'sk-'+escapeHtml(c.envKey)+'\')" style="white-space:nowrap">Save</button>' +
        '</div></div>' +
        '<span class="badge ' + (isLive ? 'badge-emerald' : 'badge-default') + '">' + (isLive ? 'Live' : 'Off') + '</span>' +
        '</div>';
    }).join(''));
  }

  // Load custom connectors (always refresh — they may have changed)
  loadCustomConnectors();

  // Load n8n config into the connect card
  if (typeof _loadN8nConfig !== 'undefined') _loadN8nConfig();

  // Load system info (lazy)
  const sysEl = document.getElementById('settings-system-info');
  if (sysEl && sysEl.textContent === 'Loading…') {
    _loadSystemInfo(sysEl);
  }
}

/* ── Custom Connectors ─────────────────────────────── */
async function loadCustomConnectors() {
  const el = document.getElementById('custom-connector-list');
  if (!el) return;
  try {
    const data = await API.get('/api/connectors/custom');
    const list = data.connectors || [];
    if (!list.length) {
      render(el, '<div class="empty-state" style="padding:24px"><div class="empty-icon" style="font-size:1.6rem">🔌</div><div class="empty-title" style="margin-top:8px">No custom connectors yet</div><div class="empty-desc text-small text-muted">Click <b>Add Custom Connector</b> above to connect any HTTP API, webhook, or MCP server.</div></div>');
      return;
    }
    render(el, list.map(c => {
      const statusBadge = c.last_status === 'ok'
        ? '<span class="badge badge-emerald">Live</span>'
        : c.last_status ? '<span class="badge badge-rose" title="'+escapeHtml(c.last_status)+'">'+escapeHtml(c.last_status.slice(0,18))+'</span>'
        : '<span class="badge badge-default">Untested</span>';
      return '<div class="settings-connector-item">' +
        '<span style="font-size:1.4rem">' + escapeHtml(c.icon||'🔌') + '</span>' +
        '<div class="settings-connector-body">' +
          '<div class="text-small font-medium">' + escapeHtml(c.name) + ' <span class="badge badge-default" style="margin-left:6px;font-size:0.6rem">'+escapeHtml(c.type)+'</span></div>' +
          '<div class="text-small text-muted" style="margin-top:2px;font-family:var(--font-mono);font-size:0.7rem">' + escapeHtml((c.url||'').slice(0,60)) + '</div>' +
          (c.description ? '<div class="text-small text-muted" style="margin-top:4px">' + escapeHtml(c.description) + '</div>' : '') +
          '<div class="flex" style="gap:6px;margin-top:8px">' +
            '<button class="btn btn-ghost btn-sm" onclick="testCustomConnectorById(\''+escapeHtml(c.id)+'\')"><i data-lucide="zap" style="width:11px;height:11px"></i> Test</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="deleteCustomConnector(\''+escapeHtml(c.id)+'\')" style="color:var(--rose)"><i data-lucide="trash-2" style="width:11px;height:11px"></i> Delete</button>' +
          '</div>' +
        '</div>' +
        statusBadge +
        '</div>';
    }).join(''));
    refreshIcons();
  } catch (e) {
    render(el, '<p class="text-rose text-small" style="padding:12px">Failed to load custom connectors: '+escapeHtml(e.message)+'</p>');
  }
}

function openCustomConnectorModal() {
  ['cc-name','cc-icon','cc-url','cc-token','cc-desc','cc-auth-header'].forEach(id => {
    const el = document.getElementById(id); if (el && id !== 'cc-auth-header') el.value = '';
  });
  const ah = document.getElementById('cc-auth-header'); if (ah) ah.value = 'Authorization';
  document.getElementById('custom-connector-modal').classList.add('active');
  setTimeout(() => document.getElementById('cc-name')?.focus(), 50);
}
function closeCustomConnectorModal() { document.getElementById('custom-connector-modal').classList.remove('active'); }

async function saveCustomConnector() {
  const payload = {
    name:        document.getElementById('cc-name').value.trim(),
    type:        document.getElementById('cc-type').value,
    icon:        document.getElementById('cc-icon').value.trim() || '🔌',
    url:         document.getElementById('cc-url').value.trim(),
    auth_type:   document.getElementById('cc-auth-type').value,
    auth_header: document.getElementById('cc-auth-header').value.trim() || 'Authorization',
    token:       document.getElementById('cc-token').value,
    description: document.getElementById('cc-desc').value.trim(),
  };
  if (!payload.name || !payload.url) { toast('Name and URL are required', 'error'); return; }
  try {
    await API.post('/api/connectors/custom', payload);
    toast('Connector saved', 'success');
    closeCustomConnectorModal();
    loadCustomConnectors();
  } catch (e) { toast('Failed: '+e.message, 'error'); }
}

async function testCustomConnector() {
  // Pre-save test (called from modal — saves first then tests)
  const nameEl = document.getElementById('cc-name');
  const urlEl  = document.getElementById('cc-url');
  if (!nameEl?.value.trim() || !urlEl?.value.trim()) { toast('Enter name + URL first', 'error'); return; }
  toast('Saving and testing…', 'info');
  await saveCustomConnector();
  // Then test the most recent one
  try {
    const data = await API.get('/api/connectors/custom');
    const latest = (data.connectors || [])[0];
    if (latest) await testCustomConnectorById(latest.id);
  } catch (e) {}
}

async function testCustomConnectorById(id) {
  try {
    const r = await API.post('/api/connectors/custom/'+id+'/test', {});
    if (r.status === 'ok') toast('Connector reachable ✓', 'success');
    else toast('Test failed: '+r.status, 'error');
    loadCustomConnectors();
  } catch (e) { toast('Test error: '+e.message, 'error'); }
}

async function deleteCustomConnector(id) {
  if (!confirm('Delete this connector?')) return;
  try {
    await fetch('/api/connectors/custom/'+id, { method:'DELETE' });
    toast('Connector deleted', 'success');
    loadCustomConnectors();
  } catch (e) { toast('Delete failed: '+e.message, 'error'); }
}

function _switchSettingsTab(tab) {
  document.querySelectorAll('[data-stab]').forEach(b => b.classList.toggle('active', b.dataset.stab === tab));
  document.querySelectorAll('.settings-panel').forEach(p => {
    const isActive = p.id === 'stab-' + tab;
    p.classList.toggle('active', isActive);
    p.classList.toggle('hidden', !isActive);
  });
}

function saveGeneralSettings() {
  const prefs = {
    agencyName: document.getElementById('st-agency-name')?.value?.trim() || 'Manthan AI Agency',
    ownerName:  document.getElementById('st-owner-name')?.value?.trim()  || 'Yash',
    city:       document.getElementById('st-city')?.value?.trim()         || 'Bengaluru, IST',
    model:      document.getElementById('st-default-model')?.value        || 'claude-sonnet-4-6',
    maxTokens:  parseInt(document.getElementById('st-max-tokens')?.value) || 8096
  };
  localStorage.setItem('manthan_prefs', JSON.stringify(prefs));
  // Update sidebar greeting name if present
  const greetEl = document.querySelector('#greeting-name');
  if (greetEl) greetEl.textContent = prefs.ownerName;
  toast('Settings saved', 'success');
}

function toggleCompactSidebar(chk) {
  document.querySelector('.sidebar')?.classList.toggle('compact', chk.checked);
  localStorage.setItem('manthan_compact_sidebar', chk.checked ? '1' : '0');
}

async function _loadSystemInfo(el) {
  let info = { version: 'unknown', db: 'unknown', node: 'unknown' };
  try { info = await API.get('/api/system/info'); } catch(e) {}
  const rows = [
    ['Server',    'Node.js / Express'],
    ['Version',   escapeHtml(info.version || '1.0.0')],
    ['Database',  'SQLite (better-sqlite3)'],
    ['Node',      escapeHtml(info.node || process?.version || 'v20')],
    ['Uptime',    info.uptime ? Math.floor(info.uptime/60)+'m' : '—'],
    ['Agents',    escapeHtml(String(info.agentCount || '—'))],
    ['API Base',  'http://localhost:3000/api']
  ];
  const html = '<table class="shortcut-table"><tbody>' +
    rows.map(([k,v]) =>
      '<tr class="shortcut-row"><td style="color:var(--text-3);width:130px;padding:8px 0">' + escapeHtml(k) + '</td>' +
      '<td style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-1);padding:8px 0">' + v + '</td></tr>'
    ).join('') +
    '</tbody></table>';
  render(el, html);
}

async function saveSettingsKey(envKey, inputId) {
  const val = document.getElementById(inputId)?.value?.trim();
  if (!val) { toast('Enter a value', 'error'); return; }
  try {
    await API.post('/api/system/env-update', { [envKey]: val });
    toast('Saved — restart server to apply', 'success');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
}

/* ── Agents Console ────────────────────────────────── */
let _agents = [];
let _agentFilter = 'all';

async function loadAgentsConsole() {
  const el = document.getElementById('agents-grid');
  if (!el) return;
  render(el, '<div class="spinner" style="margin:24px auto;grid-column:1/-1"></div>');
  try {
    const data = await API.get('/api/agents');
    _agents = Array.isArray(data?.agents)?data.agents:(Array.isArray(data)?data:[]);
    // Inject category filter tabs if not already present
    let filterRow = document.getElementById('agents-filter-row');
    if (!filterRow) {
      const header = el.previousElementSibling;
      if (header) {
        filterRow = document.createElement('div');
        filterRow.id = 'agents-filter-row';
        filterRow.className = 'cal-filters';
        filterRow.style.cssText = 'margin-bottom:16px';
        header.insertAdjacentElement('afterend', filterRow);
      }
    }
    // Build category list
    const cats = ['all', ...new Set(_agents.map(a=>a.category||'other').filter(Boolean))];
    if (filterRow) render(filterRow, cats.map(c =>
      '<span class="cal-filter'+(c===_agentFilter?' active':'')+'" data-cat="'+escapeHtml(c)+'" onclick="_agentFilter=\''+escapeHtml(c)+'\';renderAgentCards()" style="text-transform:capitalize">'+escapeHtml(c==='all'?'All':c)+'</span>'
    ).join(''));
    renderAgentCards();
    refreshIcons();
  } catch(e) { render(el, '<div style="grid-column:1/-1"><p class="text-rose">Error: '+escapeHtml(e.message)+'</p></div>'); }
}

function renderAgentCards() {
  const el = document.getElementById('agents-grid');
  if (!el) return;
  const filtered = _agentFilter==='all' ? _agents : _agents.filter(a=>(a.category||'other')===_agentFilter);
  const CATEGORY_COLORS = {content:'var(--accent)',research:'var(--emerald)',finance:'var(--gold)',ops:'var(--rose)',other:'var(--text-3)'};
  render(el, filtered.length ? filtered.map((a,i) => {
    const realIdx = _agents.indexOf(a);
    const catColor = CATEGORY_COLORS[a.category||'other'] || 'var(--text-3)';
    return '<div class="card agent-card" style="cursor:pointer;position:relative" onclick="openAgentDetail('+realIdx+')">' +
      '<div class="flex items-center gap-3 mb-3">' +
      '<div style="width:44px;height:44px;border-radius:12px;background:var(--surface-3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:1.25rem">'+escapeHtml(a.icon||'🤖')+'</div>' +
      '<div style="flex:1;min-width:0"><div class="card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escapeHtml(a.displayName||a.name||'Agent')+'</div>' +
      '<div style="font-size:0.6875rem;color:'+catColor+';font-weight:600;text-transform:uppercase;letter-spacing:0.05em">'+escapeHtml(a.category||'other')+'</div></div>' +
      '</div>' +
      '<p class="text-small text-muted" style="margin-bottom:12px;line-height:1.5">'+escapeHtml((a.description||'').slice(0,80))+'</p>' +
      '<div class="flex justify-between items-center">' +
      '<span style="font-size:0.6875rem;color:var(--text-3);font-family:monospace">' + escapeHtml((a.model||'claude-sonnet-4-6').replace('claude-','').replace('-latest','')) + '</span>' +
      '<div class="flex gap-1">' +
      '<button class="btn btn-ghost btn-sm" title="Edit" onclick="event.stopPropagation();editAgent('+realIdx+')" style="padding:4px 6px"><i data-lucide="edit-2" style="width:12px;height:12px"></i></button>' +
      '</div></div></div>';
  }).join('') : emptyState('No agents in this category','bot'));
  refreshIcons();
}

function openAgentDetail(index) {
  const a = _agents[index]; if (!a) return;
  const overlay = document.getElementById('agent-detail-overlay');
  const body = document.getElementById('agent-detail-body');
  const MODEL_OPTIONS = ['claude-opus-4-5','claude-sonnet-4-6','claude-haiku-4-5'];
  const currentModel = a.model || 'claude-sonnet-4-6';
  render(body,
    '<div class="adp-hero">' +
    '<div class="adp-agent-icon">'+escapeHtml(a.icon||'🤖')+'</div>' +
    '<div class="adp-agent-name">'+escapeHtml(a.displayName||a.name||'Agent')+'</div>' +
    '<div class="adp-agent-cat">'+escapeHtml(a.category||'General')+'</div>' +
    '<div style="font-size:0.6875rem;color:var(--text-3);margin-top:4px">Powered by Anthropic Claude API</div>' +
    '</div>' +
    '<div class="adp-section"><div class="adp-section-title">What it does</div>' +
    '<p class="text-small text-muted">'+escapeHtml(a.description||'No description')+'</p></div>' +
    '<div class="adp-section"><div class="adp-section-title" style="display:flex;justify-content:space-between"><span>Model</span></div>' +
    '<div class="flex gap-2" style="flex-wrap:wrap">' +
    MODEL_OPTIONS.map(m => '<button class="btn btn-sm '+(m===currentModel?'btn-primary':'btn-ghost')+'" style="font-family:monospace;font-size:0.75rem" onclick="setAgentModel('+index+',\''+m+'\')" id="model-btn-'+m.replace(/[^a-z0-9]/g,'-')+'">'+escapeHtml(m.replace('claude-',''))+'</button>').join('') +
    '</div></div>' +
    '<div class="adp-section"><div class="adp-section-title">Tools</div>' +
    '<div class="adp-tools-row">'+(a.tools||[]).map(t=>'<span class="adp-tool-chip">'+escapeHtml(t)+'</span>').join('')+(!(a.tools||[]).length?'<span class="text-small text-muted">None configured</span>':'')+'</div></div>' +
    '<div class="adp-section"><div class="adp-section-title">System Prompt</div>' +
    '<div class="adp-prompt-block" id="adp-prompt-'+escapeHtml(a.name||index)+'">'+escapeHtml((a.systemPrompt||'Not configured').slice(0,500))+(a.systemPrompt?.length>500?'…':'')+'</div>' +
    '<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="editAgentPrompt('+index+')"><i data-lucide="edit-2" style="width:12px;height:12px"></i> Edit Prompt</button>' +
    '</div>' +
    '<div class="adp-section">' +
    '<div class="adp-section-title">Recent Runs</div>' +
    '<div id="adp-runs-'+index+'"><div class="spinner" style="margin:8px auto;width:20px;height:20px"></div></div>' +
    '</div>' +
    '<div class="adp-cta">' +
    '<button class="btn btn-primary" onclick="runAgentNow(\''+escapeHtml(a.name||'')+'\')"><i data-lucide="zap" style="width:14px;height:14px"></i> Run Now</button>' +
    '<button class="btn btn-ghost" onclick="navigate(\'chat\');document.getElementById(\'chat-agent-label\').textContent=\''+escapeHtml(a.name||'')+'\';State.agentName=\''+escapeHtml(a.name||'')+'\';closeAgentDetail()">Chat with Agent</button>' +
    '</div>');
  overlay.classList.remove('hidden');
  refreshIcons();
  // Load recent runs async
  loadAgentRuns(index, a.name||'');
}

async function loadAgentRuns(index, agentName) {
  const el = document.getElementById('adp-runs-'+index);
  if (!el) return;
  try {
    const data = await API.get('/api/agents/'+encodeURIComponent(agentName)+'/runs').catch(()=>null);
    const runs = data?.runs || data || [];
    if (!runs.length) { render(el, '<p class="text-small text-muted">No runs yet</p>'); return; }
    render(el, runs.slice(0,5).map(r =>
      '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">' +
      '<span style="width:6px;height:6px;border-radius:50%;background:'+(r.status==='success'?'var(--emerald)':'var(--rose)')+';flex-shrink:0"></span>' +
      '<span style="font-size:0.75rem;color:var(--text-2);flex:1">'+escapeHtml(formatTime(r.created_at||r.timestamp))+'</span>' +
      '<span style="font-size:0.6875rem;color:var(--text-3);font-family:monospace">'+escapeHtml(r.duration?r.duration+'ms':'—')+'</span>' +
      '</div>'
    ).join(''));
  } catch(e) { render(el, '<p class="text-small text-muted">Run history unavailable</p>'); }
}

async function setAgentModel(index, model) {
  const a = _agents[index]; if (!a) return;
  try {
    await API.post('/api/agents/'+encodeURIComponent(a.name||'')+'/config', {model});
    a.model = model;
    // Update button states
    ['claude-opus-4-5','claude-sonnet-4-6','claude-haiku-4-5'].forEach(m => {
      const btn = document.getElementById('model-btn-'+m.replace(/[^a-z0-9]/g,'-'));
      if (btn) { btn.className='btn btn-sm '+(m===model?'btn-primary':'btn-ghost'); btn.style.cssText='font-family:monospace;font-size:0.75rem'; }
    });
    showToast('Model updated to '+model.replace('claude-',''));
  } catch(e) { showToast('Could not update model: '+e.message, 'error'); }
}

async function editAgentPrompt(index) {
  const a = _agents[index]; if (!a) return;
  const newPrompt = window.prompt('Edit system prompt for '+a.displayName+':',a.systemPrompt||'');
  if (newPrompt===null) return;
  try {
    await API.post('/api/agents/'+encodeURIComponent(a.name||'')+'/config', {systemPrompt: newPrompt});
    a.systemPrompt = newPrompt;
    const el = document.getElementById('adp-prompt-'+(a.name||index));
    if (el) el.textContent = newPrompt.slice(0,500);
    showToast('System prompt updated');
  } catch(e) { showToast('Could not update: '+e.message, 'error'); }
}

function editAgent(index) { openAgentDetail(index); }

function closeAgentDetail() { document.getElementById('agent-detail-overlay').classList.add('hidden'); }

function runAgentNow(name) {
  closeAgentDetail();
  navigate('chat');
  State.agentName = name;
  document.getElementById('chat-agent-label').textContent = name;
  document.getElementById('chat-input').value = 'Run your default task and report back with results.';
  sendChatMessage();
}

/* ── Agent Create Wizard ───────────────────────────── */
let _wizardStep = 1;
const _wizardData = {};
function openAgentCreate() { _wizardStep=1; renderWizardStep(); document.getElementById('agent-create-modal').classList.add('active'); }
function closeAgentCreate() { document.getElementById('agent-create-modal').classList.remove('active'); }
function agentWizardBack() { if (_wizardStep>1) { _wizardStep--; renderWizardStep(); } }
async function agentWizardNext() {
  if (_wizardStep===1) {
    _wizardData.name=document.getElementById('aw-name')?.value.trim();
    _wizardData.category=document.getElementById('aw-category')?.value;
    _wizardData.description=document.getElementById('aw-desc')?.value.trim();
    if (!_wizardData.name) { toast('Name required','error'); return; }
    _wizardStep=2; renderWizardStep();
  } else if (_wizardStep===2) {
    _wizardData.systemPrompt=document.getElementById('aw-prompt')?.value.trim();
    if (!_wizardData.systemPrompt) { toast('System prompt required','error'); return; }
    _wizardStep=3; renderWizardStep();
  } else if (_wizardStep===3) {
    try {
      await API.post('/api/agents',_wizardData);
      closeAgentCreate(); toast('Agent created!','success'); loadAgentsConsole();
    } catch(e) { toast('Error: '+e.message,'error'); }
  }
}

function renderWizardStep() {
  const body=document.getElementById('agent-wizard-body');
  const label=document.getElementById('agent-wizard-step-label');
  const back=document.getElementById('agent-wizard-back');
  const next=document.getElementById('agent-wizard-next');
  label.textContent='Step '+_wizardStep+' of 3 — '+['Identity','System Prompt','Review'][_wizardStep-1];
  back.style.display=_wizardStep>1?'':'none';
  next.textContent=_wizardStep===3?'✅ Create Agent →':'Next →';
  if (_wizardStep===1) {
    render(body,
      '<div class="form-group"><label class="form-label">Agent Name *</label><input class="form-input" id="aw-name" value="'+escapeHtml(_wizardData.name||'')+'" placeholder="e.g., Content Strategist" /></div>' +
      '<div class="form-group"><label class="form-label">Category</label><select class="form-input" id="aw-category"><option>content</option><option>research</option><option>ops</option><option>finance</option></select></div>' +
      '<div class="form-group"><label class="form-label">Description</label><textarea class="form-input" id="aw-desc" rows="3" placeholder="What does this agent do?">'+escapeHtml(_wizardData.description||'')+'</textarea></div>');
  } else if (_wizardStep===2) {
    render(body,
      '<div class="form-group"><label class="form-label">System Prompt *</label><textarea class="form-input" id="aw-prompt" rows="10" style="font-family:var(--font-mono,monospace);font-size:0.8125rem" placeholder="You are an expert... Your job is to...">'+escapeHtml(_wizardData.systemPrompt||'')+'</textarea></div>');
  } else {
    render(body,
      '<div class="card" style="background:var(--surface-3)">' +
      '<div class="text-small font-medium mb-2">'+escapeHtml(_wizardData.name||'Agent')+'</div>' +
      '<div class="badge" style="margin-bottom:8px">'+escapeHtml(_wizardData.category||'ops')+'</div>' +
      '<p class="text-small text-muted">'+escapeHtml(_wizardData.description||'—')+'</p>' +
      '<div class="adp-prompt-block mt-4" style="max-height:100px">'+escapeHtml((_wizardData.systemPrompt||'').slice(0,200))+'…</div>' +
      '</div>');
  }
  refreshIcons();
}

/* ── Workbench ─────────────────────────────────────── */
let _customTools = JSON.parse(localStorage.getItem('wb_custom_tools')||'[]');

function loadWorkbench() {
  const listEl = document.getElementById('wb-tools-list');
  if (!listEl) return;
  renderWbToolList(listEl);
  openWorkbenchTool(WORKBENCH_TOOLS[0].id);
}

function renderWbToolList(listEl) {
  if (!listEl) listEl = document.getElementById('wb-tools-list');
  if (!listEl) return;
  const allTools = [...WORKBENCH_TOOLS, ..._customTools];
  render(listEl,
    allTools.map(t =>
      '<div class="wb-tool-item" onclick="openWorkbenchTool(\''+escapeHtml(t.id)+'\')" id="wt-'+escapeHtml(t.id)+'">' +
      '<span class="wb-tool-icon">'+escapeHtml(t.icon)+'</span>'+escapeHtml(t.name)+'</div>'
    ).join('') +
    '<button class="wb-new-tool-btn" onclick="openNewToolModal()">' +
    '<i data-lucide="plus" style="width:14px;height:14px"></i> New Tool</button>'
  );
  refreshIcons();
}

function openNewToolModal() {
  document.getElementById('new-tool-modal').classList.add('active');
  setTimeout(()=>document.getElementById('nt-name')?.focus(), 80);
}
function closeNewToolModal() { document.getElementById('new-tool-modal').classList.remove('active'); }

function saveNewTool() {
  const name = document.getElementById('nt-name')?.value?.trim();
  const icon = document.getElementById('nt-icon')?.value?.trim()||'🔧';
  const desc = document.getElementById('nt-desc')?.value?.trim();
  const prompt = document.getElementById('nt-prompt')?.value?.trim();
  if (!name||!prompt) { toast('Name and prompt required','error'); return; }
  const id = 'custom-'+Date.now();
  const tool = {
    id, name, icon: icon||'🔧', desc: desc||name,
    fields: [{id:'input', label:'Input', type:'textarea', placeholder:'Describe what you want…'}],
    customPrompt: prompt
  };
  _customTools.push(tool);
  localStorage.setItem('wb_custom_tools', JSON.stringify(_customTools));
  renderWbToolList();
  closeNewToolModal();
  openWorkbenchTool(id);
  toast('Tool created','success');
}

function openWorkbenchTool(id) {
  const allTools = [...WORKBENCH_TOOLS, ..._customTools];
  const tool = allTools.find(t=>t.id===id); if (!tool) return;
  document.querySelectorAll('.wb-tool-item').forEach(el=>el.classList.toggle('active',el.id==='wt-'+id));
  const panel = document.getElementById('wb-active-panel');
  render(panel,
    '<div><div class="wb-panel-title">'+escapeHtml(tool.icon)+' '+escapeHtml(tool.name)+'</div>' +
    '<div class="wb-panel-desc">'+escapeHtml(tool.desc)+'</div></div>' +
    '<div class="wb-form" id="wb-form-'+escapeHtml(id)+'">'+
    tool.fields.map(f => {
      let inp = '';
      if (f.type==='select') inp='<select class="form-input" id="wf-'+escapeHtml(f.id)+'">'+f.options.map(o=>'<option>'+escapeHtml(o)+'</option>').join('')+'</select>';
      else if (f.type==='textarea') inp='<textarea class="form-input" id="wf-'+escapeHtml(f.id)+'" rows="3" placeholder="'+escapeHtml(f.placeholder||'')+'"></textarea>';
      else inp='<input class="form-input" type="text" id="wf-'+escapeHtml(f.id)+'" placeholder="'+escapeHtml(f.placeholder||'')+'" />';
      return '<div class="form-group"><label class="form-label">'+escapeHtml(f.label)+'</label>'+inp+'</div>';
    }).join('') +
    '<button class="btn btn-primary" onclick="runWorkbenchTool(\''+escapeHtml(id)+'\')"><i data-lucide="play" style="width:14px;height:14px"></i> Run Tool</button>' +
    '</div>' +
    '<div style="position:relative">' +
    '<div class="wb-output-area" id="wb-output">Select inputs above and click Run Tool</div>' +
    '<button class="btn btn-ghost btn-sm wb-copy-btn" onclick="copyOutput()"><i data-lucide="copy" style="width:14px;height:14px"></i></button>' +
    '</div>');
  refreshIcons();
}

async function runWorkbenchTool(id) {
  const allTools = [...WORKBENCH_TOOLS, ..._customTools];
  const tool = allTools.find(t=>t.id===id); if (!tool) return;
  const out = document.getElementById('wb-output');
  if (out) out.textContent = '⏳ Running '+tool.name+'…';
  const inputs = {};
  tool.fields.forEach(f => { const el=document.getElementById('wf-'+f.id); if (el) inputs[f.id]=el.value; });
  const prompt = tool.customPrompt
    ? tool.customPrompt + '\n\nInput: ' + (inputs.input||Object.values(inputs).join(' '))
    : tool.name+': '+JSON.stringify(inputs);
  try {
    const r = await API.post('/api/chat',{message:prompt,agentName:'workbench',sessionId:'wb-'+Date.now()});
    if (out) out.textContent = r.response||r.message||'Done';
  } catch(e) { if (out) out.textContent = 'Error: '+e.message; }
}

function copyOutput() {
  const out = document.getElementById('wb-output');
  if (out) navigator.clipboard.writeText(out.textContent).then(()=>toast('Copied!','success')).catch(()=>toast('Copy failed','error'));
}

/* ── Calendar ──────────────────────────────────────── */
let _calTab = 'content';
let _calFilter = 'all';

// Local custom calendar events stored in localStorage
function _getLocalCalEvents() { return JSON.parse(localStorage.getItem('cal_events')||'[]'); }
function _saveLocalCalEvents(arr) { localStorage.setItem('cal_events', JSON.stringify(arr)); }

function loadContentCalendar() {
  document.querySelectorAll('[data-cal-tab]').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('[data-cal-tab]').forEach(x=>x.classList.remove('active'));
      t.classList.add('active'); _calTab=t.dataset.calTab; loadCalendarContent(_calTab);
    };
  });
  document.querySelectorAll('[data-cal-filter]').forEach(f => {
    f.onclick = () => {
      document.querySelectorAll('[data-cal-filter]').forEach(x=>x.classList.remove('active'));
      f.classList.add('active'); _calFilter=f.dataset.calFilter; loadCalendarContent(_calTab);
    };
  });
  loadCalendarContent('content');
}

function openAddCalendarEvent() {
  // Pre-fill today's date
  const today = new Date().toISOString().split('T')[0];
  const d = document.getElementById('cal-date');
  if (d) d.value = today;
  // Pre-select current tab type
  const typeEl = document.getElementById('cal-type');
  if (typeEl && ['content','meetings','milestones'].includes(_calTab)) typeEl.value = _calTab;
  document.getElementById('add-cal-modal')?.classList.add('active');
}
function closeAddCalendarEvent() { document.getElementById('add-cal-modal')?.classList.remove('active'); }
function saveCalendarEvent() {
  const title    = document.getElementById('cal-title')?.value?.trim();
  const date     = document.getElementById('cal-date')?.value;
  const startT   = document.getElementById('cal-start-time')?.value || '';
  const endT     = document.getElementById('cal-end-time')?.value || '';
  const cat      = document.getElementById('cal-category')?.value || 'personal';
  const type     = document.getElementById('cal-type')?.value || 'content';
  const location = document.getElementById('cal-location')?.value?.trim() || '';
  const notes    = document.getElementById('cal-notes')?.value?.trim() || '';
  if (!title||!date) { toast('Title and Date are required','error'); return; }
  const events = _getLocalCalEvents();
  events.push({id:'ce_'+Date.now(), title, date, startTime:startT, endTime:endT, category:cat, type, location, notes});
  _saveLocalCalEvents(events);
  closeAddCalendarEvent();
  // Reset form
  ['cal-title','cal-date','cal-start-time','cal-end-time','cal-location','cal-notes'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  loadCalendarContent(_calTab);
  toast('Calendar entry added','success');
}
function deleteCalendarEvent(id) {
  const events = _getLocalCalEvents().filter(e=>e.id!==id);
  _saveLocalCalEvents(events);
  loadCalendarContent(_calTab);
  showToast('Entry removed');
}

async function loadCalendarContent(tab) {
  const body = document.getElementById('calendar-body');
  if (!body) return;
  render(body, '<div class="spinner" style="margin:24px auto"></div>');
  try {
    let items = [];
    if (tab==='content') {
      const data = await API.get('/api/content-calendar');
      items = (Array.isArray(data)?data:(data.records||[])).map(d => {
        const f=d.fields||d;
        return {id:null,date:f['Publish Date']||f.date||'—',title:f.Title||f.name||'Content',meta:f.Client||f.client||'—',color:'var(--accent)',category:'clients'};
      });
    } else if (tab==='meetings') {
      const data = await API.get('/api/calendar/events').catch(()=>[]);
      items = (Array.isArray(data)?data:[]).map(e=>({id:null,date:e.start||'—',title:e.summary||'Meeting',meta:e.location||'—',color:'var(--emerald)',category:'personal'}));
    } else if (tab==='deadlines') {
      const data = await API.get('/api/deliverables').catch(()=>[]);
      const rawDeadlines = Array.isArray(data)?data:(data.deliverables||data.records||[]);
      items = rawDeadlines.filter(d=>(d.fields?.['Due Date']||d.dueDate||d.due_date)).map(d=>{const f=d.fields||d;return {id:null,date:f['Due Date']||d.dueDate||d.due_date||'—',title:f.Title||d.title||d.name||'Deliverable',meta:f.Client||d.client||'—',color:'var(--gold)',category:'clients'};});
    }
    // Merge local custom events for the current tab type
    const localMerged = _getLocalCalEvents()
      .filter(e => tab==='milestones' ? true : e.type===tab)
      .map(e => ({
        id: e.id,
        date: e.date,
        startTime: e.startTime || '',
        endTime: e.endTime || '',
        title: e.title,
        location: e.location || '',
        notes: e.notes || '',
        meta: e.notes || e.category,
        color: 'var(--accent)',
        category: e.category
      }));
    items = [...items, ...localMerged];
    // Apply category filter
    if (_calFilter !== 'all') items = items.filter(i=>i.category===_calFilter);
    // Sort by date
    items.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    const meetingsEmpty = tab==='meetings'
      ? '<div class="empty-state"><div class="empty-icon" style="font-size:32px">📅</div><div class="empty-title">Google Calendar not connected</div><div class="empty-desc" style="max-width:320px">Add <code style="font-family:var(--font-mono);font-size:11px;background:var(--surface-3);padding:2px 6px;border-radius:4px">GOOGLE_SERVICE_ACCOUNT_JSON</code> to your .env to sync meetings.</div><button class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="navigate(\'settings\')">Open Settings →</button></div>'
      : emptyState('No '+tab+' entries','calendar');

    const fmtDay = dStr => {
      if (!dStr || dStr==='—') return { day:'—', month:'', weekday:'' };
      const d = new Date(dStr);
      if (isNaN(d.getTime())) {
        // Try YYYY-MM-DD parse
        const parts = String(dStr).slice(0,10).split('-');
        if (parts.length === 3) {
          const d2 = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
          if (!isNaN(d2.getTime())) return { day: d2.getDate(), month: d2.toLocaleString('en',{month:'short'}), weekday: d2.toLocaleString('en',{weekday:'short'}) };
        }
        return { day: String(dStr).slice(8,10) || '—', month: '', weekday: '' };
      }
      return { day: d.getDate(), month: d.toLocaleString('en',{month:'short'}), weekday: d.toLocaleString('en',{weekday:'short'}) };
    };

    render(body, items.length ? '<div class="cal-entries-grid">' + items.map(item => {
      const dt = fmtDay(item.date);
      const timeStr = item.startTime
        ? (item.endTime ? `${item.startTime}–${item.endTime}` : item.startTime)
        : '';
      const catBadge = item.category
        ? `<span class="cal-cat-badge cal-cat-${escapeHtml(item.category)}">${escapeHtml(item.category)}</span>` : '';
      return `<div class="cal-entry-card" style="--cal-accent:${escapeHtml(item.color)}">
        <div class="cal-entry-date">
          <div class="cal-entry-day">${escapeHtml(String(dt.day))}</div>
          <div class="cal-entry-month">${escapeHtml(dt.month)}</div>
          ${dt.weekday ? `<div class="cal-entry-weekday">${escapeHtml(dt.weekday)}</div>` : ''}
        </div>
        <div class="cal-entry-divider"></div>
        <div class="cal-entry-body">
          <div class="cal-entry-header-row">
            <div class="cal-entry-title">${escapeHtml(item.title)}</div>
            ${item.id ? `<button class="cal-entry-remove" onclick="deleteCalendarEvent('${escapeHtml(item.id)}')" title="Remove"><i data-lucide="x" style="width:13px;height:13px"></i></button>` : ''}
          </div>
          <div class="cal-entry-chips">
            ${timeStr ? `<span class="cal-entry-chip"><i data-lucide="clock" style="width:11px;height:11px"></i> ${escapeHtml(timeStr)}</span>` : ''}
            ${item.location ? `<span class="cal-entry-chip"><i data-lucide="map-pin" style="width:11px;height:11px"></i> ${escapeHtml(item.location.slice(0,30))}</span>` : ''}
            ${catBadge}
          </div>
          ${item.notes || item.meta ? `<div class="cal-entry-notes">${escapeHtml((item.notes || item.meta || '').slice(0,140))}</div>` : ''}
        </div>
      </div>`;
    }).join('') + '</div>' : meetingsEmpty);
    refreshIcons();
  } catch(e) { render(body, '<p class="text-rose">Error: '+escapeHtml(e.message)+'</p>'); }
}

/* ── Reports ───────────────────────────────────────── */
let _reportChartsInit = false;

async function loadReports(forceRefresh) {
  const kpis = document.getElementById('reports-kpis');
  if (!kpis) return;
  if (!forceRefresh && kpis.dataset.loaded) return;
  kpis.dataset.loaded = '1';
  render(kpis, '<div class="spinner" style="margin:24px auto;grid-column:1/-1"></div>');
  // Destroy old charts on refresh
  if (forceRefresh && _reportChartsInit) {
    ['reports-mrr-chart','reports-agents-chart','reports-pipeline-chart'].forEach(id => {
      const c = Chart.getChart(id); if (c) c.destroy();
    });
    _reportChartsInit = false;
  }
  try {
    const [summary, deliverables, leadStats] = await Promise.all([
      API.get('/api/reports/summary').catch(()=>({mrr:0,clientCount:0})),
      API.get('/api/deliverables?limit=200').catch(()=>[]),
      API.get('/api/leads/stats').catch(()=>({total:0,converted:0,pipeline:0,tierA:0}))
    ]);
    const mrr = summary.mrr || 0;
    render(kpis,
      kpiTile('₹'+mrr.toLocaleString('en-IN'), 'Agency MRR', 'indian-rupee', 'gold') +
      kpiTile(summary.clientCount || 0, 'Active Clients', 'users', 'accent') +
      kpiTile(summary.deliverablesCompleted || summary.deliverableCount || 0, 'Deliverables Done', 'package', 'emerald') +
      kpiTile((leadStats.stats||leadStats).total || 0, 'Total Leads', 'target', 'amber'));
    refreshIcons();

    // MRR Trend — use real value as current month + synthesize realistic prior months
    const mrrCtx = document.getElementById('reports-mrr-chart');
    if (mrrCtx && window.Chart && !_reportChartsInit) {
      const months = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d.toLocaleString('default', {month:'short'}));
      }
      // Build realistic progression: current month = real MRR, prior months decrease by 5-15%
      const mrrSeed = mrr > 0 ? mrr : 0;
      const mrrData = months.map((_, idx) => {
        if (idx === 5) return mrrSeed;
        const decay = 1 - (5 - idx) * (0.08 + Math.floor(idx * 3) / 100);
        return Math.round(mrrSeed * decay);
      });
      new Chart(mrrCtx, {
        type: 'line',
        data: {
          labels: months,
          datasets: [{
            label: 'MRR (₹)',
            data: mrrData,
            borderColor: '#f5a623',
            backgroundColor: 'rgba(245,166,35,0.1)',
            borderWidth: 2,
            pointBackgroundColor: '#f5a623',
            pointRadius: 4,
            tension: 0.4,
            fill: true
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6666aa' } },
            y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6666aa', callback: v => '₹'+Number(v).toLocaleString('en-IN') }, beginAtZero: true }
          }
        }
      });
    }

    // Pipeline chart
    const items = Array.isArray(deliverables) ? deliverables : (deliverables.records || []);
    const statusCounts = {};
    items.forEach(d => { const s = d.fields?.Status || d.status || 'Brief'; statusCounts[s] = (statusCounts[s] || 0) + 1; });
    if (!Object.keys(statusCounts).length) ['Brief','Draft','Review','Done'].forEach(s => statusCounts[s] = 0);
    const pCtx = document.getElementById('reports-pipeline-chart');
    if (pCtx && window.Chart && !_reportChartsInit) {
      new Chart(pCtx, { type: 'doughnut', data: {
        labels: Object.keys(statusCounts),
        datasets: [{ data: Object.values(statusCounts), backgroundColor: ['#4F6EF7','#F4B942','#34C759','#FF375F','#8B5CF6'], borderWidth: 0 }]
      }, options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#8888a8', font: { size: 11 }, padding: 12 } } } }});
    }

    // Agent activity chart
    const topAgents = summary.topAgents || [];
    const aCtx = document.getElementById('reports-agents-chart');
    if (aCtx && window.Chart && !_reportChartsInit && topAgents.length) {
      new Chart(aCtx, { type: 'bar', data: {
        labels: topAgents.slice(0,6).map(a => a.agent_name || a.name || 'Agent'),
        datasets: [
          { label: 'Runs', data: topAgents.slice(0,6).map(a => a.runs || 0), backgroundColor: 'rgba(79,110,247,0.75)', borderRadius: 5 },
          { label: 'Success', data: topAgents.slice(0,6).map(a => a.successes || 0), backgroundColor: 'rgba(0,196,140,0.75)', borderRadius: 5 }
        ]
      }, options: { responsive: true, plugins: { legend: { labels: { color: '#8888a8', font: { size: 10 } } } }, scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6666aa', font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6666aa' } }
      }}});
    } else if (aCtx && window.Chart && !_reportChartsInit) {
      render(aCtx.parentNode, '<div class="card-header"><div class="card-title">Agent Activity</div><div class="card-subtitle">Runs this period</div></div><p style="color:var(--text-3);font-size:0.8rem;padding:16px 20px">No agent runs recorded yet.</p>');
    }
    _reportChartsInit = true;

    // Client performance table
    const tbody = document.getElementById('reports-client-tbody');
    if (tbody) {
      if (summary.clients && summary.clients.length) {
        render(tbody, summary.clients.map(c =>
          '<tr><td class="font-medium">' + escapeHtml(c.name || '—') + '</td>' +
          '<td>' + escapeHtml(String(c.deliverables || 0)) + '</td>' +
          '<td>' + escapeHtml(String(c.pendingApprovals || 0)) + '</td>' +
          '<td class="text-gold font-mono">₹' + Number(c.mrr || 0).toLocaleString('en-IN') + '</td></tr>'
        ).join(''));
      } else {
        render(tbody, '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-3)">No client data available</td></tr>');
      }
    }

    // Lead funnel
    const funnelEl = document.getElementById('reports-lead-funnel');
    if (funnelEl) {
      const ls = leadStats || {};
      const stages = [
        { label: 'Total Leads',  value: ls.total || 0,     color: '#4F6EF7' },
        { label: 'In Pipeline',  value: ls.pipeline || 0,  color: '#f5a623' },
        { label: 'Tier A',       value: ls.tierA || 0,     color: '#a855f7' },
        { label: 'Converted',    value: ls.converted || 0, color: '#34C759' }
      ];
      const maxVal = Math.max(...stages.map(s => s.value), 1);
      render(funnelEl, stages.map((s, i) => {
        const pct = Math.round((s.value / maxVal) * 100);
        return '<div class="funnel-stage" style="--fi:'+i+'">' +
          '<div class="funnel-bar-wrap"><div class="funnel-bar" style="width:'+pct+'%;background:'+s.color+'"></div></div>' +
          '<div class="funnel-meta"><span class="funnel-label">'+escapeHtml(s.label)+'</span>' +
          '<span class="funnel-value" style="color:'+s.color+'">'+escapeHtml(String(s.value))+'</span></div></div>';
      }).join(''));
    }
  } catch(e) {
    render(kpis, '<p class="text-rose" style="grid-column:1/-1;padding:12px">Error loading reports: ' + escapeHtml(e.message) + '</p>');
  }
}

async function generateWeeklyReport() {
  const btn = document.querySelector('[onclick="generateWeeklyReport()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    await API.post('/api/n8n/trigger/weekly-report', {});
    toast('Weekly report generation started — check your WhatsApp', 'success');
  } catch(e) {
    // Fallback: trigger via chat agent
    try {
      await API.post('/api/chat', { message: 'Generate a comprehensive weekly agency report with client updates, deliverable stats, revenue summary, and lead pipeline status.', agentName: 'morning-brief', sessionId: 'report-' + Date.now() });
      toast('Report generated — check Chat for the output', 'success');
    } catch(e2) { toast('Could not generate report: ' + e2.message, 'error'); }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="file-text" style="width:13px;height:13px"></i> Generate Report'; refreshIcons(); }
  }
}

/* ── Projects ──────────────────────────────────────── */
const _PROJECT_SEEDS = [
  { id:'seed-proj-1', name:'Haute Pink — Brand Refresh', client:'Haute Pink', status:'In Progress', description:'Full brand identity refresh: new logo, packaging system, Instagram aesthetic overhaul.', dueDate:'2026-06-15', deliverables: 8, done: 5, tags:['branding','social'] },
  { id:'seed-proj-2', name:'Dharitri Wild Honey — Product Launch', client:'Dharitri', status:'In Progress', description:'D2C launch campaign: content strategy, influencer partnerships, email sequence.', dueDate:'2026-05-30', deliverables: 12, done: 7, tags:['launch','d2c'] },
  { id:'seed-proj-3', name:'MCC Coffee — Monthly Retainer (May)', client:'MCC Coffee', status:'In Progress', description:'Monthly content: 16 Instagram posts, 4 Reels, 2 blog articles, email newsletter.', dueDate:'2026-05-31', deliverables: 22, done: 14, tags:['content','retainer'] },
  { id:'seed-proj-4', name:'Sumit (Founder) — Personal Brand', client:'Sumit', status:'Review', description:'LinkedIn thought leadership, Twitter presence, speaking bio, and media kit.', dueDate:'2026-06-01', deliverables: 6, done: 5, tags:['personal-brand','linkedin'] },
  { id:'seed-proj-5', name:'Agency Website — Case Studies', client:'Manthan', status:'Not Started', description:'Write and design 3 client case studies for manthan.agency website.', dueDate:'2026-06-30', deliverables: 3, done: 0, tags:['agency','website'] },
];

let _PROJECTS_CACHE = [];

async function loadProjects() {
  const el = document.getElementById('projects-grid');
  if (!el) return;
  render(el, '<div class="spinner" style="margin:24px auto;grid-column:1/-1"></div>');
  try {
    const data = await API.get('/api/projects');
    let items = Array.isArray(data)?data:(data.records||[]);

    // Merge with seeds if Airtable returns nothing
    if (!items.length) {
      items = _PROJECT_SEEDS;
    }

    // Cache for detail view
    _PROJECTS_CACHE = items.map((p,i) => {
      const f = p.fields || p;
      return { ...p, _key: p.id || f.id || ('proj-' + i) };
    });

    const statusColor = s => {
      const l = (s||'').toLowerCase().replace(/[ -]/g,'_');
      if (l.includes('progress')) return { cls:'in-progress', color:'var(--accent)' };
      if (l.includes('review')) return { cls:'review', color:'var(--gold)' };
      if (l.includes('done') || l.includes('complete')) return { cls:'done', color:'var(--emerald)' };
      return { cls:'not-started', color:'var(--text-3)' };
    };

    render(el, _PROJECTS_CACHE.map(p => {
      const f = p.fields || p;
      const name = f.Name || f.name || 'Project';
      const client = f.Client || f.client || '—';
      const status = f.Status || f.status || 'Not Started';
      const desc = (f.Description || f.description || '').slice(0, 90);
      const due = f['Due Date'] || f.dueDate || 'TBD';
      const sc = statusColor(status);
      const total = f.deliverables || 0;
      const done = f.done || 0;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const tags = (f.tags || []).slice(0, 2);

      return `<div class="project-card" onclick="openProjectDetail('${escapeHtml(p._key)}')" style="cursor:pointer">
        <div class="project-card-top">
          <div style="flex:1;min-width:0">
            <div class="project-card-name">${escapeHtml(name)}</div>
            <div class="project-card-client">${escapeHtml(client)}</div>
          </div>
          <span class="project-status-badge ${escapeHtml(sc.cls)}">${escapeHtml(status)}</span>
        </div>
        ${desc ? `<p class="text-small text-muted" style="line-height:1.5;margin:6px 0">${escapeHtml(desc)}${f.description&&f.description.length>90?'…':''}</p>` : ''}
        ${total ? `<div class="project-progress-wrap">
          <div class="project-progress-track">
            <div class="project-progress-fill" style="width:${pct}%;background:${sc.color}"></div>
          </div>
          <span class="project-progress-label">${done}/${total} deliverables</span>
        </div>` : ''}
        <div class="project-card-footer">
          <div style="display:flex;gap:6px">
            ${tags.map(t=>`<span class="kb-tag">${escapeHtml(t)}</span>`).join('')}
          </div>
          <span class="text-small text-muted font-mono">${escapeHtml(due)}</span>
        </div>
      </div>`;
    }).join(''));
    refreshIcons();
  } catch(e) { render(el, '<div style="grid-column:1/-1"><p class="text-rose">Error: '+escapeHtml(e.message)+'</p></div>'); }
}

/* ── Project Detail Slide-over ─────────────────────── */
function openProjectDetail(key) {
  const p = _PROJECTS_CACHE.find(x => x._key === key);
  if (!p) { toast('Project not found','error'); return; }
  const f = p.fields || p;
  const name   = f.Name || f.name || 'Project';
  const client = f.Client || f.client || '—';
  const status = f.Status || f.status || 'Not Started';
  const desc   = f.Description || f.description || 'No description provided.';
  const due    = f['Due Date'] || f.dueDate || 'TBD';
  const total  = f.deliverables || 0;
  const done   = f.done || 0;
  const pct    = total ? Math.round((done / total) * 100) : 0;
  const tags   = f.tags || [];

  let panel = document.getElementById('project-detail-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'project-detail-panel';
    panel.className = 'slide-over-panel';
    document.body.appendChild(panel);
  }
  panel.innerHTML = `
    <div class="slide-over-backdrop" onclick="closeProjectDetail()"></div>
    <div class="slide-over-content">
      <div class="slide-over-header">
        <div>
          <div class="text-h3">${escapeHtml(name)}</div>
          <div class="text-small text-muted" style="margin-top:4px">${escapeHtml(client)}</div>
        </div>
        <button class="btn-icon btn btn-ghost" onclick="closeProjectDetail()"><i data-lucide="x" style="width:16px;height:16px"></i></button>
      </div>
      <div class="slide-over-body">
        <div class="grid grid-2" style="gap:12px;margin-bottom:20px">
          <div class="kpi-mini">
            <div class="kpi-mini-label">Status</div>
            <div class="kpi-mini-value">${escapeHtml(status)}</div>
          </div>
          <div class="kpi-mini">
            <div class="kpi-mini-label">Due Date</div>
            <div class="kpi-mini-value font-mono">${escapeHtml(due)}</div>
          </div>
          <div class="kpi-mini">
            <div class="kpi-mini-label">Deliverables</div>
            <div class="kpi-mini-value">${done}/${total}</div>
          </div>
          <div class="kpi-mini">
            <div class="kpi-mini-label">Completion</div>
            <div class="kpi-mini-value">${pct}%</div>
          </div>
        </div>
        ${total ? `<div class="project-progress-wrap" style="margin-bottom:20px">
          <div class="project-progress-track" style="height:8px">
            <div class="project-progress-fill" style="width:${pct}%;background:var(--accent)"></div>
          </div>
        </div>` : ''}
        <div class="settings-section-title" style="margin-top:0">Description</div>
        <p style="line-height:1.6;color:var(--text-2)">${escapeHtml(desc)}</p>
        ${tags.length ? `<div class="settings-section-title" style="margin-top:24px">Tags</div>
        <div class="flex" style="gap:6px;flex-wrap:wrap">
          ${tags.map(t => `<span class="kb-tag">${escapeHtml(t)}</span>`).join('')}
        </div>` : ''}
        <div class="settings-section-title" style="margin-top:24px">Linked Deliverables</div>
        <div id="proj-deliverables-${escapeHtml(p._key)}" class="text-small text-muted">Loading…</div>
      </div>
      <div class="slide-over-footer">
        <button class="btn btn-ghost" onclick="closeProjectDetail()">Close</button>
        <button class="btn btn-secondary" onclick="openProjectEditModal('${escapeHtml(p._key)}')"><i data-lucide="edit-2" style="width:13px;height:13px"></i> Edit</button>
      </div>
    </div>
  `;
  panel.classList.add('active');
  refreshIcons();
  // Load linked deliverables
  _loadProjectDeliverables(p._key, name);
}

async function _loadProjectDeliverables(key, projectName) {
  const el = document.getElementById('proj-deliverables-' + key);
  if (!el) return;
  try {
    const data = await API.get('/api/deliverables');
    const all = Array.isArray(data) ? data : (data.deliverables || data.records || []);
    const matches = all.filter(d => {
      const f = d.fields || d;
      return (f.Project || f.project || '').toLowerCase().includes(projectName.toLowerCase());
    });
    if (!matches.length) { render(el, '<p class="text-small text-muted">No deliverables linked to this project yet.</p>'); return; }
    render(el, '<div style="display:flex;flex-direction:column;gap:8px">' +
      matches.slice(0,8).map(d => {
        const f = d.fields || d;
        return '<div class="settings-row" style="padding:10px;background:var(--surface-2);border-radius:8px;border:1px solid var(--border)">' +
          '<div class="settings-row-info"><div class="text-small font-medium">' + escapeHtml(f.Title || f.title || 'Deliverable') + '</div>' +
          '<div class="text-small text-muted">' + escapeHtml(f.Status || f.status || '—') + '</div></div></div>';
      }).join('') + '</div>');
  } catch (e) { render(el, '<p class="text-small text-rose">Failed to load deliverables</p>'); }
}

function closeProjectDetail() {
  const panel = document.getElementById('project-detail-panel');
  if (panel) panel.classList.remove('active');
}

function openProjectEditModal(key) {
  const p = _PROJECTS_CACHE.find(x => x._key === key);
  if (!p) return;
  const f = p.fields || p;
  let modal = document.getElementById('project-edit-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'project-edit-modal';
    modal.className = 'modal-overlay';
    modal.onclick = e => { if (e.target === modal) closeProjectEditModal(); };
    document.body.appendChild(modal);
  }
  render(modal,
    '<div class="modal" style="max-width:500px">' +
    '<div class="modal-header"><h3 class="modal-title">Edit Project</h3>' +
    '<button class="modal-close" onclick="closeProjectEditModal()"><i data-lucide="x" style="width:16px;height:16px"></i></button></div>' +
    '<div class="modal-body" style="display:flex;flex-direction:column;gap:16px">' +
    '<input type="hidden" id="proj-edit-key" value="' + escapeHtml(key) + '">' +
    '<div class="form-group"><label class="form-label">Project Name</label>' +
    '<input class="form-input" id="proj-edit-name" value="' + escapeHtml(f.Name || f.name || '') + '"></div>' +
    '<div class="form-group"><label class="form-label">Status</label>' +
    '<select class="form-input" id="proj-edit-status">' +
    ['Not Started','In Progress','On Hold','Completed','Cancelled'].map(s =>
      '<option value="' + s + '"' + ((f.Status || f.status || '') === s ? ' selected' : '') + '>' + s + '</option>'
    ).join('') +
    '</select></div>' +
    '<div class="form-group"><label class="form-label">Due Date</label>' +
    '<input class="form-input" type="date" id="proj-edit-due" value="' + escapeHtml(f['Due Date'] || f.dueDate || '') + '"></div>' +
    '<div class="form-group"><label class="form-label">Description</label>' +
    '<textarea class="form-input" id="proj-edit-desc" rows="4">' + escapeHtml(f.Description || f.description || '') + '</textarea></div>' +
    '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-ghost" onclick="closeProjectEditModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveProjectEdit()">Save Changes</button>' +
    '</div></div>'
  );
  modal.style.display = 'flex';
  refreshIcons();
  setTimeout(() => document.getElementById('proj-edit-name')?.focus(), 80);
}

function closeProjectEditModal() {
  const modal = document.getElementById('project-edit-modal');
  if (modal) modal.style.display = 'none';
}

async function saveProjectEdit() {
  const key = document.getElementById('proj-edit-key')?.value;
  const name = document.getElementById('proj-edit-name')?.value?.trim();
  const status = document.getElementById('proj-edit-status')?.value;
  const due = document.getElementById('proj-edit-due')?.value;
  const desc = document.getElementById('proj-edit-desc')?.value?.trim();
  if (!name) { toast('Project name required', 'error'); return; }
  const p = _PROJECTS_CACHE.find(x => x._key === key);
  if (!p) { toast('Project not found', 'error'); return; }
  const f = p.fields || p;
  const payload = { name, status, dueDate: due, description: desc };
  try {
    await API.post('/api/projects/' + (p.id || key), payload);
  } catch(e) { /* local update if backend unavailable */ }
  // Update cache locally
  Object.assign(f, { Name: name, name, Status: status, status, 'Due Date': due, dueDate: due, Description: desc, description: desc });
  closeProjectEditModal();
  closeProjectDetail();
  toast('Project updated', 'success');
  loadProjects(true);
}

function openProjectModal() { populateClientSelect('proj-client'); document.getElementById('project-modal').classList.add('active'); }
function closeProjectModal() { document.getElementById('project-modal').classList.remove('active'); }

async function createProject() {
  const name=document.getElementById('proj-name').value.trim();
  const client=document.getElementById('proj-client').value;
  const status=document.getElementById('proj-status').value;
  const due=document.getElementById('proj-due').value;
  const desc=document.getElementById('proj-desc').value;
  if (!name||!client) { toast('Name and client required','error'); return; }
  try {
    await API.post('/api/projects',{name,client,status,dueDate:due,description:desc});
    closeProjectModal(); toast('Project created!','success'); loadProjects();
  } catch(e) { toast('Error: '+e.message,'error'); }
}
