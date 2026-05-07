// REST API Routes for Connector Management

import { Router, Request, Response, NextFunction } from 'express';
import ConnectorManager from '../services/connectors/ConnectorManager';
import { CONNECTOR_TEMPLATES, getTemplate, getTemplatesByCategory, getAllProviders } from '../services/connectors/templates';
import { ConnectorConfig, ConnectorTestResult } from '../services/connectors/types';

const router = Router();
const manager = new ConnectorManager();

// Middleware for error handling
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ============================================================
// CONNECTOR MANAGEMENT ENDPOINTS
// ============================================================

/**
 * GET /api/v1/connectors
 * List all connectors with optional filtering
 */
router.get('/connectors', asyncHandler(async (req: Request, res: Response) => {
  const { provider, status, category, search, skip, take } = req.query;

  const connectors = await manager.listConnectors({
    provider: provider as string,
    status: status as any,
    category: category as string,
    search: search as string,
    skip: skip ? parseInt(skip as string) : undefined,
    take: take ? parseInt(take as string) : undefined
  });

  res.json({
    success: true,
    data: connectors,
    timestamp: new Date()
  });
}));

/**
 * GET /api/v1/connectors/:id
 * Get specific connector details
 */
router.get('/connectors/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  
  const connector = await manager.getConnectorDetails(id);

  res.json({
    success: true,
    data: connector,
    timestamp: new Date()
  });
}));

/**
 * POST /api/v1/connectors
 * Create new connector
 */
router.post('/connectors', asyncHandler(async (req: Request, res: Response) => {
  const { name, provider, type, credentials, scopes, baseUrl, headers } = req.body;

  // Validate required fields
  if (!name || !provider || !type || !credentials) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: name, provider, type, credentials'
    });
  }

  // Generate unique ID
  const connectorId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const config: ConnectorConfig = {
    id: connectorId,
    name,
    provider,
    type: type as any,
    credentials,
    scopes,
    baseUrl,
    headers,
    status: 'active',
    lastVerified: new Date(),
    userId: (req as any).userId || 'anonymous',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const connector = await manager.addConnector(config);

  res.status(201).json({
    success: true,
    data: connector,
    message: 'Connector created successfully',
    timestamp: new Date()
  });
}));

/**
 * PUT /api/v1/connectors/:id
 * Update existing connector
 */
router.put('/connectors/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body;

  const connector = await manager.updateConnector(id, updates);

  res.json({
    success: true,
    data: connector,
    message: 'Connector updated successfully',
    timestamp: new Date()
  });
}));

/**
 * DELETE /api/v1/connectors/:id
 * Delete connector
 */
router.delete('/connectors/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  await manager.deleteConnector(id);

  res.json({
    success: true,
    message: 'Connector deleted successfully',
    timestamp: new Date()
  });
}));

// ============================================================
// CONNECTOR OPERATIONS
// ============================================================

/**
 * POST /api/v1/connectors/:id/test
 * Test connector connection
 */
router.post('/connectors/:id/test', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result: ConnectorTestResult = await manager.testConnection(id);

  res.json({
    success: result.status === 'connected',
    data: result,
    timestamp: new Date()
  });
}));

/**
 * POST /api/v1/connectors/:id/refresh-token
 * Refresh OAuth token
 */
router.post('/connectors/:id/refresh-token', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const token = await manager.refreshOAuthToken(id);

  res.json({
    success: true,
    data: token,
    message: 'Token refreshed successfully',
    timestamp: new Date()
  });
}));

/**
 * POST /api/v1/connectors/:id/execute
 * Execute connector action
 */
router.post('/connectors/:id/execute', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { action, params } = req.body;

  if (!action) {
    return res.status(400).json({
      success: false,
      error: 'Action name is required'
    });
  }

  const result = await manager.executeAction(id, action, params || {});

  res.json({
    success: true,
    data: result,
    timestamp: new Date()
  });
}));

// ============================================================
// CONNECTOR TEMPLATES
// ============================================================

/**
 * GET /api/v1/connectors/templates
 * Get all connector templates
 */
router.get('/connectors/templates', asyncHandler(async (req: Request, res: Response) => {
  const templates = Object.values(CONNECTOR_TEMPLATES).map(template => ({
    id: template.id,
    provider: template.provider,
    displayName: template.displayName,
    description: template.description,
    icon: template.icon,
    category: template.category,
    authType: template.authType,
    color: template.color,
    documentation: template.documentation,
    setupGuide: template.setupGuide
  }));

  res.json({
    success: true,
    data: templates,
    total: templates.length,
    timestamp: new Date()
  });
}));

/**
 * GET /api/v1/connectors/templates/:provider
 * Get specific connector template
 */
router.get('/connectors/templates/:provider', asyncHandler(async (req: Request, res: Response) => {
  const { provider } = req.params;

  const template = getTemplate(provider);

  if (!template) {
    return res.status(404).json({
      success: false,
      error: `Template for provider "${provider}" not found`
    });
  }

  res.json({
    success: true,
    data: template,
    timestamp: new Date()
  });
}));

/**
 * GET /api/v1/connectors/templates/categories
 * Get connector templates grouped by category
 */
router.get('/connectors/templates/categories', asyncHandler(async (req: Request, res: Response) => {
  const categories: Record<string, any[]> = {};

  Object.values(CONNECTOR_TEMPLATES).forEach(template => {
    if (!categories[template.category]) {
      categories[template.category] = [];
    }
    categories[template.category].push({
      id: template.id,
      provider: template.provider,
      displayName: template.displayName,
      icon: template.icon,
      color: template.color
    });
  });

  res.json({
    success: true,
    data: categories,
    timestamp: new Date()
  });
}));

/**
 * GET /api/v1/connectors/providers
 * Get all available providers
 */
router.get('/connectors/providers', asyncHandler(async (req: Request, res: Response) => {
  const providers = getAllProviders();

  res.json({
    success: true,
    data: providers,
    total: providers.length,
    timestamp: new Date()
  });
}));

// ============================================================
// ERROR HANDLING
// ============================================================

router.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    error: message,
    details: process.env.NODE_ENV === 'development' ? err : undefined,
    timestamp: new Date()
  });
});

export default router;
