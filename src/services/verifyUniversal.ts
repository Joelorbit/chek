/**
 * verifyUniversal.ts
 *
 * Shared smart-router logic. Called by both:
 *   - POST /verify        (verifyUniversalRoute.ts)
 *   - POST /verify-batch  (verifyBatch.ts)
 *
 * Returns a plain result object instead of writing to a response, so it can be
 * reused in any context (HTTP handler, batch loop, payment link confirm, etc.).
 */

import { verifyCBE, verifyCBEFromText } from './verifyCBE';
import { verifyTelebirr } from './verifyTelebirr';
import { verifyDashen } from './verifyDashen';
import { verifyAbyssinia } from './verifyAbyssinia';
import { verifyCBEBirr } from './verifyCBEBirr';
import { verifyProviderReceiptText } from './verifyReceiptText';
import logger from '../utils/logger';
import { extractLegacyCbeUrlData, isNewCbeReference } from '../utils/cbeReference';

export interface SmartVerifyInput {
  reference: string;
  suffix?: string;
  phoneNumber?: string;
  receiptText?: string;
  fullText?: string;
  /** Retained for caller compatibility; provider services do not receive it. */
  apiKey?: string;
}

export type SmartVerifyProvider =
  | 'CBE'
  | 'CBE_BIRR'
  | 'TELEBIRR'
  | 'DASHEN'
  | 'ABYSSINIA'
  | 'MPESA'
  | 'AWASH'
  | 'COOP'
  | 'HIBRET'
  | 'ZEMEN'
  | 'NIB'
  | 'WEGAGEN'
  | 'AMHARA'
  | 'GENERIC_BANK'
  | 'IMAGE';

export interface SmartVerifyResult {
  success: boolean;
  /** Present when success is true. Shape varies by provider. */
  data?: unknown;
  /** Present when success is false. */
  error?: string;
  details?: unknown;
  /**
   * Detected provider that handled (or attempted) this reference. Always set
   * when a provider is identified — including the new CBE token/URL form.
   * Undefined only for the very first "invalid reference length" rejection.
   */
  provider?: SmartVerifyProvider;
  /** Suggested HTTP status code for the caller to forward (default 200 on success). */
  httpStatus: number;
}

function toFailedProviderResult(
  provider: SmartVerifyProvider,
  result: unknown,
): SmartVerifyResult | null {
  if (!result || typeof result !== 'object') return null;

  const maybeFailure = result as { success?: boolean; error?: string; statusCode?: number };
  if (maybeFailure.success !== false) return null;

  return {
    success: false,
    error: maybeFailure.error ?? 'Verification failed.',
    httpStatus: maybeFailure.statusCode ?? 422,
    provider,
  };
}

