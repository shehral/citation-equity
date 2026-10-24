# Pre-registration: bench sensitivity test

Written 2026-10-23, before any run of `experiments/explorer/sensitivity.py`.

## Question

Does an open model's choice of which source to cite respond to the content of a page when every competing page is on topic? If not, the bench cannot detect anything a creator does, and experiment E2 is pointless on that model.

## Design

- Questions: the 8 sample questions (4 espresso, 4 RAG) from `samples/*/pack.json`.
- Sources per prompt: 1 target page + 7 on-topic competitors drawn from that question's 12 synthetic competitor pages. For each (question, seed) the 7 competitors and the target's position are fixed by the seed, so the conditions below differ **only** in the target page's text (paired design).
- Target conditions:
  1. `offtopic`: the other sample's "before" draft (espresso draft for RAG questions and vice versa). Floor control.
  2. `before`: the sample's "before" draft.
  3. `after`: the sample's "after" draft (written in Task 8 by following the tool's suggestions, before any bench run).
  4. `answer_first`: the "before" draft with the question inserted as an H2 directly under the title, followed by one sentence that answers it (`ORACLE` in the script). This is the question-coverage intervention.
- Prompt: the bench's GEO prompt and reminder, identical to `packages/bench/src/prompt.ts` (re-implemented in Python for this test).
- Generation: vLLM, temperature 0.5, seeds 1..8, max 600 new tokens, context 16,384, thinking disabled where the chat template supports it.
- Models: Qwen3.5-9B, Gemma-4-12B-it, Qwen3.8-27B, Gemma-4-31B-it (all cached on Explorer).
- Per model: 8 questions x 4 conditions x 8 seeds = 256 answers.

## Measures

For each answer: valid (at least one citation to a source 1..8); target cited; target share = citation markers pointing at the target / all citation markers. Per (model, condition, question) the mean over valid answers; per (model, condition) the mean over questions.

## Criteria (fixed before running)

- **H1, floor:** mean target share in `offtopic` is at most 0.05.
- **H2, sensitivity:** mean target share in `answer_first` exceeds `before` by at least 0.10, and the exact two-sided sign-flip test over the 8 per-question differences gives p at most 0.05.
- **Usable for E2:** valid-answer rate at least 0.90 and both H1 and H2 hold.
- `after` vs `before` is exploratory (a preview of E1). No criterion; reported either way.

## What would change the plan

- A model that fails H2 is dropped from E2.
- If every model fails H2, E2 is reported as "the bench cannot detect content differences with these models" and the paper leads with the measurement result instead.
