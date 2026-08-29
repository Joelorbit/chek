import axios, { AxiosError } from "axios";
import https from "https";
import * as cheerio from "cheerio";
import logger from '../utils/logger';

export interface TelebirrReceipt {
    payerName: string;
    payerTelebirrNo: string;
    creditedPartyName: string;
    creditedPartyAccountNo: string;
    transactionStatus: string;
    receiptNo: string;
    paymentDate: string;
    settledAmount: string;
    serviceFee: string;
    serviceFeeVAT: string;
    totalPaidAmount: string;
    bankName: string;
    customerNote: string;
}

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
});

/**
 * Enhanced regex-based extractor for settled amount - multiple patterns like PHP version
 */
function extractSettledAmountRegex(htmlContent: string): string | null {
    // Pattern 1: Direct match with the exact text structure
    const pattern1 = /(?:የተከፈለው\s+መጠን\/)?Settled\s+Amount.*?<\/td>\s*<td[^>]*>\s*([\d,]+(?:\.\d+)?\s+Birr)/is;
    let match = htmlContent.match(pattern1);
    if (match) return match[1].trim();

    // Pattern 2: Look for the table row structure
    const pattern2 = /<tr[^>]*>.*?(?:የተከፈለው\s+መጠን\/)?Settled\s+Amount.*?<td[^>]*>\s*([\d,]+(?:\.\d+)?\s+Birr)/is;
    match = htmlContent.match(pattern2);
    if (match) return match[1].trim();

    // Pattern 3: More flexible approach - look for any cell containing "Settled Amount" followed by amount
    const pattern3 = /Settled\s+Amount.*?([\d,]+(?:\.\d+)?\s+Birr)/is;
    match = htmlContent.match(pattern3);
    if (match) return match[1].trim();

    // Pattern 4: Look specifically in the transaction details table
    const pattern4 = /(?:የክፍያ\s+ዝርዝር\/)?Transaction\s+details.*?<tr[^>]*>.*?<td[^>]*>\s*[^<]*<\/td>\s*<td[^>]*>\s*[^<]*<\/td>\s*<td[^>]*>\s*([\d,]+(?:\.\d+)?\s+Birr)/is;
    match = htmlContent.match(pattern4);
    if (match) return match[1].trim();

    // Pattern 5: Generic Birr amount in table td
    const pattern5 = /<td[^>]*class="[^"]*receipttableTd[^"]*"[^>]*>\s*([\d,]+(?:\.\d+)?\s+Birr)\s*<\/td>/i;
    match = htmlContent.match(pattern5);
    if (match) return match[1].trim();

    return null;
}

/**
 * Enhanced regex-based extractor for service fee
 */
function extractServiceFeeRegex(htmlContent: string): string | null {
    const pattern = /(?:የአገልግሎት\s+ክፍያ\/)?Service\s+fee(?!\s+ተ\.እ\.ታ|\s+VAT).*?<\/td>\s*<td[^>]*>\s*([\d,]+(?:\.\d+)?\s+Birr)/i;
    const match = htmlContent.match(pattern);
    if (match) return match[1].trim();

    return null;
}

/**
 * Enhanced regex-based extractor for receipt number
 */
function extractReceiptNoRegex(htmlContent: string): string | null {
    const pattern = /<td[^>]*class="[^"]*receipttableTd[^"]*receipttableTd2[^"]*"[^>]*>\s*([A-Z0-9]+)\s*<\/td>/i;
    const match = htmlContent.match(pattern);
    if (match) return match[1].trim();

    return null;
}

/**
 * Enhanced regex-based extractor for payment date
 */
function extractDateRegex(htmlContent: string): string | null {
    const pattern = /(\d{2}[-/.]\d{2}[-/.]\d{4}\s+\d{2}:\d{2}:\d{2})/;
    const match = htmlContent.match(pattern);
    if (match) return match[1].trim();

    return null;
}

/**
 * Generic regex extractor for other fields with array of fallback labels
 */
