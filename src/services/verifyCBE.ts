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
    provider?: string;
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
        provider: 'CBE',
    };
}

export async function verifyCBELegacy(
    reference: string,
    accountSuffix: string
): Promise<VerifyResult> {
    const fullId = `${reference}${accountSuffix}`;
    const url = `https://apps.cbe.com.et:100/?id=${fullId}`;
    const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

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

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(res => setTimeout(res, 4000));
            await browser.close();

            if (!detectedPdfUrl) {
                return { success: false, error: 'No PDF receipt detected for CBE transaction.' };
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
    const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
    const url = `https://mb.cbe.com.et/api/v1/transactions/public/transaction-detail/${token}`;
    const maxRetries = 2;
    const retryDelayMs = 800;

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

            if (response.data && (response.data.id || response.data.debitAccountHolder || response.data.amountCredited)) {
                return mapNewCBEReceipt(response.data);
            }
        } catch (err: any) {
            const statusCode = err.response?.status;
            const resData = err.response?.data;
            const detailMsg = resData?.detail || resData?.message || resData?.title || '';

            logger.warn(`⚠️ CBE verification attempt ${attempt}/${maxRetries} responded with status ${statusCode}: ${detailMsg || err.message}`);

            // If CBE server explicitly responds indicating invalid/expired/tampered token
            if (
                statusCode === 404 ||
                statusCode === 400 ||
                (statusCode === 500 && (
                    detailMsg.toLowerCase().includes('invalid') ||
                    detailMsg.toLowerCase().includes('tampered') ||
                    detailMsg.toLowerCase().includes('security alert') ||
                    detailMsg.toLowerCase().includes('not found') ||
                    detailMsg.toLowerCase().includes('expired')
                ))
            ) {
                return {
                    success: false,
                    error: detailMsg || 'Invalid, expired, or non-existent CBE receipt token.',
                    statusCode: 404,
                    provider: 'CBE'
                };
            }

            const isLastAttempt = attempt === maxRetries;
            if (isLastAttempt) {
                return {
                    success: false,
                    error: detailMsg || `CBE receipt service returned status ${statusCode || 502}. Provide the full SMS text or check the token.`,
                    statusCode: statusCode || 502,
                    provider: 'CBE'
                };
            }

            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
    }

    return {
        success: false,
        error: 'CBE receipt service is currently unreachable.',
        statusCode: 502,
        provider: 'CBE'
    };
}

export async function verifyCBE(reference: string, accountSuffix?: string): Promise<VerifyResult> {
    const legacyLink = extractLegacyCbeUrlData(reference);
    if (legacyLink) {
        const resolvedSuffix = accountSuffix?.trim() || legacyLink.suffix;
        return verifyCBELegacy(legacyLink.reference, resolvedSuffix);
    }

    const token = extractNewCbeToken(reference);
    if (token) {
        return verifyCBENew(token);
    }

    if (!accountSuffix) {
        return {
            success: false,
            error: 'For legacy FT references, the 8-digit payer account suffix is required. Or provide the full receipt URL / SMS text.'
        };
    }

    return verifyCBELegacy(reference, accountSuffix);
}

export async function parseCBEReceipt(pdfBuffer: Buffer | ArrayBuffer): Promise<VerifyResult> {
    const buffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
    const data = await pdf(buffer);
    const text = data.text;

    const payerMatch = text.match(/Payer\s*\n\s*(.*?)\n/i);
    const payerAccountMatch = text.match(/Payer Account\s*\n\s*(\d+)/i);
    const receiverMatch = text.match(/Receiver\s*\n\s*(.*?)\n/i);
    const receiverAccountMatch = text.match(/Receiver Account\s*\n\s*(\d+)/i);
    const amountMatch = text.match(/Amount\s*\n\s*([\d,]+\.?\d*)\s*ETB/i);
    const dateMatch = text.match(/Payment Date\s*\n\s*(.*?)\n/i);
    const refMatch = text.match(/Transaction Reference\s*\n\s*(.*?)\n/i);
    const reasonMatch = text.match(/Payment Reason\s*\n\s*(.*?)\n/i);

    if (!refMatch) {
        return { success: false, error: 'Could not parse transaction reference from CBE PDF receipt' };
    }

    const rawAmount = amountMatch ? amountMatch[1].replace(/,/g, '') : '0';

    return {
        success: true,
        payer: payerMatch ? titleCase(payerMatch[1].trim()) : undefined,
        payerAccount: payerAccountMatch ? payerAccountMatch[1].trim() : undefined,
        receiver: receiverMatch ? titleCase(receiverMatch[1].trim()) : undefined,
        receiverAccount: receiverAccountMatch ? receiverAccountMatch[1].trim() : undefined,
        amount: parseFloat(rawAmount),
        date: dateMatch ? new Date(dateMatch[1].trim()) : undefined,
        reference: refMatch[1].trim(),
        reason: reasonMatch ? reasonMatch[1].trim() : null,
        verificationMode: 'LIVE_API',
        provider: 'CBE'
    };
}

