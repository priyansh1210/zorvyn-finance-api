import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerDocument from './config/swagger';
import { AppError } from './utils/errors';
import { rateLimiter } from './middleware/rateLimiter';

import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
import recordsRoutes from './modules/records/records.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';

const app = express();

// Security & parsing
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(morgan('short'));
app.use(rateLimiter(200, 60_000));

// Swagger — serve spec as JSON
app.get('/api/docs/swagger.json', (_req, res) => {
  res.json(swaggerDocument);
});

// Swagger UI — serve via CDN HTML (CSP relaxed for this route only)
app.get('/api/docs', (_req, res) => {
  res.removeHeader('Content-Security-Policy');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Zorvyn Finance API — Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; } .swagger-ui .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs/swagger.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`);
});

// Root route
app.get('/', (_req, res) => {
  res.json({
    name: 'Zorvyn Finance API',
    version: '1.0.0',
    status: 'running',
    documentation: 'https://github.com/priyansh1210/zorvyn-finance-api#api-reference',
    swagger: '/api/docs',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      records: '/api/records',
      users: '/api/users',
      dashboard: '/api/dashboard',
    },
  });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/dashboard', dashboardRoutes);

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// Global error handler — must have exactly 4 parameters for Express to recognize it
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    const zodErr = err as any;
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: zodErr.issues?.map((i: any) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
    });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
});

export default app;
