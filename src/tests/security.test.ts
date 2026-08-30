import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqualString, escapeHtml, isValidEmail, validatePasswordStrength } from '../utils/security';
import { createRateLimiter, publicSandboxRateLimiter } from '../middleware/rateLimiter';
import { buildSignature } from '../queues/webhookQueue';

test('security: timingSafeEqualString compares strings safely', () => {
  assert.equal(timingSafeEqualString('secret_token_123', 'secret_token_123'), true);
  assert.equal(timingSafeEqualString('secret_token_123', 'secret_token_456'), false);
  assert.equal(timingSafeEqualString('secret_token_123', 'short'), false);
  assert.equal(timingSafeEqualString('', ''), true);
  assert.equal(timingSafeEqualString(null as any, 'secret'), false);
  assert.equal(timingSafeEqualString('secret', undefined as any), false);
});

test('security: escapeHtml prevents XSS payloads', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('Hello & "Goodbye" \'world\''), 'Hello &amp; &quot;Goodbye&quot; &#039;world&#039;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(12345), '12345');
});

test('security: isValidEmail validates format properly', () => {
  assert.equal(isValidEmail('user@chek.et'), true);
  assert.equal(isValidEmail('support.billing@domain.com'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('user@.com'), false);
  assert.equal(isValidEmail('@domain.com'), false);
  assert.equal(isValidEmail(''), false);
});

test('security: validatePasswordStrength enforces length', () => {
  assert.equal(validatePasswordStrength('short').valid, false);
  assert.equal(validatePasswordStrength('1234567').valid, false);
  assert.equal(validatePasswordStrength('password123').valid, true);
  assert.equal(validatePasswordStrength('StrongPassword2026!').valid, true);
});

test('security: anonymous sandbox rate limiter strictly enforces limit', () => {
  const limiter = createRateLimiter({
    windowMs: 1000,
    max: 3,
    skipAdmins: false,
  });

  const mockReq: any = { headers: { 'x-forwarded-for': '192.168.1.100' } };
  let statusCode = 200;
  const mockRes: any = {
    setHeader: () => {},
    status: (c: number) => { statusCode = c; return mockRes; },
    json: () => mockRes,
  };

  let calls = 0;
  const next = () => { calls++; };

  // First 3 requests should pass
  limiter(mockReq, mockRes, next);
  limiter(mockReq, mockRes, next);
  limiter(mockReq, mockRes, next);
  assert.equal(calls, 3);

  // 4th request must be rejected with HTTP 429
  limiter(mockReq, mockRes, next);
  assert.equal(statusCode, 429);
});

test('security: buildSignature produces valid HMAC-SHA256 digests', () => {
  const secret = 'whsec_test_secret_12345';
  const payload = { event: 'payment.verified', amount: 4000 };
  const sig1 = buildSignature(payload, secret);
  const sig2 = buildSignature(payload, secret);

  assert.equal(sig1, sig2);
  assert.equal(sig1.length, 64); // 256-bit hex digest
});
