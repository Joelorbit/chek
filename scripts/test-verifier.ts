import dotenv from 'dotenv';
dotenv.config();

import { verifyCBE, verifyCBEFromText } from '../src/services/verifyCBE';
import { verifyTelebirr, verifyTelebirrFromText } from '../src/services/verifyTelebirr';
import { runSmartVerify } from '../src/services/verifyUniversal';
import { extractNewCbeToken, isNewCbeReference, extractLegacyCbeUrlData } from '../src/utils/cbeReference';

export type DetectedProvider = 'TELEBIRR' | 'CBE' | 'UNKNOWN';

export interface DetectionResult {
  provider: DetectedProvider;
  reference: string;
  suffix?: string;
  receiptText?: string;
  patternName: string;
}

export function detectProviderPattern(rawInput: string, explicitSuffix?: string, explicitText?: string): DetectionResult {
  const input = rawInput.trim();
  const text = explicitText?.trim() || (input.includes(' ') && input.length > 15 ? input : '');

  // 1. Text-based detection
  if (text) {
    const lower = text.toLowerCase();
    if (/commercial\s+bank\s+of\s+ethiopia|cbe|\bft[a-z0-9]{10}\b|vat\s+invoice/i.test(lower)) {
      const refMatch = text.match(/\b(FT[A-Za-z0-9]{10})\b/i);
      return {
        provider: 'CBE',
        reference: refMatch ? refMatch[1] : (input.length <= 15 ? input : 'CBE_RECEIPT'),
        suffix: explicitSuffix,
        receiptText: text,
        patternName: 'Commercial Bank of Ethiopia (CBE Receipt Text / SMS)',
      };
    }

    const refMatch = text.match(/\b([A-Za-z0-9]{10})\b/i);
    return {
      provider: 'TELEBIRR',
      reference: refMatch ? refMatch[1] : (input.length === 10 ? input : 'TELEBIRR_RECEIPT'),
      receiptText: text,
      patternName: 'Ethio Telecom Telebirr (SMS / Receipt Text)',
    };
  }

  // 2. Reference ID Patterns
  // 2a. CBE New Mobile Token / URL
  const newCbeToken = extractNewCbeToken(input);
  if (newCbeToken || isNewCbeReference(input)) {
    return {
      provider: 'CBE',
      reference: newCbeToken || input,
      patternName: 'CBE (New Mobile App Receipt Token / URL)',
    };
  }

  // 2b. CBE Legacy URL
  const legacyCbeData = extractLegacyCbeUrlData(input);
  if (legacyCbeData) {
    return {
      provider: 'CBE',
      reference: legacyCbeData.reference,
      suffix: legacyCbeData.suffix,
      patternName: 'CBE (Legacy Receipt Link with 8-digit suffix)',
    };
  }

  // 2c. Combined CBE reference (FT... + 8 digits)
  const combinedCbe = input.match(/^(FT[A-Za-z0-9]{10})(\d{8})$/i);
  if (combinedCbe) {
    return {
      provider: 'CBE',
      reference: combinedCbe[1].toUpperCase(),
      suffix: combinedCbe[2],
      patternName: 'CBE (12-char FT reference + 8-digit suffix)',
    };
  }

  // 2d. CBE FT Reference (12 chars)
  if (/^FT[A-Za-z0-9]{10}$/i.test(input)) {
    return {
      provider: 'CBE',
      reference: input.toUpperCase(),
      suffix: explicitSuffix,
      patternName: 'CBE Legacy (12-char FT reference)',
    };
  }

  // 2e. Telebirr Reference (10 alphanumeric chars)
  if (/^[A-Za-z0-9]{10}$/.test(input)) {
    return {
      provider: 'TELEBIRR',
      reference: input.toUpperCase(),
      patternName: 'Telebirr (10-character alphanumeric transaction reference)',
    };
  }

  return {
    provider: 'UNKNOWN',
    reference: input,
    patternName: 'Unrecognized Reference Format',
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);

  const getArg = (flag: string): string | undefined => {
    const idx = rawArgs.indexOf(flag);
    if (idx !== -1 && idx + 1 < rawArgs.length) return rawArgs[idx + 1];
    return undefined;
  };

  let explicitRef = getArg('--ref') || getArg('-r');
  let explicitSuffix = getArg('--suffix') || getArg('-s');
  let explicitText = getArg('--text') || getArg('-t');

  const positional = rawArgs.filter(
    (a, i) => !a.startsWith('-') && (i === 0 || !rawArgs[i - 1]?.startsWith('-'))
  );

  if (!explicitRef && positional.length > 0 && positional[0]) {
    explicitRef = positional.join(' ');
    if (!explicitSuffix && positional.length > 1 && positional[1].length === 8 && /^\d{8}$/.test(positional[1])) {
      explicitRef = positional[0];
      explicitSuffix = positional[1];
    }
  }

  console.log('\n================================================================');
  console.log('   🧾 CHEK — TELEBIRR & CBE PAYMENT VERIFIER CLI');
  console.log('================================================================\n');

  if (!explicitRef && !explicitText) {
    console.log('💡 Supported Inputs:\n');
    console.log('  1. Telebirr SMS or Receipt Text:');
    console.log('     pnpm verify-cli "Telebirr Reference: AB12CD34EF Payer Name: John Doe Amount: 250.00 ETB"');
    console.log('     pnpm verify-cli "You have received 1500 ETB from Chala Lemma. Txn ID: TB98765432"');
    console.log('');
    console.log('  2. Telebirr Reference ID (Live lookup on Ethio Telecom):');
    console.log('     pnpm verify-cli AB12CD34EF');
    console.log('');
    console.log('  3. CBE Receipt Text / SMS:');
    console.log('     pnpm verify-cli "Commercial Bank of Ethiopia Payer: John Doe Amount: 1234.50 ETB Ref: FT1234567890"');
    console.log('');
    console.log('  4. CBE Mobile Token or Link:');
    console.log('     pnpm verify-cli 1234567890abcdef1234');
    console.log('     pnpm verify-cli "https://mbreciept.cbe.com.et/your-token"');
    console.log('');
    console.log('  5. CBE Legacy FT Reference + Suffix:');
    console.log('     pnpm verify-cli FT1234567890 12345678');
    console.log('\n================================================================\n');
    return;
  }

  const detection = detectProviderPattern(explicitRef || '', explicitSuffix, explicitText);

  console.log('📊 AUTO-IDENTIFICATION:');
  console.log(`  🎯 Provider     : ${detection.provider}`);
  console.log(`  🔎 Pattern      : ${detection.patternName}`);
  console.log(`  🔑 Reference Key: ${detection.reference}`);
  if (detection.suffix) {
    console.log(`  🔢 Account Suffix: ${detection.suffix}`);
  }
  console.log('----------------------------------------------------------------');

  console.log(`\n⏳ Verifying payment...`);
  const start = Date.now();

  try {
    const result = await runSmartVerify({
      reference: detection.reference,
      suffix: detection.suffix || explicitSuffix,
      receiptText: detection.receiptText || explicitText,
    });

    const duration = Date.now() - start;
    console.log(`⏱️ Duration: ${duration}ms\n`);

    console.log('📋 VERIFICATION RESULT:');
    console.log(JSON.stringify(result.data || result, null, 2));

    if (result.success) {
      console.log('\n✅ Verification SUCCEEDED!');
    } else {
      console.log(`\n❌ Verification FAILED: ${result.error || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error('\n💥 Verification error:', error.message || error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
