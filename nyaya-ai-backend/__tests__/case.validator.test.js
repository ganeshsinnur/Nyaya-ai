/**
 * Unit tests for the Zod case extraction validators.
 * Uses Node.js built-in test runner (node:test) — zero extra dependencies.
 *
 * Run:
 *   node --test src/__tests__/case.validator.test.js
 *
 * Coverage areas:
 *   1. Valid fully-populated payloads
 *   2. Incomplete information (null / absent fields)
 *   3. Contradictory-statement recording
 *   4. Incorrectly formatted dates
 *   5. Edge cases: urgency levels, completeness boundaries
 *   6. extractCaseSchema (request body)
 *   7. correctCaseSchema (user corrections)
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// ─── Schema imports ───────────────────────────────────────────────────────────
let extractedCaseSchema;
let extractCaseSchema;
let correctCaseSchema;

before(async () => {
  const mod = await import("../src/validators/case.validator.js");
  extractedCaseSchema = mod.extractedCaseSchema;
  extractCaseSchema = mod.extractCaseSchema;
  correctCaseSchema = mod.correctCaseSchema;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a fully valid extracted-case payload. */
const validExtracted = () => ({
  category: "Consumer Dispute",
  subCategory: "E-commerce Refund",
  jurisdiction: { state: "Karnataka", city: "Bengaluru" },
  parties: ["Rahul Sharma", "FlipKart India Pvt Ltd"],
  events: [
    {
      date: "2024-01-15",
      description: "User placed order for laptop worth ₹55,000.",
      peopleInvolved: ["Rahul Sharma"],
    },
    {
      date: "2024-01-22",
      description: "Order arrived damaged; return request filed.",
      peopleInvolved: ["Rahul Sharma", "Delivery agent"],
    },
  ],
  financialDetails: { amount: 55000, currency: "INR" },
  evidence: ["Order confirmation email", "Photograph of damaged product"],
  userClaims: ["I received a broken laptop"],
  missingInformation: ["Exact delivery date"],
  assumptions: ["Return was filed within the platform's return window"],
  contradictions: [],
  urgency: "medium",
  caseCompleteness: 72,
});

// ─── 1. Valid full payload ─────────────────────────────────────────────────────

describe("extractedCaseSchema — valid payloads", () => {
  test("accepts a fully-populated payload without errors", () => {
    const result = extractedCaseSchema.safeParse(validExtracted());
    assert.equal(result.success, true);
  });

  test("output data matches input for well-formed payload", () => {
    const { data } = extractedCaseSchema.safeParse(validExtracted());
    assert.equal(data.category, "Consumer Dispute");
    assert.equal(data.parties.length, 2);
    assert.equal(data.caseCompleteness, 72);
  });
});

// ─── 2. Incomplete information ────────────────────────────────────────────────

