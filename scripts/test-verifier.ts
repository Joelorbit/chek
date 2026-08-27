import dotenv from 'dotenv';
dotenv.config();

import { verifyCBE, verifyCBEFromText } from '../src/services/verifyCBE';
import { verifyTelebirr } from '../src/services/verifyTelebirr';
import { verifyAbyssinia } from '../src/services/verifyAbyssinia';
import { verifyDashen } from '../src/services/verifyDashen';
import { verifyCBEBirr } from '../src/services/verifyCBEBirr';
import { verifyMpesa } from '../src/services/verifyMpesa';
import { runSmartVerify } from '../src/services/verifyUniversal';
import { verifyProviderReceiptText, type LocalReceiptProvider } from '../src/services/verifyReceiptText';
import {
  extractNewCbeToken,
  isNewCbeReference,
  extractLegacyCbeUrlData,
} from '../src/utils/cbeReference';

export type DetectedProvider =
  | 'CBE'
  | 'TELEBIRR'
  | 'ABYSSINIA'
  | 'DASHEN'
  | 'CBE_BIRR'
  | 'MPESA'
  | 'AWASH'
  | 'COOP'
  | 'HIBRET'
  | 'ZEMEN'
  | 'NIB'
  | 'WEGAGEN'
  | 'AMHARA'
  | 'GENERIC_BANK'
  | 'UNKNOWN';

export interface DetectionResult {
  provider: DetectedProvider;
  reference: string;
  suffix?: string;
  patternName: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes?: string;
}

/**
 * Automatically detects the provider (CBE, Telebirr, Abyssinia, Dashen, Awash, Coop, etc.)
 * based on the ID, URL, or receipt text.
 */
