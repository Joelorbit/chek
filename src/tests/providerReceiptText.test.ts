import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTelebirrFromText } from '../services/verifyTelebirr';
import { verifyCBEFromText } from '../services/verifyCBE';

test('verifies Telebirr structured receipt text', () => {
  const reference = 'AB12CD34EF';
  const text = `Telebirr Reference: ${reference} Payer Name: John Doe Transaction Status: Completed Amount: 250.00 Payment Date: 2026-08-27 10:30:00 AM`;
  const result = verifyTelebirrFromText(reference, text);

  assert.notEqual(result, null);
  assert.equal(result?.settledAmount, '250.00 Birr');
  assert.equal(result?.payerName, 'John Doe');
  assert.equal(result?.receiptNo, reference);
});

test('verifies Telebirr natural SMS notification text', () => {
  const reference = 'TB98765432';
  const text = `You have received 1500 ETB from Chala Lemma on 29/08/2026. Txn ID: ${reference}`;
  const result = verifyTelebirrFromText(reference, text);

  assert.notEqual(result, null);
  assert.equal(result?.settledAmount, '1500.00 Birr');
  assert.equal(result?.payerName, 'Chala Lemma');
  assert.equal(result?.receiptNo, reference);
});

test('verifies CBE VAT invoice receipt text', () => {
  const reference = 'FT1234567890';
  const text = `
    Commercial Bank of Ethiopia
    Payer: John Doe Account
    Account: ****1234
    Receiver: Jane Smith Account
    Account: ****5678
    Reason / Type of service: Invoice Payment Transferred Amount
    Transferred Amount: 1,234.50 ETB
    Reference No. (VAT Invoice No): ${reference}
    Payment Date & Time: 08/26/2026 10:30:00 AM
  `;
  const result = verifyCBEFromText(reference, text);

  assert.equal(result.success, true);
  assert.equal(result.amount, 1234.5);
  assert.equal(result.payer, 'John Doe');
  assert.equal(result.reference, reference);
});

test('verifies CBE SMS notification text', () => {
  const reference = 'FT9876543210';
  const text = `Dear Customer, your account 1000***1234 has been credited with ETB 3,500.00 by Abebe Kebede. Ref: ${reference}`;
  const result = verifyCBEFromText(reference, text);

  assert.equal(result.success, true);
  assert.equal(result.amount, 3500);
  assert.equal(result.payer, 'Abebe Kebede');
  assert.equal(result.reference, reference);
});
