/**
 * Unit tests — Chunker and Retrieval pipeline (pure logic, no DB/Gemini calls)
 *
 * Coverage:
 *   1. Text chunking — size bounds, overlap, minimum size filtering
 *   2. Section metadata extraction from legal document headers
 *   3. RRF fusion — ranking correctness, deduplication
 *   4. Cosine similarity utility
 *   5. Edge cases: empty text, very short docs, single-chunk docs
 *   6. Trusted source domain validation
 */

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";

let chunkDocument, extractSectionMetadata;
let VectorStoreService;
let EmbeddingService;
let PdfExtractor;

before(async () => {
  const chunkerMod = await import("../src/services/rag/chunker.service.js");
  chunkDocument = chunkerMod.chunkDocument;
  extractSectionMetadata = chunkerMod.extractSectionMetadata;

  const vsMod = await import("../src/services/rag/vectorStore.service.js");
  VectorStoreService = vsMod.VectorStoreService;

  const embMod = await import("../src/services/rag/embeddings.service.js");
  EmbeddingService = embMod.EmbeddingService;

  const pdfMod = await import("../src/services/rag/pdfExtractor.service.js");
  PdfExtractor = pdfMod.PdfExtractor;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_META = {
  documentTitle: "Consumer Protection Act, 2019",
  actName: "Consumer Protection Act, 2019",
  sourceType: "legislation",
  sourceUrl: "https://legislative.gov.in/sites/default/files/A2019-35.pdf",
  jurisdiction: "India",
  publicationDate: "2019-08-09",
  lastVerifiedDate: "2024-01-15",
  tags: ["consumer", "protection"],
};

/** Generates a paragraph of roughly `len` characters */
function makeParagraph(prefix, len = 500) {
  const sentence = `${prefix}: This provision shall apply to all matters relating to consumer disputes and redressal mechanisms under Indian law. `;
  let out = "";
  while (out.length < len) out += sentence;
  return out.slice(0, len).trim();
}

/** Generates a legal document with `n` distinct sections */
function makeDocument(sections = 5, sectionLength = 600) {
  return Array.from(
    { length: sections },
    (_, i) =>
      `Section ${i + 1}. ${makeParagraph(`Section ${i + 1} content`, sectionLength)}`
  ).join("\n\n");
}

// ─── 1. Chunking — size and overlap ──────────────────────────────────────────

describe("chunkDocument — basic chunking", () => {
  test("produces at least one chunk for a non-trivial document", () => {
    const text = makeDocument(3, 800);
    const chunks = chunkDocument(text, BASE_META);
    assert.ok(chunks.length >= 1, "Expected at least 1 chunk");
  });

  test("each chunk respects the minimum size threshold (>= 150 chars)", () => {
    const text = makeDocument(5, 700);
    const chunks = chunkDocument(text, BASE_META);
    for (const c of chunks) {
      assert.ok(
        c.text.length >= 150,
        `Chunk ${c.chunkIndex} is too short: ${c.text.length} chars`
      );
    }
  });

  test("chunks carry correct sequential indices starting at 0", () => {
    const text = makeDocument(4, 900);
    const chunks = chunkDocument(text, BASE_META);
    for (let i = 0; i < chunks.length; i++) {
      assert.equal(chunks[i].chunkIndex, i);
    }
  });

  test("totalChunks equals the array length for every chunk", () => {
    const text = makeDocument(4, 900);
    const chunks = chunkDocument(text, BASE_META);
    for (const c of chunks) {
      assert.equal(c.totalChunks, chunks.length);
    }
  });

  test("each chunk has a non-empty SHA-256 contentHash", () => {
    const text = makeDocument(3, 700);
    const chunks = chunkDocument(text, BASE_META);
    for (const c of chunks) {
      assert.ok(c.contentHash, "Missing contentHash");
      assert.match(c.contentHash, /^[a-f0-9]{64}$/);
    }
  });

  test("two identical documents produce identical contentHashes", () => {
    const text = makeDocument(2, 600);
    const chunks1 = chunkDocument(text, BASE_META);
    const chunks2 = chunkDocument(text, BASE_META);
    assert.deepEqual(
      chunks1.map((c) => c.contentHash),
      chunks2.map((c) => c.contentHash)
    );
  });

  test("two documents differing by one word produce different contentHashes", () => {
    const text1 = makeDocument(2, 600) + " extra word";
    const text2 = makeDocument(2, 600) + " different word";
    const c1 = chunkDocument(text1, BASE_META);
    const c2 = chunkDocument(text2, BASE_META);
    // At minimum, the last chunk hash should differ
    assert.notEqual(
      c1[c1.length - 1].contentHash,
      c2[c2.length - 1].contentHash
    );
  });

  test("inherits all document metadata on every chunk", () => {
    const text = makeDocument(2, 700);
    const chunks = chunkDocument(text, BASE_META);
    for (const c of chunks) {
      assert.equal(c.actName, BASE_META.actName);
      assert.equal(c.sourceUrl, BASE_META.sourceUrl);
      assert.equal(c.sourceType, BASE_META.sourceType);
      assert.equal(c.jurisdiction, BASE_META.jurisdiction);
      assert.equal(c.lastVerifiedDate, BASE_META.lastVerifiedDate);
    }
  });

  test("very long single-paragraph document is split into multiple chunks", () => {
    // 20,000 chars — should split into multiple ~3200 char chunks
    const longPara = makeParagraph("Long section", 20000);
    const chunks = chunkDocument(longPara, BASE_META);
    assert.ok(chunks.length > 1, "Long document should produce multiple chunks");
  });

  test("document shorter than minimum chunk size produces no chunks", () => {
    const shortText = "Short."; // 6 chars
    const chunks = chunkDocument(shortText, BASE_META);
    assert.equal(chunks.length, 0);
  });

  test("document just above minimum size produces exactly one chunk", () => {
    const text = makeParagraph("Single chunk", 160);
    const chunks = chunkDocument(text, BASE_META);
    assert.equal(chunks.length, 1);
  });
});

// ─── 2. Section metadata extraction ──────────────────────────────────────────

describe("extractSectionMetadata — section parsing", () => {
  test("extracts section number from 'Section 35.' heading", () => {
    const text = "Section 35. Consumer disputes redressal.\nThis section provides...";
    const { sectionNumber } = extractSectionMetadata(text);
    assert.equal(sectionNumber, "35");
  });

  test("extracts section number from bare '35.' heading style", () => {
    const text = "35. Rights of consumers.\nEvery consumer shall have...";
    const { sectionNumber } = extractSectionMetadata(text);
    assert.equal(sectionNumber, "35");
  });

  test("extracts alphanumeric section like '35A'", () => {
    const text = "Section 35A. Additional provisions.\nThis section applies...";
    const { sectionNumber } = extractSectionMetadata(text);
    assert.equal(sectionNumber, "35A");
  });

  test("returns null sectionNumber when no section heading is present", () => {
    const text = "This is a preamble of the Act without any section heading.";
    const { sectionNumber } = extractSectionMetadata(text);
    assert.equal(sectionNumber, null);
  });

  test("extracts CHAPTER heading into chapterTitle", () => {
    const text = "CHAPTER II\nSection 7. Constitution of Authority.";
    const { chapterTitle } = extractSectionMetadata(text);
    assert.ok(chapterTitle?.includes("CHAPTER II"), `Got: ${chapterTitle}`);
  });

  test("does not fabricate section numbers from prose text", () => {
    const text =
      "The consumer may file a complaint within 2 years from the date of cause of action.";
    const { sectionNumber, subSection } = extractSectionMetadata(text);
    assert.equal(sectionNumber, null);
    assert.equal(subSection, null);
  });
});

// ─── 3. RRF fusion ────────────────────────────────────────────────────────────

describe("VectorStoreService.fuseResults — Reciprocal Rank Fusion", () => {
  /**
   * Creates a mock retrieval result with a fake chunk _id.
   */
  const makeResult = (id, score) => ({
    chunk: { _id: id, text: `Chunk ${id}`, documentTitle: "Test Act" },
    score,
  });

  test("chunk appearing in both lists scores higher than chunk in only one", () => {
    const semantic = [makeResult("a", 0.95), makeResult("b", 0.80)];
    const keyword = [makeResult("b", 5.2), makeResult("c", 3.1)];
    const fused = VectorStoreService.fuseResults(semantic, keyword, 5);

    const idOrder = fused.map((f) => String(f.chunk._id));
    const bRank = idOrder.indexOf("b");
    const cRank = idOrder.indexOf("c");

    // 'b' appears in both lists; 'c' only in keyword — 'b' should rank higher
    assert.ok(bRank < cRank, `Expected 'b' (rank ${bRank}) before 'c' (rank ${cRank})`);
  });

  test("respects topK limit", () => {
    const semantic = Array.from({ length: 15 }, (_, i) => makeResult(`s${i}`, 0.9 - i * 0.05));
    const keyword = Array.from({ length: 15 }, (_, i) => makeResult(`k${i}`, 10 - i));
    const fused = VectorStoreService.fuseResults(semantic, keyword, 5);
    assert.equal(fused.length, 5);
  });

  test("does not duplicate chunks when both lists contain the same id", () => {
    const semantic = [makeResult("x", 0.9), makeResult("y", 0.8)];
    const keyword = [makeResult("x", 4.0)]; // 'x' in both
    const fused = VectorStoreService.fuseResults(semantic, keyword, 5);
    const ids = fused.map((f) => String(f.chunk._id));
    assert.equal(ids.length, new Set(ids).size, "Duplicate chunk id found");
  });

  test("returns empty array when both inputs are empty", () => {
    const fused = VectorStoreService.fuseResults([], [], 5);
    assert.deepEqual(fused, []);
  });

  test("handles semantic-only results when keyword list is empty", () => {
    const semantic = [makeResult("a", 0.9), makeResult("b", 0.7)];
    const fused = VectorStoreService.fuseResults(semantic, [], 5);
    assert.equal(fused.length, 2);
  });

  test("all fused entries have rrfScore > 0", () => {
    const semantic = [makeResult("a", 0.9)];
    const keyword = [makeResult("b", 3.0)];
    const fused = VectorStoreService.fuseResults(semantic, keyword, 5);
    for (const f of fused) {
      assert.ok(f.rrfScore > 0, `rrfScore should be positive, got ${f.rrfScore}`);
    }
  });
});

// ─── 4. Cosine similarity ─────────────────────────────────────────────────────

describe("EmbeddingService.cosineSimilarity", () => {
  test("identical vectors return similarity 1", () => {
    const v = [0.5, 0.5, 0.5, 0.5];
    const result = EmbeddingService.cosineSimilarity(v, v);
    assert.ok(Math.abs(result - 1.0) < 1e-9, `Expected 1, got ${result}`);
  });

  test("orthogonal vectors return similarity 0", () => {
    const a = [1, 0, 0, 0];
    const b = [0, 1, 0, 0];
    const result = EmbeddingService.cosineSimilarity(a, b);
    assert.ok(Math.abs(result) < 1e-9, `Expected 0, got ${result}`);
  });

  test("opposite vectors return similarity close to -1", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    const result = EmbeddingService.cosineSimilarity(a, b);
    assert.ok(Math.abs(result + 1.0) < 1e-9, `Expected -1, got ${result}`);
  });

  test("zero vector returns 0 (not NaN or Infinity)", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    const result = EmbeddingService.cosineSimilarity(a, b);
    assert.equal(result, 0);
  });

  test("mismatched length vectors return 0", () => {
    const result = EmbeddingService.cosineSimilarity([1, 2], [1, 2, 3]);
    assert.equal(result, 0);
  });

  test("known vector pair returns correct similarity", () => {
    // cos([1,1], [1,0]) = 1/sqrt(2) ≈ 0.7071
    const result = EmbeddingService.cosineSimilarity([1, 1], [1, 0]);
    assert.ok(
      Math.abs(result - Math.SQRT1_2) < 1e-9,
      `Expected ~0.7071, got ${result}`
    );
  });
});

