import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCBEFromText } from '../services/verifyCBE';

const reference = 'FT1234567890';
const fullCbeText = `
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

test('verifies a CBE reference against pasted full receipt text', () => {
  const result = verifyCBEFromText(reference, fullCbeText);

  assert.equal(result.success, true);
  assert.equal(result.reference, reference);
  assert.equal(result.payer, 'John Doe');
  assert.equal(result.receiver, 'Jane Smith');
  assert.equal(result.payerAccount, '****1234');
  assert.equal(result.receiverAccount, '****5678');
  assert.equal(result.amount, 1234.5);
  assert.equal(result.reason, 'Invoice Payment');
});

test('rejects CBE text whose receipt reference does not match', () => {
  const result = verifyCBEFromText('FT9999999999', fullCbeText);

  assert.equal(result.success, false);
  assert.equal(result.error, 'Receipt text reference does not match the supplied reference.');
});

test('rejects incomplete CBE receipt text with missing amount', () => {
  const result = verifyCBEFromText(reference, 'CBE Reference No: FT1234567890 without amount');

  assert.equal(result.success, false);
  assert.equal(result.error, 'Could not extract reference or amount from CBE receipt text.');
});
