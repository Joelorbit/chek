import { Request, Response, NextFunction } from 'express';
import { getRequestIp } from '../utils/requestIp';

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 300; // 300 requests/min per key/IP

const store = new Map<string, { count: number; windowStart: number }>();

// Periodic garbage collection every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of store.entries()) {
    if (now - val.windowStart > WINDOW_MS * 2) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  if ((req as any).isAdmin) {
    return next();
  }

  const apiKeyId = (req as any).apiKeyData?.id;
  const clientIp = getRequestIp(req) || 'unknown';
  const rateLimitKey = apiKeyId ? `key:${apiKeyId}` : `ip:${clientIp}`;

  const now = Date.now();
  const entry = store.get(rateLimitKey);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    store.set(rateLimitKey, { count: 1, windowStart: now });
    return next();
  }

  entry.count++;
  if (entry.count > MAX_REQUESTS_PER_MINUTE) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    res.status(429).json({
      success: false,
      error: 'Too many requests. Rate limit exceeded.',
      retryAfter,
    });
    return;
  }

  next();
};
