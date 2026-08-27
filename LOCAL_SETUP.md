# Personal Verifier Setup

This is the personal verifier source based on `Vixen878/verifier-api`. Existing live provider routes retain the reference implementation’s behavior. The personal extension adds local full receipt-text verification for CBE, Telebirr, Dashen, Abyssinia, CBE Birr, and M-Pesa.

## Install

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm approve-builds --all
pnpm exec prisma generate
pnpm exec prisma db push --skip-generate
pnpm build
pnpm start
```

Set `DATABASE_URL`, `REDIS_URL`, `ADMIN_SECRET`, `DASHBOARD_SECRET`, and `STATUS_MONITOR_SECRET` in `.env`. Use a real `MISTRAL_API_KEY` for image verification. Configure provider relay values only when you have authorized relay access.

## CBE verification modes

The original provider lookup mode remains available:

```bash
curl -X POST http://127.0.0.1:3002/verify-cbe \
  -H 'x-api-key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"reference":"FT1234567890","accountSuffix":"12345678"}'
```

For a pasted full CBE receipt text, use `receiptText` or `fullText`. The reference must be a valid CBE reference and must match the reference shown inside the receipt text:

```bash
curl -X POST http://127.0.0.1:3002/verify-cbe \
  -H 'x-api-key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  --data @cbe-full-text-payload.json
```

Example `cbe-full-text-payload.json`:

```json
{
  "reference": "FT1234567890",
  "receiptText": "Commercial Bank of Ethiopia\nPayer: John Doe Account\nAccount: ****1234\nReceiver: Jane Smith Account\nAccount: ****5678\nReason / Type of service: Invoice Payment Transferred Amount\nTransferred Amount: 1,234.50 ETB\nReference No. (VAT Invoice No): FT1234567890\nPayment Date & Time: 08/26/2026 10:30:00 AM"
}
```

The same CBE payload works through `POST /verify`. The other dedicated routes accept the same two text field names:

| Provider | Endpoint | Reference field | Minimum local text fields |
|---|---|---|---|
| Telebirr | `/verify-telebirr` | `reference` | Payer name, status, amount |
| Dashen | `/verify-dashen` | `reference` | Transaction reference, amount |
| Abyssinia | `/verify-abyssinia` | `reference` | Transaction reference, transferred amount |
| CBE Birr | `/verify-cbebirr` | `receiptNumber` or `reference` | Amount or customer name |
| M-Pesa | `/verify-mpesa` | `reference` | Payer, receiver, amount |

Use `receiptText` or `fullText` in each JSON body. The source includes `examples/cbe-full-text-payload.json` and `scripts/test-all-text-routes.sh`.

A local text success confirms that the receipt text is structurally readable and contains the supplied reference. It does not cryptographically prove that the receipt was issued by a bank or payment provider. For authenticity, use the original live-provider lookup or another trusted provider source.

## Verification status

The source builds successfully and the automated suite passes. All six provider routes were tested through the HTTP API with complete synthetic receipt text and returned HTTP 200 with parsed provider results. Live lookup without receipt text still depends on each external provider service being reachable from the host.
