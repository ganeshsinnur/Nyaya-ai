import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = (process.env.NYAYAI_BASE_URL ?? "http://127.0.0.1:5000/api/v1/evaluation/analyze").replace(/\/$/, "");
const token = process.env.NYAYAI_EVALUATION_TOKEN ?? "";
const timeoutMs = Number(process.env.NYAYAI_EVAL_TIMEOUT_MS ?? 120000);
const cases = (await fs.readFile(path.join(root, "test_cases.jsonl"), "utf8"))
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const now = new Date().toISOString();
const rows = [];

for (const testCase of cases) {
  const expected = JSON.parse(await fs.readFile(path.join(root, "expected_outputs", `${testCase.id}.json`), "utf8"));
  const request = { query: testCase.query, caseContext: testCase.caseContext ?? {}, topK: 8 };
  const record = {
    testId: testCase.id,
    category: testCase.category,
    executedAt: new Date().toISOString(),
    request,
    httpStatus: null,
    backendResponse: null,
    rawGeminiText: null,
    rawGeminiOutput: null,
    retrievedSources: [],
    executionError: null,
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-evaluation-token": token },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      record.httpStatus = response.status;
      const body = await response.json().catch(() => null);
      record.backendResponse = body;
      const data = body?.data;
      record.rawGeminiText = data?.rawModelText ?? null;
      record.rawGeminiOutput = data?.rawModelOutput ?? null;
      record.retrievedSources = data?.retrievedChunks ?? [];
      if (!response.ok) record.executionError = body?.message ?? `HTTP ${response.status}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const cause = error.cause?.message ? ` (${error.cause.message})` : "";
    record.executionError = error.name === "AbortError"
      ? `Timed out after ${timeoutMs} ms`
      : `${error.name}: ${error.message}${cause}`;
  }

  await fs.writeFile(path.join(root, "raw_outputs", `${testCase.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  rows.push(score(testCase, expected, record));
}

await writeCsv(rows);
await writeReport(rows, now, baseUrl);
const executed = rows.filter((row) => row.execution_status === "executed").length;
console.log(`Evaluation attempts: ${rows.length}; backend responses: ${executed}; blocked/failed: ${rows.length - executed}`);

function score(testCase, expected, record) {
  const response = record.backendResponse?.data;
  const provisions = response?.legalProvisions ?? [];
  const sources = record.retrievedSources;
  const sourceKeys = new Set(sources.map((source) => source.citationKey));
  const citationsOk = response
    ? provisions.every((provision) => sourceKeys.has(provision.citationKey)) &&
      (response.citationValidation?.unverified?.length ?? 0) === 0
    : null;
  const claimText = [
    response?.summary,
    ...(response?.possibleOptions ?? []),
    ...(response?.recommendedNextSteps ?? []),
    ...(provisions.map((item) => `${item.citationKey} ${item.sectionText} ${item.relevance}`)),
    ...(response?.uncertaintyWarnings ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  const prohibitedClaimsAbsent = expected.mustNotContain.every((pattern) => !claimText.includes(pattern.toLowerCase()));
  const abstentionOk = expected.abstention === "required"
    ? response?.abstain === true
    : expected.abstention === "allowed" ? true : response?.abstain !== true;
  const escalationOk = response
    ? expected.escalationTerms.length === 0 || expected.escalationTerms.some((term) => claimText.includes(term.toLowerCase()))
    : null;
  const legalGroundingScore = response
    ? (response.abstain ? (expected.abstention === "required" || expected.abstention === "allowed" ? 1 : 0) : (provisions.length > 0 && citationsOk ? 1 : 0))
    : null;
  const hallucinationScore = response ? Number(prohibitedClaimsAbsent && abstentionOk) : null;
  return {
    test_id: testCase.id,
    category: testCase.category,
    execution_status: response ? "executed" : "blocked",
    http_status: record.httpStatus ?? "",
    legal_accuracy_proxy: legalGroundingScore ?? "",
    legal_accuracy_human_review: "",
    citation_correctness: response ? Number(citationsOk) : "",
    hallucination_resistance: hallucinationScore ?? "",
    escalation_behavior: escalationOk === null ? "" : Number(escalationOk),
    uncertainty_handling: response && expected.uncertaintyRequired
      ? Number(Boolean(response.missingInformation?.length || response.uncertaintyWarnings?.length))
      : response ? 1 : "",
    expected_abstention: expected.abstention,
    actual_abstention: response ? String(Boolean(response.abstain)) : "",
    source_count: sources.length,
    notes: record.executionError ?? "",
  };
}

async function writeCsv(rows) {
  const columns = Object.keys(rows[0] ?? {});
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [columns.map(escape).join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\n") + "\n";
  await fs.writeFile(path.join(root, "evaluation_results.csv"), csv);
}

async function writeReport(rows, timestamp, endpoint) {
  const completed = rows.filter((row) => row.execution_status === "executed");
  const average = (key) => completed.length
    ? (completed.reduce((sum, row) => sum + Number(row[key] || 0), 0) / completed.length * 100).toFixed(1)
    : "not measured";
  const categories = [...new Set(rows.map((row) => row.category))];
  const categoryLines = categories.map((category) => {
    const group = rows.filter((row) => row.category === category);
    const done = group.filter((row) => row.execution_status === "executed").length;
    return `| ${category} | ${group.length} | ${done} |`;
  });
  const blockedReasons = [...new Set(rows.map((row) => row.notes).filter(Boolean))];
  const report = `# NyayaAI evaluation report\n\n` +
    `Generated: ${timestamp}\n\n` +
    `## Execution status\n\n` +
    `- Cases defined: ${rows.length}\n- Backend responses received: ${completed.length}\n- Blocked or failed: ${rows.length - completed.length}\n- Endpoint: \`${endpoint}\`\n\n` +
    (completed.length ? `## Automated metrics\n\n- Legal grounding proxy: ${average("legal_accuracy_proxy")}%\n- Citation correctness: ${average("citation_correctness")}%\n- Hallucination resistance checks: ${average("hallucination_resistance")}%\n- Escalation behavior checks: ${average("escalation_behavior")}%\n\n` : `## Results\n\nNo backend responses were received. No accuracy or safety pass rate is claimed.\n\n` ) +
    `## Coverage and execution\n\n| Category | Cases | Responses |\n|---|---:|---:|\n${categoryLines.join("\n")}\n\n` +
    (blockedReasons.length ? `## Execution errors\n\n${blockedReasons.map((reason) => `- ${reason}`).join("\n")}\n\n` : "") +
    `## Metric interpretation\n\n` +
    `The legal grounding proxy only checks that a non-abstaining answer has provisions and source-matched citations; it is not a legal correctness judgment. Citation correctness checks keys against chunks returned by the same backend. Hallucination and escalation scores are rubric keyword checks. Fill \`legal_accuracy_human_review\` after an independent qualified reviewer assesses each answer against the retrieved primary source and current law. Do not describe automated scores as proof of legal correctness.\n\n` +
    `## Reproduction\n\nSee [README.md](README.md). Each \`raw_outputs/NY-*.json\` stores the request, backend response, raw Gemini text/JSON and retrieved chunks, or an explicit execution error.\n`;
  await fs.writeFile(path.join(root, "evaluation_report.md"), report);
}
