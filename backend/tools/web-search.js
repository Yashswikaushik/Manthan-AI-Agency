'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
const https = require('https');
const axios = require('axios').create({ httpsAgent: new https.Agent({ family: 4 }) });

const BASE_URL = 'https://api.search.brave.com/res/v1/web/search';

/**
 * Search the web using Brave Search API.
 * @param {Object} params
 * @param {string} params.query - Search query string
 * @param {number} [params.count=5] - Number of results to return (max 10)
 * @returns {Promise<Array<{title: string, url: string, description: string}>>}
 */
async function search({ query, count = 5 }) {
  if (!query || typeof query !== 'string' || query.trim() === '') {
    throw new Error('[web-search] query is required and must be a non-empty string');
  }

  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error('[web-search] BRAVE_SEARCH_API_KEY environment variable is not set');
  }

  const safeCount = Math.min(Math.max(1, Math.floor(count)), 10);

  try {
    const response = await axios.get(BASE_URL, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      },
      params: {
        q: query.trim(),
        count: safeCount,
        search_lang: 'en',
        safesearch: 'moderate'
      },
      timeout: 15000
    });

    const webResults = response.data?.web?.results || [];

    const results = webResults.slice(0, safeCount).map(result => ({
      title: result.title || '',
      url: result.url || '',
      description: result.description || result.extra_snippets?.[0] || ''
    }));

    return results;
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.message || error.response.statusText;
      throw new Error(`[web-search] Brave API error ${status}: ${detail}`);
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new Error('[web-search] Request timed out after 15 seconds');
    }
    throw new Error(`[web-search] Network error: ${error.message}`);
  }
}

module.exports = { search };
