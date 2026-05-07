'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
const https = require('https');
const axios = require('axios').create({ httpsAgent: new https.Agent({ family: 4 }) });

const BASE_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function getClient() {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    throw new Error('[notion] NOTION_API_KEY environment variable is not set');
  }
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    timeout: 20000
  });
}

function getDbId() {
  const dbId = process.env.NOTION_CLIENT_DB_ID || '42802614-45ca-44b4-88b4-c4ded6f8719d';
  // Notion accepts both hyphenated and unhyphenated IDs
  return dbId;
}

/**
 * Convert a markdown-style content string to Notion blocks.
 * Supports paragraphs and simple headings.
 */
function contentToBlocks(content) {
  if (!content || typeof content !== 'string') return [];

  const blocks = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(4) } }]
        }
      });
    } else if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(3) } }]
        }
      });
    } else if (trimmed.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }]
        }
      });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }]
        }
      });
    } else {
      // Paragraph — split into 2000-char chunks (Notion's limit)
      const chunks = [];
      for (let i = 0; i < trimmed.length; i += 2000) {
        chunks.push(trimmed.slice(i, i + 2000));
      }
      for (const chunk of chunks) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: chunk } }]
          }
        });
      }
    }
  }

  return blocks;
}

/**
 * Build Notion page properties from a simple key-value object.
 * Handles known Manthan Clients DB fields.
 */
function buildProperties(title, extraProperties = {}) {
  const props = {
    'Client Name': {
      title: [{ type: 'text', text: { content: String(title).slice(0, 2000) } }]
    }
  };

  for (const [key, value] of Object.entries(extraProperties)) {
    if (value === null || value === undefined) continue;

    switch (key) {
      case 'Status':
        props[key] = { select: { name: String(value) } };
        break;
      case 'Platforms':
        props[key] = {
          multi_select: Array.isArray(value)
            ? value.map(v => ({ name: String(v) }))
            : [{ name: String(value) }]
        };
        break;
      case 'Start Date':
      case 'Contract End':
        props[key] = { date: { start: String(value) } };
        break;
      case 'Monthly Retainer':
      case 'Monthly Posts':
        props[key] = { number: Number(value) };
        break;
      case 'Airtable Record':
        props[key] = { url: String(value) };
        break;
      case 'Notes':
      case 'Primary Contact':
        props[key] = {
          rich_text: [{ type: 'text', text: { content: String(value).slice(0, 2000) } }]
        };
        break;
      default:
        // Attempt rich_text for unknown string props
        if (typeof value === 'string') {
          props[key] = {
            rich_text: [{ type: 'text', text: { content: value.slice(0, 2000) } }]
          };
        } else if (typeof value === 'number') {
          props[key] = { number: value };
        }
    }
  }

  return props;
}

/**
 * Create a new page in the Manthan Clients Notion database.
 * @param {Object} params
 * @param {string} params.title - Page title (Client Name)
 * @param {Object} [params.properties={}] - Additional Notion properties
 * @param {string} [params.content=''] - Page body content in markdown
 * @returns {Promise<{id: string, url: string}>}
 */
async function createPage({ title, properties = {}, content = '' }) {
  if (!title || typeof title !== 'string' || title.trim() === '') {
    throw new Error('[notion] title is required to create a page');
  }

  const client = getClient();
  const dbId = getDbId();

  const pageProperties = buildProperties(title.trim(), properties);
  const children = contentToBlocks(content);

  const body = {
    parent: { database_id: dbId },
    properties: pageProperties
  };

  if (children.length > 0) {
    // Notion allows max 100 blocks per request
    body.children = children.slice(0, 100);
  }

  try {
    const response = await client.post('/pages', body);

    return {
      id: response.data.id,
      url: response.data.url
    };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.message || error.response.statusText;
      throw new Error(`[notion] createPage error ${status}: ${detail}`);
    }
    throw new Error(`[notion] createPage network error: ${error.message}`);
  }
}

/**
 * Update properties on an existing Notion page.
 * @param {Object} params
 * @param {string} params.pageId - Notion page ID
 * @param {Object} params.properties - Properties to update
 * @returns {Promise<{id: string}>}
 */
async function updatePage({ pageId, properties }) {
  if (!pageId) throw new Error('[notion] pageId is required');
  if (!properties || typeof properties !== 'object') throw new Error('[notion] properties object is required');

  const client = getClient();

  // Build properly typed Notion properties
  const notionProps = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === null || value === undefined) continue;

    switch (key) {
      case 'Client Name':
        notionProps[key] = {
          title: [{ type: 'text', text: { content: String(value).slice(0, 2000) } }]
        };
        break;
      case 'Status':
        notionProps[key] = { select: { name: String(value) } };
        break;
      case 'Platforms':
        notionProps[key] = {
          multi_select: Array.isArray(value)
            ? value.map(v => ({ name: String(v) }))
            : [{ name: String(value) }]
        };
        break;
      case 'Start Date':
      case 'Contract End':
        notionProps[key] = { date: { start: String(value) } };
        break;
      case 'Monthly Retainer':
      case 'Monthly Posts':
        notionProps[key] = { number: Number(value) };
        break;
      case 'Airtable Record':
        notionProps[key] = { url: String(value) };
        break;
      case 'Notes':
      case 'Primary Contact':
        notionProps[key] = {
          rich_text: [{ type: 'text', text: { content: String(value).slice(0, 2000) } }]
        };
        break;
      default:
        if (typeof value === 'string') {
          notionProps[key] = {
            rich_text: [{ type: 'text', text: { content: value.slice(0, 2000) } }]
          };
        } else if (typeof value === 'number') {
          notionProps[key] = { number: value };
        }
    }
  }

  try {
    const response = await client.patch(`/pages/${pageId}`, {
      properties: notionProps
    });

    return { id: response.data.id };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.message || error.response.statusText;
      throw new Error(`[notion] updatePage error ${status}: ${detail}`);
    }
    throw new Error(`[notion] updatePage network error: ${error.message}`);
  }
}

/**
 * Search Notion pages and databases.
 * @param {Object} params
 * @param {string} params.query - Search query
 * @returns {Promise<Array<{id: string, title: string, url: string}>>}
 */
async function search({ query }) {
  if (!query || typeof query !== 'string') {
    throw new Error('[notion] query is required for search');
  }

  const client = getClient();

  try {
    const response = await client.post('/search', {
      query: query.trim(),
      page_size: 20,
      filter: { value: 'page', property: 'object' }
    });

    const results = response.data?.results || [];

    return results.map(item => {
      let title = 'Untitled';
      const titleProp = item.properties?.['Client Name'] || item.properties?.title;
      if (titleProp?.title?.[0]?.text?.content) {
        title = titleProp.title[0].text.content;
      } else if (titleProp?.title?.[0]?.plain_text) {
        title = titleProp.title[0].plain_text;
      } else if (item.title?.[0]?.text?.content) {
        title = item.title[0].text.content;
      }

      return {
        id: item.id,
        title,
        url: item.url,
        type: item.object,
        lastEdited: item.last_edited_time
      };
    });
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.message || error.response.statusText;
      throw new Error(`[notion] search error ${status}: ${detail}`);
    }
    throw new Error(`[notion] search network error: ${error.message}`);
  }
}

module.exports = { createPage, updatePage, search };
