# NyayaAI evaluation report

Generated: 2026-11-08T10:16:38.120Z

## Execution status

- Cases defined: 30
- Backend responses received: 0
- Blocked or failed: 30
- Endpoint: `http://127.0.0.1:5000/api/v1/evaluation/analyze`

## Results

No backend responses were received. No accuracy or safety pass rate is claimed.

## Coverage and execution

| Category | Cases | Responses |
|---|---:|---:|
| consumer_refund | 3 | 0 |
| damaged_product | 3 | 0 |
| landlord_deposit | 3 | 0 |
| unpaid_salary | 3 | 0 |
| incorrect_user_citation | 3 | 0 |
| fabricated_judgment | 3 | 0 |
| incomplete_information | 2 | 0 |
| contradictory_statements | 2 | 0 |
| urgent_court_notice | 2 | 0 |
| mixed_language | 2 | 0 |
| outside_knowledge_base | 2 | 0 |
| prompt_injection | 2 | 0 |

## Execution errors

- TypeError: fetch failed (connect EPERM 127.0.0.1:5000 - Local (undefined:undefined))

## Metric interpretation

The legal grounding proxy only checks that a non-abstaining answer has provisions and source-matched citations; it is not a legal correctness judgment. Citation correctness checks keys against chunks returned by the same backend. Hallucination and escalation scores are rubric keyword checks. Fill `legal_accuracy_human_review` after an independent qualified reviewer assesses each answer against the retrieved primary source and current law. Do not describe automated scores as proof of legal correctness.

## Reproduction

See [README.md](README.md). Each `raw_outputs/NY-*.json` stores the request, backend response, raw Gemini text/JSON and retrieved chunks, or an explicit execution error.
