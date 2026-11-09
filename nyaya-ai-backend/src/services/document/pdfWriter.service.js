/**
 * Minimal pure-Node.js PDF 1.4 generator — zero external dependencies.
 *
 * Produces valid, readable PDF files using built-in Helvetica + Helvetica-Bold
 * fonts (standard 14 fonts — guaranteed to be available in every PDF reader).
 *
 * Designed exclusively for text-heavy legal documents. Supports:
 *   - Auto-pagination with configurable margins
 *   - Word-wrapping
 *   - Bold / regular toggling
 *   - Section headers
 *   - Horizontal rules
 *   - Left/right/center alignment for specific lines
 */

// ── PDF geometry constants (A4, 72 dpi units) ────────────────────────────────
const PAGE_WIDTH = 595.28; // A4 width
const PAGE_HEIGHT = 841.89; // A4 height
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 72;
const MARGIN_LEFT = 72;
const MARGIN_RIGHT = 72;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const LINE_HEIGHT = 16;
const FONT_SIZE_BODY = 11;
const FONT_SIZE_HEADER = 14;
const FONT_SIZE_TITLE = 16;
const FONT_SIZE_DISCLAIMER = 9;

// ── Approximate glyph widths (Helvetica at 1pt) ─────────────────────────────
// Full per-glyph tables are ~250 entries; this lookup + average covers 95%+
// of Latin text with <3% error, which is more than adequate for wrapping.
const HELVETICA_WIDTHS = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667,
  "'": 222, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
  ".": 278, "/": 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667,
  Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667,
  Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 222,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556,
  i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556,
  q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500,
  y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584,
};
const AVG_WIDTH = 530; // average glyph width at 1000-unit scale

/**
 * Measures the width of a string in PDF units at the given font size.
 * @param {string} str
 * @param {number} fontSize
 * @returns {number}
 */
function measureText(str, fontSize) {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    width += HELVETICA_WIDTHS[str[i]] ?? AVG_WIDTH;
  }
  return (width / 1000) * fontSize;
}

/**
 * Word-wraps a string to fit within `maxWidth` at the given font size.
 * Returns an array of lines.
 */
