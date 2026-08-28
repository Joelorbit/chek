import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { db } from '../db';
import { usageLogs } from '../db/schema';
import { sql } from 'drizzle-orm';
import { getWorkspaceContext } from '../utils/workspaceContext';
import { getRequestIp } from '../utils/requestIp';

const statsCache = {
  totalRequests: 0,
  endpointStats: new Map<string, {
    count: number,
    successCount: number,
    failureCount: number,
    avgResponseTime: number
  }>(),
  ipStats: new Map<string, number>()
};

export const initializeStatsCache = async () => {
  try {
    const totalCountRes = await db.select({ count: sql<number>`count(*)` }).from(usageLogs);
    statsCache.totalRequests = Number(totalCountRes[0]?.count || 0);

    const [endpointStats] = await db.execute(sql`
      SELECT 
        endpoint,
        COUNT(*) as count,
        SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) as successCount,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failureCount,
        AVG(duration_ms) as avgResponseTime
      FROM usage_logs
      GROUP BY endpoint
    `) as any;

    if (Array.isArray(endpointStats)) {
      endpointStats.forEach((stat: any) => {
        statsCache.endpointStats.set(stat.endpoint, {
          count: Number(stat.count || 0),
          successCount: Number(stat.successCount || 0),
          failureCount: Number(stat.failureCount || 0),
          avgResponseTime: Number(stat.avgResponseTime || 0)
        });
      });
    }

    logger.info('Stats cache initialized from database via Drizzle');
  } catch (error) {
    logger.warn('Stats cache initialization skipped or failed:', error);
  }
};

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(2, 15);
  const requestIp = getRequestIp(req);

  logger.info(`[${requestId}] Incoming ${req.method} request to ${req.originalUrl}`, {
    method: req.method,
    url: req.originalUrl,
    ip: requestIp,
    userAgent: req.get('user-agent'),
    body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
    query: Object.keys(req.query).length ? req.query : undefined,
    apiKeyWorkspaceId: (req as any).apiKeyData ? ((req as any).apiKeyData.workspaceId ?? (req as any).apiKeyData.workspace?.id ?? 'unknown') : 'none'
  });

  statsCache.totalRequests++;

  const endpoint = `${req.method} ${req.originalUrl.split('?')[0]}`;
  if (!statsCache.endpointStats.has(endpoint)) {
    statsCache.endpointStats.set(endpoint, {
      count: 0,
      successCount: 0,
      failureCount: 0,
      avgResponseTime: 0
    });
  }
  const endpointStat = statsCache.endpointStats.get(endpoint)!;
  endpointStat.count++;

  const ipCount = statsCache.ipStats.get(requestIp) || 0;
  statsCache.ipStats.set(requestIp, ipCount + 1);

  res.on('finish', async () => {
    const responseTime = Date.now() - start;

    if (res.statusCode < 400) {
      endpointStat.successCount++;
    } else {
      endpointStat.failureCount++;
    }

    endpointStat.avgResponseTime =
      (endpointStat.avgResponseTime * (endpointStat.count - 1) + responseTime) / endpointStat.count;

    const context = getWorkspaceContext(req);
    const source = context?.source ?? ((req as any).publicVerify ? 'public' : 'unknown');
    const workspaceId = context?.workspace.id || 'none';
    
    const keyDetails = (req as any).apiKeyData;
    const safeKeyLog = keyDetails ? (keyDetails.prefix || (keyDetails.key ? keyDetails.key.substring(0, 8) : 'unknown')) : 'none';

    logger.info(`[${requestId}] Response sent in ${responseTime}ms with status ${res.statusCode}`, {
      statusCode: res.statusCode,
      responseTime,
      contentLength: res.get('Content-Length') || 'unknown',
      apiKey: safeKeyLog,
      source,
      workspaceId
    });

    if (res.statusCode >= 400) {
      logger.warn(`[${requestId}] Error occurred with status ${res.statusCode}`);
    }

    try {
      if (context?.source === 'api_key' && (req as any).apiKeyData) {
        await db.insert(usageLogs).values({
          workspaceId: (req as any).apiKeyData.workspaceId,
          apiKeyId: (req as any).apiKeyData.id,
          endpoint,
          statusCode: res.statusCode,
          durationMs: responseTime,
        });
      }
    } catch (error) {
      logger.error('Error logging API usage:', error);
    }
  });

  next();
};

export const getUsageStats = async () => {
  try {
    const totalCountRes = await db.select({ count: sql<number>`count(*)` }).from(usageLogs);
    const totalLogs = Number(totalCountRes[0]?.count || 0);

    const [endpointStats] = await db.execute(sql`
      SELECT 
        endpoint,
        COUNT(*) as count,
        SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) as successCount,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failureCount,
        AVG(duration_ms) as avgResponseTime
      FROM usage_logs
      GROUP BY endpoint
    `) as any;

    const formattedEndpointStats: Record<string, any> = {};
    if (Array.isArray(endpointStats)) {
      endpointStats.forEach((stat: any) => {
        formattedEndpointStats[stat.endpoint] = {
          count: Number(stat.count || 0),
          successCount: Number(stat.successCount || 0),
          failureCount: Number(stat.failureCount || 0),
          avgResponseTime: Number(stat.avgResponseTime || 0)
        };
      });
    }

    return {
      totalRequests: totalLogs,
      endpointStats: formattedEndpointStats,
      ipStats: {}
    };
  } catch (error) {
    logger.error('Error fetching usage stats from database:', error);

    const endpointStatsObj: Record<string, any> = {};
    statsCache.endpointStats.forEach((value, key) => {
      endpointStatsObj[key] = value;
    });

    const ipStatsObj: Record<string, number> = {};
    statsCache.ipStats.forEach((value, key) => {
      ipStatsObj[key] = value;
    });

    return {
      totalRequests: statsCache.totalRequests,
      endpointStats: endpointStatsObj,
      ipStats: ipStatsObj
    };
  }
};
