import crypto from "node:crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Target chunk size in characters (~800 tokens at ~4 chars/token).
 * Keeps each chunk within Gemini's embedding input limit.
 */
const CHUNK_SIZE = 3200;

/**
 * Overlap between consecutive chunks in characters (~100 tokens).
 * Preserves context across chunk boundaries.
 */
const CHUNK_OVERLAP = 400;

/**
 * Minimum chunk size — discard segments smaller than this.
 */
const MIN_CHUNK_SIZE = 150;

// ─── Section heading patterns for Indian legal documents ──────────────────────
// Match patterns like: "Section 2.", "2.", "CHAPTER II", "PART III", "35A."
const SECTION_HEADING_RE =
  /^(?:(?:SECTION|SEC\.?|CHAPTER|PART|SCHEDULE|APPENDIX|RULE|REGULATION|ARTICLE|CLAUSE)\s+[\dIVXA-Z]+\.?|(?:\d+[A-Z]?\.(?:\d+\.)*\s))/im;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Removes excessive whitespace and normalises line endings.
 * Preserves paragraph breaks (double newlines).
 */
function normalise(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n") // collapse 3+ newlines to 2
    .replace(/[ \t]+/g, " ") // collapse horizontal whitespace
    .replace(/^ +| +$/gm, "") // trim line edges
    .trim();
}

/**
 * Splits text into paragraphs (double-newline delimited) while trying to
 * honour section headings as natural split points.
 */
function splitIntoParagraphs(text) {
  const rawParagraphs = text.split(/\n\n+/);
  const paragraphs = [];

  for (const p of rawParagraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;

    // If a paragraph is longer than 2× chunk size, split further
    if (trimmed.length > CHUNK_SIZE * 2) {
      // First try to split by newlines within the paragraph
      const lines = trimmed.split(/\n/);
      if (lines.length > 1) {
        let lineBuf = "";
        for (const line of lines) {
          if (
            lineBuf.length + line.length + 1 > CHUNK_SIZE &&
            lineBuf.length > MIN_CHUNK_SIZE
          ) {
            paragraphs.push(lineBuf.trim());
            lineBuf = line;
          } else {
            lineBuf += (lineBuf ? "\n" : "") + line;
          }
        }
        if (lineBuf.trim()) paragraphs.push(lineBuf.trim());
      } else {
        // No newlines — force-split at sentence boundaries or hard char limit
        let pos = 0;
        while (pos < trimmed.length) {
          let end = Math.min(pos + CHUNK_SIZE, trimmed.length);
          // Try to break at a sentence boundary ('. ') within last 200 chars
          if (end < trimmed.length) {
            const lookback = trimmed.lastIndexOf(". ", end);
            if (lookback > pos + MIN_CHUNK_SIZE) end = lookback + 2;
          }
          const slice = trimmed.slice(pos, end).trim();
          if (slice.length >= MIN_CHUNK_SIZE) paragraphs.push(slice);
          pos = end;
        }
      }
    } else {
      paragraphs.push(trimmed);
    }
  }
  return paragraphs;
}

/**
 * Extracts section metadata from a chunk of text.
 * Returns best-effort section and sub-section strings.
 *
 * @param {string} text
 * @returns {{ sectionNumber: string|null, subSection: string|null, chapterTitle: string|null }}
 */
export function extractSectionMetadata(text) {
  const lines = text.split("\n").slice(0, 5); // look at first 5 lines
  let sectionNumber = null;
  let subSection = null;
  let chapterTitle = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Chapter / Part headings
    if (/^(CHAPTER|PART)\s+[\dIVXA-Z]+/i.test(trimmed)) {
      chapterTitle = trimmed.replace(/\s+/g, " ").slice(0, 120);
      continue;
    }

    // "Section 35A" / "35A." style
    const secMatch = trimmed.match(
      /^(?:Section|Sec\.?|Rule|Regulation|Article|Clause)\s+(\d+[A-Z]?(?:\(\d+\))?(?:\([a-z]\))?)/i
    );
    if (secMatch && !sectionNumber) {
      sectionNumber = secMatch[1];
      continue;
    }

    // Bare "35." or "35A(1)." style
    const bareMatch = trimmed.match(/^(\d+[A-Z]?(?:\(\d+\)(?:\([a-z]\))?)?)\.\s/);
    if (bareMatch && !sectionNumber) {
      sectionNumber = bareMatch[1];
      continue;
    }

    // Sub-section in parentheses "(1)" at start
    const subMatch = trimmed.match(/^\((\d+[a-z]?)\)\s/);
    if (subMatch && sectionNumber && !subSection) {
      subSection = `${sectionNumber}(${subMatch[1]})`;
    }
  }

  return { sectionNumber, subSection, chapterTitle };
}

/**
 * Splits a full legal document text into overlapping chunks with metadata.
 *
 * @param {string} rawText   Full text of the document (after PDF extraction)
 * @param {object} docMeta   Document-level metadata
 * @param {string} docMeta.documentTitle
 * @param {string} docMeta.actName
 * @param {string} docMeta.sourceType
 * @param {string} docMeta.sourceUrl
 * @param {string} docMeta.jurisdiction
 * @param {string|null} docMeta.publicationDate   ISO 8601
 * @param {string} docMeta.lastVerifiedDate        ISO 8601
 * @param {string[]} [docMeta.tags]
 * @returns {Array<object>}  Array of chunk objects ready for embedding + storage
 */
export function chunkDocument(rawText, docMeta) {
  const text = normalise(rawText);
  const paragraphs = splitIntoParagraphs(text);

  const chunks = [];
  let buffer = "";
  let charOffset = 0;
  let bufferOffset = 0;

  const flush = () => {
    const content = buffer.trim();
    if (content.length < MIN_CHUNK_SIZE) return;

    const { sectionNumber, subSection, chapterTitle } = extractSectionMetadata(content);
    const contentHash = crypto.createHash("sha256").update(content).digest("hex");

    chunks.push({
      ...docMeta,
      sectionNumber,
      subSection,
      chapterTitle,
      text: content,
      charOffset: bufferOffset,
      contentHash,
      tags: docMeta.tags ?? [],
    });
  };

  for (const para of paragraphs) {
    // If adding this paragraph exceeds chunk size, flush first
    if (buffer.length + para.length + 2 > CHUNK_SIZE && buffer.length > 0) {
      flush();
      // Keep the last CHUNK_OVERLAP characters for context continuity
      const overlap =
        buffer.length > CHUNK_OVERLAP ? buffer.slice(-CHUNK_OVERLAP) : buffer;
      bufferOffset = charOffset - overlap.length;
      buffer = overlap + "\n\n" + para;
    } else {
      if (buffer.length === 0) bufferOffset = charOffset;
      buffer += (buffer ? "\n\n" : "") + para;
    }
    charOffset += para.length + 2; // +2 for the \n\n separator
  }

  // Flush remaining buffer
  if (buffer.trim().length >= MIN_CHUNK_SIZE) flush();

  // Assign sequential indices
  const total = chunks.length;
  for (let i = 0; i < total; i++) {
    chunks[i].chunkIndex = i;
    chunks[i].totalChunks = total;
  }

  return chunks;
}
