/**
 * PDF text extraction service.
 *
 * Uses Node's built-in `node:buffer` and a pure-JS approach so the pipeline
 * works without native bindings. The actual heavy lifting is deferred to
 * `pdf-parse` when available, with a graceful plain-text fallback for testing.
 *
 * Usage:
 *   const { text, pageCount } = await PdfExtractor.extractFromBuffer(pdfBuffer);
 *   const { text, pageCount } = await PdfExtractor.extractFromUrl(url);  // requires network
 */

import { createHash } from "node:crypto";
import { AppError } from "../../utils/apiResponse.js";

// ─── PDF parser (optional dependency) ────────────────────────────────────────
let pdfParse = null;
try {
  // Dynamic import so the app starts even if pdf-parse is not installed
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  pdfParse = mod.default ?? mod;
} catch {
  // Will use plain-text path; logged at ingest time
}

export class PdfExtractor {
  /**
   * Extracts text from a PDF Buffer.
   *
   * @param {Buffer} buffer
   * @returns {Promise<{ text: string, pageCount: number, sha256: string }>}
   */
  static async extractFromBuffer(buffer) {
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    if (!pdfParse) {
      throw new AppError(
        "pdf-parse is not installed. Install it with: npm install pdf-parse",
        500
      );
    }

    try {
      const data = await pdfParse(buffer, {
        // Keep page breaks as double newlines for downstream chunker
        pagerender: (pageData) =>
          pageData.getTextContent().then((content) => {
            const strings = content.items.map((item) => item.str);
            return strings.join(" ") + "\n\n";
          }),
      });

      return {
        text: data.text || "",
        pageCount: data.numpages || 0,
        sha256,
      };
    } catch (err) {
      throw new AppError(`PDF parsing failed: ${err.message}`, 422);
    }
  }

  /**
   * Extracts text from plain-text content (for non-PDF ingestion or testing).
   *
   * @param {string} text
   * @returns {{ text: string, pageCount: number, sha256: string }}
   */
  static extractFromText(text) {
    const sha256 = createHash("sha256").update(text).digest("hex");
    const pageCount = (text.match(/\f/g) || []).length + 1; // form-feed as page break
    return { text: text.replace(/\f/g, "\n\n"), pageCount, sha256 };
  }

  /**
   * Validates that the ingestion source URL points to a trusted domain.
   * Only official government and recognised legal portals are permitted.
   *
   * @param {string} url
   * @returns {boolean}
   */
  static isTrustedSource(url) {
    try {
      const { hostname } = new URL(url);
      return TRUSTED_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith("." + domain)
      );
    } catch {
      return false;
    }
  }
}

/**
 * Whitelist of trusted domains for Indian legal documents.
 * Extend this list as new authoritative sources are verified.
 */
export const TRUSTED_DOMAINS = [
  // Government of India portals
  "consumeraffairs.nic.in",
  "consumerhelpline.gov.in",
  "ncdrc.nic.in",
  "legislative.gov.in",
  "indiacode.nic.in",
  "egazette.nic.in",
  "egazette.gov.in",
  "mca.gov.in",
  "finmin.nic.in",
  "pib.gov.in",
  "prsindia.org", // non-partisan legislative research
  "sci.gov.in", // Supreme Court of India

  // State consumer commissions (add as needed)
  "ncdrc.nic.in",
];

