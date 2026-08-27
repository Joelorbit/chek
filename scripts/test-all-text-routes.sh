#!/usr/bin/env bash
set -u
BASE_URL="${BASE_URL:-http://127.0.0.1:3002}"
API_KEY="${API_KEY:?Set API_KEY to the personal verifier API key}"
HEADER=(-H "x-api-key: ${API_KEY}" -H 'Content-Type: application/json')

declare -a names=(cbe telebirr dashen abyssinia cbebirr mpesa)
declare -a payloads
payloads+=("{\"reference\":\"FT1234567890\",\"receiptText\":\"Commercial Bank of Ethiopia\\nPayer: John Doe Account\\nAccount: ****1234\\nReceiver: Jane Smith Account\\nAccount: ****5678\\nReason / Type of service: Invoice Payment Transferred Amount\\nTransferred Amount: 1,234.50 ETB\\nReference No. (VAT Invoice No): FT1234567890\\nPayment Date & Time: 08/26/2026 10:30:00 AM\"}")
payloads+=("{\"reference\":\"AB12CD34EF\",\"receiptText\":\"Telebirr Reference: AB12CD34EF Payer Name: John Doe Transaction Status: Completed Amount: 250.00 Payment Date: 2026-08-27 10:30:00 AM\"}")
payloads+=("{\"reference\":\"3123456789012345\",\"receiptText\":\"Dashen Bank Transaction Reference: 3123456789012345 Sender Name: John Doe Receiver Name: Jane Smith Transaction Amount: 500.00 Transaction Date: 2026-08-27 10:30:00 AM\"}")
payloads+=("{\"reference\":\"FTABCDEFGHIJ\",\"receiptText\":\"Bank of Abyssinia Transaction Reference: FTABCDEFGHIJ Payer's Name: John Doe Transferred Amount: 750.00 Transaction Date: 2026-08-27 10:30:00 AM Narrative: Invoice payment\"}")
payloads+=("{\"receiptNumber\":\"AB12CD34EF\",\"receiptText\":\"CBE Birr Receipt Number: AB12CD34EF Customer Name: John Doe Paid Amount: 1,200.00 Transaction Date: 2026-08-27 10:30:00 AM Transaction Status: Completed\"}")
payloads+=("{\"reference\":\"MPESA12345\",\"receiptText\":\"M-Pesa Transaction ID: MPESA12345 Payer Name: John Doe Receiver Name: Jane Smith Total: 300.00 Payment Date: 2026-08-27 10:30:00 AM\"}")

for i in "${!names[@]}"; do
  provider="${names[$i]}"
  endpoint="/verify-${provider}"
  printf '%s\n' "--- ${provider} ---"
  curl --max-time 15 -sS -o "/tmp/text-${provider}.json" -w 'HTTP %{http_code}\n' -X POST "${BASE_URL}${endpoint}" "${HEADER[@]}" --data "${payloads[$i]}"
  cat "/tmp/text-${provider}.json"
  printf '\n'
done
