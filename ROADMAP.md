# 🚀 Chek — Production Roadmap & End-to-End Feature Specification
*Inspired by market leaders (Odit Verify, Veritas.et) — Blueprint for Tomorrow & Beyond*

---

## 📌 Executive Summary

**Chek** is an automated Ethiopian digital payment verification engine and developer SaaS platform for **Telebirr** and the **Commercial Bank of Ethiopia (CBE)**.

This document outlines the end-to-end architecture, user experience, and technical roadmap required to make Chek the #1 payment verification infrastructure in Ethiopia, matching and surpassing platforms like **Odit Verify** and **Veritas.et**.

---

## 🏗️ 1. Complete Merchant Account & Onboarding Lifecycle

### 1.1 Self-Serve Signup & Verification
* **Registration Methods**:
  * Email + Password (with `scrypt` hashing).
  * 1-Click Telegram Login (`Telegram Login Widget`).
  * 1-Click Google OAuth.
* **Email Verification**:
  * 6-digit OTP confirmation sent via **Resend / SendGrid** upon signup.
* **Merchant KYC Tiers**:
  1. **Sandbox / Developer** (No KYC): Instant access to test environment & 100 free live verifications.
  2. **Verified Merchant** (Light KYC): Verified business name, contact phone number, and payout/receiving Telebirr & CBE account numbers.
  3. **Enterprise Tier** (Full KYC): Business registration license (TIN/Trade license upload) for high-frequency automated checkout integrations.

### 1.2 Multi-User Teams & Role-Based Access Control (RBAC)
* **Owner / Super Admin**: Billing, team member management, business settings.
* **Developer**: Create/revoke API keys, configure webhooks, access `/docs` and testing sandbox.
* **Support / Accountant**: Read-only ledger access, inspect transactions, export CSV accounting statements.

---

## 💳 2. Hosted Checkout & Payment Links (`checkout.chek.et`)

Similar to Stripe Checkout and Veritas.et's hosted payment widget:

```
Customer Clicks "Pay with Telebirr / CBE"
  │
  ▼
Hosted Checkout Page (checkout.chek.et/pay/:id)
  ├── Displays Dynamic CBE / Telebirr QR Code
  ├── Displays Target Account & Exact ETB Amount
  ├── Real-Time Reference Input Field + Live Countdown Timer
  │
  ▼ Customer Submits Reference (e.g. DHS78S7FQN)
Chek Engine Verifies in <2 Seconds
  │
  ├── Verified: Confetti animation + auto-redirects customer to merchant's success URL
  └── Failed: Instant error feedback ("Reference not found on Ethio Telecom portal")
```

---

## 🤖 3. No-Code Telegram Bot Automation Suite

Most Ethiopian merchants sell directly inside Telegram channels and bots.

### 3.1 1-Click Telegram Bot Connection
* Merchants input their `@BotFather` API token into Chek Dashboard.
* Chek automatically sets up:
  * `/buy` command with inline shopping catalog.
  * Payment prompt with merchant's Telebirr & CBE accounts.
  * Automatic receipt listening: when a customer pastes a reference or forwards an SMS, Chek validates and automatically unlocks digital goods or marks physical orders as paid.

### 3.2 Telegram Merchant Notification Bot (`@ChekNotifyBot`)
* Merchants receive instant Telegram push notifications whenever a customer payment confirms:
  > **🔔 Payment Confirmed!**  
  > • **Amount**: 1,200.00 ETB  
  > • **Payer**: Eyuel Getachew  
  > • **Provider**: Telebirr (`DHS78S7FQN`)  
  > • **Order ID**: `#ORD-9021`

---

## 📱 4. Android SMS Auto-Forwarder Sidecar App

To achieve **0-millisecond verification** when Ethio Telecom or CBE portals experience peak-hour network delays:

* **Chek Mobile Forwarder** (Lightweight Android APK):
  * Merchant installs app on the phone with the business SIM card.
  * Listens for incoming bank SMS from `127` (Telebirr) and `889` (CBE).
  * Automatically forwards encrypted SMS payloads to `https://api.chek.et/api/v1/sms-ingest` via WebSockets.
  * When a customer submits a reference on checkout, Chek matches it instantly against the local forwarded SMS cache in **0.002 seconds**.

---

## 🛡️ 5. Advanced Anti-Fraud & Idempotency Protection

* **Strict 1-Time Redemption**:
  * Every verified transaction reference is permanently recorded in PostgreSQL with unique indexes.
  * Attempting to reuse a past reference returns `409 Conflict: "Transaction reference already redeemed"`.
* **Amount Matching Guard**:
  * If an order expects `500.00 ETB`, but the verified receipt is for `50.00 ETB`, Chek automatically flags `422 Mismatch: "Expected 500 ETB, but receipt settled 50 ETB"`.
* **Account Receiver Verification**:
  * Validates that the payment went to the *merchant's* specific phone/account and not an unrelated third-party account.
* **Rolling 30-Day Expiry**:
  * Prevents customers from redeeming old receipts from previous months.

---

## 📦 6. Official SDKs & Plugin Ecosystem

1. **Node.js / TypeScript SDK**: `npm install @chek/sdk`
   ```typescript
   import { ChekClient } from '@chek/sdk';
   const chek = new ChekClient({ apiKey: 'sk_live_...' });
   const result = await chek.verify({ reference: 'DHS78S7FQN' });
   ```
2. **Python SDK**: `pip install chek-sdk`
   ```python
   from chek import Chek
   chek = Chek(api_key="sk_live_...")
   result = chek.verify(reference="DHS78S7FQN")
   ```
3. **WooCommerce / WordPress Plugin**:
   * Drop-in payment gateway for Ethiopian eCommerce websites.
4. **Shopify & Custom Webhooks**:
   * Auto-fulfill orders upon receiving signed `payment.verified` webhooks.

---

## 💰 7. Billing, Credits & Prepaid Packages

* **Free Developer Tier**: 1,000 verifications / month free.
* **Prepaid Volume Packages**:
  * **500 ETB** = 2,500 Verifications (0.20 ETB / check)
  * **1,500 ETB** = 10,000 Verifications (0.15 ETB / check)
  * **5,000 ETB** = 50,000 Verifications (0.10 ETB / check)
* **Prepaid Balance Wallet**:
  * Merchants can top up their Chek balance via Telebirr or CBE directly inside the dashboard.

---

## 📅 Implementation Roadmap (Sprint Plan)

| Phase | Milestone | Focus Areas |
|---|---|---|
| **Phase 1 (Completed)** | **Core Engine & Multi-Tenancy** | Telebirr & CBE live engines, JWT Auth, Admin & Merchant dashboard, `/docs` portal with `Ctrl+K`. |
| **Phase 2 (Next)** | **Telegram Bot Studio & Webhook Retries** | 1-Click Bot connector, automated dead-letter queues, email OTP signup. |
| **Phase 3** | **Hosted Checkout & Payment Links** | `checkout.chek.et/pay/:id` with dynamic QR codes and live countdown redirect. |
| **Phase 4** | **Android SMS Forwarder App** | Background SMS sync for 0ms offline verification and zero telecom downtime. |
| **Phase 5** | **Prepaid Billing & Official SDKs** | Telebirr balance top-up, `@chek/sdk` npm package, WooCommerce plugin. |

---

*Chek is engineered for performance, security, and developer joy.*
