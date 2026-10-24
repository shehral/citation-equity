# How the E1 pre-registration changed after critique (2026-10-23)

Three independent critiques (statistics, validity, feasibility) were merged into this list. The feasibility numbers (fetch yield, C-SEO structure) were measured on real data.

**P0: must change before the freeze**
1. **Context overflow (all three critics).** Clean each page first: strip images and footnote markers. Then cap the original at 3,000 tokens, cutting at the last section boundary, before any editing. Every version therefore shares the same cut. Context becomes 32,768 tokens. A prompt over 31,000 tokens is refused before any job runs, and its query is excluded from every arm.
   - _Rejected:_ truncating each version separately (validity). It hides edits that fall past the cut, and it cuts different text in different arms.
   - _Rejected:_ "never truncate, only exclude" (stats). Live pages would lose too many queries.
2. **Footnote markers look like citations (feasibility).** Defuddle's `[^n]` markers match the bench's citation regex. A cleaning step removes images, footnote markers and footnote blocks, and turns links to the page's own site into plain text.
3. **Fetch yield (feasibility, measured).** Only 74% of pages fetched and 59% were usable. Fix:
   - Add a Wayback 2023 `id_` fallback through the same code path.
   - Never use `cleaned_text`.
   - Continue into the train and val splits.
   - Use a fixed fallback rule for queries with only 4 usable pages.
4. **Source order and the target's position (all three).** For each (query, seed), the order is the same in every version of that query. The target's slot rotates: across seeds 1-8 it sits in each of the 4 slots twice. Competitor order is seeded on (query, seed). Prompts are built directly, not through runBench's retrieval-ordered shuffle.
5. **Fixed source count and one scale (all three).** Every prompt has exactly 4 sources: the target and 3 competitors. A fifth page is the **donor**. It never appears in the prompt or the retrieval pool, and arms 5-7 take their figures, quotes and links only from it. This fixes the competitor-leakage bias the validity critic found. Primary outcome: citation score = (5 − r)/4, higher is better.
6. **Edits touch only the flagged spans (validity, feasibility).** The editor rewrites only the ranges the engine check reports. Text outside those spans must be byte-identical. Arms 4, 9, 11, 13 and 14 are deterministic or extractive, so no model writes them.
7. **The control matches the arm's footprint (conflict, resolved).** For every LLM-edited arm, P_A paraphrases exactly the same spans. The primary contrast is A − P_A, and it is used for both "helps" and "hurts". Deterministic arms are compared with the original, with a length and term-overlap adjustment.
   - The stats and feasibility critics wanted to keep the full-page paraphrase C. Once edits are span-local, a full-page rewrite has a much larger footprint than any arm, so the contrast would not mean the same thing across arms. Placebos are needed only for 7 arms plus ALL, which keeps the compute bounded.
8. **Multiplicity (all three; conflict resolved).**
   - Judges are pooled inside each query.
   - One two-sided test per arm.
   - Holm within two families: tool checks {2-10} and candidates {11, 12, 14}.
   - Arms 1 and 13 are descriptive only. ALL is tested in its own family.
   - "Helps" and "hurts" use the same rule, and both require each judge's mean to have the same sign. A "model-dependent" label is added for cases where the judges disagree.
   - The feasibility critic's concern about time is handled by a contingency: if Qwen does not finish, every arm switches to Gemma-only. That switch depends only on whether the runs completed, never on results.
9. **Test (stats, feasibility).** The sign-flip permutation test on query means replaces Wilcoxon. The query is the unit of analysis, and the test matches the reported mean and its bootstrap CI.
10. **Power, equivalence and what the tool does with each label (stats, validity).**
    - Add a power statement: MDE about 0.018-0.021 score units at n = 60-80.
    - Add an equivalence margin of ±0.03 score units, judged on the 90% CI.
    - Add an "inconclusive" label.
    - Each label maps to an action in the tool. Removing a check from the score also requires the C-SEO replication to agree.
    - _Rejected:_ the validity critic's margin of ±0.25 rank positions. That is 0.0625 score units, larger than the whole plausible effect range of 0.01-0.04, so it would label real effects as "negligible".
11. **Applicability is decided before any generation (all three).** Rules use the engine's own `applicable` flag, score ≥ 0.9, or "feature already present". The table is frozen. An arm with fewer than 30 analyzable queries gets no verdict. A no-op is never scored as a zero difference.
12. **Validators the repo can actually run (feasibility).** A regex check for new numbers, URLs and capitalized multi-word sequences replaces the NER check, which the repo can't run. Two new checks: nothing of the original is deleted, and the arm's own check passes.
13. **Arms 1 and 13 get no verdict (validity, feasibility).** Their mechanism needs passage-level retrieval, which this setup doesn't have. They are reported descriptively. A passage-level condition is noted as future E1b, not part of E1.
14. **What the freeze commit contains (validity, feasibility).**
    - Prompts, verbatim.
    - The validators and the analysis script.
    - A simulated null run.
    - The applicability table.
    - Hashes of the fetch log and the normalized pages.
    - Timing is smoke-tested on one query held out of the main set.

**P1: should change**
15. **Topical pages and a fair target (validity, feasibility).**
    - A usable page must contain at least half the query's key terms, and its title must not be generic.
    - The target is never a Wikipedia page when another choice exists.
    - The sha256 draw is stated exactly: UTF-8 query, pages in source order.
16. **Missing data (stats).** A (query, version, judge) cell needs at least 4 valid answers of 8. The valid-answer rate per arm is a secondary outcome.
17. **Length and query-term confounds (stats, validity).** One secondary regression of d on Δlog(length) and Δ(key-term count). Arm 2's new headings may use only words already in the heading or its section's first paragraph.
18. **Retrieval spec (validity, feasibility).**
    - The edited page replaces the original in the pool.
    - BM25 runs on the bench's `retrieve()` in Node, with ties broken by docId.
    - Outcomes: rank in the full pool, rank among the query's own 5 pages, and top 8.
    - The dense retriever is cut to save time.
19. **Replication set (validity, feasibility; facts corrected).** C-SEO `web` split replaces the 8 synthetic samples, which become a smoke test only. The validity critic described it as "10 documents per query, Name:/Description: form", which does not match the cached web rows (5 per query, flat text). The license is to be confirmed from the dataset card before the freeze.
20. **Arm tiers and run plan (feasibility, stats).** Tiers are fixed now. The cut order is: Tier 3, then Tier 2, then queries down to 60. Seeds never drop below 8. Every cut depends only on the timing projection and on what finished.
21. **Editor-family check (validity, feasibility).** Arms that earn a verdict are re-edited by Qwen3.8-27B and judged again, if time allows. Each label records whether this check has been done.
22. **Limits section (validity, feasibility).** Add:
    - No reranker and no current-date signal in the prompt.
    - One edit sample per arm.
    - Judges were chosen from exploratory results.
    - Editor and primary judge are both Gemma.
    - Wayback and Wikipedia pages are reported as their own subgroups.

**P2: nice to have**
23. Optional mixed model, reported only if it disagrees with the primary test.
24. Editor hardware and token limits stated.
25. The "attribute existing quote" variant of arm 6 is dropped (rarely applicable). Arm 6 is "add one donor quote".

---
