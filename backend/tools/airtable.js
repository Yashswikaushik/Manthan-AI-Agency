'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
const https = require('https');
const axios = require('axios').create({ httpsAgent: new https.Agent({ family: 4 }) });

const AIRTABLE_BASE_URL = 'https://api.airtable.com/v0';
const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appE95FlXiPgMU1nT';

function getAuthHeaders() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    throw new Error('[airtable] AIRTABLE_API_KEY environment variable is not set');
  }
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

function tableUrl(tableName) {
  return `${AIRTABLE_BASE_URL}/${BASE_ID}/${encodeURIComponent(tableName)}`;
}

/**
 * Read records from an Airtable table.
 * @param {Object} params
 * @param {string} params.table - Table name
 * @param {string} [params.filterFormula] - Airtable filter formula
 * @param {number} [params.maxRecords=20] - Max records to return
 * @param {string[]} [params.fields] - Specific fields to return
 * @returns {Promise<Array<{id: string, fields: Object}>>}
 */
async function read({ table, filterFormula, maxRecords = 20, fields }) {
  if (!table) throw new Error('[airtable] table name is required');

  const params = {
    maxRecords: Math.min(Math.max(1, Math.floor(maxRecords)), 100)
  };

  if (filterFormula && typeof filterFormula === 'string') {
    params.filterByFormula = filterFormula;
  }

  if (Array.isArray(fields) && fields.length > 0) {
    // Airtable expects repeated fields[] params
    params['fields[]'] = fields;
  }

  try {
    const allRecords = [];
    let offset;

    do {
      const queryParams = { ...params };
      if (offset) queryParams.offset = offset;

      const response = await axios.get(tableUrl(table), {
        headers: getAuthHeaders(),
        params: queryParams,
        timeout: 20000
      });

      const records = response.data?.records || [];
      allRecords.push(...records.map(r => ({ id: r.id, fields: r.fields })));
      offset = response.data?.offset;

      // Stop if we've reached maxRecords
      if (allRecords.length >= params.maxRecords) break;

    } while (offset);

    return allRecords.slice(0, params.maxRecords);
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.error?.message || error.response.statusText;
      throw new Error(`[airtable] read error ${status} on table "${table}": ${detail}`);
    }
    throw new Error(`[airtable] read network error: ${error.message}`);
  }
}

/**
 * Create a new record in an Airtable table.
 * @param {Object} params
 * @param {string} params.table - Table name
 * @param {Object} params.fields - Record fields as key-value pairs
 * @returns {Promise<{id: string, fields: Object}>}
 */
async function create({ table, fields }) {
  if (!table) throw new Error('[airtable] table name is required');
  if (!fields || typeof fields !== 'object') throw new Error('[airtable] fields object is required');

  try {
    const response = await axios.post(
      tableUrl(table),
      { fields },
      {
        headers: getAuthHeaders(),
        timeout: 20000
      }
    );

    return {
      id: response.data.id,
      fields: response.data.fields
    };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.error?.message || error.response.statusText;
      throw new Error(`[airtable] create error ${status} on table "${table}": ${detail}`);
    }
    throw new Error(`[airtable] create network error: ${error.message}`);
  }
}

/**
 * Update an existing record in an Airtable table.
 * @param {Object} params
 * @param {string} params.table - Table name
 * @param {string} params.recordId - Airtable record ID (starts with "rec")
 * @param {Object} params.fields - Fields to update
 * @returns {Promise<{id: string, fields: Object}>}
 */
async function update({ table, recordId, fields }) {
  if (!table) throw new Error('[airtable] table name is required');
  if (!recordId) throw new Error('[airtable] recordId is required');
  if (!fields || typeof fields !== 'object') throw new Error('[airtable] fields object is required');

  try {
    const response = await axios.patch(
      `${tableUrl(table)}/${recordId}`,
      { fields },
      {
        headers: getAuthHeaders(),
        timeout: 20000
      }
    );

    return {
      id: response.data.id,
      fields: response.data.fields
    };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.error?.message || error.response.statusText;
      throw new Error(`[airtable] update error ${status} on record "${recordId}": ${detail}`);
    }
    throw new Error(`[airtable] update network error: ${error.message}`);
  }
}

/**
 * Delete a record from an Airtable table.
 * @param {Object} params
 * @param {string} params.table - Table name
 * @param {string} params.recordId - Airtable record ID
 * @returns {Promise<{deleted: boolean}>}
 */
async function remove({ table, recordId }) {
  if (!table) throw new Error('[airtable] table name is required');
  if (!recordId) throw new Error('[airtable] recordId is required');

  try {
    await axios.delete(
      `${tableUrl(table)}/${recordId}`,
      {
        headers: getAuthHeaders(),
        timeout: 20000
      }
    );

    return { deleted: true };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.error?.message || error.response.statusText;
      throw new Error(`[airtable] delete error ${status} on record "${recordId}": ${detail}`);
    }
    throw new Error(`[airtable] delete network error: ${error.message}`);
  }
}

module.exports = { read, create, update, remove };
