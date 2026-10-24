# Results: bench sensitivity test

Run 2026-10-23 on Northeastern's Explorer cluster, as pre-registered in `PREREG_sensitivity.md`. Raw outputs: `results/sensitivity/`.

| Model          | Valid answers | Sources cited per answer (of 8) | Target share: offtopic | before | after | answer_first | answer_first - before (p) | after - before (p, exploratory) |
| -------------- | ------------- | ------------------------------- | ---------------------- | ------ | ----- | ------------ | ------------------------- | ------------------------------- |
| Qwen3.5-9B     | 100%          | 6.2                             | 0.003                  | 0.164  | 0.178 | 0.198        | +0.034 (0.055)            | +0.014 (0.52)                   |
| Gemma-4-12B-it | 100%          | 6.95                            | 0.001                  | 0.178  | 0.201 | 0.205        | +0.026 (0.008)            | +0.023 (0.008)                  |
| Qwen3.8-27B    | 100%          | 6.25                            | 0.000                  | 0.154  | 0.180 | 0.178        | +0.025 (0.008)            | +0.026 (0.008)                  |
| Gemma-4-31B-it | 100%          | 6.65                            | 0.000                  | 0.180  | 0.211 | 0.187        | +0.007 (0.58)             | +0.031 (0.039)                  |

Chance share = 0.125 (1 of 8 sources). p = exact two-sided sign-flip over 8 questions (smallest possible 0.0078).

## Against the pre-registered criteria

- H1 (floor, offtopic share <= 0.05): **holds for all four models.**
- H2 (answer_first - before >= 0.10 and p <= 0.05): **fails for all four models.** The differences are positive but 0.007 to 0.034, far below 0.10.
- Usable for E2 as pre-registered: **no model qualifies.**

## What the data show beyond the criteria (exploratory, not confirmatory)

- Relevance is detected sharply: an off-topic page is almost never cited, while on-topic pages are.
- With all sources on topic, every model cites most of them (6.2 to 7.0 of 8 per answer). A single page's share is therefore diluted, and realistic content edits move it by 1 to 3 points, not 10.
- The direction is consistent: answer_first beat before on all 8 questions for Gemma-4-12B and Qwen3.8-27B; after (the tool's suggestions applied) beat before on all 8 questions for those two models and with p 0.039 for Gemma-4-31B.
- The 0.10 threshold was set before we knew citations would be spread across 6 to 7 sources; it is kept as the reported outcome. Any E2 design must be pre-registered anew with a metric chosen for this dilution (for example whether the page is cited at all, or its rank among cited sources), before it runs.
