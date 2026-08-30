import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import cookieParser from 'cookie-parser';

import logger from './utils/logger';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import { rateLimiter, enforceMerchantMonthlyQuota } from './middleware/rateLimiter';
import universalRouter from './routes/verifyUniversalRoute';
import batchRouter from './routes/verifyBatch';
import CBERouter from './routes/verifyCBERoute';
import telebirrRouter from './routes/verifyTelebirrRoute';
import adminRouter from './routes/adminRoute';
import { verifyImageHandler } from './services/verifyImage';
import { checkDatabaseConnection } from './db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'chek_cookie_secret_super_90210';

// Global Security Middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(cookieParser(COOKIE_SECRET));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Assets
app.use(express.static(path.join(process.cwd(), 'public')));

// Root landing page
app.get('/', (_req: Request, res: Response) => {
  const indexPath = path.join(process.cwd(), 'public', 'index.html');
  res.sendFile(indexPath);
});

// Direct Super Admin alias
app.get('/super-admin', (_req: Request, res: Response) => {
  res.redirect('/admin/super-admin');
});

// Live Gateway Status Page
app.get('/status', (_req: Request, res: Response) => {
  const statusFile = path.join(process.cwd(), 'public', 'status.html');
  res.sendFile(statusFile);
});

// Admin Dashboard & Admin REST API (manages its own auth)
app.use('/admin', adminRouter);

// Customer Authentication & Quota Enforcement (20 checks/hr sandbox, 250 checks/mo free)
app.use(apiKeyAuth as express.RequestHandler);
app.use(enforceMerchantMonthlyQuota as express.RequestHandler);
app.use(rateLimiter as express.RequestHandler);

// Verification Route with Image OCR
app.post('/verify-image', ...(verifyImageHandler as any));

// Verification Routes (Telebirr, CBE & Universal)
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