function extractWithRegex(htmlContent: string, labelPatterns: string | string[], valuePattern: string = '([^<]+)'): string | null {
    const patterns = Array.isArray(labelPatterns) ? labelPatterns : [labelPatterns];

    for (const labelPattern of patterns) {
        const escapedLabel = labelPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`<td[^>]*>\\s*${escapedLabel}\\s*<\\/td>\\s*<td[^>]*>\\s*${valuePattern}`, 'i');
        const match = htmlContent.match(pattern);
        if (match) {
            return match[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        }
    }

    return null;
}

function extractWithRegexLegacy(htmlContent: string): { settledAmount: string | null; serviceFee: string | null } {
    return {
        settledAmount: extractSettledAmountRegex(htmlContent),
        serviceFee: extractServiceFeeRegex(htmlContent)
    };
}

/**
 * Scrapes Telebirr receipt data from HTML content with exhaustive multi-label fallbacks
 */
function scrapeTelebirrReceipt(html: string): TelebirrReceipt {
    const $ = cheerio.load(html);

    const getPaymentDate = (): string => {
        const regexDate = extractDateRegex(html);
        if (regexDate) return regexDate;
        return $('.receipttableTd').filter((_, el) => $(el).text().includes("-202")).first().text().trim();
    };

    const getReceiptNo = (): string => {
        const regexReceiptNo = extractReceiptNoRegex(html);
        if (regexReceiptNo) return regexReceiptNo;
        return $('td.receipttableTd.receipttableTd2')
            .eq(1)
            .text()
            .trim();
    };

    const getSettledAmount = (): string => {
        const regexAmount = extractSettledAmountRegex(html);
        if (regexAmount) return regexAmount;

        let amount = $('td.receipttableTd.receipttableTd2')
            .filter((_, el) => {
                const prevTd = $(el).prev();
                return prevTd.text().includes("የተከፈለው መጠን") || prevTd.text().includes("Settled Amount");
            })
            .text()
            .trim();

        if (!amount) {
            amount = $('tr')
                .filter((_, el) => {
                    return $(el).find('td').first().text().includes("የተከፈለው መጠን") ||
                        $(el).find('td').first().text().includes("Settled Amount");
                })
                .find('td')
                .last()
                .text()
                .trim();
        }

        if (!amount) {
            $('td').each((_, el) => {
                const t = $(el).text().trim();
                if (/^[\d,]+(?:\.\d+)?\s+Birr$/i.test(t)) {
                    amount = t;
                    return false;
                }
            });
        }

        return amount;
    };

    const getServiceFee = (): string => {
        const regexFee = extractServiceFeeRegex(html);
        if (regexFee) return regexFee;

        let fee = $('td.receipttableTd1')
            .filter((_, el) => {
                const text = $(el).text();
                return (text.includes("የአገልግሎት ክፍያ") || text.includes("Service fee")) &&
                    !text.includes("ተ.እ.ታ") && !text.includes("VAT");
            })
            .next('td.receipttableTd.receipttableTd2')
            .text()
            .trim();

        if (!fee) {
            fee = $('tr')
                .filter((_, el) => {
                    const text = $(el).text();
                    return (text.includes("የአገልግሎት ክፍያ") || text.includes("Service fee")) &&
                        !text.includes("ተ.እ.ታ") && !text.includes("VAT");
                })
                .find('td')
                .last()
                .text()
                .trim();
        }

        return fee || "0.00 Birr";
    };

    const getTextWithFallback = (labels: string | string[], cheerioSelector?: string): string => {
        const regexResult = extractWithRegex(html, labels);
        if (regexResult) return regexResult;

        const labelArr = Array.isArray(labels) ? labels : [labels];
        for (const label of labelArr) {
            let found = "";
            $("td").each((_, elem) => {
                if ($(elem).text().trim().includes(label)) {
                    found = $(elem).next("td").text().trim();
                    if (found) return false;
                }
            });
            if (found) return found;
        }

        if (cheerioSelector) {
            return $(cheerioSelector).next().text().trim();
        }

        return "";
    };

    let creditedPartyName = getTextWithFallback([
        "የገንዘብ ተቀባይ ስም/Credited Party name",
        "የክፍያ ተቀባይ ስም/Credited party name",
        "የክፍያ ተቀባይ ስም",
        "የገንዘብ ተቀባይ ስም",
        "Credited Party name",
        "Credited party name"
    ]);

    let creditedPartyAccountNo = getTextWithFallback([
        "የገንዘብ ተቀባይ ቴሌብር ቁ./Credited party account no",
        "የክፍያ ተቀባይ ቴሌብር ቁ./Credited party telebirr no.",
        "የክፍያ ተቀባይ ቴሌብር ቁ.",
        "የገንዘብ ተቀባይ ቴሌብር ቁ.",
        "Credited party telebirr no.",
        "Credited party account no"
    ]);

    let bankName = "";
    const bankAccountNumberRaw = getTextWithFallback([
        "የባንክ አካውንት ቁጥር/Bank account number",
        "Bank account number",
        "የባንክ አካውንት ቁጥር"
    ]);

    if (bankAccountNumberRaw) {
        bankName = creditedPartyName;
        const bankAccountRegex = /(\d+)\s+(.*)/;
        const match = bankAccountNumberRaw.match(bankAccountRegex);
        if (match) {
            creditedPartyAccountNo = match[1].trim();
            creditedPartyName = match[2].trim();
        }
    }

    const payerName = getTextWithFallback([
        "የከፋይ ስም/Payer Name",
        "Payer Name",
        "የከፋይ ስም",
        "Payer name"
    ]);

    const payerTelebirrNo = getTextWithFallback([
        "የከፋይ ቴሌብር ቁ./Payer telebirr no.",
        "Payer telebirr no.",
        "Payer Telebirr No.",
        "የከፋይ ቴሌብር ቁ."
    ]);

    const transactionStatus = getTextWithFallback([
        "የክፍያው ሁኔታ/transaction status",
        "የክፍያው ሁኔታ/Transaction status",
        "transaction status",
        "Transaction Status",
        "የክፍያው ሁኔታ"
    ]) || "Completed";

    const serviceFeeVAT = getTextWithFallback([
        "የአገልግሎት ክፍያ ተ.እ.ታ/Service fee VAT",
        "Service fee VAT",
        "Service Fee VAT",
        "የአገልግሎት ክፍያ ተ.እ.ታ"
    ]) || "0.00 Birr";

    const totalPaidAmount = getTextWithFallback([
        "ጠቅላላ የተከፈለ/Total Paid Amount",
        "Total Paid Amount",
        "ጠቅላላ የተከፈለ"
    ]) || getSettledAmount();

    const customerNote = getTextWithFallback([
        "የደንበኛ መልዕክት/Customer Note",
        "Customer Note",
        "የደንበኛ መልዕክት"
    ]);

    return {
        payerName,
        payerTelebirrNo,
        creditedPartyName,
        creditedPartyAccountNo,
        transactionStatus,
        receiptNo: getReceiptNo(),
        paymentDate: getPaymentDate(),
        settledAmount: getSettledAmount(),
        serviceFee: getServiceFee(),
        serviceFeeVAT,
        totalPaidAmount,
        bankName,
        customerNote
    };
}

