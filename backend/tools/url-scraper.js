'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
const https = require('https');
const axios = require('axios').create({ httpsAgent: new https.Agent({ family: 4 }) });

const BASE_URL = 'https://api.firecrawl.dev/v1/scrape';

/**
 * Scrape and extract content from a URL using Firecrawl.
 * @param {Object} params
 * @param {string} params.url - URL to scrape
 * @returns {Promise<{markdown: string, title: string, url: string}>}
 */
async function scrape({ url }) {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    throw new Error('[url-scraper] url is required and must be a non-empty string');
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error('[url-scraper] FIRECRAWL_API_KEY environment variable is not set');
  }

  // Basic URL validation
  let parsedUrl;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    throw new Error(`[url-scraper] Invalid URL format: ${url}`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`[url-scraper] URL must use http or https protocol`);
  }

  try {
    const response = await axios.post(
      BASE_URL,
      {
        url: parsedUrl.href,
        formats: ['markdown']
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const data = response.data?.data || response.data || {};

    const markdown = data.markdown || data.content || '';
    const title = data.metadata?.title || data.title || parsedUrl.hostname;
    const resolvedUrl = data.metadata?.url || data.url || parsedUrl.href;

    return {
      markdown,
      title,
      url: resolvedUrl
    };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.error || error.response.data?.message || error.response.statusText;
      throw new Error(`[url-scraper] Firecrawl API error ${status}: ${detail}`);
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new Error('[url-scraper] Request timed out after 30 seconds');
    }
    throw new Error(`[url-scraper] Network error: ${error.message}`);
  }
}

module.exports = { scrape };
