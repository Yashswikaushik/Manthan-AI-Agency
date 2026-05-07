'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
const https = require('https');
const axios = require('axios').create({ httpsAgent: new https.Agent({ family: 4 }) });

const WHATSAPP_API_VERSION = 'v18.0';
const GRAPH_BASE = 'https://graph.facebook.com';

/**
 * Send a WhatsApp message via Meta Cloud API.
 * @param {Object} params
 * @param {string} params.message - Message text (max 4096 chars)
 * @param {string} [params.to] - Recipient phone number (E.164 format, e.g. 918875566031)
 * @returns {Promise<{messageId: string, status: string}>}
 */
async function send({ message, to }) {
  if (!message || typeof message !== 'string' || message.trim() === '') {
    throw new Error('[whatsapp] message is required and must be a non-empty string');
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('[whatsapp] WHATSAPP_ACCESS_TOKEN environment variable is not set');
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '1015871981620582';
  const recipient = to || process.env.WHATSAPP_RECIPIENT || '918875566031';

  if (!recipient) {
    throw new Error('[whatsapp] recipient phone number is required');
  }

  // Normalize recipient: strip all non-digits, ensure no leading +
  const normalizedRecipient = String(recipient).replace(/\D/g, '');
  if (normalizedRecipient.length < 10) {
    throw new Error(`[whatsapp] Invalid recipient phone number: ${recipient}`);
  }

  // Truncate message to WhatsApp's 4096-char limit
  const truncatedMessage = message.trim().slice(0, 4096);

  const url = `${GRAPH_BASE}/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;

  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedRecipient,
        type: 'text',
        text: {
          preview_url: false,
          body: truncatedMessage
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const messageId = response.data?.messages?.[0]?.id || 'unknown';
    const messageStatus = response.data?.messages?.[0]?.message_status || 'sent';

    return {
      messageId,
      status: messageStatus,
      to: normalizedRecipient,
      sentAt: new Date().toISOString()
    };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data?.error || {};
      const detail = errorData.message || errorData.error_data?.details || error.response.statusText;
      const code = errorData.code || '';
      throw new Error(`[whatsapp] API error ${status} (code ${code}): ${detail}`);
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new Error('[whatsapp] Request timed out after 15 seconds');
    }
    throw new Error(`[whatsapp] Network error: ${error.message}`);
  }
}

module.exports = { send };
