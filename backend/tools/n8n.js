'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
const https = require('https');
const axios = require('axios').create({ httpsAgent: new https.Agent({ family: 4 }) });

const BASE_URL = 'https://ykaiagency.app.n8n.cloud/api/v1';

function getClient() {
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) {
    throw new Error('[n8n] N8N_API_KEY environment variable is not set');
  }
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'X-N8N-API-KEY': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    httpsAgent: new https.Agent({ family: 4 }),
    timeout: 25000
  });
}

/**
 * List all workflows in the n8n instance.
 * @returns {Promise<Array<{id: string, name: string, active: boolean}>>}
 */
async function listWorkflows() {
  const client = getClient();
  try {
    const response = await client.get('/workflows');
    const workflows = response.data?.data || response.data || [];

    return workflows.map(wf => ({
      id: wf.id,
      name: wf.name,
      active: wf.active === true,
      createdAt: wf.createdAt,
      updatedAt: wf.updatedAt,
      tags: wf.tags || []
    }));
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.message || error.response.statusText;
      throw new Error(`[n8n] listWorkflows error ${status}: ${detail}`);
    }
    throw new Error(`[n8n] listWorkflows network error: ${error.message}`);
  }
}

/**
 * Trigger an n8n workflow via webhook or execution API.
 * n8n Cloud uses the executions endpoint to run a workflow.
 * @param {Object} params
 * @param {string} params.workflowId - n8n workflow ID
 * @param {Object} [params.data={}] - Data payload to pass to workflow
 * @returns {Promise<{executionId: string, success: boolean}>}
 */
async function triggerWorkflow({ workflowId, data = {} }) {
  if (!workflowId) throw new Error('[n8n] workflowId is required');

  const client = getClient();
  try {
    // n8n Cloud API: POST /workflows/{id}/run
    const response = await client.post(`/workflows/${workflowId}/run`, {
      runData: data,
      startNodes: [],
      destinationNode: ''
    });

    const executionId = response.data?.executionId || response.data?.id || 'unknown';

    return {
      executionId: String(executionId),
      success: true,
      workflowId,
      triggeredAt: new Date().toISOString()
    };
  } catch (error) {
    // If the run endpoint fails, try the executions approach
    if (error.response?.status === 404 || error.response?.status === 405) {
      try {
        const execResponse = await client.post('/executions', {
          workflowId,
          mode: 'manual',
          data: { ...data }
        });
        const execId = execResponse.data?.id || execResponse.data?.executionId || 'unknown';
        return {
          executionId: String(execId),
          success: true,
          workflowId,
          triggeredAt: new Date().toISOString()
        };
      } catch (innerError) {
        const status = innerError.response?.status || 'unknown';
        const detail = innerError.response?.data?.message || innerError.message;
        throw new Error(`[n8n] triggerWorkflow error ${status}: ${detail}`);
      }
    }

    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.message || error.response.statusText;
      throw new Error(`[n8n] triggerWorkflow error ${status}: ${detail}`);
    }
    throw new Error(`[n8n] triggerWorkflow network error: ${error.message}`);
  }
}

/**
 * Get recent executions for a workflow.
 * @param {Object} params
 * @param {string} params.workflowId - n8n workflow ID
 * @param {number} [params.limit=10] - Max executions to return
 * @returns {Promise<Array>}
 */
async function getExecutions({ workflowId, limit = 10 }) {
  if (!workflowId) throw new Error('[n8n] workflowId is required');

  const client = getClient();
  try {
    const response = await client.get('/executions', {
      params: {
        workflowId,
        limit: Math.min(Math.max(1, Math.floor(limit)), 50),
        includeData: false
      }
    });

    const executions = response.data?.data || response.data || [];

    return executions.map(exec => ({
      id: exec.id,
      workflowId: exec.workflowId || workflowId,
      status: exec.status || exec.finished ? 'success' : 'running',
      startedAt: exec.startedAt || exec.createdAt,
      stoppedAt: exec.stoppedAt,
      mode: exec.mode || 'unknown',
      finished: exec.finished !== false
    }));
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const detail = error.response.data?.message || error.response.statusText;
      throw new Error(`[n8n] getExecutions error ${status}: ${detail}`);
    }
    throw new Error(`[n8n] getExecutions network error: ${error.message}`);
  }
}

/**
 * Get overall health and summary of the n8n instance.
 * @returns {Promise<{status: string, workflowCount: number, activeCount: number}>}
 */
async function getHealth() {
  const client = getClient();
  try {
    const response = await client.get('/workflows');
    const workflows = response.data?.data || response.data || [];

    const workflowCount = workflows.length;
    const activeCount = workflows.filter(wf => wf.active === true).length;

    return {
      status: 'ok',
      workflowCount,
      activeCount,
      inactiveCount: workflowCount - activeCount,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      return {
        status: `error_${status}`,
        workflowCount: 0,
        activeCount: 0,
        error: error.response.data?.message || error.response.statusText,
        checkedAt: new Date().toISOString()
      };
    }
    return {
      status: 'unreachable',
      workflowCount: 0,
      activeCount: 0,
      error: error.message,
      checkedAt: new Date().toISOString()
    };
  }
}

module.exports = { listWorkflows, triggerWorkflow, getExecutions, getHealth };
