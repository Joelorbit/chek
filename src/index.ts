import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

import CBERouter from './routes/verifyCBERoute';
import telebirrRouter from './routes/verifyTelebirrRoute';
import universalRouter from './routes/verifyUniversalRoute';
import batchRouter from './routes/verifyBatch';
import adminRouter from './routes/adminRoute';
import logger from './utils/logger';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import { rateLimiter } from './middleware/rateLimiter';
import { checkDatabaseConnection } from './db';

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static assets if any
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(process.cwd(), 'public')));

// Admin Dashboard & Admin REST API (bypasses customer API key auth)
app.use('/admin', adminRouter);

// Customer API Key Authentication
app.use(apiKeyAuth as express.RequestHandler);

// Rate Limiter
app.use('/verify', rateLimiter);
app.use('/verify-batch', rateLimiter);
app.use('/verify-cbe', rateLimiter);
app.use('/verify-telebirr', rateLimiter);

// Verification Routes (Telebirr & CBE)
app.use('/verify', universalRouter);
app.use('/verify-batch', batchRouter);
app.use('/verify-cbe', CBERouter);
app.use('/verify-telebirr', telebirrRouter);

// Health Check Probes
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '3.1.0',
  });
});

app.get('/ready', async (_req: Request, res: Response) => {
  const dbConnected = await checkDatabaseConnection();
  res.status(dbConnected ? 200 : 503).json({
    ready: dbConnected,
    database: dbConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    version: '3.1.0',
  });
});

// JSON Error Handler
const jsonErrorHandler: ErrorRequestHandler = (err, _req, res, next): void => {
  if (err instanceof SyntaxError && 'body' in err) {
    logger.error('JSON parsing error:', err);
    res.status(400).json({ success: false, error: 'Invalid JSON body.' });
    return;
  }
  next(err);
};
app.use(jsonErrorHandler);

// Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error.',
  });
});

// Start Server
async function bootstrap() {
  try {
    const isConnected = await checkDatabaseConnection();
    if (isConnected) {
      logger.info('Connected to Supabase PostgreSQL database successfully via Drizzle ORM');
    } else {
      logger.warn('Database connection check failed on startup. Server running in offline fallback mode.');
    }

    const server = app.listen(PORT, () => {
      logger.info(`Chek Verification Engine running on port ${PORT}`);
      logger.info(`Admin Dashboard: http://localhost:${PORT}/admin`);
    });

    return server;
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

export default app;
