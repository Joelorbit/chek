# Chek — Senior-Grade Ethiopian Payment Verification Engine

> **Laser-focused, zero-bloat Ethiopian Payment Verification & Approval Engine.**
> Speaks Drizzle ORM directly to Supabase PostgreSQL. Instant regex SMS parsing, live bank lookups, automatic payment deduplication, webhooks, and embedded Umami real-time analytics.

---

## 1. What Chek Does (Pure & Simple)

1. **Receipt Verification**: Takes raw SMS/Telegram receipt text, reference numbers, CBE mobile app tokens, or receipt screenshots from any Ethiopian bank or mobile money provider (Telebirr, CBE, CBE Birr, Abyssinia, Dashen, Awash, Coop, M-Pesa, etc.).
2. **Instant Extraction**: Automatically extracts `amount`, `payer`, `receiver`, `reference`, `provider`, and `timestamp`.
3. **Database Audit & Anti-Fraud**: Automatically saves every verified transaction to Supabase via Drizzle ORM (`verified_transactions`).
4. **App Approval**: Returns immediate JSON approval to your app + dispatches an asynchronous webhook callback.
5. **Real-time Admin & Umami Analytics**: Embedded dashboard with Umami real-time visitor/payment analytics and verified payments feed.

---

## 2. Environment Configuration (`.env`)

Configure your `.env` file (see [.env.example](file:///.env.example)):

```env
# ─── Supabase / Postgres (Drizzle ORM) ──────────────────────────────────
# See drizzle.md for Drizzle query patterns and syntax.
DIRECT_URL=postgresql://postgres.your-project-ref:your-db-password@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
DATABASE_URL=postgresql://postgres.your-project-ref:your-db-password@aws-1-eu-west-1.pooler.supabase.com:6543/postgres

# ─── Server Configuration ──────────────────────────────────────────────────
PORT=3001
NODE_ENV=development
APP_URL=https://chek.et

# ─── Admin Secret & Umami Analytics ────────────────────────────────────────
ADMIN_SECRET=chek_admin_super_secret_key_902104

# Paste your public or password-protected Umami Share URL here:
UMAMI_SHARE_URL=https://cloud.umami.is/share/your-share-token
```

---

## 3. Database Schema Deployment

To push or sync the Drizzle schema to Supabase:

```bash
pnpm db:push
```

The database contains only 4 clean, dedicated tables:
* `api_keys` — SHA-256 hashed API keys for your apps.
* `verified_transactions` — Deduplicated transaction log with amount, reference, payer, and provider.
* `webhooks` — Registered webhook endpoint URLs with signing secrets.
* `webhook_deliveries` — Delivery audit log with HTTP statuses and retry attempts.

---

## 4. Run & Verify

### Run Test Suite (Offline)
```bash
pnpm test
```
*(42 passing unit tests across regexes, receipt parsing, and circuit breakers).*

### Start Server
```bash
pnpm dev      # Development with live-reload
# or
pnpm build && pnpm start
```

---

## 5. Integrating with Your Apps

### A. Generate an API Key
Via the Admin Dashboard at `http://localhost:3001/admin` or via API:
```bash
curl -X POST http://localhost:3001/admin/api/api-keys \
  -H "x-admin-key: $ADMIN_SECRET" \
  -H "content-type: application/json" \
  -d '{"name": "Telegram Bot"}'
```
*(Save the returned `key`: `sk_live_...`)*

### B. Verify Payment from Your App (`POST /verify`)
Send the raw SMS message received on the merchant phone:

```bash
curl -X POST http://localhost:3001/verify \
  -H "x-api-key: sk_live_your_key_here" \
  -H "content-type: application/json" \
  -d '{
    "reference": "AW12345678",
    "receiptText": "Awash Bank Amount: 500.00 ETB Receiver: Abebe Kebede Ref: AW12345678"
  }'
```

**JSON Response returned immediately to your app:**
```json
{
  "success": true,
  "verified": true,
  "provider": "AWASH",
  "reference": "AW12345678",
  "amount": 500.00,
  "payer": null,
  "receiver": "Abebe Kebede",
  "status": "COMPLETED",
  "verificationMode": "LOCAL_TEXT",
  "verifiedAt": "2026-08-29T12:00:00.000Z",
  "transactionId": "2d485b8b-b1a4-42aa-9381-0994ad56edba"
}
```
**Your app can immediately check `if (res.verified && res.amount >= orderAmount)` and approve the user!**

---

## 6. Admin Panel & Umami Analytics

Open your browser to:
```
http://localhost:3001/admin?key=YOUR_ADMIN_SECRET
```

Features included:
* **Umami Analytics Tab**: Seamlessly embeds your Umami Share URL iframe directly in the admin dashboard.
* **Verified Payments Feed**: Real-time searchable table of all verified Ethiopian transactions.
* **API Keys Manager**: Generate new keys or revoke compromised keys with a single click.
* **Webhooks Manager**: Register HTTP callback endpoints to receive automatic payment events.