/**
 * Parses Telebirr SMS or Receipt Text
 */
export function verifyTelebirrFromText(reference: string, text: string): TelebirrReceipt | null {
    const raw = text.replace(/\s+/g, ' ').trim();
    const cleanRef = reference.trim().toUpperCase();

    if (!raw.toUpperCase().includes(cleanRef) && cleanRef.length > 0 && cleanRef !== 'TELEBIRR_RECEIPT') {
        return null;
    }

    let amountStr = '';
    const amtMatch = raw.match(/(?:amount|total|settled\s+amount|received|paid)\s*[:\-]?\s*(?:birr|etb)?\s*([\d,]+(?:\.\d{1,2})?)/i)
      || raw.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:birr|etb)/i);
    if (amtMatch) {
        amountStr = amtMatch[1].replace(/,/g, '');
    }

    let payer = '';
    const payerMatch = raw.match(/(?:payer|sender)(?:\s+name)?\s*[:\-]\s*(.*?)(?=\s+(?:transaction\s+status|status|amount|total|settled|birr|etb|txn|ref|payment|date)\b|$)/i)
      || raw.match(/from\s+(?:(?:\+?251\d{9}|\d{10})\s+)?\(([A-Za-z][A-Za-z .'-]{2,})\)/i)
      || raw.match(/from\s+([A-Za-z][A-Za-z .'-]{2,})(?=\s+(?:on|with|for|txn|ref|birr|etb|amount)\b|$)/i)
      || raw.match(/from\s+([A-Za-z][A-Za-z .'-]{2,})/i);
    if (payerMatch) {
        payer = payerMatch[1].trim();
    }

    const statusMatch = raw.match(/(?:status|transaction\s+status)\s*[:\-]\s*([A-Za-z]+)/i);
    const status = statusMatch ? statusMatch[1] : 'Completed';

    const dateMatch = raw.match(/(\d{2}[-/.]\d{2}[-/.]\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?)/i);
    const paymentDate = dateMatch ? dateMatch[1] : new Date().toISOString();

    const numericAmount = parseFloat(amountStr) || 0;
    const formattedAmount = `${numericAmount.toFixed(2)} Birr`;

    return {
        payerName: payer || 'Customer',
        payerTelebirrNo: '',
        creditedPartyName: '',
        creditedPartyAccountNo: '',
        transactionStatus: status,
        receiptNo: cleanRef !== 'TELEBIRR_RECEIPT' ? cleanRef : (raw.match(/\b([A-Za-z0-9]{10})\b/)?.[1] || ''),
        paymentDate,
        settledAmount: formattedAmount,
        serviceFee: '0.00 Birr',
        serviceFeeVAT: '0.00 Birr',
        totalPaidAmount: formattedAmount,
        bankName: 'Telebirr',
        customerNote: '',
    };
}

/**
 * Fetches live Telebirr receipt from Ethio Telecom portal
 */
async function fetchFromEthioTelecom(reference: string): Promise<TelebirrReceipt | null> {
    const url = `https://transactioninfo.ethiotelecom.et/receipt/${encodeURIComponent(reference.trim())}`;

    try {
        logger.info(`Fetching Telebirr receipt from Ethio Telecom: ${url}`);
        const response = await axios.get(url, {
            httpsAgent,
            timeout: 8000,
            validateStatus: () => true,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "am-ET,am;q=0.9,en-US;q=0.8,en;q=0.7",
            },
        });

        const html = response.data;
        if (!html || typeof html !== 'string' || html.includes('This request is not correct') || html.length < 150) {
            logger.warn(`Ethio Telecom reported invalid/missing receipt for reference: ${reference}`);
            return null;
        }

        const data = scrapeTelebirrReceipt(html);
        if (!data.receiptNo && !data.payerName && !data.settledAmount) {
            return null;
        }

        return data;
    } catch (err: any) {
        logger.error(`Ethio Telecom live lookup error: ${err.message}`);
        return null;
    }
}

/**
 * Universal Telebirr Verification: checks receipt text if given, otherwise runs live lookup
 */
export async function verifyTelebirr(reference: string, receiptText?: string): Promise<TelebirrReceipt | null> {
    const cleanRef = reference.trim().toUpperCase();

    // 1. If receipt text or SMS is supplied, parse locally in 0ms
    if (receiptText && receiptText.trim()) {
        const textResult = verifyTelebirrFromText(cleanRef, receiptText);
        if (textResult) return textResult;
    }

    // 2. Otherwise run live Ethio Telecom portal lookup
    return fetchFromEthioTelecom(cleanRef);
}
