# 🧾 Chek — Under the Hood & Deep Architecture

> **An in-depth technical analysis of how the Chek verification engine reverse-engineers, fetches, parses, hedges, and verifies financial transactions across Ethiopia's banking and mobile money ecosystem.**

---

## 📑 Table of Contents

1. [Architectural Philosophy & Challenges](#1-architectural-philosophy--challenges)
2. [CBE (Commercial Bank of Ethiopia) Deep Dive](#2-cbe-commercial-bank-of-ethiopia-deep-dive)
   - [New Mobile API Fingerprinting (`mb.cbe.com.et`)](#new-mobile-api-fingerprinting)
   - [Legacy Port 100 PDF Pipeline (`apps.cbe.com.et:100`)](#legacy-port-100-pdf-pipeline)
   - [Puppeteer Headless Fallback Engine](#puppeteer-headless-fallback-engine)
3. [Ethio Telecom Telebirr Scraping & Multi-Relay Circuit Breaker](#3-ethio-telecom-telebirr-scraping--multi-relay-circuit-breaker)
   - [Geo-IP Blocking & Firewall Constraints](#geo-ip-blocking--firewall-constraints)
   - [HTML Scraper & Regex Extraction Hierarchy](#html-scraper--regex-extraction-hierarchy)
   - [Multi-Relay Hedging Pool & Adaptive Circuit Breaker](#multi-relay-hedging-pool--adaptive-circuit-breaker)
4. [Bank of Abyssinia Public Slip API](#4-bank-of-abyssinia-public-slip-api)
   - [5-Digit Suffix Protocol & Security Model](#5-digit-suffix-protocol--security-model)
   - [JSON Unmarshaling & Field Translation](#json-unmarshaling--field-translation)
5. [Dashen Bank SuperApp PDF Engine](#5-dashen-bank-superapp-pdf-engine)
   - [Direct Binary Stream Ingestion](#direct-binary-stream-ingestion)
   - [PDF Buffer Tokenizer & Regex Extractor](#pdf-buffer-tokenizer--regex-extractor)
6. [CBE Birr AU Receipt Pipeline](#6-cbe-birr-au-receipt-pipeline)
   - [Phone Normalization & TID Query Mechanism](#phone-normalization--tid-query-mechanism)
   - [Multi-Line String Buffer Parser](#multi-line-string-buffer-parser)
7. [Safaricom M-Pesa Business API](#7-safaricom-m-pesa-business-api)
   - [Base64 Encoded Binary PDF Decoding](#base64-encoded-binary-pdf-decoding)
   - [Relay Fallback Protocol](#relay-fallback-protocol)
8. [Other Banks: Awash, Coop, Hibret, Zemen, Nib, Wegagen, Amhara](#8-other-banks-multi-engine-text-parser)
   - [Word-Boundary Regex Tokenizer](#word-boundary-regex-tokenizer)
9. [Mistral AI Vision OCR Engine](#9-mistral-ai-vision-ocr-engine)
   - [Prompt Engineering & Visual Feature Extraction](#prompt-engineering--visual-feature-extraction)
   - [Atomic Token Decrement & Transactional Rollbacks](#atomic-token-decrement--transactional-rollbacks)
10. [Universal Smart Router & Token Classifier](#10-universal-smart-router--token-classifier)
    - [O(1) Token Disambiguation Algorithm](#o1-token-disambiguation-algorithm)
11. [BullMQ Distributed Queue & Webhook Delivery Engine](#11-bullmq-distributed-queue--webhook-delivery-engine)
    - [Job Lifecycle, Exponential Backoff & Dead-Letter Resolution](#job-lifecycle-exponential-backoff--dead-letter-resolution)
    - [HMAC SHA-256 Signature Verification](#hmac-sha-256-signature-verification)

---

## 1. Architectural Philosophy & Challenges

Ethiopia's digital payments landscape is fragmented. Unlike markets with standardized Open Banking APIs (like PSD2 in Europe or Unified Payments Interface in India), Ethiopian financial institutions utilize disparate systems:

1. **Proprietary Mobile Banking JSON APIs** (e.g. CBE's new MB gateway).
2. **Public Slip Endpoints with Suffix Verification** (e.g. Bank of Abyssinia).
3. **Public HTML Web Receipts with Region Restrictions** (e.g. Telebirr).
4. **Dynamic Server-Side Generated PDF Receipts** (e.g. Dashen Bank, CBE Birr).
5. **Base64-Encoded Binary Streams** (e.g. Safaricom M-Pesa).

The goal of this engine is to unify these heterogeneous protocols into an **idempotent, unified, zero-friction verification pipeline** that delivers structured JSON in sub-second response times.

---

## 2. CBE (Commercial Bank of Ethiopia) Deep Dive

Commercial Bank of Ethiopia operates two concurrent verification systems: the **New Mobile Banking API** and the **Legacy Port 100 Receipt Server**.

```text
                                    ┌──► Is New Token? (15-40 chars / mbreciept URL)
                                    │    └──► Query mb.cbe.com.et REST API (Headers spoofed)
Input (Reference / URL) ────────────┤
                                    └──► Is Legacy FT... (12 chars + 8 digit suffix)
                                         ├──► Step 1: Direct Axios HTTPS GET (Port 100)
                                         └──► Step 2 (Fallback): Puppeteer Headless Chromium
```

### New Mobile API Fingerprinting
When a customer makes a transfer via CBE Mobile, the app generates a shareable link in the format:
`https://mbreciept.cbe.com.et/<UUID_OR_HASH>`

The backend fetches the raw JSON data directly from CBE's internal public detail gateway:
`GET https://mb.cbe.com.et/api/v1/transactions/public/transaction-detail/<TOKEN>`

#### Custom Headers Required:
To prevent unauthorized scraping, CBE's gateway requires specific mobile application identifiers:
```typescript
headers: {
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://mbreciept.cbe.com.et',
  'Referer': 'https://mbreciept.cbe.com.et/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'x-app-id': process.env.CBE_APP_ID || 'd1292e42-7400-49de-a2d3-9731caa4c819',
  'x-app-version': process.env.CBE_APP_VERSION || '0a01980b-9859-1369-8198-59f403820000'
}
```

The system retries up to 4 times with an 1800ms backoff before flagging an upstream outage.

### Legacy Port 100 PDF Pipeline
Older transactions or ATM/branch transfers use the legacy URL:
`https://apps.cbe.com.et:100/?id=FT<10_DIGITS><8_DIGIT_ACCOUNT_SUFFIX>`

1. **SSL Handling**: The server at `apps.cbe.com.et:100` uses a self-signed or legacy TLS certificate. Axios is configured with an explicit custom HTTPS agent:
   ```typescript
   const httpsAgent = new https.Agent({ rejectUnauthorized: false });
   ```
2. **Binary Buffer Parsing**: The response returns a raw `application/pdf` binary buffer. It is converted to text in-memory via `pdf-parse` without ever touching disk I/O.

### Puppeteer Headless Fallback Engine
If direct HTTP requests to port 100 fail due to CBE JavaScript redirects or anti-bot challenge scripts, the engine spawns a lightweight headless Chromium process via Puppeteer:
```typescript
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors', '--disable-dev-shm-usage', '--disable-gpu']
});
```
It intercepts network responses to capture dynamic `.pdf` download URLs, downloads the asset, and passes it to the parser.

---

## 3. Ethio Telecom Telebirr Scraping & Multi-Relay Circuit Breaker

### Geo-IP Blocking & Firewall Constraints
Ethio Telecom hosts Telebirr receipt confirmation pages at:
`https://transactioninfo.ethiotelecom.et/receipt/<10_CHAR_REFERENCE>`

> **The Problem**: Ethio Telecom's edge firewall frequently blocks or drops TCP packets originating from foreign data centers (AWS, GCP, DigitalOcean, Hetzner), resulting in `ETIMEDOUT` or `ECONNRESET`.

### Multi-Relay Hedging Pool & Adaptive Circuit Breaker
To overcome regional firewalls, the engine implements a **Distributed Relay Pool with Circuit Breaking & Hedging**:

```text
                         ┌────────────────────────────────────────────────┐
                         │              Telebirr Verification             │
                         └───────────────────────┬────────────────────────┘
                                                 │
                             ┌───────────────────┴───────────────────┐
                             │ SKIP_PRIMARY_VERIFICATION == false?   │
                             └───────────────────┬───────────────────┘
                                     YES         │          NO
                                     ▼           │          ▼
                      ┌──────────────────────┐   │   ┌───────────────────────────────┐
                      │ Primary Direct Fetch │   │   │ Preferred Ethiopia Proxy      │
                      │ (Ethio Telecom)      │   │   │ (leul.et / custom relay)      │
                      └──────────┬───────────┘   │   └───────────────┬───────────────┘
                                 │ Failed        │                   │ Timeout / 503
                                 ▼               │                   ▼
                      ┌──────────────────────────┴───┐       ┌───────────────────────┐
                      │ Fallback Relays Pool         │◄──────│ Open Circuit & Switch │
                      │ (Community Proxy 1, 2, 3...) │       │ to Winning Node       │
                      └──────────────────────────────┘       └───────────────────────┘
```

#### Circuit Breaker Logic (`src/services/verifyTelebirr.ts`):
1. **Consecutive Failure Threshold**: If a proxy relay fails 3 consecutive times with 5xx/transport errors, its circuit is marked `OPEN` for 30 seconds.
2. **Hedging Strategy**: If the preferred proxy does not respond within 400ms, the engine asynchronously races fallback relays in parallel and adopts the fastest responder.
3. **Half-Open Recovery**: When all circuits are open, a single probe is permitted through to check if the node has recovered.
4. **404 vs 5xx Distinction**: A missing receipt (404 / "No transaction found") does **not** trip the circuit breaker, preserving relay health status.

---

## 4. Bank of Abyssinia Public Slip API

Bank of Abyssinia exposes a high-speed JSON slip verification endpoint:
`GET https://cs.bankofabyssinia.com/api/onlineSlip/getDetails/?id=FT<10_DIGITS><5_DIGIT_SUFFIX>`

### 5-Digit Suffix Protocol & Security Model
To prevent enumeration attacks against references (`FT...`), the BoA API requires appending the last 5 digits of the source/payer account number.

```text
Reference:  FT23062669JJ  (12 characters)
Suffix:     90172         (5 digits)
Combined:   FT23062669JJ90172
```

### JSON Unmarshaling & Field Translation
The response payload returns an array of transaction maps:
```json
{
  "header": { "status": "success" },
  "body": [
    {
      "Source Account Name": "LEUL ZENEBE ADMASU",
      "Payer's Name": "LEUL ZENEBE ADMASU",
      "Source Account": "1******72",
      "Transferred Amount": "3000.00",
      "Transaction Reference": "FT23062669JJ",
      "Transaction Date": "03/03/23 12:39",
      "Total Amount including VAT": "3000.00"
    }
  ]
}
```
The parser normalizes Amharic/English field names, casts formatted amount strings (`"3,000.00 ETB"`) to pure floating-point numbers (`3000`), and produces standardized ISO 8601 timestamps.

---

## 5. Dashen Bank SuperApp PDF Engine

Dashen Bank's SuperApp generates PDF receipts hosted publicly at:
`https://receipt.dashensuperapp.com/receipt/<16_DIGIT_REFERENCE>`

### PDF Buffer Tokenizer
1. Fetches raw PDF array buffer over HTTPS with TLS validation.
2. Converts binary stream to text via `pdf-parse`.
3. Normalizes whitespace and executes regular expression boundary matching:
   ```typescript
   const senderName = rawText.match(/Sender\s*Name\s*:?\s*(.*?)\s+(?:Sender\s*Account|Account)/i)?.[1];
   const amount = parseFloat(rawText.match(/Transaction\s*Amount\s*:?\s*([\d,]+(?:\.\d+)?)/i)?.[1].replace(/,/g, ''));
   const date = new Date(rawText.match(/Transaction\s*Date\s*:?\s*([\d/\-:, ]+(?:AM|PM)?)/i)?.[1]);
   ```

---

## 6. CBE Birr AU Receipt Pipeline

CBE Birr mobile money platform generates dynamic AU receipts at:
`https://cbepay1.cbe.com.et/aureceipt?TID=<RECEIPT_NO>&PH=<PHONE_NO>`

### Phone Normalization
Ethiopian phone numbers are validated and sanitized to the standard 12-digit international format (`2519...` or `2517...`):
```typescript
export function normalisePhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('251')) return d;
  if (d.startsWith('09') || d.startsWith('07')) return '251' + d.slice(1);
  return d;
}
```

The parsed PDF extracts customer name, debit account, credited organization account, paid amount, service charge, and VAT.

---

## 7. Safaricom M-Pesa Business API

Safaricom Ethiopia exposes an internal JSON endpoint:
`https://m-pesabusiness.safaricom.et/api/receipt/getReceipt?trxNo=<TRANSACTION_ID>`

### Base64 Encoded Binary PDF Decoding
The API returns a JSON wrapper containing a Base64-encoded PDF string:
```json
{
  "responseCode": "0",
  "responseDescription": "Success",
  "base64Data": "JVBERi0xLjQKJ..."
}
```
The engine decodes this string into a Node.js `Buffer.from(base64Data, 'base64')` and streams it through the PDF parser, extracting payer, receiver, settled amount, and timestamp.

---

## 8. Other Banks: Multi-Engine Text Parser

For banking apps that do not provide public URL slips or whose public endpoints are restricted to internal intranets (e.g. **Awash Bank**, **Coop Bank / Coopay**, **Hibret Bank**, **Zemen**, **Nib**, **Wegagen**, **Amhara Bank**), the engine features a **Deterministic Local Text Tokenizer** (`src/services/verifyReceiptText.ts`).

### Word-Boundary Regex Tokenizer
The parser executes strict word-boundary checks (`\b...\b`) to avoid false positives:
- **Awash Bank**: Extracts from `"Awash Bank Ref: ... Transferred Amount: ..."`
- **Cooperative Bank of Oromia**: Extracts from `"Cooperative Bank of Oromia Ref: ... Paid Amount: ..."`
- **Hibret / United Bank**: Extracts from `"Hibret Bank Ref: ... Beneficiary: ..."`
- **Generic Bank Fallback**: Heuristically extracts amounts, references, dates, and participant names from any unlisted Ethiopian bank receipt text.

---

## 9. Mistral AI Vision OCR Engine

When a merchant or buyer uploads a screenshot of a mobile banking app or SMS receipt (`POST /verify-image`), the vision engine processes it using Mistral AI's multimodal model (`ministral-14b-2512`).

```text
Upload Image ──► Atomic Credit Decrement ──► Mistral Vision API ──► Auto-Router ──► Verification Result
                        │ (If Mistral 500/503)
                        └──► Automatic Credit Refund
```

### Prompt Engineering
The model is instructed with domain-specific Ethiopian receipt heuristics:
- CBE receipts feature a purple header with "Commercial Bank of Ethiopia" and structured tables.
- Telebirr receipts feature a green interface with minus sign amounts.
- Returns strict JSON schema with `"type"`, `"transaction_id"`, and `"transaction_number"`.

### Atomic Decrement & Refund Safety
1. **Atomic Guard**: The workspace credit count is decremented with a concurrency guard:
   ```typescript
   await prisma.workspace.updateMany({
     where: { id: workspaceId, imageCredits: { gt: 0 } },
     data: { imageCredits: { decrement: 1 } },
   });
   ```
2. **Refund on Failure**: If the upstream vision API fails or the image is unreadable, the credit is immediately incremented back to the customer's balance.

---

## 10. Universal Smart Router & Token Classifier

The **Universal Smart Router** (`src/services/verifyUniversal.ts`) executes an $O(1)$ classifier:

```typescript
// 1. New CBE Token / Link
if (isNewCbeReference(input)) return routeToNewCBE(input);

// 2. Legacy CBE Link with embedded suffix
if (isLegacyCbeUrl(input)) return routeToLegacyCBE(input);

// 3. Dashen Bank (16 characters starting with 3xx)
if (len === 16 && /^\d{3}/.test(input)) return routeToDashen(input);

// 4. FT Reference (12 chars starting with FT)
if (len === 12 && input.startsWith('FT')) {
  if (suffix.length === 8) return routeToCBE(input, suffix);
  if (suffix.length === 5) return routeToAbyssinia(input, suffix);
}

// 5. Telebirr / CBE Birr (10 alphanumeric chars)
if (len === 10) {
  if (phoneNumber) return routeToCBEBirr(input, phoneNumber);
  return routeToTelebirr(input);
}
```

---

## 11. BullMQ Distributed Queue & Webhook Delivery Engine

Webhooks are decoupled from HTTP request/response lifecycles using BullMQ and Redis.

```text
Verification Success ──► Enqueue Webhook Job ──► Worker Process ──► Sign Payload (HMAC-SHA256)
                                                                            │
                                                     ┌──────────────────────┴──────────────────────┐
                                                     ▼                                             ▼
                                              HTTP 2xx (Success)                         HTTP 5xx / Timeout (Fail)
                                                     │                                             │
                                                     ▼                                             ▼
                                           Mark Delivery SUCCEEDED                       Schedule Retry (Exp Backoff)
                                                                                                   │
                                                                                         (After 4 attempts)
                                                                                                   ▼
                                                                                         Move to DEAD_LETTER Queue
```

### Exponential Backoff Schedule
Failed deliveries are automatically retried with exponential backoff:
- Attempt 1: Immediate
- Attempt 2: 10 seconds
- Attempt 3: 40 seconds
- Attempt 4: 160 seconds
- Final: Moved to `DEAD_LETTER` with exact error logs and manual replay capability via `/webhooks/:id/retry/:deliveryId`.

### HMAC SHA-256 Signature Verification
Every outbound webhook payload is cryptographically signed using the workspace's unique secret:
```typescript
const signature = crypto
  .createHmac('sha256', webhook.signingSecret)
  .update(JSON.stringify(payload))
  .digest('hex');
// Sent as: X-Chek-Signature: sha256=<signature>
```
