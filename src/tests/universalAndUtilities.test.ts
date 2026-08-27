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
import {
  getVerificationMonthlyQuota,
  getMonthlyImageCredits,
  getWebhookLimit,
  getNotificationChannelLimit,
  getBatchMaxReferences,
  getRateLimit,
} from '../config/plans';
import { DEFAULT_BILLING_CONFIG } from '../config/billingConfig';

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
  assert.equal(accountMatches(null, '1000012345678'), true); // null means skip verification
  assert.equal(accountMatches('1000012345678', '1000012345678'), true);
});

test('paymentMatch: validates merchant account formats', () => {
  assert.equal(isValidMerchantAccount('0912345678'), true);
  assert.equal(isValidMerchantAccount('0712345678'), true);
  assert.equal(isValidMerchantAccount('251912345678'), true);
  assert.equal(isValidMerchantAccount('1000012345678'), true);
  assert.equal(isValidMerchantAccount('abc123'), false);
});

test('paymentMatch: extracts payment details for various providers', () => {
  const telebirrRes = extractPaymentDetails({ settledAmount: '150.50', creditedPartyAccountNo: '251911223344' }, 'telebirr');
  assert.equal(telebirrRes.amount, 150.5);
  assert.equal(telebirrRes.account, '251911223344');

  const cbeRes = extractPaymentDetails({ amount: 500, receiverAccount: '1000012345678' }, 'cbe');
  assert.equal(cbeRes.amount, 500);
  assert.equal(cbeRes.account, '1000012345678');

  const dashenRes = extractPaymentDetails({ transactionAmount: 300 }, 'dashen');
  assert.equal(dashenRes.amount, 300);
  assert.equal(dashenRes.account, null);
});

test('plans config: computes correct tier quotas and limits', () => {
  const cfg = DEFAULT_BILLING_CONFIG;

  assert.equal(getVerificationMonthlyQuota('FREE', false, cfg), 100);
  assert.equal(getVerificationMonthlyQuota('FREE', true, cfg), 250);
  assert.equal(getVerificationMonthlyQuota('PRO', false, cfg), 2000);
  assert.equal(getVerificationMonthlyQuota('BUSINESS', false, cfg), 50000);

  assert.equal(getMonthlyImageCredits('FREE', cfg), 0);
  assert.equal(getMonthlyImageCredits('PRO', cfg), 100);
  assert.equal(getMonthlyImageCredits('BUSINESS', cfg), 300);

  assert.equal(getWebhookLimit('FREE', cfg), 0);
  assert.equal(getWebhookLimit('PRO', cfg), 20);
  assert.equal(getWebhookLimit('BUSINESS', cfg), 50);

  assert.equal(getNotificationChannelLimit('FREE', cfg), 0);
  assert.equal(getNotificationChannelLimit('PRO', cfg), 0);
  assert.equal(getNotificationChannelLimit('BUSINESS', cfg), 20);

  assert.equal(getBatchMaxReferences('FREE', cfg), 0);
  assert.equal(getBatchMaxReferences('PRO', cfg), 20);
  assert.equal(getBatchMaxReferences('BUSINESS', cfg), 100);

  assert.equal(getRateLimit('FREE', false, cfg), 10);
  assert.equal(getRateLimit('FREE', true, cfg), 30);
  assert.equal(getRateLimit('PRO', false, cfg), 60);
  assert.equal(getRateLimit('BUSINESS', false, cfg), 300);
});

test('runSmartVerify: routes Dashen text receipts accurately', async () => {
  const ref = '3123456789012345';
  const receiptText = `Dashen Bank Transaction Reference: ${ref} Sender Name: John Doe Receiver Name: Jane Smith Transaction Amount: 500.00 Transaction Date: 2026-08-27 10:30:00 AM`;
  const res = await runSmartVerify({ reference: ref, receiptText });

  assert.equal(res.success, true);
  assert.equal(res.provider, 'DASHEN');
  assert.equal(res.httpStatus, 200);
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

test('runSmartVerify: routes Bank of Abyssinia text receipts accurately', async () => {
  const ref = 'FTABCDEFGHIJ';
  const receiptText = `Bank of Abyssinia Transaction Reference: ${ref} Payer's Name: John Doe Transferred Amount: 750.00 Transaction Date: 2026-08-27 10:30:00 AM Narrative: Invoice payment`;
  const res = await runSmartVerify({ reference: ref, receiptText });

  assert.equal(res.success, true);
  assert.equal(res.provider, 'ABYSSINIA');
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

test('runSmartVerify: routes CBE Birr text receipts accurately with phoneNumber', async () => {
  const ref = 'AB12CD34EF';
  const receiptText = `CBE Birr Receipt Number: ${ref} Customer Name: John Doe Paid Amount: 1,200.00 Transaction Date: 2026-08-27 10:30:00 AM Transaction Status: Completed`;
  const res = await runSmartVerify({ reference: ref, phoneNumber: '251912345678', receiptText });

  assert.equal(res.success, true);
  assert.equal(res.provider, 'CBE_BIRR');
  assert.equal(res.httpStatus, 200);
});

test('runSmartVerify: rejects invalid reference length', async () => {
  const res = await runSmartVerify({ reference: 'INVALID' });
  assert.equal(res.success, false);
  assert.equal(res.httpStatus, 400);
  assert.match(res.error ?? '', /Invalid reference length/);
});
