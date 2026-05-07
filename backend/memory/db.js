const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../manthan.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      agent_name TEXT,
      client_id TEXT,
      tokens_used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);

    CREATE TABLE IF NOT EXISTS agent_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      client_id TEXT,
      memory_type TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_name, client_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_mem_agent ON agent_memory(agent_name, client_id);

    CREATE TABLE IF NOT EXISTS client_contexts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brand_name TEXT,
      industry TEXT,
      tone TEXT,
      channels TEXT,
      rate_card TEXT,
      brand_gradient TEXT,
      airtable_record_id TEXT,
      notion_page_id TEXT,
      whatsapp_number TEXT,
      context_md TEXT,
      mind_map_data TEXT DEFAULT '{}',
      health_score INTEGER DEFAULT 0,
      health_computed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      client_id TEXT,
      session_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('running','success','error')),
      input_summary TEXT,
      output_summary TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      duration_ms INTEGER,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_name, created_at);

    CREATE TABLE IF NOT EXISTS financials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      year INTEGER NOT NULL,
      client_id TEXT,
      retainer_amount REAL DEFAULT 0,
      invoice_amount REAL DEFAULT 0,
      payment_status TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(month, year, client_id)
    );

    CREATE TABLE IF NOT EXISTS saved_outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      title TEXT,
      content TEXT NOT NULL,
      agent_name TEXT,
      client_id TEXT,
      output_type TEXT,
      saved_to_notion INTEGER DEFAULT 0,
      notion_page_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL UNIQUE,
      client_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'INR',
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','sent','paid','overdue','cancelled')),
      due_date DATE,
      paid_date DATE,
      line_items TEXT DEFAULT '[]',
      notes TEXT,
      pdf_path TEXT,
      airtable_record_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deliverables (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT,
      platform TEXT,
      status TEXT DEFAULT 'brief' CHECK(status IN ('brief','draft','qa','client_review','approved','published','rejected')),
      content TEXT,
      hashtags TEXT,
      image_prompt TEXT,
      brief TEXT,
      due_date DATE,
      approved_date DATE,
      published_date DATE,
      client_feedback TEXT,
      revision_count INTEGER DEFAULT 0,
      airtable_record_id TEXT,
      project_id TEXT,
      current_version INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_deliv_client ON deliverables(client_id, status);

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      deliverable_id TEXT,
      title TEXT NOT NULL,
      content_type TEXT,
      platform TEXT,
      content_preview TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revision_requested')),
      priority TEXT DEFAULT 'normal',
      whatsapp_sent INTEGER DEFAULT 0,
      whatsapp_sent_at DATETIME,
      reviewed_by TEXT,
      reviewed_via TEXT,
      reviewed_at DATETIME,
      client_feedback TEXT,
      revision_notes TEXT,
      airtable_record_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, created_at);

    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      event_type TEXT,
      payload TEXT NOT NULL,
      processed INTEGER DEFAULT 0,
      processed_at DATETIME,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_processed ON webhook_events(processed, created_at);

    CREATE TABLE IF NOT EXISTS content_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deliverable_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      changed_by TEXT DEFAULT 'agent',
      change_summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(deliverable_id, version)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      client_id TEXT,
      action_url TEXT,
      read INTEGER DEFAULT 0,
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read, created_at);

    CREATE TABLE IF NOT EXISTS sops (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'ops',
      description TEXT,
      owner TEXT DEFAULT 'Yash',
      steps TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      version INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sops_cat ON sops(category, created_at);

    CREATE TABLE IF NOT EXISTS custom_connectors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'rest_api',
      icon TEXT DEFAULT '🔌',
      url TEXT,
      auth_type TEXT DEFAULT 'bearer',
      auth_header TEXT DEFAULT 'Authorization',
      token TEXT,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      last_tested DATETIME,
      last_status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_cc_enabled ON custom_connectors(enabled);

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      type TEXT DEFAULT 'meeting',
      client_id TEXT,
      location TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events(start_time);

    CREATE TABLE IF NOT EXISTS uploaded_files (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      path TEXT,
      context TEXT DEFAULT 'kb',
      client_id TEXT,
      tags TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_files_ctx ON uploaded_files(context, created_at);
  `);
}

module.exports = { getDb };
