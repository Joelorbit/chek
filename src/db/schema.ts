import {
  mysqlTable,
  varchar,
  text,
  int,
  timestamp,
  boolean,
  decimal,
  mysqlEnum,
  json,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import crypto from 'crypto';

// ─── USERS & NEXTAUTH ─────────────────────────────────────────────────────────

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }).unique(),
  emailVerified: timestamp('email_verified'),
  image: text('image'),
  role: mysqlEnum('role', ['USER', 'ADMIN', 'SUPERADMIN']).default('USER').notNull(),
  currentWorkspaceId: varchar('current_workspace_id', { length: 36 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const accounts = mysqlTable('accounts', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'cascade' }).notNull(),
  type: varchar('type', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 255 }).notNull(),
  providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
  refreshToken: text('refresh_token'),
  accessToken: text('access_token'),
  expiresAt: int('expires_at'),
  tokenType: varchar('token_type', { length: 255 }),
  scope: varchar('scope', { length: 255 }),
  idToken: text('id_token'),
  sessionState: varchar('session_state', { length: 255 }),
  refreshTokenExpiresIn: int('refresh_token_expires_in'),
}, (t) => ({
  providerUnique: uniqueIndex('provider_unique').on(t.provider, t.providerAccountId),
}));

export const sessions = mysqlTable('sessions', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionToken: varchar('session_token', { length: 255 }).unique().notNull(),
  userId: varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'cascade' }).notNull(),
  expires: timestamp('expires').notNull(),
});

// ─── WORKSPACES ───────────────────────────────────────────────────────────────

export const workspaces = mysqlTable('workspaces', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: varchar('name', { length: 255 }).notNull(),
  tier: mysqlEnum('tier', ['FREE', 'PRO', 'BUSINESS']).default('FREE').notNull(),
  verificationCredits: int('verification_credits').default(0).notNull(),
  verificationCreditsMonthly: int('verification_credits_monthly').default(0).notNull(),
  verificationCreditsResetAt: timestamp('verification_credits_reset_at'),
  paidUntil: timestamp('paid_until'),
  planTermMonths: int('plan_term_months'),
  imageCredits: int('image_credits').default(0).notNull(),
  imageCreditsMonthly: int('image_credits_monthly').default(0).notNull(),
  imageCreditsResetAt: timestamp('image_credits_reset_at'),
  grandfathered: boolean('grandfathered').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const memberships = mysqlTable('memberships', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'cascade' }).notNull(),
  workspaceId: varchar('workspace_id', { length: 36 }).references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  role: mysqlEnum('role', ['OWNER', 'ADMIN', 'MEMBER']).default('MEMBER').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userWorkspaceUnique: uniqueIndex('user_workspace_unique').on(t.userId, t.workspaceId),
  workspaceIdx: index('workspace_idx').on(t.workspaceId),
}));

// ─── API KEYS ─────────────────────────────────────────────────────────────────

export const apiKeys = mysqlTable('api_keys', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: varchar('key', { length: 255 }), // Legacy plain-text
  keyHash: varchar('key_hash', { length: 64 }), // SHA-256
  prefix: varchar('prefix', { length: 32 }),
  workspaceId: varchar('workspace_id', { length: 36 }).references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  permissions: json('permissions').$type<string[]>().notNull(),
  usageCount: int('usage_count').default(0).notNull(),
  lastUsed: timestamp('last_used'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  keyHashIdx: index('key_hash_idx').on(t.keyHash),
  workspaceIdx: index('workspace_idx').on(t.workspaceId),
}));

// ─── WEBHOOKS & DELIVERIES ───────────────────────────────────────────────────

