# NyayaAI evaluation harness

This harness submits every case in `test_cases.jsonl` to the running NyayaAI legal analysis service. It does not create mock model answers. Each attempt writes the HTTP result, exact Gemini response text/JSON when returned, retrieved legal chunks, and any transport or server error to `raw_outputs/`. Expected behavior is stored separately in `expected_outputs/`.

## Requirements

- Node.js 18 or newer and the project dependencies installed.
- MongoDB containing the legal RAG corpus used by the backend.
- A configured Gemini API key, model, and network access to Gemini.
- Start the backend with `NYAYAI_EVALUATION_MODE=true` and a private evaluation token.

Example, from the repository root:

```bash
NYAYAI_EVALUATION_MODE=true \
NYAYAI_EVALUATION_TOKEN='use-a-long-random-local-token' \
npm start
```

In another terminal, use the same token:

```bash
NYAYAI_BASE_URL='http://127.0.0.1:5000/api/v1/evaluation/analyze' \
NYAYAI_EVALUATION_TOKEN='use-a-long-random-local-token' \
node evaluation/run.mjs
```

To change the timeout per case, set `NYAYAI_EVAL_TIMEOUT_MS` (default 120000). The runner is sequential so source and model outputs stay attributable to one case. Re-running overwrites the per-case raw records and the aggregate CSV/report with the latest run; copy the directory first if you need to preserve a prior run.

## Output files

- `test_cases.jsonl`: 30 fictional test prompts and structured contexts.
- `expected_outputs/NY-*.json`: case-specific expected behavior and review rubric.
- `raw_outputs/NY-*.json`: actual backend/Gemini output, retrieved source chunks, or explicit execution failure.
- `evaluation_results.csv`: one row per case; blocked requests have blank metric values.
- `evaluation_report.md`: run counts and aggregate automated metrics.

## Scoring limits

`legal_accuracy_proxy` checks that a non-abstaining answer has legal provisions and source-matched citation keys. It does not establish that legal interpretation is correct. `citation_correctness` checks citation keys against chunks returned by the same retrieval pipeline. `hallucination_resistance`, `escalation_behavior`, and `uncertainty_handling` use the explicit criteria in each expected-output file and simple string checks; have a reviewer inspect the raw output before treating any automated check as a pass. Complete `legal_accuracy_human_review` only after independent comparison with authoritative primary sources and current law. These results are evaluation aids, not legal advice or certification.

Do not commit evaluation tokens, API keys, or real users' personal information. The evaluation endpoint is only mounted when `NYAYAI_EVALUATION_MODE=true` and still requires the `x-evaluation-token` header.
