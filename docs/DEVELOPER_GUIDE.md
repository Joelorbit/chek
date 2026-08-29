# Chek Payment Engine — Developer Integration Guide

> Production API documentation for verifying Ethiopian mobile money and banking payments (**Telebirr** and **Commercial Bank of Ethiopia (CBE)**).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Endpoints](#3-endpoints)
   - [Universal Verification (`POST /verify`)](#post-verify)
   - [Batch Verification (`POST /verify-batch`)](#post-verify-batch)
   - [Telebirr Verification (`POST /verify-telebirr`)](#post-verify-telebirr)
   - [CBE Verification (`POST /verify-cbe`)](#post-verify-cbe)
4. [Webhooks & Signature Verification](#4-webhooks--signature-verification)
5. [Code Examples](#5-code-examples)
   - [Node.js / TypeScript](#nodejs--typescript)
   - [Python](#python)
   - [Telegram Bot (Node.js)](#telegram-bot-integration)
   - [PHP](#php)
   - [cURL](#curl)
6. [Response Codes & Error Handling](#6-response-codes--error-handling)

---

## 1. Overview

Chek provides sub-second verification for Ethiopian payment methods:
- **Telebirr**: Live Ethio Telecom receipt scraper (10-character reference) and natural SMS text parser.
- **Commercial Bank of Ethiopia (CBE)**: Direct Mobile token API scraper, PDF receipt generator, and CBE SMS/VAT invoice parser.

### Base URLs:
- **Local Development**: `http://localhost:3001`
- **Production**: `https://your-domain.com`

---

## 2. Authentication

All requests to `/verify`, `/verify-batch`, `/verify-cbe`, and `/verify-telebirr` require an API Key issued from your Chek Admin Console (`/admin`).

Include your API key via the `x-api-key` header:

```http
x-api-key: sk_live_your_api_key_here
```

*(Alternatively, you may pass `?apiKey=sk_live_...` as a query parameter).*

---

## 3. Endpoints

### `POST /verify`
**Universal Verification Endpoint**: Automatically inspects the input (reference string, CBE URL, or raw SMS text) and routes it to the correct provider.

#### Request Body
```json
{
  "reference": "DHS78S7FQN"
}
```
*Or with full customer SMS text:*
```json
{
  "receiptText": "Dear Customer, your account 1000***1234 has been credited with ETB 200.00 by Eyuel Getachew. Ref: FT1234567890"
}
```

#### Success Response (`HTTP 200`)
```json
{
  "success": true,
  "provider": "TELEBIRR",
  "data": {
    "receiptNo": "DHS78S7FQN",
    "payerName": "Eyuel Getachew Angassa",
    "payerTelebirrNo": "2519****7061",
    "creditedPartyName": "Gelila Bekele Dibaba",
    "creditedPartyAccountNo": "2519****6534",
    "settledAmount": "200 Birr",
    "serviceFee": "1.74 Birr",
    "serviceFeeVAT": "0.26 Birr",
    "totalPaidAmount": "202 Birr",
    "paymentDate": "28-08-2026 17:45:59",
    "transactionStatus": "Completed",
    "verificationMode": "LIVE_API"
  },
  "httpStatus": 200
}
```

---

### `POST /verify-batch`
Verifies multiple payments in parallel (up to 50 items per call).

#### Request Body
```json
{
  "items": [
    { "reference": "DHS78S7FQN" },
    { "reference": "hfHCxGIt9KKGN61d55FL" },
    { "receiptText": "You have received 500 ETB from Chala Lemma on 29/08/2026. Txn ID: TB98765432" }
  ]
}
```

---

### `POST /verify-cbe`
Dedicated CBE verification endpoint.

#### Request Body (Mobile Token / URL)
```json
{
  "reference": "hfHCxGIt9KKGN61d55FL"
}
```

#### Request Body (Legacy FT Reference with Payer Suffix)
```json
{
  "reference": "FT1234567890",
  "accountSuffix": "12345678"
}
```

---

## 4. Webhooks & Signature Verification

Whenever a payment is verified, Chek immediately sends an HTTP POST event to all registered webhook URLs.

### Webhook Event Payload:
```json
{
  "event": "payment.verified",
  "transaction": {
    "id": "3c98f821-6a2e-4efb-bc6b-95286a5eb23b",
    "reference": "DHS78S7FQN",
    "provider": "TELEBIRR",
    "amount": 200.00,
    "payer": "Eyuel Getachew Angassa",
    "receiver": "Gelila Bekele Dibaba",
    "status": "COMPLETED",
    "verificationMode": "LIVE_API",
    "verifiedAt": "2026-08-29T20:30:00.000Z"
  },
  "timestamp": "2026-08-29T20:30:01.000Z"
}
```

### Verifying HMAC SHA-256 Signatures in Node.js:
Chek sends the header `x-chek-signature` containing the HMAC SHA-256 signature of the raw request body.

```typescript
import crypto from 'crypto';
import { Request, Response } from 'express';

export function verifyChekWebhook(req: Request, res: Response) {
  const signature = req.headers['x-chek-signature'] as string;
  const webhookSecret = process.env.CHEK_WEBHOOK_SECRET!;

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).send('Invalid signature');
  }

  const { event, transaction } = req.body;
  console.log(`Payment confirmed for reference: ${transaction.reference}, Amount: ${transaction.amount}`);

  res.status(200).json({ received: true });
}
```

---

## 5. Code Examples

### Node.js / TypeScript
```typescript
import axios from 'axios';

async function checkPayment(reference: string) {
  try {
    const response = await axios.post('http://localhost:3001/verify', {
      reference
    }, {
      headers: {
        'x-api-key': process.env.CHEK_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (response.data.success) {
      const data = response.data.data;
      console.log(`✅ Verified ${data.settledAmount} from ${data.payerName}`);
      return data;
    }
  } catch (error: any) {
    console.error('Verification failed:', error.response?.data?.error || error.message);
  }
}
```

---

### Python
```python
import requests
import os

def verify_payment(reference: str):
    url = "http://localhost:3001/verify"
    headers = {
        "x-api-key": os.getenv("CHEK_API_KEY", "sk_live_..."),
        "Content-Type": "application/json"
    }
    payload = {"reference": reference}

    response = requests.post(url, json=payload, headers=headers)
    data = response.json()

    if data.get("success"):
        tx = data["data"]
        print(f"✅ Verified {tx.get('settledAmount')} from {tx.get('payerName')}")
        return tx
    else:
        print(f"❌ Verification failed: {data.get('error')}")
        return None
```

---

### Telegram Bot Integration (Telegraf)
```typescript
import { Telegraf } from 'telegraf';
import axios from 'axios';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  // If user pasted a 10-char Telebirr reference or SMS text
  if (text.length >= 10) {
    await ctx.reply('⏳ Verifying payment with bank servers...');

    try {
      const res = await axios.post('http://localhost:3001/verify', {
        reference: text.includes(' ') ? undefined : text,
        receiptText: text.includes(' ') ? text : undefined
      }, {
        headers: { 'x-api-key': process.env.CHEK_API_KEY }
      });

      if (res.data.success) {
        const d = res.data.data;
        await ctx.reply(`✅ Payment Confirmed!\n\n` +
          `• Amount: ${d.settledAmount || d.amount} ETB\n` +
          `• Payer: ${d.payerName || d.payer}\n` +
          `• Ref: ${d.receiptNo || d.reference}\n\n` +
          `Your order has been unlocked! 🎉`);
      } else {
        await ctx.reply(`❌ Payment verification failed: ${res.data.error}`);
      }
    } catch (err: any) {
      await ctx.reply(`⚠️ Verification error: ${err.response?.data?.error || err.message}`);
    }
  }
});

bot.launch();
```

---

### PHP (cURL)
```php
<?php
$apiKey = "sk_live_YOUR_API_KEY";
$reference = "DHS78S7FQN";

$ch = curl_init("http://localhost:3001/verify");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "x-api-key: " . $apiKey,
    "Content-Type: application/json"
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(["reference" => $reference]));

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true);
if ($data && $data["success"]) {
    echo "Payment verified: " . $data["data"]["settledAmount"];
} else {
    echo "Verification failed: " . ($data["error"] ?? "Unknown error");
}
?>
```

---

### cURL
```bash
curl -X POST http://localhost:3001/verify \
  -H "x-api-key: sk_live_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"reference": "DHS78S7FQN"}'
```

---

## 6. Response Codes & Error Handling

| HTTP Status | Reason | Description |
|---|---|---|
| `200 OK` | Verified | Payment was found and confirmed on the bank or telecom network. |
| `400 Bad Request` | Invalid Input | Missing reference number, malformed format, or missing account suffix. |
| `401 Unauthorized` | Missing / Invalid Key | `x-api-key` header was missing or revoked in the Admin Console. |
| `404 Not Found` | Not Found | Transaction reference does not exist on Ethio Telecom or CBE servers. |
| `422 Unprocessable` | Parsing Mismatch | SMS text reference or amount does not match the supplied reference. |
| `429 Too Many Requests` | Rate Limited | Exceeded rate limits (60 requests/minute per IP/key). |
| `502 Bad Gateway` | Upstream Outage | The bank portal or telecom server is undergoing maintenance. |

---

*Chek Ethiopian Payment Engine • Production Edition v3.1*