export async function runSmartVerify(input: SmartVerifyInput): Promise<SmartVerifyResult> {
  const { suffix, phoneNumber } = input;
  const receiptText = typeof input.receiptText === 'string' ? input.receiptText : input.fullText;
  const trimmedRef = input.reference.trim();
  const len = trimmedRef.length;
  const isNewCBE = isNewCbeReference(trimmedRef);
  const legacyCbeLink = extractLegacyCbeUrlData(trimmedRef);

  // ── Receipt text routing for custom and other Ethiopian banks ───────────────
  if (receiptText?.trim()) {
    const textLower = receiptText.toLowerCase();

    if (/\b(awash|awashbirr)\b/i.test(textLower)) {
      const result = verifyProviderReceiptText('AWASH', trimmedRef, receiptText);
      const failure = toFailedProviderResult('AWASH', result);
      if (failure) return failure;
      return { success: true, data: result, httpStatus: 200, provider: 'AWASH' };
    }
    if (/\b(coop|cooperative\s+bank|coopay|ebirr)\b/i.test(textLower)) {
      const result = verifyProviderReceiptText('COOP', trimmedRef, receiptText);
      const failure = toFailedProviderResult('COOP', result);
      if (failure) return failure;
      return { success: true, data: result, httpStatus: 200, provider: 'COOP' };
    }
    if (/\b(hibret|united\s+bank)\b/i.test(textLower)) {
      const result = verifyProviderReceiptText('HIBRET', trimmedRef, receiptText);
      const failure = toFailedProviderResult('HIBRET', result);
      if (failure) return failure;
      return { success: true, data: result, httpStatus: 200, provider: 'HIBRET' };
    }
    if (/\b(zemen)\b/i.test(textLower)) {
      const result = verifyProviderReceiptText('ZEMEN', trimmedRef, receiptText);
      const failure = toFailedProviderResult('ZEMEN', result);
      if (failure) return failure;
      return { success: true, data: result, httpStatus: 200, provider: 'ZEMEN' };
    }
    if (/\b(nib\s+bank|nib\s+international)\b/i.test(textLower)) {
      const result = verifyProviderReceiptText('NIB', trimmedRef, receiptText);
      const failure = toFailedProviderResult('NIB', result);
      if (failure) return failure;
      return { success: true, data: result, httpStatus: 200, provider: 'NIB' };
    }
    if (/\b(wegagen)\b/i.test(textLower)) {
      const result = verifyProviderReceiptText('WEGAGEN', trimmedRef, receiptText);
      const failure = toFailedProviderResult('WEGAGEN', result);
      if (failure) return failure;
      return { success: true, data: result, httpStatus: 200, provider: 'WEGAGEN' };
    }
    if (/\b(amhara\s+bank)\b/i.test(textLower)) {
      const result = verifyProviderReceiptText('AMHARA', trimmedRef, receiptText);
      const failure = toFailedProviderResult('AMHARA', result);
      if (failure) return failure;
      return { success: true, data: result, httpStatus: 200, provider: 'AMHARA' };
    }
  }

  // ── Basic length check ──────────────────────────────────────────────────────
  if (!isNewCBE && !legacyCbeLink && len !== 10 && len !== 12 && len !== 16) {
    if (receiptText?.trim()) {
      const result = verifyProviderReceiptText('GENERIC_BANK', trimmedRef, receiptText);
      const failure = toFailedProviderResult('GENERIC_BANK', result);
      if (failure) return failure;
      return { success: true, data: result, httpStatus: 200, provider: 'GENERIC_BANK' };
    }
    return {
      success: false,
      error: 'Invalid reference length for automatic sorting.',
      httpStatus: 400,
    };
  }

  try {
    // ── Dashen Bank (16 chars, starts with 3 digits) ───────────────────────────
    if (len === 16 && /^\d{3}/.test(trimmedRef)) {
      if (receiptText?.trim()) {
        const result = verifyProviderReceiptText('DASHEN', trimmedRef, receiptText);
        const failure = toFailedProviderResult('DASHEN', result);
        if (failure) return failure;
        return { success: true, data: result, httpStatus: 200, provider: 'DASHEN' };
      }
      if (suffix || phoneNumber) {
        return {
          success: false,
          error: 'Dashen bank verification expects only a reference number. Exclude suffix and phoneNumber.',
          httpStatus: 400,
          provider: 'DASHEN',
        };
      }
      const result = await verifyDashen(trimmedRef);
      const failure = toFailedProviderResult('DASHEN', result);
      if (failure) return failure;
      return { success: true, data: result, httpStatus: 200, provider: 'DASHEN' };
    }

    // ── Legacy CBE receipt URL (contains FT reference + embedded suffix) ─────
    if (legacyCbeLink) {
      if (phoneNumber) {
        return {
          success: false,
          error: 'Legacy CBE receipt links do not use phoneNumber.',
          httpStatus: 400,
          provider: 'CBE',
        };
      }

      if (suffix && suffix.trim().length !== 8) {
        return {
          success: false,
          error: 'CBE suffix must be exactly 8 digits when provided.',
          httpStatus: 400,
          provider: 'CBE',
        };
      }

      const result = await verifyCBE(trimmedRef, suffix?.trim());
      const failure = toFailedProviderResult('CBE', result);
      if (failure) return failure;
      return { success: true, data: result, httpStatus: 200, provider: 'CBE' };
    }

    // ── CBE & Abyssinia (12 chars, starts with "FT") ───────────────────────────
    if (len === 12 && trimmedRef.toUpperCase().startsWith('FT')) {
      if (receiptText?.trim()) {
        const isAbyssiniaText = /\b(bank\s+of\s+abyssinia|abyssinia)\b/i.test(receiptText);
        const result = isAbyssiniaText
          ? verifyProviderReceiptText('ABYSSINIA', trimmedRef, receiptText)
          : verifyCBEFromText(trimmedRef, receiptText);
        const provider = isAbyssiniaText ? 'ABYSSINIA' : 'CBE';
        const failure = toFailedProviderResult(provider, result);
        if (failure) return failure;
        return { success: true, data: result, httpStatus: 200, provider };
      }

      if (!suffix) {
        return {
          success: false,
          error: 'Transactions starting with "FT" require a suffix (8 digits for CBE, 5 digits for Abyssinia).',
          httpStatus: 400,
        };
      }
      const trimmedSuffix = suffix.trim();
      if (trimmedSuffix.length === 8) {
        const result = await verifyCBE(trimmedRef, trimmedSuffix);
        const failure = toFailedProviderResult('CBE', result);
        if (failure) return failure;
        return { success: true, data: result, httpStatus: 200, provider: 'CBE' };
      } else if (trimmedSuffix.length === 5) {
        const result = await verifyAbyssinia(trimmedRef, trimmedSuffix);
        const failure = toFailedProviderResult('ABYSSINIA', result);
        if (failure) return failure;
        return { success: true, data: result, httpStatus: 200, provider: 'ABYSSINIA' };
      } else {
        return {
          success: false,
          error: 'Suffix must be exactly 8 digits (CBE) or 5 digits (Abyssinia).',
          httpStatus: 400,
        };
      }
    }

    // ── New CBE token / URL ───────────────────────────────────────────────────
    if (isNewCBE) {
      if (suffix || phoneNumber) {
        return {
          success: false,
          error: 'New CBE receipt verification expects only the token or receipt URL.',
          httpStatus: 400,
          provider: 'CBE',
        };
      }
      const result = await verifyCBE(trimmedRef);
      const failure = toFailedProviderResult('CBE', result);
      if (failure) return failure;
      return { success: true, data: result, httpStatus: 200, provider: 'CBE' };
    }

    // ── CBE Birr & Telebirr (10 alphanumeric chars) ───────────────────────────
    if (len === 10) {
      if (!/^[A-Za-z0-9]{10}$/.test(trimmedRef)) {
        return {
          success: false,
          error: '10-character reference must be alphanumeric.',
          httpStatus: 400,
        };
      }
      if (suffix) {
        return {
          success: false,
          error: 'Suffix is not expected for 10-character transactions.',
          httpStatus: 400,
        };
      }

      if (phoneNumber) {
        const trimmedPhone = phoneNumber.trim();
        if (!trimmedPhone.startsWith('251') || trimmedPhone.length > 12 || trimmedPhone.length < 10) {
          return {
            success: false,
            error: 'Invalid phone number format. Must start with 251 and be 12 digits long.',
            httpStatus: 400,
            provider: 'CBE_BIRR',
          };
        }
        const result = receiptText?.trim()
          ? verifyProviderReceiptText('CBE_BIRR', trimmedRef, receiptText)
          : await verifyCBEBirr(trimmedRef, trimmedPhone);
        const failure = toFailedProviderResult('CBE_BIRR', result);
        if (failure) return failure;
        return { success: true, data: result, httpStatus: 200, provider: 'CBE_BIRR' };
      } else {
        // Telebirr
        const result = receiptText?.trim()
          ? verifyProviderReceiptText('TELEBIRR', trimmedRef, receiptText)
          : await verifyTelebirr(trimmedRef);
        if (!result) {
          return {
            success: false,
            error: 'Receipt not found or could not be processed.',
            httpStatus: 404,
            provider: 'TELEBIRR',
          };
        }
        return { success: true, data: result, httpStatus: 200, provider: 'TELEBIRR' };
      }
    }

    return {
      success: false,
      error: 'The provided reference does not match any recognised provider format.',
      httpStatus: 400,
    };
  } catch (err: any) {
    logger.error('💥 runSmartVerify failed:', err);
    if (err.name === 'TelebirrVerificationError') {
      return {
        success: false,
        error: err.message,
        details: err.details,
        httpStatus: 502,
        provider: 'TELEBIRR',
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error during verification.',
      httpStatus: 500,
    };
  }
}
