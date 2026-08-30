import { verifyCBE, verifyCBEFromText } from './verifyCBE';
import { verifyTelebirr, verifyTelebirrFromText } from './verifyTelebirr';
import logger from '../utils/logger';
import { extractLegacyCbeUrlData, isNewCbeReference, extractNewCbeToken } from '../utils/cbeReference';

export interface SmartVerifyInput {
  reference?: string;
  suffix?: string;
  phoneNumber?: string;
  receiptText?: string;
  fullText?: string;
  input?: string;
  apiKey?: string;
}

export type SmartVerifyProvider = 'TELEBIRR' | 'CBE';

export interface SmartVerifyResult {
  success: boolean;
  data?: any;
  error?: string;
  details?: unknown;
  provider?: SmartVerifyProvider;
  verificationMode?: 'LIVE_ETHIO_TELECOM' | 'LIVE_CBE_API' | 'LIVE_CBE_LEGACY' | 'TEXT_PARSER';
  httpStatus: number;
}

const COMMON_NON_REF_WORDS = new Set([
  'COMMERCIAL', 'TRANSACTION', 'ADDITIONAL', 'REGISTERED',
  'COMPLETED', 'CREDENTIAL', 'SETTLEMENT', 'MANAGEMENT',
  'TRANSFERRED', 'INFORMATION', 'NOTIFICATION', 'VERIFICATION'
]);

/**
 * Extracts candidate payment references, tokens, and URLs from any raw string
 */
export function extractCandidateMetadata(rawInput: string): {
  telebirrRef?: string;
  cbeToken?: string;
  cbeFtRef?: string;
  cbeSuffix?: string;
  isText: boolean;
  isCbeText: boolean;
  isTelebirrText: boolean;
} {
  const input = rawInput.trim();
  const isText = input.includes(' ') || input.includes('\n') || input.length > 30;
  const lower = input.toLowerCase();

  const isCbeText = /commercial\s+bank\s+of\s+ethiopia|\bcbe\b|vat\s+invoice|\bft[a-z0-9]{10,14}\b/i.test(lower);
  const isTelebirrText = /telebirr|ethiotelecom|ethio\s+telecom/i.test(lower);

  // 1. Check for Telebirr URL
  const telebirrUrlMatch = input.match(/transactioninfo\.ethiotelecom\.et\/receipt\/([A-Za-z0-9]{10})/i)
    || input.match(/telebirr\.et[^\s]*\/([A-Za-z0-9]{10})/i);
  const telebirrRef = telebirrUrlMatch ? telebirrUrlMatch[1].toUpperCase() : undefined;

  // 2. Check for CBE Token / URL (20 chars)
  const cbeUrlMatch = input.match(/mbreciept\.cbe\.com\.et\/([A-Za-z0-9]{20})/i)
    || input.match(/mb\.cbe\.com\.et[^\s]*\/([A-Za-z0-9]{20})/i)
    || input.match(/[?&]token=([A-Za-z0-9]{20})/i);
  const cbeToken = cbeUrlMatch ? cbeUrlMatch[1] : extractNewCbeToken(input) || (input.length === 20 && /^[A-Za-z0-9]{20}$/.test(input) ? input : undefined);

  // 3. Check for CBE FT Reference (FT + 10 to 14 chars)
  const legacyCbe = extractLegacyCbeUrlData(input);
  const combinedCbe = input.match(/^(FT[A-Za-z0-9]{10})(\d{8})$/i);
  const ftMatch = input.match(/\b(FT[A-Za-z0-9]{10,14})\b/i)
    || input.match(/(?:reference\s+no\.?|ref(?:\s+no)?\.?)\s*[:\-]?\s*(FT[A-Za-z0-9]+)/i);

  let cbeFtRef: string | undefined;
  let cbeSuffix: string | undefined;

  if (legacyCbe) {
    cbeFtRef = legacyCbe.reference;
    cbeSuffix = legacyCbe.suffix;
  } else if (combinedCbe) {
    cbeFtRef = combinedCbe[1].toUpperCase();
    cbeSuffix = combinedCbe[2];
  } else if (ftMatch) {
    cbeFtRef = ftMatch[1].toUpperCase();
    const suffixMatch = input.match(/\b(\d{8})\b/);
    if (suffixMatch) cbeSuffix = suffixMatch[1];
  } else if (isCbeText && !cbeFtRef) {
    const genericRef = input.match(/(?:reference\s+no\.?|ref(?:\s+no)?\.?)\s*[:\-]?\s*([A-Za-z0-9]+)/i);
    if (genericRef) cbeFtRef = genericRef[1].toUpperCase();
  }

  // 4. Fallback Telebirr 10-char reference match (only if not CBE text)
  let fallbackTelebirr = telebirrRef;
  if (!fallbackTelebirr && !cbeToken && !cbeFtRef && !isCbeText) {
    if (input.length === 10 && /^[A-Za-z0-9]{10}$/.test(input) && !COMMON_NON_REF_WORDS.has(input.toUpperCase())) {
      fallbackTelebirr = input.toUpperCase();
    } else {
      const allMatches = input.match(/\b([A-Za-z0-9]{10})\b/g) || [];
      for (const m of allMatches) {
        const u = m.toUpperCase();
        if (!u.startsWith('FT') && !COMMON_NON_REF_WORDS.has(u)) {
          fallbackTelebirr = u;
          break;
        }
      }
    }
  }

  return {
    telebirrRef: fallbackTelebirr,
    cbeToken,
    cbeFtRef,
    cbeSuffix,
    isText,
    isCbeText,
    isTelebirrText,
  };
}

