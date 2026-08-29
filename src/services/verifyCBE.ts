import puppeteer from 'puppeteer';
import axios, { AxiosResponse } from 'axios';
import pdf from 'pdf-parse';
import https from 'https';
import logger from '../utils/logger';
import { extractLegacyCbeUrlData, extractNewCbeToken } from '../utils/cbeReference';

export interface VerifyResult {
    success: boolean;
    payer?: string;
    payerAccount?: string;
    receiver?: string;
    receiverAccount?: string;
    amount?: number;
    date?: Date;
    reference?: string;
    reason?: string | null;
    error?: string;
    statusCode?: number;
    verificationMode?: string;
    receiptTextVerified?: boolean;
}

function titleCase(str: string): string {
    return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

interface CBETransactionResponse {
    id?: string;
    debitAccountHolder?: string;
    debitAccountNo?: string;
    creditAccountHolder?: string;
    creditAccountNo?: string;
    amountCredited?: string;
    dateTimes?: string[];
    paymentDetails?: string[];
}

function parseAmount(value?: string): number | undefined {
    const parsed = value ? Number.parseFloat(value.replace(/,/g, '')) : NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
}

function mapNewCBEReceipt(data: CBETransactionResponse): VerifyResult {
    return {
        success: true,
        payer: data.debitAccountHolder,
        payerAccount: data.debitAccountNo,
        receiver: data.creditAccountHolder,
        receiverAccount: data.creditAccountNo,
        amount: parseAmount(data.amountCredited),
        date: data.dateTimes?.[0] ? new Date(data.dateTimes[0]) : new Date(),
        reference: data.id,
        reason: data.paymentDetails?.join(' ') || null,
        verificationMode: 'LIVE_API',
    };
}

export async function verifyCBELegacy(
    reference: string,
    accountSuffix: string
): Promise<VerifyResult> {
    const fullId = `${reference}${accountSuffix}`;
    const url = `https://apps.cbe.com.et:100/?id=${fullId}`;
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    try {
        logger.info(`🔎 Attempting direct CBE legacy fetch: ${url}`);
        const response: AxiosResponse<ArrayBuffer> = await axios.get(url, {
            httpsAgent,
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'application/pdf'
            },
            timeout: 10000
        });

        logger.info('✅ Direct fetch success, parsing PDF');
        return await parseCBEReceipt(response.data);
    } catch (directErr: any) {
        logger.warn('⚠️ Direct fetch failed, falling back to Puppeteer:', directErr.message);

        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--ignore-certificate-errors',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
            });

            const page = await browser.newPage();
            let detectedPdfUrl: string | null = null;

            page.on('response', async (response) => {
                const contentType = response.headers()['content-type'];
                if (contentType?.includes('pdf')) {
                    detectedPdfUrl = response.url();
                    logger.info('🧾 PDF detected:', detectedPdfUrl);
                }
            });

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
            await new Promise(res => setTimeout(res, 4000));
            await browser.close();

            if (!detectedPdfUrl) {
                return { success: false, error: 'No PDF detected from CBE legacy portal.' };
            }

            const pdfRes = await axios.get(detectedPdfUrl, {
                httpsAgent,
                responseType: 'arraybuffer',
                timeout: 8000,
            });

            return await parseCBEReceipt(pdfRes.data);
        } catch (puppetErr: any) {
            logger.error('❌ Puppeteer failed:', puppetErr.message);
            if (browser) await browser.close();
            return {
                success: false,
                error: `Could not verify legacy CBE receipt: ${puppetErr.message}`
            };
        }
    }
}

export async function verifyCBENew(token: string): Promise<VerifyResult> {
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const url = `https://mb.cbe.com.et/api/v1/transactions/public/transaction-detail/${token}`;
    const maxRetries = 2;
    const retryDelayMs = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.info(`🔎 Attempting new CBE JSON fetch (${attempt}/${maxRetries}): ${url}`);
            const response = await axios.get<CBETransactionResponse>(url, {
                httpsAgent,
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Origin': 'https://mbreciept.cbe.com.et',
                    'Referer': 'https://mbreciept.cbe.com.et/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'x-app-id': process.env.CBE_APP_ID || 'd1292e42-7400-49de-a2d3-9731caa4c819',
                    'x-app-version': process.env.CBE_APP_VERSION || '0a01980b-9859-1369-8198-59f403820000'
                },
                timeout: 8000
            });

            return mapNewCBEReceipt(response.data);
        } catch (err: any) {
            const statusCode = err.response?.status;
            const isLastAttempt = attempt === maxRetries;

            if (statusCode === 404) {
                return {
                    success: false,
                    error: 'Invalid or expired CBE receipt token.',
                    statusCode: 404
                };
            }

            if (isLastAttempt) {
                return {
                    success: false,
                    error: 'CBE receipt service is currently unreachable.',
                    statusCode: 502
                };
            }

            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
    }

    return {
        success: false,
        error: 'CBE receipt service is currently unreachable.',
        statusCode: 502
    };
}

export async function verifyCBE(reference: string, accountSuffix?: string): Promise<VerifyResult> {
    const legacyLink = extractLegacyCbeUrlData(reference);
    if (legacyLink) {
        const resolvedSuffix = accountSuffix?.trim() || legacyLink.suffix;
        return verifyCBELegacy(legacyLink.reference, resolvedSuffix);
    }

    const token = extractNewCbeToken(reference);
    if (token) return verifyCBENew(token);

    if (!accountSuffix?.trim()) {
        return {
            success: false,
            error: 'Legacy CBE verification requires an 8-digit account suffix (e.g. FT1234567890 with suffix 12345678). Or use receipt text.',
            statusCode: 400
        };
    }
    return verifyCBELegacy(reference.trim(), accountSuffix.trim());
}