export const webhooks = mysqlTable('webhooks', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: varchar('workspace_id', { length: 36 }).references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  url: text('url').notNull(),
  signingSecret: varchar('signing_secret', { length: 255 }).notNull(),
  events: json('events').$type<string[]>().notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  lastTriggeredAt: timestamp('last_triggered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const webhookDeliveries = mysqlTable('webhook_deliveries', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  webhookId: varchar('webhook_id', { length: 36 }).references(() => webhooks.id, { onDelete: 'cascade' }).notNull(),
  event: varchar('event', { length: 100 }).notNull(),
  payload: json('payload').notNull(),
  status: mysqlEnum('status', ['PENDING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER']).default('PENDING').notNull(),
  responseStatus: int('response_status'),
  responseBody: text('response_body'),
  error: text('error'),
  attemptCount: int('attempt_count').default(0).notNull(),
  nextRetryAt: timestamp('next_retry_at'),
  deliveredAt: timestamp('delivered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── E-COMMERCE & CHECKOUT ───────────────────────────────────────────────────

export const payoutAccounts = mysqlTable('payout_accounts', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: varchar('workspace_id', { length: 36 }).references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  label: varchar('label', { length: 255 }).notNull(),
  type: mysqlEnum('type', ['PHONE', 'BANK_ACCOUNT']).notNull(),
  account: varchar('account', { length: 255 }).notNull(),
  providersAllowed: json('providers_allowed').$type<string[]>().notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const products = mysqlTable('products', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: varchar('workspace_id', { length: 36 }).references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  acceptedProviders: json('accepted_providers').$type<string[]>().notNull(),
  payoutAccountId: varchar('payout_account_id', { length: 36 }),
  deliveryUrl: text('delivery_url'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const paymentLinks = mysqlTable('payment_links', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: varchar('workspace_id', { length: 36 }).references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  mode: mysqlEnum('mode', ['PRODUCT', 'CUSTOM']).notNull(),
  productId: varchar('product_id', { length: 36 }),
  fixedAmount: decimal('fixed_amount', { precision: 10, scale: 2 }),
  payoutAccountId: varchar('payout_account_id', { length: 36 }),
  acceptedProviders: json('accepted_providers').$type<string[]>().notNull(),
  redirectUrl: text('redirect_url'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const orders = mysqlTable('orders', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: varchar('workspace_id', { length: 36 }).references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  paymentLinkId: varchar('payment_link_id', { length: 36 }),
  productId: varchar('product_id', { length: 36 }),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  provider: varchar('provider', { length: 50 }),
  customerPhone: varchar('customer_phone', { length: 50 }),
  customerEmail: varchar('customer_email', { length: 255 }),
  transactionReference: varchar('transaction_reference', { length: 100 }),
  status: mysqlEnum('status', ['PENDING', 'PAID', 'EXPIRED', 'FAILED']).default('PENDING').notNull(),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── LOGS & MISC ─────────────────────────────────────────────────────────────

export const usageLogs = mysqlTable('usage_logs', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: varchar('workspace_id', { length: 36 }).notNull(),
  apiKeyId: varchar('api_key_id', { length: 36 }),
  endpoint: varchar('endpoint', { length: 255 }).notNull(),
  statusCode: int('status_code').notNull(),
  durationMs: int('duration_ms').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notificationChannels = mysqlTable('notification_channels', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: varchar('workspace_id', { length: 36 }).references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  type: mysqlEnum('type', ['TELEGRAM', 'EMAIL']).notNull(),
  target: varchar('target', { length: 255 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── RELATIONS ───────────────────────────────────────────────────────────────

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  memberships: many(memberships),
  apiKeys: many(apiKeys),
  webhooks: many(webhooks),
  notificationChannels: many(notificationChannels),
  payoutAccounts: many(payoutAccounts),
  products: many(products),
  paymentLinks: many(paymentLinks),
  orders: many(orders),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  accounts: many(accounts),
  sessions: many(sessions),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  workspace: one(workspaces, { fields: [memberships.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  workspace: one(workspaces, { fields: [apiKeys.workspaceId], references: [workspaces.id] }),
}));

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [webhooks.workspaceId], references: [workspaces.id] }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, { fields: [webhookDeliveries.webhookId], references: [webhooks.id] }),
}));
