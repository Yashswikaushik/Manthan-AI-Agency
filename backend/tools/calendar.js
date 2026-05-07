'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
const https = require('https');
const axios = require('axios').create({ httpsAgent: new https.Agent({ family: 4 }) });
const crypto = require('crypto');

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'yashsingh328@gmail.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

// Cache the access token to avoid repeated JWT minting
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Parse the service account JSON from the environment variable.
 */
function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('[calendar] GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('[calendar] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
}

/**
 * Create a base64url-encoded string (no padding).
 */
function base64url(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Mint a JWT and exchange it for an OAuth2 access token.
 */
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (with 60-second buffer)
  if (cachedToken && tokenExpiresAt > now + 60) {
    return cachedToken;
  }

  const sa = getServiceAccount();

  const header = base64url(Buffer.from(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT'
  })));

  const payload = base64url(Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
    sub: CALENDAR_ID // delegate to the calendar owner
  })));

  const signingInput = `${header}.${payload}`;

  // Sign with the private key from the service account
  const privateKey = sa.private_key;
  if (!privateKey) {
    throw new Error('[calendar] Service account JSON is missing private_key');
  }

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = base64url(sign.sign(privateKey));

  const jwt = `${signingInput}.${signature}`;

  const response = await axios.post(TOKEN_URL, null, {
    params: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    timeout: 15000
  });

  cachedToken = response.data.access_token;
  tokenExpiresAt = now + (response.data.expires_in || 3600);

  return cachedToken;
}

/**
 * Return mock calendar events for graceful degradation.
 */
function getMockEvents() {
  // Return empty — caller should show a proper "connect calendar" CTA
  return [];
}

/**
 * Read upcoming calendar events from Google Calendar.
 * @param {Object} params
 * @param {number} [params.daysAhead=7] - Number of days ahead to look
 * @param {number} [params.maxResults=10] - Maximum number of events
 * @returns {Promise<Array<{id: string, summary: string, start: string, end: string, description: string, location: string}>>}
 */
async function readEvents({ daysAhead = 7, maxResults = 10 } = {}) {
  const safeDaysAhead = Math.max(1, Math.min(365, Math.floor(daysAhead)));
  const safeMaxResults = Math.max(1, Math.min(50, Math.floor(maxResults)));

  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + safeDaysAhead * 24 * 3600 * 1000).toISOString();

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (authError) {
    console.warn('[calendar] Auth failed, returning mock data:', authError.message);
    return getMockEvents();
  }

  try {
    const response = await axios.get(
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        params: {
          timeMin,
          timeMax,
          maxResults: safeMaxResults,
          singleEvents: true,
          orderBy: 'startTime',
          timeZone: 'Asia/Kolkata'
        },
        timeout: 15000
      }
    );

    const items = response.data?.items || [];

    return items.map(event => ({
      id: event.id,
      summary: event.summary || '(No title)',
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      description: event.description || '',
      location: event.location || '',
      status: event.status || 'confirmed',
      htmlLink: event.htmlLink || ''
    }));
  } catch (error) {
    if (error.response?.status === 403 || error.response?.status === 401) {
      console.warn('[calendar] Access denied to calendar, returning mock data. Status:', error.response.status);
      return getMockEvents();
    }
    if (error.response?.status === 404) {
      console.warn('[calendar] Calendar not found:', CALENDAR_ID);
      return [];
    }
    console.warn('[calendar] API error, returning mock data:', error.message);
    return getMockEvents();
  }
}

module.exports = { readEvents };
