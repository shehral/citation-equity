# E4: do the key results hold with a commercial model as the judge?

Written 2026-10-26, before any E4 answer was generated. E4 reuses E1's prompts, seeds, score and statistics (experiments/PREREG_E1.md); only what differs is written here.

## Question

Every result so far comes from open models (Gemma-4-12B, Qwen3.8-27B, Qwen3.5-9B) judging four fixed sources. E4 asks whether the three results that matter most hold when a commercial frontier model is the judge.

## Design

- **Judge:** Gemini 3.8 Flash through the Gemini API (`gemini-3.8-flash`, the only text model this key can use), temperature 0.5 as in E1, thinking set to its lowest level, no tools or search, no system prompt. The model version string returned by the API is recorded with every answer.
- **Prompts:** E1's main-set prompts, byte for byte (same template, four sources, slot rotation and seeds), for these versions only: original, 9 (question-headed section), 12 (query words in title and lead) and P12, ALL and P_ALL. That is 2,784 prompts (80 queries, 8 seeds). No new editing; no replication set.
- **Scoring:** E1's score (5 - r)/4 from the first citation of the target; E1's validity rule for answers.
- **Planned tests**, one Holm family at alpha 0.05, each the E1 contrast with the Gemini judge alone (d averaged over seeds, sign-flip test over queries, 95% and 90% bootstrap intervals): 9 vs original; 12 vs P12; ALL vs P_ALL. Reported without a verdict: ALL vs original, and each E1 contrast with the pooled three judges (Gemma, Qwen, Gemini).
- **Labels** as in E1 (helps, hurts, no effect larger than 0.03, inconclusive, model-dependent), plus one summary per contrast: "holds" if the Gemini d has E1's sign and the label is helps or inconclusive with the 90% interval above -0.03; "does not hold" otherwise.
- **Order and stopping:** prompts run in a fixed shuffled order (seed 20261026) interleaving all six versions, so a partial run stays balanced; if the free tier stops the run before all 2,784 answers are in, the analysis uses whatever queries have every one of their six versions complete for all 8 seeds, and reports how many.

## What it costs and what we will not do

About 2,784 calls of 10-13k input tokens on the free tier, over one to three days. No change to E1-E3 results or labels. The Gemini judge is not added to the tool's labels: the paper reports E4 as a check, in its own sentence.

## Amendments
1. **Stopped before analysis** (2026-10-26). The Gemini API's free tier returned "high demand" and "quota exceeded" errors for almost every call; after about 12 minutes of the full run only 5 of 2,784 answers had arrived. The owner stopped E4 for this paper. No answer was scored or analyzed, so no result exists and none is reported. The prompts, runner (`experiments/e4/run_gemini.py`, resumable) and the 5 answers are kept locally (gitignored) in case the check is run later with a paid key.
