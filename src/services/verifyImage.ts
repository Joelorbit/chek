import { Mistral } from "@mistralai/mistralai";
import fs from "fs";
import { Request, Response } from "express";
import multer from "multer";
import logger from "../utils/logger";
import { verifyTelebirr } from "./verifyTelebirr";
import { verifyCBE } from "./verifyCBE";
import dotenv from "dotenv";

dotenv.config();

const upload = multer({ dest: "uploads/" });

const getMistralClient = () => {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  return new Mistral({ apiKey });
};

export const verifyImageHandler = [
  upload.single("file"),

  async (req: Request, res: Response): Promise<void> => {
    try {
      const autoVerify = req.query.autoVerify === "true";
      const accountSuffix = req.body?.suffix || null;

      if (!req.file) {
        logger.warn("No file uploaded");
        res.status(400).json({ success: false, error: "No file uploaded." });
        return;
      }

      const client = getMistralClient();
      if (!client) {
        res.status(503).json({ success: false, error: "MISTRAL_API_KEY is not configured for image OCR." });
        return;
      }

      const filePath = req.file.path;
      const imageBuffer = fs.readFileSync(filePath);
      const base64Image = imageBuffer.toString("base64");

      const prompt = `
You are an Ethiopian payment receipt analyzer. Based on the uploaded image, determine:
- If the receipt was issued by Telebirr or the Commercial Bank of Ethiopia (CBE) or other banks.
- If it's a CBE receipt, extract the transaction ID (starts with 'FT').
- If it's a Telebirr receipt, extract the transaction number (10 uppercase alphanumeric characters).

Return this JSON format exactly:
{
  "type": "telebirr" | "cbe" | "other",
  "transaction_id": "string",
  "transaction_number": "string"
}
      `.trim();

      const chatResponse = await client.chat.complete({
        model: "ministral-14b-2512",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                imageUrl: `data:image/jpeg;base64,${base64Image}`,
              },
            ],
          },
        ],
        responseFormat: { type: "json_object" },
      });

      // Cleanup temp uploaded file
      try { fs.unlinkSync(filePath); } catch {}

      const rawMessage = chatResponse.choices?.[0]?.message as any;
      const messageContent = typeof rawMessage?.content === "string"
        ? rawMessage.content
        : Array.isArray(rawMessage?.content)
          ? rawMessage.content.map((c: any) => c.text || '').join('\n')
          : null;

      if (!messageContent) {
        res.status(500).json({ success: false, error: "Could not extract receipt data from image." });
        return;
      }

      const parsed = JSON.parse(messageContent);
      const reference = parsed.transaction_id || parsed.transaction_number || parsed.reference;

      if (!reference) {
        res.status(404).json({ success: false, error: "No transaction reference found in receipt image." });
        return;
      }

      if (!autoVerify) {
        res.json({
          success: true,
          ocrResult: parsed,
          reference,
          type: parsed.type,
        });
        return;
      }

      if (parsed.type === "cbe") {
        if (!accountSuffix) {
          res.status(400).json({
            success: false,
            error: "CBE verification requires account suffix (last 8 digits)",
            reference,
          });
          return;
        }
        const verification = await verifyCBE(reference, accountSuffix);
        res.json({ success: true, ocrResult: parsed, verification });
      } else {
        const verification = await verifyTelebirr(reference);
        res.json({ success: true, ocrResult: parsed, verification });
      }
    } catch (err: any) {
      logger.error("Error verifying receipt image:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to process image." });
    }
  },
];
