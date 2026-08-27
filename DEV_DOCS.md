# 🧾 Chek — Developer Guide & API Reference

> **Comprehensive Engineering Documentation & Integration Reference for Chek Ethiopian Payment Verification & Webhook Relay.**  
> Supports **Commercial Bank of Ethiopia (CBE)**, **Ethio Telecom Telebirr**, **Bank of Abyssinia**, **Dashen Bank**, **CBE Birr**, **Safaricom M-Pesa**, **Awash Bank**, **Cooperative Bank of Oromia**, and **Hibret Bank**.

---

## 📑 Table of Contents

1. [Architecture & System Topology](#-architecture--system-topology)
2. [Quickstart & Installation](#-quickstart--installation)
3. [Authentication & Workspace Security](#-authentication--workspace-security)
4. [Universal Smart Router (`POST /verify`)](#-universal-smart-router-post-verify)
5. [Dedicated Provider Endpoints](#-dedicated-provider-endpoints)
   - [Commercial Bank of Ethiopia (CBE)](#1-commercial-bank-of-ethiopia-cbe)
   - [Ethio Telecom Telebirr](#2-ethio-telecom-telebirr)
   - [Bank of Abyssinia (BoA)](#3-bank-of-abyssinia)
   - [Dashen Bank](#4-dashen-bank)
   - [CBE Birr](#5-cbe-birr)
   - [Safaricom M-Pesa](#6-safaricom-m-pesa)
   - [Other Banks (Awash, Coop, Hibret, Zemen, Nib, Wegagen, Amhara)](#7-other-ethiopian-banks)
6. [Image & Screenshot OCR Verification (`POST /verify-image`)](#-image--screenshot-ocr-verification)
7. [Batch Verification (`POST /verify-batch`)](#-batch-verification-post-verify-batch)
8. [E-Commerce & Hosted Payment Links](#-e-commerce--hosted-payment-links)
9. [Webhooks & Delivery Engine](#-webhooks--delivery-engine)
10. [CLI Verification Tool](#-cli-verification-tool)
11. [Client SDK & Code Examples](#-client-sdk--code-examples)

---

## 🏛 Architecture & System Topology

The platform operates as a modular, high-throughput Node.js/TypeScript verification gateway backed by Prisma ORM (MySQL) and BullMQ (Redis).

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Client Applications                              │
│       (E-commerce Checkouts, Mobile Apps, Telegram Bots, POS Terminals)     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP / JSON (x-api-key / Bearer)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Express Gateway & Middleware Pipeline                     │
│  • Request Logger & Stats Aggregator (In-Memory Ring Cache + UsageLog)      │
│  • API Key Authentication & SHA-256 Hash Verification                       │
│  • Tier Gate, Rate Limiter (Per Minute) & Monthly Quota Check               │
│  • Verification Webhook Capture Hook                                        │
└──────────────┬───────────────────────┬───────────────────────┬──────────────┘
               │                       │                       │
               ▼                       ▼                       ▼
┌───────────────────────────┐ ┌───────────────────┐ ┌─────────────────────────┐
│  Universal Smart Router   │ │ Provider Services │ │ OCR / Vision Engine     │
│  • Reference Tokenizer    │ │ • CBE Public API  │ │ • Mistral Vision        │
│  • Regex Pattern Matcher  │ │ • Telebirr Relay  │ │   (ministral-14b-2512)  │
│  • Receipt Text Parser    │ │ • BoA Slip JSON   │ │ • Atomic Token Decrement│
│  • Fallback Classifier    │ │ • Dashen/AU PDFs  │ │ • Auto-Refund on Error  │
└───────────────────────────┘ └───────────────────┘ └─────────────────────────┘
               │                       │                       │
               └───────────────────────┼───────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Async Workers & Webhook Queue (BullMQ)                   │
│  • Exponential Backoff Retries (4 attempts)                                 │
│  • Cryptographic HMAC-SHA256 Webhook Signatures (`X-Chek-Signature`)        │
│  • Dead-Letter Queue & Manual Replay Pipeline                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quickstart & Installation

### Prerequisites
- **Node.js**: `v20.x` or `v22.x`+
- **pnpm**: `v9.x` or `v11.x`
- **MySQL Database**: `v8.0`+
- **Redis**: `v6.0`+ (for BullMQ queues)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Vixen878/verifier-api.git
cd verifier-api
pnpm install
pnpm approve-builds --all
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory:
```env
PORT=3001
NODE_ENV=development
DATABASE_URL="mysql://root:password@localhost:3306/verifier_db"
REDIS_URL="redis://localhost:6379"

# Security Secrets
ADMIN_SECRET="your-super-admin-secret-key"
WEBHOOK_SECRET_KEY="your-default-signing-secret"

# OCR / Mistral Vision (Optional, for image verification)
MISTRAL_API_KEY="your-mistral-ai-key"

# Telebirr & M-Pesa Proxies (Optional for VPS outside Ethiopia)
SKIP_PRIMARY_VERIFICATION=false
FALLBACK_PROXIES="https://your-ethiopia-relay.com/proxy.php"
MPESA_PROXY_KEY="your-mpesa-proxy-key"
```

### 3. Initialize Database & Run Tests
```bash
# Push Prisma Schema to database
npx prisma db push
npx prisma generate

# Run Full Test Suite
pnpm test

# Start Development Server
pnpm dev
```

---

## 🔐 Authentication & Workspace Security

Every API request (except `/admin` and public payment link confirmation endpoints) requires authentication.

### Header Authentication Format
Include your API Key in either the `x-api-key` header or the `Authorization` header:

```http
x-api-key: vts_live_a1b2c3d4e5f6...
```
or
```http
Authorization: Bearer vts_live_a1b2c3d4e5f6...
```

### Tier Quotas & Rate Limits
| Plan Tier | Monthly Quota | Rate Limit | Image Credits | Batch Verification | Webhooks Limit |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **FREE** | 100 verifications/mo | 10 req/min | 0 | ❌ | 0 |
| **PRO** | 2,000 verifications/mo | 60 req/min | 100/mo | 20 refs/batch | 20 |
| **BUSINESS** | 50,000 verifications/mo | 300 req/min | 300/mo | 100 refs/batch | 50 |

---

## ⚡ Universal Smart Router (`POST /verify`)

The **Universal Smart Router** (`POST /verify`) is a single, intelligent endpoint that automatically identifies the provider based on the reference format, URL pattern, or accompanying receipt text.

### Endpoint Definition
```http
POST /verify
Content-Type: application/json
x-api-key: <YOUR_API_KEY>
```

### Request Body Schema
```typescript
interface UniversalVerifyBody {
  reference: string;          // Transaction reference, Token, or Receipt URL
  suffix?: string;             // Optional account suffix (8 digits for CBE, 5 digits for BoA)
  phoneNumber?: string;        // Optional Ethiopian phone (e.g. 251911223344 for CBE Birr)
  receiptText?: string;        // Optional pasted full receipt text for instant zero-latency verification
  fullText?: string;           // Alias for receiptText
}
```

### Pattern Matching Rules Table
| Pattern | Auto-Detected Provider | Required Fields |
| :--- | :---: | :--- |
| `10 characters alphanumeric` | **Telebirr** | `reference` |
| `mbreciept.cbe.com.et/<token>` or `15–40 char token` | **CBE (New Mobile)** | `reference` |
| `FT...` (12 chars) + 8-digit suffix | **CBE (Legacy)** | `reference`, `suffix` |
| `FT...` (12 chars) + 5-digit suffix | **Bank of Abyssinia** | `reference`, `suffix` |
| `16 digits` starting with `3xx` | **Dashen Bank** | `reference` |
| `10 characters` + `phoneNumber` | **CBE Birr** | `reference`, `phoneNumber` |
| `receiptText` with bank keywords | **Awash / Coop / Hibret / etc.** | `reference`, `receiptText` |

---

## 🏦 Dedicated Provider Endpoints

### 1. Commercial Bank of Ethiopia (CBE)
Verifies transactions made through CBE Mobile Banking (`mb.cbe.com.et`), legacy CBE receipts (`apps.cbe.com.et:100`), or pasted receipt text.

```http
POST /verify-cbe
Content-Type: application/json
x-api-key: <YOUR_API_KEY>
```

#### New CBE Token Request:
```json
{
  "reference": "1234567890abcdef1234"
}
```

#### Legacy CBE Reference Request:
```json
{
  "reference": "FT1234567890",
  "accountSuffix": "12345678"
}
```

#### Successful Response:
```json
{
  "success": true,
  "payer": "Abebe Kebede",
  "payerAccount": "****1234",
  "receiver": "Veritas Payments",
  "receiverAccount": "****5678",
  "amount": 1500.00,
  "date": "2026-08-26T07:30:00.000Z",
  "reference": "FT1234567890",
  "reason": "Invoice #1042"
}
```

---

### 2. Ethio Telecom Telebirr
Verifies Telebirr transactions by scraping receipt records or parsing local text.

```http
POST /verify-telebirr
Content-Type: application/json
x-api-key: <YOUR_API_KEY>

{
  "reference": "AB12CD34EF"
}
```

#### Successful Response:
```json
{
  "success": true,
  "data": {
    "payerName": "Abebe Kebede",
    "payerTelebirrNo": "251911****12",
    "creditedPartyName": "Merchant Store",
    "creditedPartyAccountNo": "251912345678",
    "transactionStatus": "Completed",
    "receiptNo": "AB12CD34EF",
    "paymentDate": "2026-08-27 10:30:00 AM",
    "settledAmount": "500.00 Birr",
    "serviceFee": "0.00 Birr",
    "serviceFeeVAT": "0.00 Birr",
    "totalPaidAmount": "500.00 Birr"
  }
}
```

---

### 3. Bank of Abyssinia
Verifies Bank of Abyssinia transfers using the 12-character transaction reference (`FT...`) and the sender's 5-digit account suffix.

```http
POST /verify-abyssinia
Content-Type: application/json
x-api-key: <YOUR_API_KEY>

{
  "reference": "FT23062669JJ",
  "suffix": "90172"
}
```

#### Successful Response:
```json
{
  "success": true,
  "data": {
    "payer": "LEUL ZENEBE ADMASU",
    "payerAccount": "1******72",
    "amount": 3000.00,
    "date": "2023-03-03T09:39:00.000Z",
    "reference": "FT23062669JJ",
    "reason": "Transfer"
  }
}
```

---

### 4. Dashen Bank
Verifies Dashen Bank transfers using the 16-character transaction reference number.

```http
POST /verify-dashen
Content-Type: application/json
x-api-key: <YOUR_API_KEY>

{
  "reference": "3123456789012345"
}
```

#### Successful Response:
```json
{
  "success": true,
  "senderName": "Abebe Kebede",
  "receiverName": "Jane Smith",
  "transactionAmount": 500.00,
  "transactionReference": "3123456789012345",
  "transactionDate": "2026-08-27T07:30:00.000Z",
  "serviceType": "Transfer"
}
```

---

### 5. CBE Birr
Verifies CBE Birr transactions using the receipt number and the payer's 12-digit Ethiopian phone number (`251...`).

```http
POST /verify-cbebirr
Content-Type: application/json
x-api-key: <YOUR_API_KEY>

{
  "receiptNumber": "AB12CD34EF",
  "phoneNumber": "251911223344"
}
```

---

### 6. Safaricom M-Pesa
Verifies M-Pesa mobile money payments using the transaction ID.

```http
POST /verify-mpesa
Content-Type: application/json
x-api-key: <YOUR_API_KEY>

{
  "reference": "MPESA12345"
}
```

---

### 7. Other Ethiopian Banks
For **Awash Bank**, **Cooperative Bank of Oromia (Coop / Coopay)**, **Hibret Bank**, **Zemen Bank**, **Nib Bank**, **Wegagen Bank**, and **Amhara Bank**, pass the transaction reference and the pasted receipt text to `POST /verify`:

```http
POST /verify
Content-Type: application/json
x-api-key: <YOUR_API_KEY>

{
  "reference": "AW123456789",
  "receiptText": "Awash Bank Ref: AW123456789 Sender Name: Abebe Kebede Transferred Amount: 4,500.00 Date: 2026-08-27 10:30:00 AM"
}
```

---

## 📷 Image & Screenshot OCR Verification

Verifies payments directly from uploaded receipt screenshots using Mistral AI Vision (`ministral-14b-2512`).

```http
POST /verify-image?autoVerify=true
Content-Type: multipart/form-data
x-api-key: <YOUR_API_KEY>

file: <screenshot.jpg|png>
suffix: "12345678" (optional, for CBE)
```

- **Atomic Credit Protection**: Credits are deducted before OCR execution.
- **Automatic Refund**: If the OCR service or upstream bank API experiences an outage, your credit is automatically refunded in the same transaction.

---

## 📦 Batch Verification (`POST /verify-batch`)

Allows PRO and BUSINESS subscribers to verify multiple transactions concurrently in a single HTTP request.

```http
POST /verify-batch
Content-Type: application/json
x-api-key: <YOUR_API_KEY>

{
  "references": [
    { "reference": "AB12CD34EF" },
    { "reference": "FT1234567890", "suffix": "12345678" },
    { "reference": "FT23062669JJ", "suffix": "90172" }
  ]
}
```

#### Response:
```json
{
  "success": true,
  "total": 3,
  "succeeded": 3,
  "failed": 0,
  "results": [
    { "index": 0, "success": true, "reference": "AB12CD34EF", "provider": "TELEBIRR", "data": { ... } },
    { "index": 1, "success": true, "reference": "FT1234567890", "provider": "CBE", "data": { ... } },
    { "index": 2, "success": true, "reference": "FT23062669JJ", "provider": "ABYSSINIA", "data": { ... } }
  ]
}
```

---

## 🛒 E-Commerce & Hosted Payment Links

The API includes a complete merchant toolkit for accepting bank & mobile money payments with automatic receipt validation:

### 1. Payout Accounts (`/payouts`)
Configure destination accounts where buyer payments should land:
```http
POST /payouts
Content-Type: application/json
x-api-key: <YOUR_API_KEY>

{
  "label": "Main Telebirr Merchant",
  "type": "PHONE",
  "account": "251911223344",
  "providersAllowed": ["telebirr", "cbebirr"]
}
```

### 2. Products (`/products`)
Create digital or physical products with pricing and provider restrictions:
```http
POST /products
Content-Type: application/json
x-api-key: <YOUR_API_KEY>

{
  "name": "Pro Membership",
  "price": 500,
  "acceptedProviders": ["telebirr", "cbe", "abyssinia"],
  "deliveryUrl": "https://myapp.com/download"
}
```

### 3. Payment Links (`/payment-links`)
Generate hosted payment checkout links for buyers:
```http
POST /payment-links
Content-Type: application/json
x-api-key: <YOUR_API_KEY>

{
  "name": "Invoice #492",
  "mode": "CUSTOM",
  "fixedAmount": 1200,
  "acceptedProviders": ["telebirr", "cbe", "abyssinia"]
}
```

### 4. Buyer Confirmation (`POST /payment-links/:id/confirm`)
Public endpoint called when a buyer submits their reference on the hosted payment page. The system verifies the transaction, ensures the credited account matches the merchant's active payout account, and creates an `Order` record in state `PAID`.

---

## 🔔 Webhooks & Delivery Engine

### Supported Webhook Events
- `verification.success`: Fired whenever any transaction is verified successfully.
- `verification.failed`: Fired on invalid or fake reference numbers.
- `payment_link.paid`: Fired when a customer completes payment via a payment link.
- `product.sold_out`: Fired when inventory is exhausted.
- `webhook.dead_letter`: Fired when a webhook fails after 4 retry attempts.

### Registering a Webhook
```http
POST /webhooks
Content-Type: application/json
x-api-key: <YOUR_API_KEY>

{
  "url": "https://api.yourdomain.com/webhooks/payments",
  "events": ["payment_link.paid", "verification.success"]
}
```

### Verifying Webhook Signatures
Every webhook delivery includes an HMAC-SHA256 signature in the `X-Chek-Signature` header:

```typescript
import crypto from 'crypto';

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}
```

---

## 💻 CLI Verification Tool

The project includes an automatic ID pattern detection CLI tool for terminal testing:

```bash
# Telebirr
pnpm verify-cli AB12CD34EF

# Bank of Abyssinia (Auto-splits reference + 5-digit suffix)
pnpm verify-cli FT23062669JJ90172

# CBE Legacy (Auto-splits reference + 8-digit suffix)
pnpm verify-cli FT123456789012345678

# CBE New Mobile URL
pnpm verify-cli "https://mbreciept.cbe.com.et/your-token"
```

---

## 📦 Client SDK & Code Examples

### TypeScript / Node.js
```typescript
import axios from 'axios';

const client = axios.create({
  baseURL: 'https://api.chek.et',
  headers: { 'x-api-key': process.env.CHEK_API_KEY },
});

async function verifyPayment(reference: string, suffix?: string) {
  const { data } = await client.post('/verify', { reference, suffix });
  if (data.success) {
    console.log('✅ Payment verified! Amount:', data.data.amount);
  }
}
```

### Python
```python
import requests

API_KEY = "chk_live_..."

def verify_payment(reference: str, suffix: str = None):
    response = requests.post(
        "https://api.chek.et/verify",
        headers={"x-api-key": API_KEY},
        json={"reference": reference, "suffix": suffix}
    )
    return response.json()
```

### cURL
```bash
curl -X POST https://api.chek.et/verify \
  -H "x-api-key: chk_live_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"reference": "FT23062669JJ", "suffix": "90172"}'
```
