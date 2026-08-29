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

// ─── 1. API KEYS ─────────────────────────────────────────────────────────────

export const apiKeys = pgTable('api_keys', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: varchar('name', { length: 255 }).default('Default App').notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull(), // SHA-256 hash of sk_live_...
  prefix: varchar('prefix', { length: 32 }).notNull(),   // Display prefix e.g. "sk_live_1e3a..."
  isActive: boolean('is_active').default(true).notNull(),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  keyHashIdx: uniqueIndex('api_keys_key_hash_idx').on(t.keyHash),
}));

// ─── 2. VERIFIED TRANSACTIONS ─────────────────────────────────────────────────

export const verifiedTransactions = pgTable('verified_transactions', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  reference: varchar('reference', { length: 100 }).notNull(), // Transaction Reference (e.g. AB12CD34EF, FT...)
  provider: varchar('provider', { length: 50 }).notNull(),    // TELEBIRR, CBE, ABYSSINIA, DASHEN, AWASH, etc.
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(), // In ETB
  payer: varchar('payer', { length: 255 }),                   // Payer name / phone / account
  receiver: varchar('receiver', { length: 255 }),             // Receiver name / merchant account
  status: varchar('status', { length: 50 }).default('COMPLETED').notNull(),
  verificationMode: varchar('verification_mode', { length: 50 }).default('LOCAL_TEXT').notNull(), // LOCAL_TEXT, LIVE_API, IMAGE_OCR
  rawText: text('raw_text'),                                  // Original SMS / receipt text
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  apiKeyId: varchar('api_key_id', { length: 36 }).references(() => apiKeys.id, { onDelete: 'set null' }),
  verifiedAt: timestamp('verified_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  referenceIdx: index('verified_tx_reference_idx').on(t.reference),
  providerIdx: index('verified_tx_provider_idx').on(t.provider),
  createdAtIdx: index('verified_tx_created_at_idx').on(t.createdAt),
}));

// ─── 3. WEBHOOKS ─────────────────────────────────────────────────────────────

export const webhooks = pgTable('webhooks', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  url: text('url').notNull(),                                // Destination URL to receive webhook
  signingSecret: varchar('signing_secret', { length: 255 }).notNull(), // HMAC Secret for verification
  events: jsonb('events').$type<string[]>().default(['verification.success']).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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

export const apiKeysRelations = relations(apiKeys, ({ many }) => ({
  transactions: many(verifiedTransactions),
}));

export const verifiedTransactionsRelations = relations(verifiedTransactions, ({ one }) => ({
  apiKey: one(apiKeys, {
    fields: [verifiedTransactions.apiKeyId],
    references: [apiKeys.id],
  }),
}));

export const webhooksRelations = relations(webhooks, ({ many }) => ({
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, {
    fields: [webhookDeliveries.webhookId],
    references: [webhooks.id],
  }),
}));

// Type exports for clean TypeScript type-safety
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type VerifiedTransaction = typeof verifiedTransactions.$inferSelect;
export type NewVerifiedTransaction = typeof verifiedTransactions.$inferInsert;
export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
