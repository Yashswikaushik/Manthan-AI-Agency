'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
const https = require('https');
const axios = require('axios').create({ httpsAgent: new https.Agent({ family: 4 }) });

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

// Token cache
let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Get a valid OAuth2 access token by exchanging the refresh token.
 * Caches the token until it's within 60 seconds of expiry.
 */
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);

  if (cachedAccessToken && tokenExpiresAt > now + 60) {
    return cachedAccessToken;
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId) throw new Error('[email-sender] GMAIL_CLIENT_ID is not set');
  if (!clientSecret) throw new Error('[email-sender] GMAIL_CLIENT_SECRET is not set');
  if (!refreshToken) throw new Error('[email-sender] GMAIL_REFRESH_TOKEN is not set');

  try {
    const response = await axios.post(TOKEN_URL, null, {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      },
      timeout: 15000
    });

    cachedAccessToken = response.data.access_token;
    tokenExpiresAt = now + (response.data.expires_in || 3600);

    return cachedAccessToken;
  } catch (error) {
    if (error.response) {
      const detail = error.response.data?.error_description || error.response.data?.error || error.response.statusText;
      throw new Error(`[email-sender] OAuth token error: ${detail}`);
    }
    throw new Error(`[email-sender] OAuth token fetch failed: ${error.message}`);
  }
}

/**
 * Encode a string to base64url format (RFC 4648 §5, no padding).
 */
function base64url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Build an RFC 2822 email message string.
 */
function buildRfc2822Email({ from, to, subject, body, htmlBody }) {
  const fromAddress = from || process.env.GMAIL_USER || 'me';
  const boundary = `boundary_${Date.now()}_manthan`;
  const hasHtml = htmlBody && typeof htmlBody === 'string' && htmlBody.trim().length > 0;

  let message;

  if (hasHtml) {
    // Multipart: both text and HTML
    message = [
      `From: ${fromAddress}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      body,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      htmlBody,
      '',
      `--${boundary}--`
    ].join('\r\n');
  } else {
    // Plain text only
    message = [
      `From: ${fromAddress}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      body
    ].join('\r\n');
  }

  return message;
}

/**
 * Send an email via Gmail API using OAuth2.
 * @param {Object} params
 * @param {string} params.to - Recipient email address
 * @param {string} params.subject - Email subject
 * @param {string} params.body - Plain text body
 * @param {string} [params.htmlBody] - HTML body (optional)
 * @returns {Promise<{messageId: string, success: boolean}>}
 */
async function send({ to, subject, body, htmlBody }) {
  if (!to || typeof to !== 'string' || to.trim() === '') {
    throw new Error('[email-sender] to (recipient email) is required');
  }
  if (!subject || typeof subject !== 'string') {
    throw new Error('[email-sender] subject is required');
  }
  if (!body || typeof body !== 'string') {
    throw new Error('[email-sender] body is required');
  }

  const gmailUser = process.env.GMAIL_USER;
  if (!gmailUser) {
    throw new Error('[email-sender] GMAIL_USER environment variable is not set');
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (authError) {
    throw new Error(`[email-sender] Authentication failed: ${authError.message}`);
  }

  const rawEmail = buildRfc2822Email({
    from: gmailUser,
    to: to.trim(),
    subject: subject.trim(),
    body: body.trim(),
    htmlBody: htmlBody ? htmlBody.trim() : null
  });

  const encodedEmail = base64url(rawEmail);

  try {
    const response = await axios.post(
      GMAIL_SEND_URL,
      { raw: encodedEmail },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    const messageId = response.data?.id || 'unknown';

    return {
      messageId,
      success: true,
      to: to.trim(),
      subject: subject.trim(),
      sentAt: new Date().toISOString()
    };
  } catch (error) {
    if (error.response?.status === 401) {
      // Token might have been invalidated — clear cache and surface error
      cachedAccessToken = null;
      tokenExpiresAt = 0;
      const detail = error.response.data?.error?.message || 'Unauthorized';
      throw new Error(`[email-sender] Gmail authorization error: ${detail}. Token has been cleared — retry.`);
    }
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.error?.message || error.response.statusText;
      throw new Error(`[email-sender] Gmail API error ${status}: ${detail}`);
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new Error('[email-sender] Request timed out after 20 seconds');
    }
    throw new Error(`[email-sender] Network error: ${error.message}`);
  }
}

module.exports = { send };
