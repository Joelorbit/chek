import { Mistral } from "@mistralai/mistralai";
import fs from "fs";
import { Request, Response } from "express";
import multer from "multer";
import Tesseract from "tesseract.js";
import logger from "../utils/logger";
import { runSmartVerify } from "./verifyUniversal";
import dotenv from "dotenv";

dotenv.config();

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP, TIFF) are allowed.'));
    }
  }
});

const getMistralClient = () => {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  return new Mistral({ apiKey });
};

export async function extractTextFromImageBuffer(buffer: Buffer): Promise<string> {
  try {
    const { data: { text } } = await Tesseract.recognize(buffer, "eng");
    return text || "";
  } catch (err: any) {
    logger.warn(`Tesseract OCR error: ${err.message}`);
    return "";
  }
}

export function parseReceiptTextPattern(rawText: string): {
  type: "telebirr" | "cbe" | "abyssinia" | "dashen" | "other";
  reference?: string;
  amount?: string;
} {
  const text = rawText.trim();
  const textLower = text.toLowerCase();

  // 1. CBE Check
  const cbeMatch = text.match(/\b(FT[A-Za-z0-9]{10,18})\b/i) || text.match(/VAT\s+Invoice\s*No\.?\s*[:\-]?\s*([A-Za-z0-9]+)/i);
  if (cbeMatch) {
    return { type: "cbe", reference: cbeMatch[1].toUpperCase() };
  }

  // 2. Telebirr Check
  const telebirrRef = text.match(/(?:transaction\s*id|trans\s*id|receipt\s*no\.?)\s*[:\-]?\s*([A-Za-z0-9]{8,14})/i)
    || text.match(/\b([A-Z0-9]{10})\b/);
  if (telebirrRef && (textLower.includes("telebirr") || textLower.includes("ethio") || textLower.includes("balance") || telebirrRef[1].length === 10)) {
    return { type: "telebirr", reference: telebirrRef[1].toUpperCase() };
  }

  // 3. Abyssinia Check
  if (textLower.includes("abyssinia") || textLower.includes("boa")) {
    const boaMatch = text.match(/\b([A-Za-z0-9]{10,20})\b/);
    if (boaMatch) return { type: "abyssinia", reference: boaMatch[1].toUpperCase() };
  }

  // 4. Dashen Check
  if (textLower.includes("dashen")) {
    const dashenMatch = text.match(/\b([A-Za-z0-9]{10,20})\b/);
    if (dashenMatch) return { type: "dashen", reference: dashenMatch[1].toUpperCase() };
  }

  // Generic 10-char alphanumeric fallback
  const genericMatch = text.match(/\b([A-Za-z0-9]{10})\b/);
  if (genericMatch) {
    return { type: "other", reference: genericMatch[1].toUpperCase() };
  }

  return { type: "other" };
}

export const verifyImageHandler = [
  upload.single("file"),

  async (req: Request, res: Response): Promise<void> => {
    let filePath: string | null = null;

    try {
      const autoVerify = req.query.autoVerify !== "false";
      const accountSuffix = req.body?.suffix || req.query.suffix || null;

      let imageBuffer: Buffer | null = null;

      if (req.file) {
        filePath = req.file.path;
        imageBuffer = fs.readFileSync(filePath);
      } else if (req.body?.image || req.body?.imageBase64) {
        const rawBase64 = req.body.image || req.body.imageBase64;
        const cleanBase64 = rawBase64.replace(/^data:image\/\w+;base64,/, "");
        imageBuffer = Buffer.from(cleanBase64, "base64");
      }

      if (!imageBuffer) {
        logger.warn("No image file or base64 data provided");
        res.status(400).json({ success: false, error: "No image file or base64 provided." });
        return;
      }

      let detectedRef: string | undefined;
      let detectedType: string = "other";
      let recognizedText: string = "";

      // Try Mistral Vision first if configured
      const mistral = getMistralClient();
      if (mistral) {
        try {
          const base64Image = imageBuffer.toString("base64");
          const prompt = `You are an Ethiopian payment receipt analyzer. Extract:
- provider type: "telebirr" | "cbe" | "abyssinia" | "dashen" | "other"
- transaction reference / ID
- settled amount in ETB
Return JSON: {"type":"telebirr","reference":"DHS78S7FQN","amount":"200.00"}`;

          const chatResponse = await mistral.chat.complete({
            model: "ministral-14b-2512",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", imageUrl: `data:image/jpeg;base64,${base64Image}` },
                ],
              },
            ],
            responseFormat: { type: "json_object" },
          });

          const rawMsg = chatResponse.choices?.[0]?.message as any;
          const msgContent = typeof rawMsg?.content === "string"
            ? rawMsg.content
            : Array.isArray(rawMsg?.content)
              ? rawMsg.content.map((c: any) => c.text || "").join("\n")
              : null;

          if (msgContent) {
            const parsed = JSON.parse(msgContent);
            detectedRef = parsed.reference || parsed.transaction_id || parsed.transaction_number;
            detectedType = parsed.type || "other";
          }
        } catch (mErr: any) {
          logger.warn(`Mistral OCR fallback to Tesseract: ${mErr.message}`);
        }
      }

      // If no Mistral or Mistral didn't extract reference, run Tesseract OCR
      if (!detectedRef) {
        recognizedText = await extractTextFromImageBuffer(imageBuffer);
        const parsed = parseReceiptTextPattern(recognizedText);
        detectedRef = parsed.reference;
        detectedType = parsed.type;
      }

      if (!detectedRef && !recognizedText) {
        res.status(422).json({
          success: false,
          error: "Could not read text or transaction reference from receipt screenshot.",
        });
        return;
      }

      const reference = detectedRef || "";

      if (!autoVerify) {
        res.json({
          success: true,
          reference,
          type: detectedType,
          extractedText: recognizedText,
        });
        return;
      }

      // Execute full smart verification
      const verifyResult = await runSmartVerify({
        reference,
        receiptText: recognizedText || undefined,
        suffix: accountSuffix as string,
      });

      res.status(verifyResult.httpStatus || 200).json({
        success: verifyResult.success,
        reference,
        type: detectedType,
        extractedText: recognizedText ? recognizedText.slice(0, 500) : undefined,
        verification: verifyResult.data,
        error: verifyResult.error,
      });
    } catch (err: any) {
      logger.error("Error verifying receipt image:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to process image." });
    } finally {
      if (filePath) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  },
];
