import {
  pgTable,
  varchar,
  text,
  integer,
  timestamp,
  boolean,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import crypto from 'crypto';

// ─── 1. MERCHANTS / USERS ───────────────────────────────────────────────────

export const merchants = pgTable('merchants', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).default('Merchant').notNull(),
  businessName: varchar('business_name', { length: 255 }).default('My Business').notNull(),
  role: varchar('role', { length: 50 }).default('merchant').notNull(), // 'admin' | 'merchant'
  plan: varchar('plan', { length: 50 }).default('free').notNull(),     // 'free' | 'shop' | 'developer' | 'scale' | 'enterprise'
  planExpiresAt: timestamp('plan_expires_at'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  emailIdx: uniqueIndex('merchants_email_idx').on(t.email),
}));

// ─── 2. API KEYS ─────────────────────────────────────────────────────────────

export const apiKeys = pgTable('api_keys', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  merchantId: varchar('merchant_id', { length: 36 }).references(() => merchants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).default('Default App').notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull(), // SHA-256 hash of sk_live_...
  prefix: varchar('prefix', { length: 32 }).notNull(),   // Display prefix e.g. "sk_live_1e3a..."
  isActive: boolean('is_active').default(true).notNull(),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  keyHashIdx: uniqueIndex('api_keys_key_hash_idx').on(t.keyHash),
  merchantIdx: index('api_keys_merchant_idx').on(t.merchantId),
}));

// ─── 3. VERIFIED TRANSACTIONS ─────────────────────────────────────────────────

export const verifiedTransactions = pgTable('verified_transactions', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  merchantId: varchar('merchant_id', { length: 36 }).references(() => merchants.id, { onDelete: 'set null' }),
  apiKeyId: varchar('api_key_id', { length: 36 }).references(() => apiKeys.id, { onDelete: 'set null' }),
  reference: varchar('reference', { length: 100 }).notNull(), // Transaction Reference (e.g. AB12CD34EF, FT...)
  provider: varchar('provider', { length: 50 }).notNull(),    // TELEBIRR, CBE, ABYSSINIA, DASHEN, CBEBIRR, etc.
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(), // In ETB
  payer: varchar('payer', { length: 255 }),                   // Payer name / phone / account
  receiver: varchar('receiver', { length: 255 }),             // Receiver name / merchant account
  status: varchar('status', { length: 50 }).default('COMPLETED').notNull(),
  verificationMode: varchar('verification_mode', { length: 50 }).default('LOCAL_TEXT').notNull(), // LOCAL_TEXT, LIVE_API, IMAGE_OCR
  rawText: text('raw_text'),                                  // Original SMS / receipt text
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  verifiedAt: timestamp('verified_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  referenceIdx: index('verified_tx_reference_idx').on(t.reference),
  providerIdx: index('verified_tx_provider_idx').on(t.provider),
  createdAtIdx: index('verified_tx_created_at_idx').on(t.createdAt),
  merchantIdx: index('verified_tx_merchant_idx').on(t.merchantId),
}));

// ─── 4. SUBSCRIPTION PAYMENTS ─────────────────────────────────────────────────

export const subscriptionPayments = pgTable('subscription_payments', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  merchantId: varchar('merchant_id', { length: 36 }).references(() => merchants.id, { onDelete: 'cascade' }).notNull(),
  plan: varchar('plan', { length: 50 }).notNull(), // 'shop' | 'developer' | 'scale' | 'enterprise'
  billingCycle: varchar('billing_cycle', { length: 20 }).default('monthly').notNull(), // 'monthly' | 'annual'
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 10 }).default('ETB').notNull(),
  provider: varchar('provider', { length: 50 }).notNull(), // 'TELEBIRR', 'CBE', 'CHAPA', 'DIRECT'
  reference: varchar('reference', { length: 100 }).notNull(),
  status: varchar('status', { length: 50 }).default('COMPLETED').notNull(), // 'COMPLETED', 'PENDING', 'FAILED'
  validUntil: timestamp('valid_until'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  merchantIdx: index('sub_payments_merchant_idx').on(t.merchantId),
  referenceIdx: index('sub_payments_reference_idx').on(t.reference),
}));

// ─── 5. WEBHOOKS ─────────────────────────────────────────────────────────────

export const webhooks = pgTable('webhooks', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  merchantId: varchar('merchant_id', { length: 36 }).references(() => merchants.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),                                // Destination URL to receive webhook
  signingSecret: varchar('signing_secret', { length: 255 }).notNull(), // HMAC Secret for verification
  events: jsonb('events').$type<string[]>().default(['payment.verified']).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  merchantIdx: index('webhooks_merchant_idx').on(t.merchantId),
}));

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  webhookId: varchar('webhook_id', { length: 36 }).references(() => webhooks.id, { onDelete: 'cascade' }).notNull(),
  transactionId: varchar('transaction_id', { length: 36 }),
  event: varchar('event', { length: 100 }).notNull(),
  payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 20 }).default('QUEUED').notNull(), // QUEUED, SUCCEEDED, RETRYING, FAILED
  statusCode: integer('status_code'),
  responseBody: text('response_body'),
  attempts: integer('attempts').default(0).notNull(),
  lastError: text('last_error'),
  deliveredAt: timestamp('delivered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  webhookIdx: index('webhook_deliveries_webhook_idx').on(t.webhookId),
}));

// ─── RELATIONS ───────────────────────────────────────────────────────────────

export const merchantsRelations = relations(merchants, ({ many }) => ({
  apiKeys: many(apiKeys),
  transactions: many(verifiedTransactions),
  subscriptions: many(subscriptionPayments),
  webhooks: many(webhooks),
}));

export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  merchant: one(merchants, {
    fields: [apiKeys.merchantId],
    references: [merchants.id],
  }),
  transactions: many(verifiedTransactions),
}));

export const verifiedTransactionsRelations = relations(verifiedTransactions, ({ one }) => ({
  merchant: one(merchants, {
    fields: [verifiedTransactions.merchantId],
    references: [merchants.id],
  }),
  apiKey: one(apiKeys, {
    fields: [verifiedTransactions.apiKeyId],
    references: [apiKeys.id],
  }),
}));

export const subscriptionPaymentsRelations = relations(subscriptionPayments, ({ one }) => ({
  merchant: one(merchants, {
    fields: [subscriptionPayments.merchantId],
    references: [merchants.id],
  }),
}));

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  merchant: one(merchants, {
    fields: [webhooks.merchantId],
    references: [merchants.id],
  }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, {
    fields: [webhookDeliveries.webhookId],
    references: [webhooks.id],
  }),
}));