export function verifyCBEFromText(reference: string, receiptText: string): VerifyResult {
    const normalizedReference = reference.trim();
    const result = parseCBEReceiptText(receiptText);

    if (!result.success) return result;

    if (result.reference && result.reference.toUpperCase() !== normalizedReference.toUpperCase() && normalizedReference.length > 0) {
        return {
            success: false,
            error: 'Receipt text reference does not match the supplied reference.'
        };
    }

    return {
        ...result,
        reference: result.reference || normalizedReference,
        verificationMode: 'LOCAL_TEXT',
        receiptTextVerified: true,
    };
}

async function parseCBEReceipt(buffer: ArrayBuffer): Promise<VerifyResult> {
    try {
        const parsed = await pdf(Buffer.from(buffer));
        return parseCBEReceiptText(parsed.text);
    } catch (parseErr: any) {
        logger.error('❌ PDF parsing failed:', parseErr.message);
        return { success: false, error: 'Error parsing PDF data' };
    }
}

function parseCBEReceiptText(receiptText: string): VerifyResult {
    const rawText = receiptText.replace(/\s+/g, ' ').trim();

    // 1. Extract reference: e.g. "FT1234567890", "Reference No. (VAT Invoice No): FT1234567890", "Ref: FT1234567890"
    const referenceMatch = rawText.match(/(?:reference\s+no\.?(?:\s*\([^)]*\))?|vat\s+invoice\s+no\.?|ref(?:\s+no)?\.?|txn\s+id)\s*[:\-]?\s*([A-Za-z0-9]+)/i)?.[1]
      || rawText.match(/\b(FT[A-Za-z0-9]{10})\b/i)?.[1];

    // 2. Extract amount: e.g. "Transferred Amount: 1,234.50 ETB", "credited with ETB 1,234.50", "1,234.50 ETB"
    const amountMatch = rawText.match(/(?:transferred\s+amount|credited\s+with|amount|paid)\s*[:\-]?\s*(?:etb|birr)?\s*([\d,]+(?:\.\d{1,2})?)/i)
      || rawText.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:etb|birr)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : undefined;

    // 3. Extract payer: e.g. "Payer: John Doe Account", "by John Doe", "Payer Name: John Doe"
    let payerName = rawText.match(/Payer\s*:?\s*(.*?)\s+Account/i)?.[1]?.trim()
      || rawText.match(/(?:by|from|payer(?:\s+name)?\s*[:\-])\s*([A-Za-z][A-Za-z .'-]{2,}?)(?=[.,;]?\s+(?:ref|txn|on|at|account|amount)\b|[.,]|$)/i)?.[1]?.trim()
      || rawText.match(/(?:by|from|payer(?:\s+name)?\s*[:\-])\s*([A-Za-z][A-Za-z .'-]{2,})/i)?.[1]?.trim();

    // 4. Extract receiver
    let receiverName = rawText.match(/Receiver\s*:?\s*(.*?)\s+Account/i)?.[1]?.trim()
      || rawText.match(/(?:to|receiver(?:\s+name)?\s*[:\-])\s*([A-Za-z][A-Za-z .'-]{2,}?)(?=[.,;]?\s+(?:ref|txn|on|at|account|amount)\b|[.,]|$)/i)?.[1]?.trim()
      || rawText.match(/(?:to|receiver(?:\s+name)?\s*[:\-])\s*([A-Za-z][A-Za-z .'-]{2,})/i)?.[1]?.trim();

    // 5. Extract accounts
    const accountMatches = [...rawText.matchAll(/Account\s*:?\s*([A-Z0-9]?\*{3,4}\d{3,4}|\d{13,16})/gi)];
    const payerAccount = accountMatches?.[0]?.[1] || undefined;
    const receiverAccount = accountMatches?.[1]?.[1] || undefined;

    // 6. Extract date
    const dateRaw = rawText.match(/(?:payment\s+date\s*&?\s*time|date\s*&?\s*time|date)\s*:?\s*([\d\/:, ]+[APM]{2}|\d{2}[-/.]\d{2}[-/.]\d{4})/i)?.[1]?.trim();
    const date = dateRaw ? new Date(dateRaw) : new Date();

    const reason = rawText.match(/Reason\s*\/\s*Type of service\s*:?\s*(.*?)\s+(?:Transferred\s+Amount|amount)/i)?.[1]?.trim();

    payerName = payerName ? titleCase(payerName) : undefined;
    receiverName = receiverName ? titleCase(receiverName) : undefined;

    if (amount !== undefined && (referenceMatch || payerName)) {
        return {
            success: true,
            payer: payerName || 'Customer',
            payerAccount,
            receiver: receiverName || 'Merchant',
            receiverAccount,
            amount,
            date,
            reference: referenceMatch || 'CBE_RECEIPT',
            reason: reason || null,
            verificationMode: 'LOCAL_TEXT',
            receiptTextVerified: true,
        };
    }

    return {
        success: false,
        error: 'Could not extract reference or amount from CBE receipt text.'
    };
}
