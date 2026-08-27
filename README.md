# 🧾 Chek — Ethiopian Payment Verification Engine & Webhook Relay

> **Chek** is a high-performance payment verification engine, smart router, and webhook bridge built for developers, Telegram bot creators, and merchants in Ethiopia.  
> Supports **Commercial Bank of Ethiopia (CBE)**, **Ethio Telecom Telebirr**, **Bank of Abyssinia**, **Dashen Bank**, **CBE Birr**, **Safaricom M-Pesa**, **Awash Bank**, **Cooperative Bank of Oromia**, **Hibret Bank**, **Zemen Bank**, **Nib International Bank**, **Wegagen Bank**, and **Amhara Bank**.

---

## ⚡ Highlights

- **🧾 Chek Universal Smart Router (`POST /verify`)**: Pass any reference code, token, URL, or receipt text and Chek automatically detects the bank and verifies transaction details.
- **⚡ Sub-Second Verification**: Direct mobile API gateways, cached headless scrapers, and deterministic text tokenizers.
- **🔄 Multi-Relay Circuit Breaker**: Distributed hedging pool to bypass Telebirr and M-Pesa foreign datacenter geo-blocks.
- **🔔 Webhooks & HMAC SHA-256 Signatures**: Asynchronous delivery via BullMQ with exponential backoff and dead-letter queues (`X-Chek-Signature`).
- **📷 Multimodal Vision OCR**: Screenshot verification powered by Mistral AI (`ministral-14b-2512`) with atomic credit guards and automated refund on upstream error.
- **🛍️ E-Commerce & Checkout Suite**: Hosted payment links, product catalogues, order states (`PENDING`, `PAID`, `EXPIRED`), and merchant payout account matching.

---

## 📑 Documentation

- 📘 **[Developer Guide & API Reference](file:///home/latexjo/Projects/underdev/verify/DEV_DOCS.md)**
- 🔬 **[Under The Hood & Architecture Deep Dive](file:///home/latexjo/Projects/underdev/verify/UNDER_THE_HOOD.md)**

---

## 🏦 Supported Banks & Payment Methods

| Financial Institution | Protocol / Verification Method | Auto-Detection | Live Lookup / Text |
| :--- | :--- | :---: | :---: |
| **Commercial Bank of Ethiopia (CBE)** | Mobile JSON API (`mb.cbe.com.et`), Port 100 PDF, Text | Yes | ✅ Both Supported |
| **Ethio Telecom Telebirr** | Scraper + Multi-Relay Circuit Breaker Pool | Yes | ✅ Both Supported |
| **Bank of Abyssinia (BoA)** | Public Slip API (`FT...` + 5-digit suffix) | Yes | ✅ Both Supported |
| **Dashen Bank** | SuperApp Public PDF Parser (`receipt.dashensuperapp.com`) | Yes | ✅ Both Supported |
| **CBE Birr** | AU Receipt PDF Generator (`cbepay1.cbe.com.et`) + 251 Phone | Yes | ✅ Both Supported |
| **Safaricom M-Pesa** | Safaricom Business API + Base64 PDF Decoder | Yes | ✅ Both Supported |
| **Awash Bank (AwashBirr)** | Deterministic Regex & Keyword Tokenizer | Yes | ✅ Text Verification |
| **Cooperative Bank of Oromia (Coop)** | Deterministic Regex & Keyword Tokenizer | Yes | ✅ Text Verification |
| **Hibret Bank / United Bank** | Deterministic Regex & Keyword Tokenizer | Yes | ✅ Text Verification |
| **Zemen Bank** | Deterministic Regex & Keyword Tokenizer | Yes | ✅ Text Verification |
| **Nib International Bank** | Deterministic Regex & Keyword Tokenizer | Yes | ✅ Text Verification |
| **Wegagen Bank** | Deterministic Regex & Keyword Tokenizer | Yes | ✅ Text Verification |
| **Amhara Bank** | Deterministic Regex & Keyword Tokenizer | Yes | ✅ Text Verification |
| **Generic Ethiopian Bank Fallback** | Universal Heuristic Tokenizer (Sinqee, Lion, Bunna, etc.) | Yes | ✅ Text Verification |

---

## 🚀 Quick Start

### 1. Installation
```bash
git clone https://github.com/Joelorbit/Chek.git
cd Chek
pnpm install
pnpm approve-builds --all
```

### 2. Environment Setup
```bash
cp .env.example .env
# Edit .env with your DATABASE_URL (MySQL) and REDIS_URL
```

### 3. Database & Tests
```bash
npx prisma db push
npx prisma generate
pnpm test
```

### 4. Run CLI Verifier
```bash
# Auto-detects Telebirr
pnpm verify-cli AB12CD34EF

# Auto-detects Bank of Abyssinia
pnpm verify-cli FT23062669JJ90172

# Auto-detects CBE New Mobile App Receipt
pnpm verify-cli "https://mbreciept.cbe.com.et/your-token"
```

---

## 📜 License
MIT License. Built for developers and creators in Ethiopia.
