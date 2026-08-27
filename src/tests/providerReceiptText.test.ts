import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyProviderReceiptText } from '../services/verifyReceiptText';

test('verifies Telebirr receipt text', () => {
  const reference = 'AB12CD34EF';
  const result = verifyProviderReceiptText('TELEBIRR', reference, `Telebirr Reference: ${reference} Payer Name: John Doe Transaction Status: Completed Amount: 250.00 Payment Date: 2026-08-27 10:30:00 AM`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'TELEBIRR');
  assert.equal(result.amount, 250);
});

test('verifies Dashen receipt text', () => {
  const reference = '3123456789012345';
  const result = verifyProviderReceiptText('DASHEN', reference, `Dashen Bank Transaction Reference: ${reference} Sender Name: John Doe Receiver Name: Jane Smith Transaction Amount: 500.00 Transaction Date: 2026-08-27 10:30:00 AM`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'DASHEN');
  assert.equal(result.transactionReference, reference);
  assert.equal(result.transactionAmount, 500);
});

test('verifies Abyssinia receipt text', () => {
  const reference = 'FTABCDEFGHIJ';
  const result = verifyProviderReceiptText('ABYSSINIA', reference, `Bank of Abyssinia Transaction Reference: ${reference} Payer's Name: John Doe Transferred Amount: 750.00 Transaction Date: 2026-08-27 10:30:00 AM Narrative: Invoice payment`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'ABYSSINIA');
  assert.equal(result.transferredAmount, 750);
});

test('verifies CBE Birr receipt text', () => {
  const reference = 'AB12CD34EF';
  const result = verifyProviderReceiptText('CBE_BIRR', reference, `CBE Birr Receipt Number: ${reference} Customer Name: John Doe Paid Amount: 1,200.00 Transaction Date: 2026-08-27 10:30:00 AM Transaction Status: Completed`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'CBE_BIRR');
  assert.equal(result.amount, 1200);
});

test('verifies M-Pesa receipt text', () => {
  const reference = 'MPESA12345';
  const result = verifyProviderReceiptText('MPESA', reference, `M-Pesa Transaction ID: ${reference} Payer Name: John Doe Receiver Name: Jane Smith Total: 300.00 Payment Date: 2026-08-27 10:30:00 AM`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'MPESA');
  assert.equal(result.amount, 300);
});

test('verifies Awash Bank receipt text', () => {
  const reference = 'AW123456789';
  const result = verifyProviderReceiptText('AWASH', reference, `Awash Bank Ref: ${reference} Sender Name: Abebe Kebede Receiver Name: Chala Tadesse Transferred Amount: 4,500.00 Date: 2026-08-27 10:30:00 AM`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'AWASH');
  assert.equal(result.amount, 4500);
  assert.equal(result.payer, 'Abebe Kebede');
});

test('verifies Cooperative Bank of Oromia receipt text', () => {
  const reference = 'COOP987654321';
  const result = verifyProviderReceiptText('COOP', reference, `Cooperative Bank of Oromia Reference: ${reference} Customer Name: Chala Tolessa Receiver Name: Almaz Ayana Amount: 3,200.00 Date: 2026-08-27 10:30:00 AM`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'COOP');
  assert.equal(result.amount, 3200);
  assert.equal(result.payer, 'Chala Tolessa');
});

test('verifies Hibret Bank receipt text', () => {
  const reference = 'HB1122334455';
  const result = verifyProviderReceiptText('HIBRET', reference, `Hibret Bank Reference: ${reference} Payer Name: Rahel Hailu Receiver Name: Meron Desta Amount: 1,800.00 Date: 2026-08-27 10:30:00 AM`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'HIBRET');
  assert.equal(result.amount, 1800);
});

test('verifies Zemen Bank receipt text', () => {
  const reference = 'ZM5544332211';
  const result = verifyProviderReceiptText('ZEMEN', reference, `Zemen Bank Reference: ${reference} Sender Name: Yohannes Girma Amount: 6,000.00 Date: 2026-08-27 10:30:00 AM`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'ZEMEN');
  assert.equal(result.amount, 6000);
});

test('verifies Nib International Bank receipt text', () => {
  const reference = 'NIB99887766';
  const result = verifyProviderReceiptText('NIB', reference, `Nib International Bank Ref: ${reference} Customer Name: Tigist Alemu Amount: 2,500.00 Date: 2026-08-27 10:30:00 AM`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'NIB');
  assert.equal(result.amount, 2500);
});

test('verifies Wegagen Bank receipt text', () => {
  const reference = 'WG33221144';
  const result = verifyProviderReceiptText('WEGAGEN', reference, `Wegagen Bank Ref: ${reference} Sender Name: Fitsum Berhe Amount: 1,100.00 Date: 2026-08-27 10:30:00 AM`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'WEGAGEN');
  assert.equal(result.amount, 1100);
});

test('verifies Amhara Bank receipt text', () => {
  const reference = 'AMH77889900';
  const result = verifyProviderReceiptText('AMHARA', reference, `Amhara Bank Ref: ${reference} Payer Name: Belayneh Assefa Amount: 3,750.00 Date: 2026-08-27 10:30:00 AM`);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'AMHARA');
  assert.equal(result.amount, 3750);
});

test('rejects receipt text when provider reference does not match', () => {
  const result = verifyProviderReceiptText('TELEBIRR', 'AB12CD34EF', 'Telebirr Reference: ZZ99YY88XX Payer Name: John Doe Transaction Status: Completed Amount: 250.00');
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /does not match/);
});