export function detectProviderPattern(
  rawInput: string,
  explicitSuffix?: string,
  receiptText?: string
): DetectionResult {
  const input = rawInput.trim();

  // 1. Text-based detection if receipt text is supplied
  if (receiptText && receiptText.trim()) {
    const lowerText = receiptText.toLowerCase();
    if (/commercial\s+bank\s+of\s+ethiopia|cbe/i.test(lowerText) && !/cbe\s*birr/i.test(lowerText)) {
      return {
        provider: 'CBE',
        reference: input,
        suffix: explicitSuffix,
        patternName: 'Commercial Bank of Ethiopia (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/cbe\s*birr/i.test(lowerText)) {
      return {
        provider: 'CBE_BIRR',
        reference: input,
        patternName: 'CBE Birr (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/bank\s+of\s+abyssinia|abyssinia|boa/i.test(lowerText)) {
      return {
        provider: 'ABYSSINIA',
        reference: input,
        suffix: explicitSuffix,
        patternName: 'Bank of Abyssinia (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/dashen\s+bank|dashen/i.test(lowerText)) {
      return {
        provider: 'DASHEN',
        reference: input,
        patternName: 'Dashen Bank (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/telebirr|ethiotelecom|ethio\s+telecom/i.test(lowerText)) {
      return {
        provider: 'TELEBIRR',
        reference: input,
        suffix: explicitSuffix,
        patternName: 'Telebirr (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/safaricom|m-pesa|mpesa/i.test(lowerText)) {
      return {
        provider: 'MPESA',
        reference: input,
        patternName: 'Safaricom M-Pesa (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/awash\s+bank|awashbirr|awash/i.test(lowerText)) {
      return {
        provider: 'AWASH',
        reference: input,
        patternName: 'Awash Bank / AwashBirr (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/cooperative\s+bank\s+of\s+oromia|coop\s+bank|coopay|ebirr/i.test(lowerText)) {
      return {
        provider: 'COOP',
        reference: input,
        patternName: 'Cooperative Bank of Oromia (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/hibret\s+bank|united\s+bank/i.test(lowerText)) {
      return {
        provider: 'HIBRET',
        reference: input,
        patternName: 'Hibret Bank (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/zemen\s+bank/i.test(lowerText)) {
      return {
        provider: 'ZEMEN',
        reference: input,
        patternName: 'Zemen Bank (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/nib\s+bank|nib\s+international/i.test(lowerText)) {
      return {
        provider: 'NIB',
        reference: input,
        patternName: 'Nib International Bank (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/wegagen\s+bank/i.test(lowerText)) {
      return {
        provider: 'WEGAGEN',
        reference: input,
        patternName: 'Wegagen Bank (from receipt text)',
        confidence: 'HIGH',
      };
    }
    if (/amhara\s+bank/i.test(lowerText)) {
      return {
        provider: 'AMHARA',
        reference: input,
        patternName: 'Amhara Bank (from receipt text)',
        confidence: 'HIGH',
      };
    }
  }

  // 2. URL Patterns
  // 2a. New CBE Mobile Receipt URL
  const newCbeToken = extractNewCbeToken(input);
  if (newCbeToken && (input.startsWith('http://') || input.startsWith('https://'))) {
    return {
      provider: 'CBE',
      reference: newCbeToken,
      patternName: 'CBE (New Mobile Receipt URL: mbreciept.cbe.com.et)',
      confidence: 'HIGH',
    };
  }

  // 2b. Legacy CBE Receipt URL (apps.cbe.com.et:100/?id=FT...<8-digits>)
  const legacyCbeData = extractLegacyCbeUrlData(input);
  if (legacyCbeData) {
    return {
      provider: 'CBE',
      reference: legacyCbeData.reference,
      suffix: legacyCbeData.suffix,
      patternName: 'CBE (Legacy Receipt URL with embedded 8-digit suffix)',
      confidence: 'HIGH',
    };
  }

  // 2c. Telebirr Receipt URL (transactioninfo.ethiotelecom.et/receipt/<10-chars>)
  const telebirrUrlMatch = input.match(
    /^https?:\/\/transactioninfo\.ethiotelecom\.et\/receipt\/([A-Za-z0-9]{10})\/?$/i
  );
  if (telebirrUrlMatch && telebirrUrlMatch[1]) {
    return {
      provider: 'TELEBIRR',
      reference: telebirrUrlMatch[1].toUpperCase(),
      patternName: 'Telebirr (Receipt URL: transactioninfo.ethiotelecom.et)',
      confidence: 'HIGH',
    };
  }

  // 2d. Abyssinia API URL (cs.bankofabyssinia.com/api/onlineSlip/getDetails/?id=FT...<5-digits>)
  const abyssiniaUrlMatch = input.match(
    /^https?:\/\/cs\.bankofabyssinia\.com\/api\/onlineSlip\/getDetails\/\?id=(FT[A-Za-z0-9]{10})(\d{5})$/i
  );
  if (abyssiniaUrlMatch && abyssiniaUrlMatch[1] && abyssiniaUrlMatch[2]) {
    return {
      provider: 'ABYSSINIA',
      reference: abyssiniaUrlMatch[1].toUpperCase(),
      suffix: abyssiniaUrlMatch[2],
      patternName: 'Bank of Abyssinia (Online Slip URL with 5-digit suffix)',
      confidence: 'HIGH',
    };
  }

  // 3. Combined Reference strings (Reference concatenated with suffix)
  // 3a. Combined Abyssinia: 17 chars (12-char FT reference + 5 digits)
  const combinedAbyssiniaMatch = input.match(/^(FT[A-Za-z0-9]{10})(\d{5})$/i);
  if (combinedAbyssiniaMatch && combinedAbyssiniaMatch[1] && combinedAbyssiniaMatch[2]) {
    return {
      provider: 'ABYSSINIA',
      reference: combinedAbyssiniaMatch[1].toUpperCase(),
      suffix: combinedAbyssiniaMatch[2],
      patternName: 'Bank of Abyssinia (Combined 12-char FT + 5-digit suffix)',
      confidence: 'HIGH',
    };
  }

  // 3b. Combined CBE Legacy: 20 chars (12-char FT reference + 8 digits)
  const combinedCbeMatch = input.match(/^(FT[A-Za-z0-9]{10})(\d{8})$/i);
  if (combinedCbeMatch && combinedCbeMatch[1] && combinedCbeMatch[2]) {
    return {
      provider: 'CBE',
      reference: combinedCbeMatch[1].toUpperCase(),
      suffix: combinedCbeMatch[2],
      patternName: 'CBE (Combined 12-char FT + 8-digit suffix)',
      confidence: 'HIGH',
    };
  }

  // 4. Dashen Bank (16 digits/characters starting with 3 digits)
  if (input.length === 16 && /^\d{3}/.test(input)) {
    return {
      provider: 'DASHEN',
      reference: input,
      patternName: 'Dashen Bank (16-character reference)',
      confidence: 'HIGH',
    };
  }

  // 5. New CBE Mobile Token (15-40 chars, alphanumeric/hyphens, not starting with FT)
  if (!input.toUpperCase().startsWith('FT') && /^[A-Za-z0-9-]{15,40}$/.test(input)) {
    return {
      provider: 'CBE',
      reference: input,
      patternName: 'CBE (New Mobile Transaction Token / Hash)',
      confidence: 'HIGH',
    };
  }

  // 6. Telebirr Reference (Exact 10 alphanumeric characters)
  if (/^[A-Za-z0-9]{10}$/.test(input)) {
    return {
      provider: 'TELEBIRR',
      reference: input.toUpperCase(),
      patternName: 'Telebirr (10-character alphanumeric transaction reference)',
      confidence: 'HIGH',
    };
  }

  // 7. FT Reference (12 chars starting with "FT")
  if (/^FT[A-Za-z0-9]{10}$/i.test(input)) {
    const cleanRef = input.toUpperCase();
    const cleanSuffix = explicitSuffix?.trim();

    if (cleanSuffix) {
      if (cleanSuffix.length === 5 && /^\d{5}$/.test(cleanSuffix)) {
        return {
          provider: 'ABYSSINIA',
          reference: cleanRef,
          suffix: cleanSuffix,
          patternName: 'Bank of Abyssinia (12-char FT reference + 5-digit suffix)',
          confidence: 'HIGH',
        };
      }
      if (cleanSuffix.length === 8 && /^\d{8}$/.test(cleanSuffix)) {
        return {
          provider: 'CBE',
          reference: cleanRef,
          suffix: cleanSuffix,
          patternName: 'CBE Legacy (12-char FT reference + 8-digit suffix)',
          confidence: 'HIGH',
        };
      }
    }

    return {
      provider: 'UNKNOWN',
      reference: cleanRef,
      patternName: 'Ambiguous FT Reference (Used by both CBE and Bank of Abyssinia)',
      confidence: 'MEDIUM',
      notes:
        'Please provide an account suffix: 8 digits for CBE, or 5 digits for Bank of Abyssinia.',
    };
  }

  return {
    provider: 'UNKNOWN',
    reference: input,
    patternName: 'Unrecognized Pattern',
    confidence: 'LOW',
    notes: 'Reference does not match standard patterns for Ethiopian providers.',
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);

  const getArg = (flag: string): string | undefined => {
    const idx = rawArgs.indexOf(flag);
    if (idx !== -1 && idx + 1 < rawArgs.length) return rawArgs[idx + 1];
    return undefined;
  };

  let explicitProvider = getArg('--provider') || getArg('-p');
  let explicitRef = getArg('--ref') || getArg('--reference') || getArg('-r');
  let explicitSuffix = getArg('--suffix') || getArg('-s');
  let explicitText = getArg('--text') || getArg('-t');
  let explicitPhone = getArg('--phone');

  const positional = rawArgs.filter(
    (a, i) => !a.startsWith('-') && (i === 0 || !rawArgs[i - 1]?.startsWith('-'))
  );

  if (!explicitRef && positional.length > 0 && positional[0]) {
    explicitRef = positional[0];
    if (!explicitSuffix && positional.length > 1) {
      explicitSuffix = positional[1];
    }
  }

  console.log('\n================================================================');
  console.log('   🧾 CHEK — ETHIOPIAN PAYMENT VERIFICATION ENGINE & CLI');
  console.log('================================================================\n');

  if (!explicitRef && !explicitText) {
    console.log('💡 How to use:');
    console.log('  Simply pass any Reference / Token / URL and the CLI will auto-detect the bank!\n');
    console.log('  Supported Banks & Mobile Money:');
    console.log('   • Commercial Bank of Ethiopia (CBE)');
    console.log('   • Ethio Telecom Telebirr');
    console.log('   • Bank of Abyssinia (BoA)');
    console.log('   • Dashen Bank');
    console.log('   • CBE Birr');
    console.log('   • Safaricom M-Pesa');
    console.log('   • Awash Bank / AwashBirr');
    console.log('   • Cooperative Bank of Oromia (Coop / Coopay)');
    console.log('   • Hibret Bank');
    console.log('   • Zemen Bank / Nib Bank / Wegagen / Amhara Bank\n');
    console.log('  Examples:');
    console.log('  1. Telebirr:');
    console.log('     pnpm verify-cli AB12CD34EF');
    console.log('');
    console.log('  2. CBE (New Mobile App Token or Link):');
    console.log('     pnpm verify-cli 1234567890abcdef1234');
    console.log('     pnpm verify-cli "https://mbreciept.cbe.com.et/your-token"');
    console.log('');
    console.log('  3. Bank of Abyssinia (FT reference + 5-digit suffix):');
    console.log('     pnpm verify-cli FT23062669JJ 90172');
    console.log('     pnpm verify-cli FT23062669JJ90172');
    console.log('');
    console.log('  4. Dashen Bank (16-digit reference):');
    console.log('     pnpm verify-cli 3123456789012345');
    console.log('');
    console.log('  5. Instant Receipt Text Parsing:');
    console.log('     pnpm verify-cli AW12345678 --text "Awash Bank Amount: 500.00 ..."');
    console.log('\n================================================================\n');
    return;
  }

  // Run automatic pattern detection
  const detection = detectProviderPattern(
    explicitRef || '',
    explicitSuffix,
    explicitText
  );

  console.log('📊 PATTERN DETECTION:');
  console.log(`  🎯 Detected Provider : ${detection.provider}`);
  console.log(`  🔎 Pattern Type      : ${detection.patternName}`);
  console.log(`  🔑 Reference Key     : ${detection.reference}`);
  if (detection.suffix) {
    console.log(`  🔢 Extracted Suffix  : ${detection.suffix}`);
  }
  if (detection.notes) {
    console.log(`  ℹ️ Note              : ${detection.notes}`);
  }
  console.log('----------------------------------------------------------------');

  const resolvedProvider = (explicitProvider || detection.provider).toUpperCase();
  const ref = detection.reference;
  const suf = detection.suffix || explicitSuffix;

  if (resolvedProvider === 'UNKNOWN') {
    console.error('\n⚠️ Could not determine provider with certainty.');
    if (detection.notes) console.error(`  ${detection.notes}`);
    console.log('\nYou can explicitly specify the provider using --provider <cbe|telebirr|abyssinia|dashen|etc>');
    return;
  }

  console.log(`\n⏳ Running verification for ${resolvedProvider}...`);
  const start = Date.now();

  try {
    let result: any;

    if (explicitText) {
      if (resolvedProvider === 'CBE') {
        result = verifyCBEFromText(ref, explicitText);
      } else {
        result = verifyProviderReceiptText(resolvedProvider as LocalReceiptProvider, ref, explicitText);
      }
    } else if (resolvedProvider === 'CBE') {
      result = await verifyCBE(ref, suf);
    } else if (resolvedProvider === 'TELEBIRR') {
      result = await verifyTelebirr(ref);
    } else if (resolvedProvider === 'ABYSSINIA') {
      if (!suf) {
        console.error('❌ Bank of Abyssinia requires a 5-digit account suffix (e.g. pnpm verify-cli ' + ref + ' 90172)');
        return;
      }
      result = await verifyAbyssinia(ref, suf);
    } else if (resolvedProvider === 'DASHEN') {
      result = await verifyDashen(ref);
    } else if (resolvedProvider === 'CBE_BIRR') {
      if (!explicitPhone) {
        console.error('❌ CBE Birr live verification requires a phone number (--phone 251911223344)');
        return;
      }
      result = await verifyCBEBirr(ref, explicitPhone);
    } else if (resolvedProvider === 'MPESA') {
      result = await verifyMpesa(ref);
    } else {
      result = await runSmartVerify({ reference: ref, suffix: suf });
    }

    const duration = Date.now() - start;
    console.log(`⏱️ Duration: ${duration}ms\n`);

    console.log('📋 VERIFICATION RESULT:');
    console.log(JSON.stringify(result, null, 2));

    if (result?.success || result?.transactionStatus || result?.status === 'success') {
      console.log('\n✅ Verification SUCCEEDED!');
    } else {
      console.log('\n❌ Verification FAILED.');
    }
  } catch (error: any) {
    console.error('\n💥 Error executing verification:', error.message || error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
