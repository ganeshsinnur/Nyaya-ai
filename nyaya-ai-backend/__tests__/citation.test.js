/**
 * Unit tests — Citation Validator (pure logic, no Gemini/DB calls)
 *
 * Coverage:
 *   1. Citation extraction from AI-generated answer text
 *   2. Validation — verified, unverified, partially verified
 *   3. Source type trust hierarchy
 *   4. Guidance-only answer warnings
 *   5. Empty / edge cases
 *   6. Claim support (token overlap grounding check)
 *   7. Fabricated citation detection
 */

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";

let CitationValidator;

before(async () => {
  const mod = await import("../src/services/rag/citationValidator.service.js");
  CitationValidator = mod.CitationValidator;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal FormattedChunk for testing */
const makeChunk = (overrides = {}) => ({
  _id: "64aabbcc1234567890abcdef",
  citationKey: "CPA2019 §35",
  actName: "Consumer Protection Act, 2019",
  sectionNumber: "35",
  subSection: null,
  chapterTitle: null,
  sourceType: "legislation",
  sourceUrl: "https://legislative.gov.in/sites/default/files/A2019-35.pdf",
  publicationDate: "2019-08-09",
  lastVerifiedDate: "2024-01-15",
  jurisdiction: "India",
  text: "Section 35. Subject to the other provisions of this Act, the District Commission shall have jurisdiction to entertain complaints where the value of the goods or services paid as consideration does not exceed one crore rupees.",
  ...overrides,
});

// ─── 1. Citation extraction from text ────────────────────────────────────────

describe("CitationValidator.extractCitationsFromText", () => {
  test("extracts bracketed citation keys like [CPA2019 §35]", () => {
    const text = "According to [CPA2019 §35], the district commission has jurisdiction.";
    const citations = CitationValidator.extractCitationsFromText(text);
    assert.ok(citations.some((c) => c.includes("CPA2019")), `Got: ${citations}`);
  });

  test("extracts 'Section X of the Act Name' pattern", () => {
    const text =
      "Section 35 of the Consumer Protection Act, 2019 provides for district commissions.";
    const citations = CitationValidator.extractCitationsFromText(text);
    assert.ok(citations.length > 0, "Expected at least one citation extracted");
  });

  test("extracts multiple citations from one text", () => {
    const text =
      "See [CPA2019 §35] and [CPR2020 §7] for the relevant provisions.";
    const citations = CitationValidator.extractCitationsFromText(text);
    assert.ok(citations.length >= 2, `Expected ≥2 citations, got ${citations}`);
  });

  test("returns empty array for text with no citation patterns", () => {
    const text = "Please consult a lawyer for further advice on your situation.";
    const citations = CitationValidator.extractCitationsFromText(text);
    assert.equal(citations.length, 0);
  });

  test("does not duplicate the same citation", () => {
    const text = "[CPA2019 §35] applies here and [CPA2019 §35] also applies there.";
    const citations = CitationValidator.extractCitationsFromText(text);
    const unique = new Set(citations);
    assert.equal(citations.length, unique.size, "Duplicate citations found");
  });

  test("extracts §-only patterns as partial citations", () => {
    const text = "Under §35, consumers may seek redress.";
    const citations = CitationValidator.extractCitationsFromText(text);
    assert.ok(
      citations.some((c) => c.includes("35")),
      `Expected §35 pattern, got: ${citations}`
    );
  });
});

// ─── 2. Citation validation — verified / unverified ──────────────────────────

describe("CitationValidator.validate — basic verification", () => {
  test("verifies a citation that exactly matches a chunk's citationKey", () => {
    const chunk = makeChunk({ citationKey: "CPA2019 §35" });
    const result = CitationValidator.validate(["CPA2019 §35"], [chunk]);
    assert.equal(result.verified.length, 1);
    assert.equal(result.unverified.length, 0);
    assert.equal(result.isFullyVerified, true);
  });

  test("marks a citation not in retrieved chunks as unverified", () => {
    const chunk = makeChunk({ citationKey: "CPA2019 §35" });
    const result = CitationValidator.validate(["CPA2019 §99"], [chunk]);
    assert.equal(result.unverified.length, 1);
    assert.equal(result.unverified[0], "CPA2019 §99");
  });

  test("handles mixed verified and unverified citations correctly", () => {
    const chunks = [
      makeChunk({ citationKey: "CPA2019 §35", _id: "aaa" }),
      makeChunk({ citationKey: "CPA2019 §8", _id: "bbb", sectionNumber: "8" }),
    ];
    const result = CitationValidator.validate(
      ["CPA2019 §35", "CPA2019 §8", "FAKE §999"],
      chunks
    );
    assert.equal(result.verified.length, 2);
    assert.equal(result.unverified.length, 1);
    assert.equal(result.unverified[0], "FAKE §999");
    assert.equal(result.isFullyVerified, false);
  });

  test("citation key matching is case-insensitive", () => {
    const chunk = makeChunk({ citationKey: "CPA2019 §35" });
    const result = CitationValidator.validate(["cpa2019 §35"], [chunk]);
    assert.equal(result.verified.length, 1, "Should match case-insensitively");
  });

  test("returns empty verified when no chunks are provided", () => {
    const result = CitationValidator.validate(["CPA2019 §35"], []);
    assert.equal(result.verified.length, 0);
    assert.equal(result.unverified.length, 1);
  });

  test("returns empty arrays when no citations are claimed", () => {
    const chunk = makeChunk();
    const result = CitationValidator.validate([], [chunk]);
    assert.equal(result.verified.length, 0);
    assert.equal(result.unverified.length, 0);
    assert.equal(result.isFullyVerified, true);
  });
});

// ─── 3. Source type trust hierarchy ──────────────────────────────────────────

describe("CitationValidator.validate — trust levels", () => {
  test("legislation citations have higher trust level than guidance", () => {
    const legChunk = makeChunk({
      citationKey: "CPA2019 §35",
      sourceType: "legislation",
      _id: "leg1",
    });
    const guidChunk = makeChunk({
      citationKey: "NCH2023 §1",
      actName: "NCH Guidance 2023",
      sourceType: "guidance",
      sectionNumber: "1",
      _id: "guid1",
    });

    const result = CitationValidator.validate(
      ["CPA2019 §35", "NCH2023 §1"],
      [legChunk, guidChunk]
    );

    const legEntry = result.verified.find((v) => v.citation === "CPA2019 §35");
    const guidEntry = result.verified.find((v) => v.citation === "NCH2023 §1");

    assert.ok(legEntry, "Legislation citation not verified");
    assert.ok(guidEntry, "Guidance citation not verified");
    assert.ok(
      legEntry.trustLevel > guidEntry.trustLevel,
      `Legislation trust (${legEntry.trustLevel}) should be > guidance trust (${guidEntry.trustLevel})`
    );
  });

  test("rules have higher trust than guidance but lower than legislation", () => {
    const rulesChunk = makeChunk({
      citationKey: "CPR2020 §7",
      actName: "Consumer Protection Rules, 2020",
      sourceType: "rules",
      sectionNumber: "7",
      _id: "rules1",
    });
    const guidChunk = makeChunk({
      citationKey: "NCH §3",
      actName: "National Consumer Helpline",
      sourceType: "guidance",
      sectionNumber: "3",
      _id: "guid2",
    });

    const result = CitationValidator.validate(
      ["CPR2020 §7", "NCH §3"],
      [rulesChunk, guidChunk]
    );
    const rulesEntry = result.verified.find((v) => v.sourceType === "rules");
    const guidEntry = result.verified.find((v) => v.sourceType === "guidance");

    assert.ok(rulesEntry.trustLevel > guidEntry.trustLevel);
    // Rules (3) < Legislation (4), but > guidance (0)
    assert.ok(rulesEntry.trustLevel < 4);
  });
});

// ─── 4. Guidance-only warnings ────────────────────────────────────────────────

describe("CitationValidator.validate — guidance-only warnings", () => {
  test("adds a warning when only guidance sources are cited (no legislation)", () => {
    const guidChunk = makeChunk({
      citationKey: "NCH2023 §1",
      actName: "NCH Guidance 2023",
      sourceType: "guidance",
      sectionNumber: "1",
      _id: "guid10",
    });
    const result = CitationValidator.validate(["NCH2023 §1"], [guidChunk]);
    assert.equal(result.hasLegislationCited, false);
    assert.ok(
      result.warnings.some((w) => w.toLowerCase().includes("guidance")),
      `Expected guidance warning, got: ${result.warnings}`
    );
  });

  test("does NOT add guidance warning when legislation is also cited", () => {
    const legChunk = makeChunk({ citationKey: "CPA2019 §35", _id: "l1" });
    const guidChunk = makeChunk({
      citationKey: "NCH §1",
      sourceType: "guidance",
      sectionNumber: "1",
      _id: "g1",
    });
    const result = CitationValidator.validate(
      ["CPA2019 §35", "NCH §1"],
      [legChunk, guidChunk]
    );
    assert.equal(result.hasLegislationCited, true);
    const hasGuidanceWarn = result.warnings.some(
      (w) => w.includes("guidance documents, not primary legislation")
    );
    assert.equal(hasGuidanceWarn, false, "Guidance warning should not appear when legislation is cited");
  });

  test("adds 'no sources found' warning when nothing is verified", () => {
    const result = CitationValidator.validate(["FAKE §999"], []);
    assert.ok(
      result.warnings.some((w) => w.toLowerCase().includes("no verified")),
      `Expected 'no verified' warning, got: ${result.warnings}`
    );
  });
});

// ─── 5. Fabricated citation detection ─────────────────────────────────────────

describe("CitationValidator — fabricated citation patterns", () => {
  test("citation with a section number far beyond the actual act is unverified", () => {
    const chunk = makeChunk({ citationKey: "CPA2019 §35" });
    // Model fabricates a §999 that doesn't exist
    const result = CitationValidator.validate(["CPA2019 §999"], [chunk]);
    assert.equal(result.unverified[0], "CPA2019 §999");
    assert.ok(result.warnings.length > 0);
  });

  test("completely invented act name is unverified", () => {
    const chunk = makeChunk({ citationKey: "CPA2019 §35" });
    const result = CitationValidator.validate(
      ["Imaginary Consumer Rights Act, 2020 §1"],
      [chunk]
    );
    assert.equal(result.unverified.length, 1);
  });

  test("validates multiple real citations and flags only the fake one", () => {
    const chunks = [
      makeChunk({ citationKey: "CPA2019 §35", _id: "r1" }),
      makeChunk({ citationKey: "CPA2019 §8", sectionNumber: "8", _id: "r2" }),
    ];
    const result = CitationValidator.validate(
      ["CPA2019 §35", "CPA2019 §8", "FakeAct2024 §99"],
      chunks
    );
    assert.equal(result.verified.length, 2);
    assert.equal(result.unverified.length, 1);
    assert.equal(result.isFullyVerified, false);
  });
});

// ─── 6. Claim support (token overlap grounding) ───────────────────────────────

describe("CitationValidator.isClaimSupportedByChunk", () => {
  const chunkText =
    "Section 35. Subject to the other provisions of this Act, the District Commission shall have jurisdiction to entertain complaints where the value of the goods or services paid as consideration does not exceed one crore rupees.";

  test("claim using words from the chunk is marked as supported", () => {
    const claim =
      "The District Commission has jurisdiction for complaints under one crore rupees.";
    const { supported } = CitationValidator.isClaimSupportedByChunk(claim, chunkText);
    assert.equal(supported, true);
  });

  test("claim about an entirely different topic is not supported", () => {
    const claim =
      "The Supreme Court grants leave to appeal in constitutional matters.";
    const { supported } = CitationValidator.isClaimSupportedByChunk(claim, chunkText);
    assert.equal(supported, false);
  });

  test("overlapRatio is between 0 and 1", () => {
    const claim = "jurisdiction for consumer complaints";
    const { overlapRatio } = CitationValidator.isClaimSupportedByChunk(claim, chunkText);
    assert.ok(overlapRatio >= 0 && overlapRatio <= 1, `Got: ${overlapRatio}`);
  });

  test("empty claim returns overlapRatio 0 and not supported", () => {
    const { supported, overlapRatio } = CitationValidator.isClaimSupportedByChunk("", chunkText);
    assert.equal(overlapRatio, 0);
    assert.equal(supported, false);
  });

  test("claim identical to chunk text returns high overlap", () => {
    const { overlapRatio } = CitationValidator.isClaimSupportedByChunk(
      chunkText,
      chunkText
    );
    assert.ok(overlapRatio >= 0.5, `Expected high overlap, got: ${overlapRatio}`);
  });
});

// ─── 7. Edge cases ────────────────────────────────────────────────────────────

describe("CitationValidator — edge cases", () => {
  test("handles citations array with duplicate entries without double-counting", () => {
    const chunk = makeChunk({ citationKey: "CPA2019 §35" });
    const result = CitationValidator.validate(
      ["CPA2019 §35", "CPA2019 §35"],
      [chunk]
    );
    // Both should resolve to the same chunk
    assert.ok(result.verified.length >= 1);
    assert.equal(result.unverified.length, 0);
  });

  test("handles chunk with no sectionNumber gracefully", () => {
    const chunk = makeChunk({ sectionNumber: null, citationKey: "CPA2019" });
    const result = CitationValidator.validate(["CPA2019"], [chunk]);
    assert.equal(result.verified.length, 1);
  });
});