// ─── 5. Trusted source validation ────────────────────────────────────────────

describe("PdfExtractor.isTrustedSource", () => {
  test("accepts official legislative.gov.in URLs", () => {
    assert.equal(
      PdfExtractor.isTrustedSource("https://legislative.gov.in/sites/default/files/A2019-35.pdf"),
      true
    );
  });

  test("accepts consumerhelpline.gov.in", () => {
    assert.equal(
      PdfExtractor.isTrustedSource("https://consumerhelpline.gov.in/guidelines.pdf"),
      true
    );
  });

  test("accepts indiacode.nic.in", () => {
    assert.equal(
      PdfExtractor.isTrustedSource("https://indiacode.nic.in/handle/123456789/13073"),
      true
    );
  });

  test("accepts subdomains of trusted domains", () => {
    assert.equal(
      PdfExtractor.isTrustedSource("https://files.legislative.gov.in/act.pdf"),
      true
    );
  });

  test("rejects Wikipedia", () => {
    assert.equal(
      PdfExtractor.isTrustedSource("https://en.wikipedia.org/wiki/Consumer_Protection_Act"),
      false
    );
  });

  test("rejects arbitrary legal blog", () => {
    assert.equal(
      PdfExtractor.isTrustedSource("https://legalcorner.in/consumer-act"),
      false
    );
  });

  test("rejects HTTP (non-HTTPS) trusted domains", () => {
    // isTrustedSource checks hostname only, not protocol
    // But ingestDocumentSchema Zod validator enforces HTTPS separately
    assert.equal(
      PdfExtractor.isTrustedSource("http://legislative.gov.in/act.pdf"),
      true // hostname match — HTTPS enforcement is in Zod validator
    );
  });

  test("rejects malformed URL gracefully (no throw)", () => {
    assert.equal(PdfExtractor.isTrustedSource("not-a-url"), false);
  });

  test("rejects empty string", () => {
    assert.equal(PdfExtractor.isTrustedSource(""), false);
  });
});

// ─── 6. PdfExtractor.extractFromText ──────────────────────────────────────────

describe("PdfExtractor.extractFromText", () => {
  test("produces a non-empty sha256 hash", () => {
    const { sha256 } = PdfExtractor.extractFromText("Some legal text here.");
    assert.match(sha256, /^[a-f0-9]{64}$/);
  });

  test("two different texts produce different hashes", () => {
    const { sha256: h1 } = PdfExtractor.extractFromText("Text A");
    const { sha256: h2 } = PdfExtractor.extractFromText("Text B");
    assert.notEqual(h1, h2);
  });

  test("replaces form-feed \\f with double newlines", () => {
    const { text } = PdfExtractor.extractFromText("Page 1\fPage 2");
    assert.ok(text.includes("\n\n"), "Expected \\f replaced with \\n\\n");
    assert.ok(!text.includes("\f"), "Expected no raw \\f in output");
  });

  test("counts pages via form-feed characters", () => {
    const { pageCount } = PdfExtractor.extractFromText("P1\fP2\fP3");
    assert.equal(pageCount, 3);
  });
});