export function verifyCBEFromText(reference: string, receiptText: string): VerifyResult {
    const raw = receiptText.trim();
    if (!raw) {
        return { success: false, error: 'Receipt text cannot be empty.' };
    }

    let payer: string | undefined;
    let payerAccount: string | undefined;
    let receiver: string | undefined;
    let receiverAccount: string | undefined;
    let amount: number | undefined;
    let paymentDate: Date | undefined;
    let extractedRef: string | undefined;
    let reason: string | null = null;

    // ─── Extract Reference ──────────────────────────────────────────────────
    const refMatch =
        raw.match(/(?:transaction reference|reference no\.?\s*(?:\(vat invoice no\))?|ref(?:\s+no)?|tx ref|ft id)\s*[:\-]?\s*([A-Za-z0-9]+)/i) ||
        raw.match(/\b(FT[A-Za-z0-9]{10})\b/i);

    if (refMatch) {
        extractedRef = refMatch[1].toUpperCase();
    }

    if (reference && reference !== 'CBE_RECEIPT' && extractedRef && extractedRef !== reference.toUpperCase()) {
        return {
            success: false,
            error: 'Receipt text reference does not match the supplied reference.',
            statusCode: 422,
        };
    }

    // ─── Extract Amount ─────────────────────────────────────────────────────
    const amountMatch =
        raw.match(/(?:transferred amount|amount|settled amount|total paid|paid amount|debited with etb|credited with etb|transferred etb)\s*[:\-]?\s*(?:etb|birr)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
        raw.match(/(?:etb|birr)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
        raw.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:etb|birr)/i);

    if (amountMatch) {
        amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    }

    if (!amount || (!extractedRef && !reference)) {
        return {
            success: false,
            error: 'Could not extract reference or amount from CBE receipt text.',
            statusCode: 422,
        };
    }

    // ─── Extract Reason ─────────────────────────────────────────────────────
    const reasonMatch = raw.match(/(?:reason\s*\/\s*type of service|reason|payment reason)\s*[:\-]?\s*([^\n\r]+?)(?:\s+Transferred Amount|$)/i);
    if (reasonMatch) {
        reason = reasonMatch[1].trim();
    }

    // ─── Extract Payer ──────────────────────────────────────────────────────
    const payerMatch =
        raw.match(/Payer:\s*([^\n\r]+?)(?:\s+Account|$)/i) ||
        raw.match(/by\s+([A-Za-z\s]+?)(?:\.|\s+Ref|$)/i) ||
        raw.match(/(?:payer(?:\s+name)?|sender(?:\s+name)?|from)\s*[:\-]?\s*([A-Za-z\s]+?)(?:\r?\n|account|acc|to|credited|date|$)/i);
    if (payerMatch) {
        payer = payerMatch[1].replace(/Account$/i, '').trim();
    }

    // ─── Extract Receiver ───────────────────────────────────────────────────
    const receiverMatch =
        raw.match(/Receiver:\s*([^\n\r]+?)(?:\s+Account|$)/i) ||
        raw.match(/(?:receiver(?:\s+name)?|credited party|beneficiary(?:\s+name)?|to)\s*[:\-]?\s*([A-Za-z\s]+?)(?:\r?\n|account|acc|amount|date|$)/i);
    if (receiverMatch) {
        receiver = receiverMatch[1].replace(/Account$/i, '').trim();
    }

    // ─── Extract Accounts ───────────────────────────────────────────────────
    const payerAccMatch =
        raw.match(/Payer:[^\n\r]*\r?\n\s*Account:\s*([^\n\r]+)/i) ||
        raw.match(/(?:payer account|from account|debit account|your account)\s*[:\-]?\s*([A-Za-z0-9*]+)/i);
    if (payerAccMatch) {
        payerAccount = payerAccMatch[1].trim();
    }

    const receiverAccMatch =
        raw.match(/Receiver:[^\n\r]*\r?\n\s*Account:\s*([^\n\r]+)/i) ||
        raw.match(/(?:receiver account|to account|credit account)\s*[:\-]?\s*([A-Za-z0-9*]+)/i);
    if (receiverAccMatch) {
        receiverAccount = receiverAccMatch[1].trim();
    }

    // ─── Extract Date ───────────────────────────────────────────────────────
    const dateMatch =
        raw.match(/(?:payment date|transaction date|date)\s*[:\-]?\s*([0-9\/\-:\sAPMapm]+)/i);
    if (dateMatch) {
        const parsed = new Date(dateMatch[1].trim());
        if (!isNaN(parsed.getTime())) paymentDate = parsed;
    }

    return {
        success: true,
        reference: extractedRef || reference || 'CBE_RECEIPT',
        payer: payer || 'CBE Customer',
        payerAccount,
        receiver: receiver || 'Merchant',
        receiverAccount,
        amount,
        date: paymentDate || new Date(),
        reason,
        verificationMode: 'LOCAL_TEXT',
        receiptTextVerified: true,
        provider: 'CBE',
    };
}