/**
 * Universal Server-Side Verification Engine
 */
export async function runSmartVerify(input: SmartVerifyInput): Promise<SmartVerifyResult> {
  const textBody = (typeof input.receiptText === 'string' && input.receiptText.trim())
    ? input.receiptText.trim()
    : (typeof input.fullText === 'string' && input.fullText.trim())
      ? input.fullText.trim()
      : '';

  const rawInput = textBody
    ? (input.reference && !textBody.includes(input.reference) ? `${input.reference} ${textBody}` : textBody)
    : (input.input || input.reference || '').trim();

  const explicitSuffix = input.suffix?.trim();

  if (!rawInput) {
    return {
      success: false,
      error: 'Missing verification input. Provide a transaction reference ID, CBE token, or receipt text.',
      httpStatus: 400,
    };
  }

  const meta = extractCandidateMetadata(rawInput);
  const effectiveSuffix = explicitSuffix || meta.cbeSuffix;

  // ─── 1. CBE TOKEN VERIFICATION (Live CBE API) ──────────────────────────────
  if (meta.cbeToken) {
    logger.info(`[SERVER-VERIFY] Querying official CBE Live API for token: ${meta.cbeToken}`);
    const cbeResult = await verifyCBE(meta.cbeToken);

    if (cbeResult && cbeResult.success) {
      return {
        success: true,
        data: cbeResult,
        provider: 'CBE',
        verificationMode: 'LIVE_CBE_API',
        httpStatus: 200,
      };
    }

    if (!meta.isText) {
      return {
        success: false,
        error: cbeResult.error || `CBE transaction token "${meta.cbeToken}" not found on official Commercial Bank of Ethiopia portal.`,
        httpStatus: cbeResult.statusCode || 404,
        provider: 'CBE',
      };
    }
  }

  // ─── 2. CBE FT REFERENCE OR CBE TEXT ────────────────────────────────────────
  if (meta.cbeFtRef || meta.isCbeText) {
    const targetRef = meta.cbeFtRef || 'CBE_RECEIPT';
    logger.info(`[SERVER-VERIFY] Processing CBE Reference: ${targetRef}`);

    // If receipt text is present, extract structured fields from text
    if (meta.isText) {
      const textRes = verifyCBEFromText(targetRef, rawInput);
      if (textRes && textRes.success) {
        return {
          success: true,
          data: textRes,
          provider: 'CBE',
          verificationMode: 'TEXT_PARSER',
          httpStatus: 200,
        };
      }
    }

    if (effectiveSuffix && meta.cbeFtRef) {
      const cbeLegacyRes = await verifyCBE(meta.cbeFtRef, effectiveSuffix);
      if (cbeLegacyRes && cbeLegacyRes.success) {
        return {
          success: true,
          data: cbeLegacyRes,
          provider: 'CBE',
          verificationMode: 'LIVE_CBE_LEGACY',
          httpStatus: 200,
        };
      }
    }

    if (!meta.isText && meta.cbeFtRef) {
      return {
        success: false,
        error: `CBE reference "${meta.cbeFtRef}" requires the 8-digit credited account suffix or receipt text for verification.`,
        httpStatus: 400,
        provider: 'CBE',
      };
    }
  }

  // ─── 3. TELEBIRR VERIFICATION ───────────────────────────────────────────────
  if (meta.telebirrRef || meta.isTelebirrText) {
    const targetRef = meta.telebirrRef || 'TELEBIRR_RECEIPT';
    logger.info(`[SERVER-VERIFY] Processing Telebirr reference: ${targetRef}`);

    // If receipt text is provided, parse locally
    if (meta.isText) {
      const textTelebirr = verifyTelebirrFromText(targetRef, rawInput);
      if (textTelebirr && textTelebirr.settledAmount) {
        return {
          success: true,
          data: textTelebirr,
          provider: 'TELEBIRR',
          verificationMode: 'TEXT_PARSER',
          httpStatus: 200,
        };
      }
    }

    // Attempt live Ethio Telecom portal lookup
    if (meta.telebirrRef) {
      const liveTelebirr = await verifyTelebirr(meta.telebirrRef);
      if (liveTelebirr && (liveTelebirr.receiptNo || liveTelebirr.settledAmount)) {
        return {
          success: true,
          data: liveTelebirr,
          provider: 'TELEBIRR',
          verificationMode: 'LIVE_ETHIO_TELECOM',
          httpStatus: 200,
        };
      }
    }

    return {
      success: false,
      error: `Telebirr transaction "${targetRef}" was not found on the official Ethio Telecom portal (transactioninfo.ethiotelecom.et).`,
      httpStatus: 404,
      provider: 'TELEBIRR',
    };
  }

  // ─── 4. PURE TEXT FALLBACK ──────────────────────────────────────────────────
  if (meta.isText) {
    const teleText = verifyTelebirrFromText('TELEBIRR_RECEIPT', rawInput);
    if (teleText && teleText.settledAmount) {
      return {
        success: true,
        data: teleText,
        provider: 'TELEBIRR',
        verificationMode: 'TEXT_PARSER',
        httpStatus: 200,
      };
    }
  }

  return {
    success: false,
    error: 'Unrecognized payment reference format. Provide a 10-char Telebirr ID (e.g. DHS78S7FQN), CBE token (e.g. hfHCxGIt9KKGN61d55FL), or full receipt text.',
    httpStatus: 400,
  };
}
