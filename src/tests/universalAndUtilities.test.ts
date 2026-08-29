import test from 'node:test';
import assert from 'node:assert/strict';
import { runSmartVerify } from '../services/verifyUniversal';
import {
  normalisePhone,
  maskCbeAccount,
  cbeAccountMatches,
  accountMatches,
  isValidMerchantAccount,
  extractPaymentDetails,
} from '../utils/paymentMatch';
import {
  extractNewCbeToken,
  isNewCbeReference,
  extractLegacyCbeUrlData,
  isLegacyCbeReference,
} from '../utils/cbeReference';

test('cbeReference: identifies new CBE tokens and URLs', () => {
  const token = '1234567890abcdef1234';
  assert.equal(isNewCbeReference(token), true);
  assert.equal(extractNewCbeToken(token), token);

  const url = `https://mbreciept.cbe.com.et/${token}`;
  assert.equal(isNewCbeReference(url), true);
  assert.equal(extractNewCbeToken(url), token);

  // Legacy reference starting with FT should not be detected as new CBE token
  assert.equal(isNewCbeReference('FT1234567890'), false);
  assert.equal(extractNewCbeToken('FT1234567890'), null);
});

test('cbeReference: identifies legacy CBE URL data', () => {
  const legacyUrl = 'https://apps.cbe.com.et:100/?id=FT123456789012345678';
  const data = extractLegacyCbeUrlData(legacyUrl);
  assert.notEqual(data, null);
  assert.equal(data?.reference, 'FT1234567890');
  assert.equal(data?.suffix, '12345678');

  assert.equal(isLegacyCbeReference('FT1234567890'), true);
  assert.equal(isLegacyCbeReference('INVALID123'), false);
});

test('paymentMatch: normalises phone numbers to 251 format', () => {
  assert.equal(normalisePhone('0912345678'), '251912345678');
  assert.equal(normalisePhone('0712345678'), '251712345678');
  assert.equal(normalisePhone('+251912345678'), '251912345678');
  assert.equal(normalisePhone('251912345678'), '251912345678');
});

test('paymentMatch: masks and matches CBE accounts', () => {
  assert.equal(maskCbeAccount('1000012345678'), '1***5678');
  assert.equal(cbeAccountMatches('1***5678', '1000012345678'), true);
  assert.equal(cbeAccountMatches('1***9999', '1000012345678'), false);
  assert.equal(cbeAccountMatches('1000012345678', '1000012345678'), true);
});

test('paymentMatch: matches merchant accounts correctly', () => {
  assert.equal(accountMatches('251912345678', '0912345678'), true);
  assert.equal(accountMatches('2519***1234', '0912341234'), true);
  assert.equal(accountMatches(null, '1000012345678'), true);
  assert.equal(accountMatches('1000012345678', '1000012345678'), true);
});

test('paymentMatch: validates merchant account formats', () => {
  assert.equal(isValidMerchantAccount('0912345678'), true);
  assert.equal(isValidMerchantAccount('0712345678'), true);
  assert.equal(isValidMerchantAccount('251912345678'), true);
  assert.equal(isValidMerchantAccount('1000012345678'), true);
  assert.equal(isValidMerchantAccount('abc123'), false);
});

test('paymentMatch: extracts payment details for Telebirr and CBE', () => {
  const telebirrRes = extractPaymentDetails({ settledAmount: '150.50', creditedPartyAccountNo: '251911223344' }, 'telebirr');
  assert.equal(telebirrRes.amount, 150.5);
  assert.equal(telebirrRes.account, '251911223344');

  const cbeRes = extractPaymentDetails({ amount: 500, receiverAccount: '1000012345678' }, 'cbe');
  assert.equal(cbeRes.amount, 500);
  assert.equal(cbeRes.account, '1000012345678');
});

test('runSmartVerify: routes CBE text receipts accurately', async () => {
  const ref = 'FT1234567890';
  const receiptText = `
    Commercial Bank of Ethiopia
    Payer: John Doe Account
    Account: ****1234
    Receiver: Jane Smith Account
    Account: ****5678
    Reason / Type of service: Invoice Payment Transferred Amount
    Transferred Amount: 1,234.50 ETB
    Reference No. (VAT Invoice No): ${ref}
    Payment Date & Time: 08/26/2026 10:30:00 AM
  `;
  const res = await runSmartVerify({ reference: ref, receiptText });

  assert.equal(res.success, true);
  assert.equal(res.provider, 'CBE');
  assert.equal(res.httpStatus, 200);
});

test('runSmartVerify: routes Telebirr text receipts accurately', async () => {
  const ref = 'AB12CD34EF';
  const receiptText = `Telebirr Reference: ${ref} Payer Name: John Doe Transaction Status: Completed Amount: 250.00 Payment Date: 2026-08-27 10:30:00 AM`;
  const res = await runSmartVerify({ reference: ref, receiptText });

  assert.equal(res.success, true);
  assert.equal(res.provider, 'TELEBIRR');
  assert.equal(res.httpStatus, 200);
});

test('runSmartVerify: auto-detects Telebirr from natural SMS', async () => {
  const sms = 'You have received 1500 ETB from Chala Lemma on 29/08/2026. Txn ID: TB98765432';
  const res = await runSmartVerify({ receiptText: sms });

  assert.equal(res.success, true);
  assert.equal(res.provider, 'TELEBIRR');
  assert.equal(res.httpStatus, 200);
  assert.equal(res.data?.settledAmount, '1500.00 Birr');
});

test('runSmartVerify: rejects invalid reference length', async () => {
  const res = await runSmartVerify({ reference: 'INVALID' });
  assert.equal(res.success, false);
  assert.equal(res.httpStatus, 400);
});
