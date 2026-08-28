import { PrismaClient } from '@prisma/client';
import { db, checkDatabaseConnection, closeDatabaseConnection } from '../db';
import * as schema from '../db/schema';
import { eq, and, or, desc, asc, sql, inArray, gte, lte, gt, lt } from 'drizzle-orm';
import crypto from 'crypto';
import logger from './logger';

export { db, checkDatabaseConnection, closeDatabaseConnection };

// ── Helper to build where expressions for Drizzle ─────────────────────────────
function buildWhere(table: any, whereObj: Record<string, any> = {}) {
  const conditions: any[] = [];

  for (const [key, val] of Object.entries(whereObj)) {
    if (val === undefined) continue;

    if (key === 'OR' && Array.isArray(val)) {
      const orConds = val.map(v => buildWhere(table, v)).filter(Boolean);
      if (orConds.length > 0) conditions.push(or(...orConds));
      continue;
    }

    if (key === 'AND' && Array.isArray(val)) {
      const andConds = val.map(v => buildWhere(table, v)).filter(Boolean);
      if (andConds.length > 0) conditions.push(and(...andConds));
      continue;
    }

    const col = table[key];
    if (!col) continue;

    if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      if (val.gt !== undefined) conditions.push(gt(col, val.gt));
      if (val.gte !== undefined) conditions.push(gte(col, val.gte));
      if (val.lt !== undefined) conditions.push(lt(col, val.lt));
      if (val.lte !== undefined) conditions.push(lte(col, val.lte));
      if (val.in !== undefined && Array.isArray(val.in)) conditions.push(inArray(col, val.in));
      if (val.not !== undefined) conditions.push(sql`${col} != ${val.not}`);
    } else {
      conditions.push(eq(col, val));
    }
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

// ── Generic Model Adapter ─────────────────────────────────────────────────────
function createModelAdapter(tableName: keyof typeof schema, tableObj: any) {
  return {
    async findUnique(args: any = {}): Promise<any> {
      const whereCond = buildWhere(tableObj, args.where || {});
      const queryFn = (db.query as any)[tableName];
      if (queryFn?.findFirst) {
        return await queryFn.findFirst({
          where: whereCond,
          with: args.include,
        });
      }
      const results = await db.select().from(tableObj).where(whereCond).limit(1);
      return results[0] || null;
    },

    async findFirst(args: any = {}): Promise<any> {
      const whereCond = buildWhere(tableObj, args.where || {});
      const queryFn = (db.query as any)[tableName];
      if (queryFn?.findFirst) {
        return await queryFn.findFirst({
          where: whereCond,
          with: args.include,
        });
      }
      const query = db.select().from(tableObj);
      if (whereCond) query.where(whereCond);
      const results = await query.limit(1);
      return results[0] || null;
    },

    async findMany(args: any = {}): Promise<any[]> {
      const whereCond = buildWhere(tableObj, args.where || {});
      const queryFn = (db.query as any)[tableName];
      if (queryFn?.findMany) {
        return await queryFn.findMany({
          where: whereCond,
          with: args.include,
          limit: args.take,
          offset: args.skip,
        });
      }
      const query = db.select().from(tableObj);
      if (whereCond) query.where(whereCond);
      if (args.take) query.limit(args.take);
      if (args.skip) query.offset(args.skip);
      return await query;
    },

    async create(args: any = {}): Promise<any> {
      const id = args.data?.id || crypto.randomUUID();
      const insertData = { ...args.data, id };
      await db.insert(tableObj).values(insertData as any);
      return await this.findUnique({ where: { id }, include: args.include });
    },

    async createMany(args: any = {}): Promise<{ count: number }> {
      const items = Array.isArray(args.data) ? args.data : [args.data];
      if (items.length === 0) return { count: 0 };
      const formatted = items.map((i: any) => ({ ...i, id: i.id || crypto.randomUUID() }));
      await db.insert(tableObj).values(formatted as any);
      return { count: items.length };
    },

    async update(args: any = {}): Promise<any> {
      const whereCond = buildWhere(tableObj, args.where || {});
      const updateData: Record<string, any> = {};

      if (args.data) {
        for (const [k, v] of Object.entries(args.data)) {
          if (v && typeof v === 'object' && 'increment' in v) {
            updateData[k] = sql`${tableObj[k]} + ${(v as any).increment}`;
          } else if (v && typeof v === 'object' && 'decrement' in v) {
            updateData[k] = sql`${tableObj[k]} - ${(v as any).decrement}`;
          } else {
            updateData[k] = v;
          }
        }
      }

      await db.update(tableObj).set(updateData).where(whereCond);
      return await this.findFirst({ where: args.where });
    },

    async updateMany(args: any = {}): Promise<{ count: number }> {
      const whereCond = buildWhere(tableObj, args.where || {});
      const updateData: Record<string, any> = {};

      if (args.data) {
        for (const [k, v] of Object.entries(args.data)) {
          if (v && typeof v === 'object' && 'increment' in v) {
            updateData[k] = sql`${tableObj[k]} + ${(v as any).increment}`;
          } else if (v && typeof v === 'object' && 'decrement' in v) {
            updateData[k] = sql`${tableObj[k]} - ${(v as any).decrement}`;
          } else {
            updateData[k] = v;
          }
        }
      }

      const res = await db.update(tableObj).set(updateData).where(whereCond);
      return { count: (res as any)[0]?.affectedRows || 1 };
    },

    async delete(args: any = {}): Promise<any> {
      const item = await this.findFirst({ where: args.where });
      const whereCond = buildWhere(tableObj, args.where || {});
      await db.delete(tableObj).where(whereCond);
      return item;
    },

    async deleteMany(args: any = {}): Promise<{ count: number }> {
      const whereCond = buildWhere(tableObj, args.where || {});
      const res = await db.delete(tableObj).where(whereCond);
      return { count: (res as any)[0]?.affectedRows || 0 };
    },

    async count(args: any = {}): Promise<number> {
      const whereCond = buildWhere(tableObj, args.where || {});
      const query = db.select({ count: sql<number>`count(*)` }).from(tableObj);
      if (whereCond) query.where(whereCond);
      const res = await query;
      return Number(res[0]?.count || 0);
    },

    async groupBy(args: any = {}): Promise<any[]> {
      return [];
    },
  };
}

// ── Unified Drizzle Database Interface ────────────────────────────────────────

export const prisma: PrismaClient = ({
  workspace: createModelAdapter('workspaces', schema.workspaces),
  apiKey: createModelAdapter('apiKeys', schema.apiKeys),
  user: createModelAdapter('users', schema.users),
  membership: createModelAdapter('memberships', schema.memberships),
  product: createModelAdapter('products', schema.products),
  order: createModelAdapter('orders', schema.orders),
  paymentLink: createModelAdapter('paymentLinks', schema.paymentLinks),
  payoutAccount: createModelAdapter('payoutAccounts', schema.payoutAccounts),
  webhook: createModelAdapter('webhooks', schema.webhooks),
  webhookDelivery: createModelAdapter('webhookDeliveries', schema.webhookDeliveries),
  notificationChannel: createModelAdapter('notificationChannels', schema.notificationChannels),
  usageLog: createModelAdapter('usageLogs', schema.usageLogs),

  async $connect() {
    return await checkDatabaseConnection();
  },

  async $disconnect() {
    return await closeDatabaseConnection();
  },

  async $queryRaw(query: any, ...params: any[]) {
    try {
      if (typeof query === 'string') {
        const [res] = await db.execute(sql.raw(query)) as any;
        return res;
      }
      const [res] = await db.execute(query) as any;
      return res;
    } catch (e) {
      return [];
    }
  },

  async $transaction(arg: any) {
    if (Array.isArray(arg)) {
      return await Promise.all(arg);
    }
    if (typeof arg === 'function') {
      return await arg(prisma);
    }
    return arg;
  },
} as unknown) as PrismaClient;

export const disconnectPrisma = async () => {
  await closeDatabaseConnection();
};