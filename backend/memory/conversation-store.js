'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
const { getDb } = require('./db');

const COMPRESS_THRESHOLD = 30;  // Compress if session has more than this many messages
const COMPRESS_KEEP_OLDEST = 20; // Summarize the oldest N messages when compressing

/**
 * Save a message to the conversations table.
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.role - 'user' | 'assistant' | 'system'
 * @param {string} params.content
 * @param {string} [params.agentName]
 * @param {string} [params.clientId]
 * @param {number} [params.tokensUsed=0]
 * @returns {{ id: number }}
 */
function saveMessage({ sessionId, role, content, agentName = null, clientId = null, tokensUsed = 0 }) {
  if (!sessionId) throw new Error('[conversation-store] sessionId is required');
  if (!role) throw new Error('[conversation-store] role is required');
  if (!content && content !== '') throw new Error('[conversation-store] content is required');

  const validRoles = ['user', 'assistant', 'system'];
  if (!validRoles.includes(role)) {
    throw new Error(`[conversation-store] role must be one of: ${validRoles.join(', ')}`);
  }

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO conversations (session_id, role, content, agent_name, client_id, tokens_used, created_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const result = stmt.run(
    String(sessionId),
    role,
    String(content),
    agentName ? String(agentName) : null,
    clientId ? String(clientId) : null,
    Math.max(0, Math.floor(tokensUsed || 0))
  );

  return { id: result.lastInsertRowid };
}

/**
 * Get messages for a session, ordered oldest first.
 * @param {string} sessionId
 * @param {number} [limit=50]
 * @returns {Array<{id, sessionId, role, content, agentName, clientId, tokensUsed, createdAt}>}
 */
function getMessages(sessionId, limit = 50) {
  if (!sessionId) throw new Error('[conversation-store] sessionId is required');

  const db = getDb();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));

  const rows = db.prepare(`
    SELECT id, session_id as sessionId, role, content, agent_name as agentName,
           client_id as clientId, tokens_used as tokensUsed, created_at as createdAt
    FROM conversations
    WHERE session_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(String(sessionId), safeLimit);

  return rows;
}

/**
 * Delete all messages for a session.
 * @param {string} sessionId
 */
function deleteSession(sessionId) {
  if (!sessionId) throw new Error('[conversation-store] sessionId is required');

  const db = getDb();
  db.prepare('DELETE FROM conversations WHERE session_id = ?').run(String(sessionId));
}

/**
 * Get a summary of all sessions.
 * @returns {Array<{sessionId, messageCount, lastMessage, createdAt}>}
 */
function getAllSessions() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      session_id as sessionId,
      COUNT(*) as messageCount,
      MAX(content) as lastMessage,
      MIN(created_at) as createdAt,
      MAX(created_at) as lastActivity
    FROM conversations
    GROUP BY session_id
    ORDER BY MAX(created_at) DESC
  `).all();

  return rows.map(r => ({
    sessionId: r.sessionId,
    messageCount: r.messageCount,
    lastMessage: String(r.lastMessage || '').slice(0, 100),
    createdAt: r.createdAt,
    lastActivity: r.lastActivity
  }));
}

/**
 * Compress a session by summarizing the oldest messages with Claude.
 * If the session has more than COMPRESS_THRESHOLD messages,
 * the oldest COMPRESS_KEEP_OLDEST are summarized into a single system message.
 * @param {string} sessionId
 */
async function compressSession(sessionId) {
  if (!sessionId) throw new Error('[conversation-store] sessionId is required');

  const db = getDb();

  const totalCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM conversations WHERE session_id = ?'
  ).get(String(sessionId));

  if (!totalCount || totalCount.cnt <= COMPRESS_THRESHOLD) {
    return; // Nothing to compress
  }

  // Get the oldest messages to summarize
  const oldestMessages = db.prepare(`
    SELECT id, role, content, agent_name as agentName, created_at as createdAt
    FROM conversations
    WHERE session_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(String(sessionId), COMPRESS_KEEP_OLDEST);

  if (oldestMessages.length === 0) return;

  // Format messages for the summarizer
  const conversationText = oldestMessages
    .map(m => `[${m.role.toUpperCase()}${m.agentName ? ` (${m.agentName})` : ''}]: ${m.content}`)
    .join('\n\n');

  let summary;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: 'You are a conversation summarizer for an AI agency management system. Create concise, factual summaries that preserve all key decisions, client names, tasks mentioned, and important context. Output a single paragraph summary.',
      messages: [
        {
          role: 'user',
          content: `Summarize this conversation segment concisely, preserving key facts, decisions, and context:\n\n${conversationText}`
        }
      ]
    });

    summary = response.content[0]?.text || conversationText.slice(0, 500);
  } catch (err) {
    console.warn('[conversation-store] Claude compression failed, using truncated text:', err.message);
    // Fallback: use first 500 chars of the conversation as the summary
    summary = `[Compressed] ${conversationText.slice(0, 500)}...`;
  }

  // Delete the old messages and replace with a single system summary message
  const oldIds = oldestMessages.map(m => m.id);
  const oldestDate = oldestMessages[0].createdAt;

  const deleteStmt = db.prepare(`DELETE FROM conversations WHERE id IN (${oldIds.map(() => '?').join(',')})`);
  const insertStmt = db.prepare(`
    INSERT INTO conversations (session_id, role, content, agent_name, created_at)
    VALUES (?, 'system', ?, 'compression', ?)
  `);

  db.transaction(() => {
    deleteStmt.run(...oldIds);
    insertStmt.run(String(sessionId), `[Conversation summary — compressed ${oldIds.length} messages]: ${summary}`, oldestDate);
  })();

  console.log(`[conversation-store] Compressed ${oldIds.length} messages in session ${sessionId}`);
}

module.exports = {
  saveMessage,
  getMessages,
  deleteSession,
  getAllSessions,
  compressSession
};