describe("extractedCaseSchema — incomplete information", () => {
  test("accepts null for category and subCategory", () => {
    const result = extractedCaseSchema.safeParse({
      ...validExtracted(),
      category: null,
      subCategory: null,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.category, null);
    assert.equal(result.data.subCategory, null);
  });

  test("defaults empty arrays when array fields are omitted", () => {
    const { parties, evidence, userClaims, missingInformation, assumptions, contradictions, ...rest } =
      validExtracted();
    const result = extractedCaseSchema.safeParse(rest);
    assert.equal(result.success, true);
    assert.deepEqual(result.data.parties, []);
    assert.deepEqual(result.data.evidence, []);
  });

  test("accepts null for event date (date unknown)", () => {
    const result = extractedCaseSchema.safeParse({
      ...validExtracted(),
      events: [{ date: null, description: "Complaint filed verbally", peopleInvolved: [] }],
    });
    assert.equal(result.success, true);
    assert.equal(result.data.events[0].date, null);
  });

  test("accepts null financial amount when amount is unknown", () => {
    const result = extractedCaseSchema.safeParse({
      ...validExtracted(),
      financialDetails: { amount: null, currency: "INR" },
    });
    assert.equal(result.success, true);
    assert.equal(result.data.financialDetails.amount, null);
  });

  test("accepts null for jurisdiction state and city", () => {
    const result = extractedCaseSchema.safeParse({
      ...validExtracted(),
      jurisdiction: { state: null, city: null },
    });
    assert.equal(result.success, true);
    assert.equal(result.data.jurisdiction.state, null);
    assert.equal(result.data.jurisdiction.city, null);
  });

  test("defaults urgency to 'low' when omitted", () => {
    const { urgency, ...rest } = validExtracted();
    const result = extractedCaseSchema.safeParse(rest);
    assert.equal(result.success, true);
    assert.equal(result.data.urgency, "low");
  });

  test("defaults caseCompleteness to 0 when omitted", () => {
    const { caseCompleteness, ...rest } = validExtracted();
    const result = extractedCaseSchema.safeParse(rest);
    assert.equal(result.success, true);
    assert.equal(result.data.caseCompleteness, 0);
  });

  test("accepts an entirely empty payload by using all defaults", () => {
    const result = extractedCaseSchema.safeParse({});
    assert.equal(result.success, true);
    assert.equal(result.data.category, null);
    assert.deepEqual(result.data.parties, []);
    assert.equal(result.data.urgency, "low");
    assert.equal(result.data.caseCompleteness, 0);
  });
});

// ─── 3. Contradictory statements ──────────────────────────────────────────────

describe("extractedCaseSchema — contradictory statements", () => {
  test("stores contradictions verbatim in the contradictions array", () => {
    const result = extractedCaseSchema.safeParse({
      ...validExtracted(),
      contradictions: [
        "User first said delivery was on Jan 22, later said Jan 25.",
        "User claimed refund was never initiated but also mentioned partial credit.",
      ],
    });
    assert.equal(result.success, true);
    assert.equal(result.data.contradictions.length, 2);
    assert.ok(result.data.contradictions[0].includes("Jan 22"));
  });

  test("accepts an empty contradictions array when none detected", () => {
    const result = extractedCaseSchema.safeParse({ ...validExtracted(), contradictions: [] });
    assert.equal(result.success, true);
    assert.deepEqual(result.data.contradictions, []);
  });

  test("rejects contradictions that are not strings", () => {
    const result = extractedCaseSchema.safeParse({
      ...validExtracted(),
      contradictions: [{ text: "not a string" }],
    });
    assert.equal(result.success, false);
  });
});

// ─── 4. Incorrectly formatted dates ──────────────────────────────────────────

describe("extractedCaseSchema — date validation", () => {
  const makeDateEvent = (date) => ({
    ...validExtracted(),
    events: [{ date, description: "Some event", peopleInvolved: [] }],
  });

  test("accepts YYYY-MM-DD formatted dates", () => {
    const result = extractedCaseSchema.safeParse(makeDateEvent("2024-03-25"));
    assert.equal(result.success, true);
    assert.equal(result.data.events[0].date, "2024-03-25");
  });

  test("accepts null for missing date", () => {
    const result = extractedCaseSchema.safeParse(makeDateEvent(null));
    assert.equal(result.success, true);
    assert.equal(result.data.events[0].date, null);
  });

  test("rejects human-readable date format '15 January 2024'", () => {
    const result = extractedCaseSchema.safeParse(makeDateEvent("15 January 2024"));
    assert.equal(result.success, false);
    const issue = result.error.issues[0];
    assert.ok(issue.message.includes("YYYY-MM-DD"));
  });

  test("rejects DD/MM/YYYY format", () => {
    const result = extractedCaseSchema.safeParse(makeDateEvent("25/03/2024"));
    assert.equal(result.success, false);
  });

  test("rejects empty string as date", () => {
    const result = extractedCaseSchema.safeParse(makeDateEvent(""));
    assert.equal(result.success, false);
  });

  test("rejects ISO 8601 datetime string with time component", () => {
    const result = extractedCaseSchema.safeParse(makeDateEvent("2024-03-25T10:30:00Z"));
    assert.equal(result.success, false);
  });
});

// ─── 5. Urgency & completeness edge cases ─────────────────────────────────────

describe("extractedCaseSchema — urgency and caseCompleteness", () => {
  test("accepts all valid urgency levels", () => {
    for (const urgency of ["low", "medium", "high", "critical"]) {
      const result = extractedCaseSchema.safeParse({ ...validExtracted(), urgency });
      assert.equal(result.success, true, `Expected success for urgency=${urgency}`);
      assert.equal(result.data.urgency, urgency);
    }
  });

  test("rejects an unknown urgency level", () => {
    const result = extractedCaseSchema.safeParse({ ...validExtracted(), urgency: "extreme" });
    assert.equal(result.success, false);
  });

  test("accepts caseCompleteness at boundary values 0 and 100", () => {
    assert.equal(
      extractedCaseSchema.safeParse({ ...validExtracted(), caseCompleteness: 0 }).success,
      true
    );
    assert.equal(
      extractedCaseSchema.safeParse({ ...validExtracted(), caseCompleteness: 100 }).success,
      true
    );
  });

  test("rejects caseCompleteness > 100", () => {
    const result = extractedCaseSchema.safeParse({ ...validExtracted(), caseCompleteness: 101 });
    assert.equal(result.success, false);
  });

  test("rejects caseCompleteness < 0", () => {
    const result = extractedCaseSchema.safeParse({ ...validExtracted(), caseCompleteness: -1 });
    assert.equal(result.success, false);
  });
});

// ─── 6. extractCaseSchema (request body) ──────────────────────────────────────

describe("extractCaseSchema — request body validation", () => {
  const validBody = () => ({
    conversation: [
      { role: "user", content: "I need help. My landlord hasn't returned my deposit." },
      { role: "assistant", content: "I understand. Can you tell me more?" },
    ],
  });

  test("accepts a valid conversation array without caseId", () => {
    const result = extractCaseSchema.safeParse(validBody());
    assert.equal(result.success, true);
  });

  test("accepts an optional valid caseId", () => {
    const result = extractCaseSchema.safeParse({
      ...validBody(),
      caseId: "507f1f77bcf86cd799439011",
    });
    assert.equal(result.success, true);
  });

  test("rejects an invalid caseId format", () => {
    const result = extractCaseSchema.safeParse({ ...validBody(), caseId: "not-an-objectid" });
    assert.equal(result.success, false);
  });

  test("rejects an empty conversation array", () => {
    const result = extractCaseSchema.safeParse({ conversation: [] });
    assert.equal(result.success, false);
  });

  test("rejects a conversation with invalid role", () => {
    const result = extractCaseSchema.safeParse({
      conversation: [{ role: "judge", content: "Order!" }],
    });
    assert.equal(result.success, false);
  });

  test("rejects messages with empty content", () => {
    const result = extractCaseSchema.safeParse({
      conversation: [{ role: "user", content: "" }],
    });
    assert.equal(result.success, false);
  });
});

// ─── 7. correctCaseSchema ─────────────────────────────────────────────────────

describe("correctCaseSchema — user corrections", () => {
  test("accepts a valid corrections array", () => {
    const result = correctCaseSchema.safeParse({
      corrections: [
        { field: "jurisdiction.state", value: "Maharashtra" },
        { field: "financialDetails.amount", value: 75000 },
      ],
    });
    assert.equal(result.success, true);
  });

  test("rejects an empty corrections array", () => {
    const result = correctCaseSchema.safeParse({ corrections: [] });
    assert.equal(result.success, false);
  });

  test("rejects corrections with an empty field name", () => {
    const result = correctCaseSchema.safeParse({
      corrections: [{ field: "", value: "Delhi" }],
    });
    assert.equal(result.success, false);
  });

  test("accepts any JSON value type (string, number, array, null, object)", () => {
    for (const value of ["Delhi", 1000, ["item"], null, { nested: true }]) {
      const result = correctCaseSchema.safeParse({
        corrections: [{ field: "category", value }],
      });
      assert.equal(result.success, true, `Expected success for value=${JSON.stringify(value)}`);
    }
  });
});
