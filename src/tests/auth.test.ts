import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerMerchant,
  loginMerchant,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  processSubscriptionPayment,
  createPasswordResetToken,
  resetPasswordWithToken,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASS,
} from '../services/authService';

test('auth: password hashing with scrypt and salt', () => {
  const password = 'StrongPassword123!';
  const hash = hashPassword(password);
  assert.ok(hash.includes(':'));
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword('WrongPassword', hash), false);
});

test('auth: JWT token signing and verification', () => {
  const payload = { id: 'test-user-123', email: 'merchant@domain.et', role: 'merchant' };
  const token = signToken(payload, 24);
  assert.equal(typeof token, 'string');

  const decoded = verifyToken(token);
  assert.ok(decoded);
  assert.equal(decoded?.id, 'test-user-123');
  assert.equal(decoded?.email, 'merchant@domain.et');
});

test('auth: single super admin login with abitieyuel@gmail.com / Joelget@4', async () => {
  const res = await loginMerchant(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASS);
  assert.ok(res.merchant);
  assert.equal(res.merchant.email, SUPER_ADMIN_EMAIL);
  assert.equal(res.merchant.role, 'super_admin');
  assert.equal(res.merchant.plan, 'unlimited');
  assert.ok(res.token);
});

test('auth: merchant registration produces instant API key and JWT session', async () => {
  const email = `merchant_${Date.now()}@domain.et`;
  const password = 'SecurePassword987!';
  const businessName = 'Addis Tech Store';

  const res = await registerMerchant({ email, password, businessName });
  assert.ok(res.merchant);
  assert.equal(res.merchant.email, email);
  assert.equal(res.merchant.businessName, businessName);
  assert.ok(res.token);
  assert.ok(res.rawApiKey.startsWith('sk_live_'));

  // Test logging in with newly created merchant credentials
  const loginRes = await loginMerchant(email, password);
  assert.ok(loginRes.merchant);
  assert.equal(loginRes.merchant.email, email);
  assert.ok(loginRes.token);
});

test('auth: forgot password token workflow resets password safely', async () => {
  const email = `forgot_test_${Date.now()}@domain.et`;
  await registerMerchant({ email, password: 'InitialPassword123!' });

  const tokenRes = await createPasswordResetToken(email);
  assert.equal(tokenRes.success, true);
  assert.ok(tokenRes.resetToken);

  const resetRes = await resetPasswordWithToken(email, tokenRes.resetToken!, 'NewSecurePassword456!');
  assert.equal(resetRes.success, true);

  // Sign in with new password
  const newLogin = await loginMerchant(email, 'NewSecurePassword456!');
  assert.ok(newLogin.merchant);
});

test('auth: process 4,000 ETB Unlimited subscription payment upgrade', async () => {
  const email = `sub_test_${Date.now()}@domain.et`;
  const reg = await registerMerchant({ email, password: 'StrongPassword456!' });

  const subRes = await processSubscriptionPayment({
    merchantId: reg.merchant.id,
    plan: 'unlimited',
    billingCycle: 'monthly',
    amount: 4000,
    provider: 'TELEBIRR',
    reference: 'DHS78S7FQN',
  });

  assert.equal(subRes.success, true);
  assert.equal(subRes.subscription.plan, 'unlimited');
  assert.equal(subRes.subscription.amount, '4000.00');
  assert.equal(subRes.subscription.currency, 'ETB');
});