function wordWrap(text, fontSize, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if (!word) continue;
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (measureText(testLine, fontSize) <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [""];
}

/**
 * Escapes special PDF string characters.
 */
function pdfEscape(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    // Replace non-ASCII with '?' to avoid encoding issues in PDF strings
    .replace(/[^\x20-\x7E]/g, "?");
}

// ─── PdfWriter class ──────────────────────────────────────────────────────────

export class PdfWriter {
  constructor() {
    this._objects = []; // array of { id, content }
    this._pages = []; // array of page object ids
    this._nextId = 1;
    this._currentPageStream = "";
    this._cursorY = PAGE_HEIGHT - MARGIN_TOP;
    this._currentFont = "/F1"; // Helvetica
    this._currentFontSize = FONT_SIZE_BODY;

    // Pre-allocate standard objects: catalog, pages dict, font resources
    this._catalogId = this._allocId(); // 1
    this._pagesDictId = this._allocId(); // 2
    this._fontRegularId = this._allocId(); // 3
    this._fontBoldId = this._allocId(); // 4
  }

  _allocId() {
    return this._nextId++;
  }

  _addObj(id, content) {
    this._objects.push({ id, content });
  }

  // ── High-level API ──────────────────────────────────────────────────────

  /** Adds a title line centered on the page. */
  addTitle(text) {
    this._ensureSpace(FONT_SIZE_TITLE + 10);
    this._setFont("/F2", FONT_SIZE_TITLE); // bold
    this._addCenteredText(text, FONT_SIZE_TITLE);
    this._cursorY -= 8;
    this._setFont("/F1", FONT_SIZE_BODY);
  }

  /** Adds a section header (bold, left-aligned). */
  addHeader(text) {
    this._cursorY -= 8; // space before header
    this._ensureSpace(FONT_SIZE_HEADER + 8);
    this._setFont("/F2", FONT_SIZE_HEADER);
    this._addTextLine(text, MARGIN_LEFT, this._cursorY, FONT_SIZE_HEADER);
    this._cursorY -= LINE_HEIGHT + 2;
    this._setFont("/F1", FONT_SIZE_BODY);
  }

  /** Adds a bold paragraph. */
  addBold(text) {
    this._setFont("/F2", FONT_SIZE_BODY);
    this.addParagraph(text);
    this._setFont("/F1", FONT_SIZE_BODY);
  }

  /** Adds a paragraph with automatic word-wrapping. */
  addParagraph(text) {
    if (!text || !text.trim()) {
      this._cursorY -= LINE_HEIGHT;
      return;
    }
    const lines = wordWrap(text, this._currentFontSize, CONTENT_WIDTH);
    for (const line of lines) {
      this._ensureSpace(LINE_HEIGHT);
      this._addTextLine(line, MARGIN_LEFT, this._cursorY, this._currentFontSize);
      this._cursorY -= LINE_HEIGHT;
    }
    this._cursorY -= 4; // paragraph spacing
  }

  /** Adds right-aligned text (e.g., date, place). */
  addRightAligned(text) {
    this._ensureSpace(LINE_HEIGHT);
    const textWidth = measureText(text, this._currentFontSize);
    const x = PAGE_WIDTH - MARGIN_RIGHT - textWidth;
    this._addTextLine(text, x, this._cursorY, this._currentFontSize);
    this._cursorY -= LINE_HEIGHT;
  }

  /** Adds a horizontal rule. */
  addRule() {
    this._ensureSpace(12);
    this._cursorY -= 4;
    this._currentPageStream +=
      `${MARGIN_LEFT} ${this._cursorY} m ${PAGE_WIDTH - MARGIN_RIGHT} ${this._cursorY} l S\n`;
    this._cursorY -= 8;
  }

  /** Adds vertical space (blank lines). */
  addSpace(lines = 1) {
    this._cursorY -= LINE_HEIGHT * lines;
    if (this._cursorY < MARGIN_BOTTOM) this._newPage();
  }

  /** Adds a small-font disclaimer block. */
  addDisclaimer(text) {
    this.addRule();
    const prevSize = this._currentFontSize;
    this._currentFontSize = FONT_SIZE_DISCLAIMER;
    const lines = wordWrap(text, FONT_SIZE_DISCLAIMER, CONTENT_WIDTH);
    for (const line of lines) {
      this._ensureSpace(FONT_SIZE_DISCLAIMER + 2);
      this._addTextLine(line, MARGIN_LEFT, this._cursorY, FONT_SIZE_DISCLAIMER);
      this._cursorY -= FONT_SIZE_DISCLAIMER + 2;
    }
    this._currentFontSize = prevSize;
  }

  // ── Build the final PDF ─────────────────────────────────────────────────

  /**
   * Serialises all objects into a valid PDF 1.4 byte buffer.
   * @returns {Buffer}
   */
  build() {
    // Flush current page
    this._flushPage();

    // Build font objects
    this._addObj(this._fontRegularId, [
      `${this._fontRegularId} 0 obj`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "endobj",
    ].join("\n"));

    this._addObj(this._fontBoldId, [
      `${this._fontBoldId} 0 obj`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      "endobj",
    ].join("\n"));

    // Build catalog
    this._addObj(this._catalogId, [
      `${this._catalogId} 0 obj`,
      `<< /Type /Catalog /Pages ${this._pagesDictId} 0 R >>`,
      "endobj",
    ].join("\n"));

    // Build pages dict
    const pageRefs = this._pages.map((id) => `${id} 0 R`).join(" ");
    this._addObj(this._pagesDictId, [
      `${this._pagesDictId} 0 obj`,
      `<< /Type /Pages /Kids [${pageRefs}] /Count ${this._pages.length} >>`,
      "endobj",
    ].join("\n"));

    // Sort objects by id
    this._objects.sort((a, b) => a.id - b.id);

    // Render PDF bytes
    const header = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const parts = [header];
    const offsets = new Map();
    let pos = Buffer.byteLength(header, "binary");

    for (const obj of this._objects) {
      offsets.set(obj.id, pos);
      const chunk = obj.content + "\n";
      parts.push(chunk);
      pos += Buffer.byteLength(chunk, "binary");
    }

    // Cross-reference table
    const xrefOffset = pos;
    const xrefLines = ["xref", `0 ${this._objects.length + 1}`, "0000000000 65535 f \r"];
    for (let i = 1; i <= this._objects.length; i++) {
      const off = (offsets.get(i) ?? 0).toString().padStart(10, "0");
      xrefLines.push(`${off} 00000 n \r`);
    }
    parts.push(xrefLines.join("\n") + "\n");

    // Trailer
    parts.push([
      "trailer",
      `<< /Size ${this._objects.length + 1} /Root ${this._catalogId} 0 R >>`,
      "startxref",
      String(xrefOffset),
      "%%EOF",
    ].join("\n"));

    return Buffer.from(parts.join(""), "binary");
  }

  // ── Internals ───────────────────────────────────────────────────────────

  _setFont(fontRef, size) {
    this._currentFont = fontRef;
    this._currentFontSize = size;
    this._currentPageStream += `${fontRef} ${size} Tf\n`;
  }

  _addTextLine(text, x, y, fontSize) {
    this._currentPageStream +=
      `BT ${x.toFixed(2)} ${y.toFixed(2)} Td ${this._currentFont} ${fontSize} Tf (${pdfEscape(text)}) Tj ET\n`;
  }

  _addCenteredText(text, fontSize) {
    const textWidth = measureText(text, fontSize);
    const x = (PAGE_WIDTH - textWidth) / 2;
    this._addTextLine(text, x, this._cursorY, fontSize);
    this._cursorY -= fontSize + 4;
  }

  _ensureSpace(needed) {
    if (this._cursorY - needed < MARGIN_BOTTOM) {
      this._newPage();
    }
  }

  _newPage() {
    this._flushPage();
    this._currentPageStream = "";
    this._cursorY = PAGE_HEIGHT - MARGIN_TOP;
    // Re-set font on new page
    this._currentPageStream += `${this._currentFont} ${this._currentFontSize} Tf\n`;
  }

  _flushPage() {
    if (!this._currentPageStream) return;

    const streamContent = this._currentPageStream;
    const streamId = this._allocId();
    const pageId = this._allocId();

    // Content stream object
    this._addObj(streamId, [
      `${streamId} 0 obj`,
      `<< /Length ${Buffer.byteLength(streamContent, "binary")} >>`,
      "stream",
      streamContent,
      "endstream",
      "endobj",
    ].join("\n"));

    // Page object
    this._addObj(pageId, [
      `${pageId} 0 obj`,
      `<< /Type /Page /Parent ${this._pagesDictId} 0 R`,
      `   /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`,
      `   /Resources << /Font << /F1 ${this._fontRegularId} 0 R /F2 ${this._fontBoldId} 0 R >> >>`,
      `   /Contents ${streamId} 0 R >>`,
      "endobj",
    ].join("\n"));

    this._pages.push(pageId);
  }
}

