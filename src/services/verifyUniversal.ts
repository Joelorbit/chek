import { verifyCBE, verifyCBEFromText } from './verifyCBE';
import { verifyTelebirr, verifyTelebirrFromText } from './verifyTelebirr';
import logger from '../utils/logger';
import { extractLegacyCbeUrlData, isNewCbeReference } from '../utils/cbeReference';

export interface SmartVerifyInput {
  reference?: string;
  suffix?: string;
  phoneNumber?: string;
  receiptText?: string;
  fullText?: string;
  apiKey?: string;
}

export type SmartVerifyProvider = 'TELEBIRR' | 'CBE';

export interface SmartVerifyResult {
  success: boolean;
  data?: any;
  error?: string;
  details?: unknown;
  provider?: SmartVerifyProvider;
  httpStatus: number;
}

export async function runSmartVerify(input: SmartVerifyInput): Promise<SmartVerifyResult> {
  const { suffix } = input;
  const rawText = (typeof input.receiptText === 'string' && input.receiptText.trim())
    ? input.receiptText.trim()
    : (typeof input.fullText === 'string' && input.fullText.trim())
      ? input.fullText.trim()
      : null;

  let trimmedRef = (input.reference || '').trim();

  // If reference itself is multi-word / full text, treat it as receiptText
  if (!rawText && trimmedRef.includes(' ') && trimmedRef.length > 20) {
    return runSmartVerify({ receiptText: trimmedRef, suffix });
  }

  // ── 1. RECEIPT TEXT / SMS PROCESSING ─────────────────────────────────────────
  if (rawText) {
    const textLower = rawText.toLowerCase();

    // Auto-detect CBE vs Telebirr from text
    const isCBE = /commercial\s+bank\s+of\s+ethiopia|cbe|\bft[a-z0-9]{10}\b|vat\s+invoice/i.test(textLower);
    const isTelebirr = /telebirr|ethiotelecom|ethio\s+telecom|\b[a-z0-9]{10}\b/i.test(textLower);

    if (isCBE) {
      // Extract reference from text if reference was empty
      if (!trimmedRef) {
        const refMatch = rawText.match(/\b(FT[A-Za-z0-9]{10})\b/i)
          || rawText.match(/(?:reference\s+no\.?|ref(?:\s+no)?\.?)\s*[:\-]?\s*([A-Za-z0-9]+)/i);
        if (refMatch) trimmedRef = refMatch[1];
      }

      const result = verifyCBEFromText(trimmedRef || 'CBE_RECEIPT', rawText);
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'CBE receipt verification failed.',
          httpStatus: 422,
          provider: 'CBE',
        };
      }
      return {
        success: true,
        data: result,
        httpStatus: 200,
        provider: 'CBE',
      };
    }

    // Default to Telebirr for text
    if (!trimmedRef) {
      const refMatch = rawText.match(/\b([A-Za-z0-9]{10})\b/i);
      if (refMatch) trimmedRef = refMatch[1];
    }

    const result = verifyTelebirrFromText(trimmedRef || 'TELEBIRR_RECEIPT', rawText);
    if (!result) {
      return {
        success: false,
        error: 'Could not extract valid payment details from Telebirr receipt text.',
        httpStatus: 422,
        provider: 'TELEBIRR',
      };
    }
    return {
      success: true,
      data: result,
      httpStatus: 200,
      provider: 'TELEBIRR',
    };
  }

  // ── 2. REFERENCE-ONLY VERIFICATION ──────────────────────────────────────────
  if (!trimmedRef) {
    return {
      success: false,
      error: 'Missing reference number or receipt text for verification.',
      httpStatus: 400,
    };
  }

  const isNewCBE = isNewCbeReference(trimmedRef);
  const legacyCbeLink = extractLegacyCbeUrlData(trimmedRef);
  const isLegacyCBERef = trimmedRef.toUpperCase().startsWith('FT') && trimmedRef.length === 12;

  // A. CBE: New Mobile App Token / URL
  if (isNewCBE) {
    const result = await verifyCBE(trimmedRef);
    if (!result.success) {
      return {
        success: false,
        error: result.error || 'CBE token verification failed.',
        httpStatus: result.statusCode || 404,
        provider: 'CBE',
      };
    }
    return { success: true, data: result, httpStatus: 200, provider: 'CBE' };
  }

  // B. CBE: Legacy FT Reference / URL with Suffix
  if (legacyCbeLink || isLegacyCBERef) {
    const result = await verifyCBE(trimmedRef, suffix);
    if (!result.success) {
      return {
        success: false,
        error: result.error || 'CBE verification failed.',
        httpStatus: result.statusCode || 400,
        provider: 'CBE',
      };
    }
    return { success: true, data: result, httpStatus: 200, provider: 'CBE' };
  }

  // C. Telebirr: 10-character alphanumeric Reference ID
  if (trimmedRef.length === 10 && /^[A-Za-z0-9]{10}$/.test(trimmedRef)) {
    const result = await verifyTelebirr(trimmedRef);
    if (!result) {
      return {
        success: false,
        error: `Telebirr receipt not found for reference "${trimmedRef}" on Ethio Telecom portal. Or provide the SMS receipt text.`,
        httpStatus: 404,
        provider: 'TELEBIRR',
      };
    }
    return { success: true, data: result, httpStatus: 200, provider: 'TELEBIRR' };
  }

  return {
    success: false,
    error: 'Unrecognized reference format. Expected 10-char Telebirr reference (e.g. AB12CD34EF) or CBE reference (e.g. FT... with suffix or mobile token).',
    httpStatus: 400,
  };
}
