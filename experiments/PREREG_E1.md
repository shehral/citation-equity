# Pre-registration: E1, which suggestions change citation?

**Status (changed):** FROZEN r3, 2026-10-24 (amendments 1-10 at the end), revised after three independent critiques (stats, validity, feasibility). The plan is frozen at commit `7859b07` (experiments/e1/freeze/MANIFEST.md). That commit contains:
- the editor prompt for every arm and placebo, verbatim;
- the validator script;
- the frozen applicability table;
- the analysis script, with its output on simulated null data (arm labels shuffled), showing about 5% familywise false positives per Holm family;
- the fetch-log schema, the fetch date range, and the sha256 of the local fetch log and of each normalized page.

No edited page from the main or replication set is generated, and no E1 answer is collected, before that commit. The one exception is the timing smoke, which runs on a query held out of both sets, and its outcomes are discarded.

## Question (unchanged)

For each kind of suggestion Citation Equity makes (and the candidate checks), does applying that one change to a real web page, holding everything else fixed, change whether and how early an open model cites the page, and whether a lexical retriever finds it? Which suggestions help, which do nothing, and which hurt?

## Data (changed)

**Main set: real, structured web pages from GEO-bench's source URLs** (Aggarwal et al., KDD 2024; `GEO-Optim/geo-bench` on Hugging Face). Research use only and never redistributed. The license text on the card is inconsistent, so nothing derived from the pages is committed beyond aggregate results and hashes.
1. Take the `test` split in dataset order. Continue into `val`, then `train`, if needed.
2. Keep queries whose tags include `informational` and whose text is a question or a how-to or explanation request. Rule: the query starts with a question word, or contains "how to", "why", "what is", "explain" or "difference between". Drop queries tagged `sensitive` or about named private individuals.
3. **Fetch (changed).** Fetch each of the query's 5 URLs live with `ce pack from-urls` (robots.txt respected, Defuddle to Markdown). If the live fetch fails or the page is unusable, fetch the closest 2023 Wayback snapshot (`https://web.archive.org/web/2023id_/<url>`, raw HTML without the toolbar) through the same code path. Record which source each page came from. GEO-bench `cleaned_text` and `raw_text` are never used, because they keep no headings, lists or tables.
4. **Normalization (new).** Applied once to the fetched text, before any choice, edit or validation:
   - remove Markdown images `![..](..)`;
   - remove footnote markers `[^n]` and the footnote definition block (they match the bench's citation pattern);
   - turn links to the page's own site into plain anchor text, and keep links to other sites.
5. **Usable page (changed).** After normalization a page must meet all of these:
   - (a) at least 250 words;
   - (b) contains at least half of the query's key terms (engine tokenizer);
   - (c) its title is not only a site name or a home, login, consent or error page title (the pattern list is fixed in the script).
   - **Cap:** a page longer than 3,000 tokens (taking the larger count of the two judge tokenizers) is cut at the last heading before 3,000 tokens, or at the last paragraph boundary if there is no heading. The cut page _is_ the original, so every version of that page shares the cut.
6. **Query admission (changed).** A query is admitted when all 5 of its pages are usable. Target n = 80 queries, floor 60, taken in dataset order.
   - Fallback, fixed now: if fewer than 60 five-page queries are found by the end of the `val` split or after 6 hours of fetching, whichever comes first, four-page queries are admitted in dataset order. They have no donor, and arms 5-7 are not applicable for them.
7. **Roles (changed).**
   - Target: index `int(sha256(query.encode("utf-8")).hexdigest(), 16) mod m`, over the usable pages in GEO-bench source order. `en.wikipedia.org` pages are excluded from this draw whenever at least one other usable page exists.
   - Donor: the same rule applied to `query + "|donor"` over the remaining pages. The donor is never placed in any prompt or in the retrieval pool.
   - Competitors: the other 3 pages.
8. The fetch log is kept locally and never committed. It records URL, source (live or Wayback), HTTP status, words, tokens, fetch timestamp, and sha256 of the normalized text. The page set is described as 2026 snapshots (live) or 2023 snapshots (Wayback) of GEO-bench URLs.

**Replication set (changed): C-SEO Bench `web` split** (`cseo/cseo-bench` on Hugging Face, the data release of `parameterlab/c-seo-bench` on GitHub; license confirmed from the dataset card before the freeze). It has 300 queries with 5 documents each. The documents are plain text with no headings, tables or URLs.
- Take the first 60 queries in dataset order whose 5 documents all meet rules 5(a) and 5(b) after the same cap, cutting at paragraph boundaries.
- Target, donor and competitors are drawn as in the main set. A donor quote or link is attributed by the donor's name, because the documents carry no URL.
- Arms run there: 5, 6, 7 (each with its placebo), 9, 11, 12, 14 (only where a date is present), and ALL-text with P_ALL. ALL-text is ALL restricted to arms 5-9.
- Structure arms (1-4, 10, 13) are not applicable by construction.

**Smoke set (changed):** the 8 sample questions in `samples/` check the pipeline only. They produce no reported results.

## Arms (one edited version of the target per arm) (changed)

Each arm changes one thing.
- Arms 2-10 are the tool's checks. They form confirmatory family A.
- Arms 11, 12 and 14 are candidate checks. They form confirmatory family B.
- Arms 1 and 13 are descriptive only: their mechanism needs passage-level retrieval, which this whole-page setup does not have. A passage-level condition is future work (E1b).
- ALL is the combined edit.

"Spans" means the issue ranges that the named engine check reports on the original, computed with `ce analyze --json --questions <query>`. "Ref" is the version the arm is compared against in the primary contrast.

| Arm               | Change                                                                                                                                                       | Mechanism                                                                                      | Ref                    | Tier |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------- | ---- |
| 1 standalone      | Paragraph openers that depend on earlier text ("This", "It") name their subject                                                                              | LLM, spans from `standalone-paragraphs`                                                        | original (descriptive) | 3    |
| 2 q-headings      | H2/H3 headings rephrased as the questions they answer, using only words already in that heading or in its section's first paragraph                          | LLM, spans from `question-headings`                                                            | P2                     | 2    |
| 3 lists           | Prose enumerations of 3+ items become lists with the same words                                                                                              | LLM, spans from `lists`                                                                        | P3                     | 2    |
| 4 tables          | Key-value runs become a table                                                                                                                                | Deterministic: the `tables` check's own `after` text                                           | original               | 3    |
| 5 statistics      | Claims flagged as unsupported get a figure taken from the donor, attributed with the donor's URL                                                             | LLM, spans from `statistics`                                                                   | P5                     | 1    |
| 6 quotes          | One short quotation (40 words or fewer) copied verbatim from the donor and attributed to the speaker the donor names, or else to the donor site              | LLM picks the quote and the span; the quote is spliced in verbatim; spans from `expert-quotes` | P6                     | 1    |
| 7 sources         | Flagged claims that the donor supports get a link to the donor's URL; not applicable if the editor returns NONE                                              | LLM, spans from `cited-sources`                                                                | P7                     | 1    |
| 8 answer-lead     | Each flagged section's first sentence becomes a direct answer, built from that section's own text                                                            | LLM, spans from `direct-answer-lead`                                                           | P8                     | 2    |
| 9 q-coverage      | An H2 that is the query text, directly under the title, followed by the page sentence with the highest overlap with the query's key terms (earliest on ties) | Extractive, deterministic                                                                      | original               | 1    |
| 10 comparisons    | Where the page discusses alternatives, an explicit comparison sentence built from its own content                                                            | LLM, spans from `comparisons`                                                                  | P10                    | 3    |
| 11 definitions    | The page's first sentence of the form "<key term> is/are …" is copied directly under the title; not applicable if there is none                              | Extractive, deterministic                                                                      | original               | 3    |
| 12 query-wording  | The query's missing key terms are worked into the title, the first heading and the first paragraph; only key terms and function words may be added           | LLM, those 3 spans                                                                             | P12                    | 2    |
| 13 passage-length | Sections over 400 words are split at the paragraph boundary nearest the middle, under a heading made of the first 8 or fewer words of the new section        | Deterministic                                                                                  | original (descriptive) | 3    |
| 14 dated          | The page's own publication or update date (found by regex) is shown as "Updated: <date>" under the title; not applicable if the page has no date             | Deterministic                                                                                  | original               | 3    |
| ALL               | Every applicable tool-check edit (arms 1-10), applied in the fixed order 3, 4, 2, 1, 8, 9, 10, 5, 6, 7, with spans recomputed after each step                | as for each arm                                                                                | P_ALL and original     | 1    |

**Placebos (new; this replaces the full-page control C).** For each LLM arm A (2, 3, 5, 6, 7, 8, 10, 12), P_A paraphrases exactly the spans A edited, measured in the original's coordinates. Its word count must stay within ±10% of those spans. It must keep every query key term the spans contain and add none of the arm's features: every engine check value stays within ±0.02 of the original. For arms 5-7, the spans are the sentences the insertion attaches to; P_A paraphrases them and inserts nothing. P_ALL paraphrases the union of the original spans touched by ALL's LLM steps. Arms 1 and 13 get no placebo, since they are descriptive.

**Applicability (new, frozen before any generation).**
- Arms 2-10 are not applicable to a page when the check returns `applicable = false` or a score of 0.9 or more on the original.
- Arms 11-14 are not applicable when the feature is already present.
- Arms 5-7 are not applicable when there is no donor.

Not-applicable pairs are excluded, never scored as zero. The table of (query, arm) applicability is part of the freeze commit.

**Editor (changed).**
- Model: Gemma-4-31B-it on Explorer (one H200, or 2x A100 with tensor parallelism 2), temperature 0, max 4,096 new tokens per call.
- One strict prompt per arm and per placebo. The prompt receives the spans and returns JSON `{span_id: replacement}`, and a script splices the replacements in.
- An edit cut off at the token limit counts as failed.

**Validity checks (changed; automatic, every edit):**
1. Text outside the spans is byte-identical to the original. For ALL, this is checked step by step.
2. The arm's own engine check value rises (arms 2-10), or the feature is present (arms 1, 11-14).
3. No number token (`[0-9][0-9.,%]*`), URL, or capitalized multi-word sequence (two or more consecutive capitalized words that do not start a sentence) appears unless it occurs verbatim in the target. Exceptions: the donor is also allowed for arms 5-7, and the query for arms 9, 11 and 12.
4. No heading, list item, table row or link of the original is removed, except where the arm converts it.
5. Length:
   - Arms 1-4, 8, 10, 12, 13: within 0.95x to 1.10x.
   - Additive arms 5, 6, 7, 9, 11, 14: at most 15% more words; added words are recorded.
   - Placebos: within ±10% of the span words.
   - ALL: within 0.9x to 1.6x.
6. Arm 3 keeps the multiset of content words (stopwords and Markdown removed) within 5%.

A failing edit is regenerated once, with the validator's message appended to the prompt. If it fails again, the (query, arm) pair is excluded. Per arm, the report includes counts of applicable pairs and of validity exclusions. Any arm with more than 20% validity exclusions is flagged. For every version, the report records edit distance, length ratio, and the change in query key-term count.

## Measurement (changed)

**1. Retrieval** (reported, no verdicts):
- Pool: every normalized page of the main set except donors, about 320 pages at n = 80. For each (query, arm), the target's original is replaced by its edited version; every other page stays as originally fetched.
- BM25: the bench's `retrieve()` (MiniSearch defaults, title + text) run in Node with k = pool size. Ties are broken by docId.
- Outcomes: the target's 1-based rank in the pool, its rank among the query's own 4 in-prompt pages, and whether it is in the top 8.
- Caveat: BM25 rewards lexical arms (12, 9, 2) by construction.

**2. Generation:**
- **Sources:** exactly 4 per prompt (target and 3 competitors).
- **Order:** for each (query, seed), the order depends only on (query, seed) and is identical across the original, every arm, every placebo and ALL. Seed s puts the target in slot ((s − 1) mod 4) + 1, so with seeds 1-8 each slot is used twice per query. Competitors fill the other slots in the order given by `random.Random(f"{query}|{seed}")`.
- **Prompt:** the bench's GEO prompt via `buildPrompt`, using the Python twin from the sensitivity test, checked byte-identical against `--export-prompts` on 10 prompts.
- **Settings:** vLLM, temperature 0.5, seeds 1-8, max 1,024 new tokens, `max_model_len` 32,768, thinking off. The export driver refuses any prompt over 31,000 tokens before any job is sent, and that query is excluded from every arm.

**Outcomes per answer:**
- **Valid:** at least one citation to a source 1-4.
- **Citation score (primary):** (5 − r) / 4. Here r is the target's position among distinct in-range sources in order of first citation, with r = 5 if the target is uncited. The score is 1 when the target is cited first, 0 when it is uncited, and higher is better. One rank position equals 0.25.
- **Secondary:** cited at all (a ceiling is expected), and PAWC citation share (bench `pawcShares`).

**Cells:** per (query, version, judge), the mean over valid answers. A cell with fewer than 4 valid answers of 8 drops that query from every contrast involving that version, and the drop is counted.

**Judge models (changed).**
- Primary: Gemma-4-12B-it.
- Second judge: Qwen3.8-27B (thinking off).
- Both were chosen from the exploratory part of the sensitivity test, where both gave consistent answers.
- Gemma-4-31B is the editor and is never a judge.
- Contingency, decided by completion status only: if Qwen has not finished every tested arm when the analysis starts, all verdicts use Gemma alone and are labelled "single-model". Qwen's finished results are reported as secondary.

## Analysis (fixed now) (changed)

- **Unit of analysis: the query.** Seeds, and then judges, are averaged within each query before any test. No test or interval treats answers as independent.
- **Primary statistic per (query, arm):**
  - d_q = mean over judges of [score(A) − score(Ref)], with Ref from the arms table.
  - A − original is computed for every arm and reported as secondary.
- **Test:** two-sided paired sign-flip permutation test on the mean of {d_q}. It is exact when n ≤ 12; otherwise it uses 100,000 draws (`numpy.random.default_rng(1)`) with p = (hits + 1) / (draws + 1). This is the Python twin of `metrics.ts signFlipP`, with more draws.
- **Intervals:** 95% and 90% percentile bootstrap over queries (10,000 resamples, seed 1). They are unadjusted and reported next to the Holm-adjusted p.
- **Families:**
  - Holm-Bonferroni at α = 0.05 within family A (arms 2-10) and, separately, within family B (11, 12, 14).
  - Each family contains only its arms that both completed and have at least 30 analyzable queries (applicable, valid, cells complete). Arms below 30 are reported as "insufficient n", with no verdict.
  - ALL: ALL − P_ALL and ALL − original, Holm over these 2.
  - Arms 1 and 13: estimates and CIs only.
- **Verdicts**, applied in this order:
  1. **model-dependent:** each judge's own mean d has a different sign, and either judge's own test gives unadjusted p < 0.01.
  2. **helps:** Holm-significant, pooled d > 0, and each judge's mean d > 0.
  3. **hurts:** Holm-significant, pooled d < 0, and each judge's mean d < 0.
  4. **no effect larger than δ:** the 90% CI of d lies within ±δ, with δ = 0.03 score units (0.12 rank positions).
  5. **inconclusive:** none of the above.
- **Power (new).** Assumptions taken from the raw sensitivity rows:
  - SD of the paired per-answer score difference: about 0.17.
  - Query-level SD of the effect: 0.7 × the effect.
  - Test efficiency: 0.95.
  - Power: 80% at the strictest Holm step.

  On that basis the minimum detectable d is about 0.021 at n = 60 and about 0.018 at n = 80 (0.07-0.08 rank positions). The plausible effect of one arm is 0.01-0.04. The report recomputes the MDE per arm from the realized SDs. Effects below about 0.02 cannot be ruled out, and the report says so.
- **Secondary (reported, no verdicts):**
  - Per-judge d and tests.
  - Cited-at-all and PAWC share.
  - Valid-answer rate per arm against Ref (same test).
  - Retrieval ranks (same test over queries).
  - d by target slot (1-4).
  - Wikipedia-target and Wayback-page subgroups.
  - **Confound regression:** per arm, regress d_q on Δlog(length) and Δ(query key-term count) and report the intercept with its 95% CI. An arm labelled helps whose adjusted CI includes 0 is reported as "helps, possibly through length or query-term overlap".
  - Optional, if time allows: `score ~ version * judge + (1|query) + (1|query:seed)` (statsmodels MixedLM, Gaussian) on answer-level scores. Reported only if it disagrees with the primary test in sign or significance for any arm.
- **Editor-family check (new, run only if time allows).** Every arm labelled helps or hurts is re-edited by Qwen3.8-27B (same prompts, spans and validators). Its arm and placebo versions are judged by Gemma-4-12B and Qwen3.5-9B.
  - The label stands if d keeps its sign; otherwise it becomes "editor-dependent".
  - Until this check runs, labels carry "Gemma-edited".
- **Replication set:** the same statistic, with Holm within that set. Its results are reported, and they are used only for the score-removal rule below.

## What the tool does with the result (changed)

| Label                                                                  | Tool action                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **helps**                                                              | Measured label on the suggestion (effect, CI, models); weight kept. A candidate check that helps is proposed as a new check.                                                                                                                                                                          |
| **hurts**                                                              | The advice is reworded with the finding straight away. The check is removed from the score only if the C-SEO replication shows d < 0 for that arm (unadjusted p < 0.05). If that arm was not replicated (structure arms) or the replication has not run yet, it stays scored, with the finding shown. |
| **no effect larger than δ**                                            | Becomes an unscored note.                                                                                                                                                                                                                                                                             |
| **inconclusive / insufficient n / model-dependent / editor-dependent** | Evidence grade kept, and "E1: <label> (d, CI)" added.                                                                                                                                                                                                                                                 |

## Limits stated up front (changed)

- **Setup:**
  - Open models of 9-31B parameters in a fixed context of 4 pre-selected sources, with no reranker and no snippets. This is not ChatGPT, Perplexity or Google.
  - The prompt carries no current date, so arm 14 tests date text, not freshness.
  - Arms 1 and 13 need passage-level retrieval and get no verdict here.
- **Pages:**
  - Live pages are 2026 snapshots, not what GEO-bench had in 2023; Wayback pages are reported as their own subgroup.
  - Measured live yield is low (about 30% of queries keep 4 of 5 pages without the fallback).
  - Pages over 3,000 tokens are cut.
  - Wikipedia is a large share of the competitors.
- **Editing:**
  - Each (query, arm) gets one edit at temperature 0, so variation between edits is folded into the per-query effect.
  - The editor and the primary judge are both Gemma models. The placebos (written by the same editor) and the optional Qwen-editor check are the controls for that.
- **Judges** were selected from the exploratory part of a sensitivity test whose pre-registered H2 failed for every model.
- **Power:** effects below about 0.02 score units (0.08 rank positions) cannot be ruled out.
- **Replication:** C-SEO tests only the text arms.

## Run plan and compute (new)

- **Day 1:**
  - Fetch, normalize and draw (CPU).
  - Build the applicability table, editor prompts, validators and analysis script, plus the null simulation.
  - Run the timing smoke on the held-out timing query (amendment 8: the last qualifying `test` query): all versions, 8 seeds, both judges.
  - Freeze the commit.
  - Start edits and generation in tier order. Within each tier, Gemma runs before Qwen.
- **Day 2:** finish generation, then retrieval, replication and analysis, then the editor-family check if time allows.
- **Expected size:** about 17 applicable versions × 80 queries × 8 seeds ≈ 11k answers per judge, at about 10-13k prompt tokens each. The editor needs about 80 × 9 span-edit jobs plus placebos. The smoke run turns these figures into GPU-hours.
- **Cut order if the projection exceeds the budget:**
  1. Tier 3.
  2. Tier 2 arms in the order 12, 3, 2, 8.
  3. Queries down to the 60 floor.
  4. Replication on Gemma only.

  Never cut: seeds below 8, Tier 1 (original, 9, 5, 6, 7, ALL and their placebos), or the primary judge. Every cut depends only on the timing projection and on what has finished, never on outcomes, and each one is logged with a timestamp.

## r3 amendments (2026-10-23, before the freeze)

Made after building the pipeline and before any edited page or answer exists. None depends on an outcome.

1. **Validity check 2 for arm 9 is its feature,** not a rise of `question-coverage`: the query appears as an H2 directly under the title, followed by a sentence copied verbatim from the page. Arm 9 is defined by extraction ("the page sentence with the highest overlap"), and that sentence often misses the check's 8-40-word, 60% key-term bar, so the literal rule would exclude most arm 9 pairs by construction (pipeline smoke 0/2, development pages 1/5). Applicability still uses the check (not applicable when it scores 0.9 or more).
2. **Validity check 2 for arm 7 on the replication set is its feature:** every edited claim names the donor, `(source: <donor name>)`. C-SEO documents carry no URL, so `cited-sources` (absolute links and footnotes only) cannot rise there; the replication section already requires attribution by name. On the main set arm 7 still needs `cited-sources` to rise. ALL-text step 7 follows the same rule.
3. **C-SEO dataset id** corrected to `cseo/cseo-bench` (Hugging Face), the data release of the paper's GitHub repo `parameterlab/c-seo-bench`. The donor "name" on the replication set is the document's first line, which can be uninformative (for example a reading-time line); this is recorded as a limit.
4. **Private-individual screen:** before the freeze, the controller reads the list of admitted main-set queries and drops any about a named private individual (Data 2); the dropped query ids are listed in the freeze commit.
5. **ALL with no applicable step** is recorded as "not applicable", not as a validity exclusion.
6. **Generation sharding:** if the timing smoke projects a generation job over 6 hours, the prompts file is split into shards in file order (a mechanical split, no outcome involved) and each shard runs as its own job.
7. **Node on the cluster:** the editor runs the engine bundle with Node 22 (`module load nodejs/v22.11.0` on Explorer); the bundle targets Node 22.
8. **Only the GEO-bench `test` split is usable.** On the Hugging Face datasets-server, the `val` and `train` splits (config `train`) hold only `query`, `dset` and `sugg_idx`: no tags and no source URLs, so no query there can qualify (verified against the API's /info endpoint and by a full read of `val`: 1,000 rows, 0 usable). The `test` split alone yields 391 qualifying queries, each with 5 URLs. Therefore:
   - Data 1 reads "the `test` split, in dataset order"; there is no continuation into `val` or `train`.
   - The four-page fallback triggers if fewer than 60 five-page queries are found by the end of the `test` split or after 6 hours of fetching, whichever comes first.
   - The timing smoke uses the **last** qualifying `test` query in dataset order, which is then excluded from the main set (it is never among the first 80 admitted at this yield).
9. **An ALL step that fails validation is skipped, not fatal to ALL.** r2 excluded ALL for a query whenever one of its steps failed twice. Now a step that still fails its validity checks after its one regenerate (a deterministic step, which has no regenerate, after its one attempt) is skipped: ALL continues from the version before that step, and the version records the step and the validator's messages in `skipped_steps`. ALL is excluded only when every step it attempted failed or was skipped (recorded as `invalid: every step failed`) or when the whole version fails check 3 or check 5. When no step was attempted because none was applicable, ALL is recorded as `not applicable: no step applied` (amendment 5), not as a validity exclusion. Every kept step still passes checks 1-4 and 6, so ALL stays "every applicable tool-check edit that passes validation"; P_ALL paraphrases only the spans of the kept LLM steps. `skipped_steps` stays in `versions.jsonl`, and `experiments/e1/validity_report.py` counts, per step, how many ALL versions skipped it. No threshold changes. Reason: in the timing smoke's edit job (the held-out query of amendment 8, whose outcomes are discarded), a failed arm 1 step excluded the whole ALL version, a Tier 1 arm, although its other steps passed. Made 2026-10-24, before the freeze, before any main or replication page was edited and before any judge answer was read.
   - Recorded with it, though not a change to the plan: the same edit job showed placebos paraphrasing 10-15% short and losing a query key term, and arm 1 rewriting a later sentence instead of the opening word. The editor's prompts (committed verbatim in the freeze commit) now give each placebo span's word count and allowed range and the query words it must keep or must not gain, and name each arm 1 span's pointer word with a worked example. The regenerate message adds the measured counts against those ranges and the arm 1 spans that still open with a pointer. The validators are unchanged.
10. **Validity check 3 reads Title Case in headings as style, not as a name.** On a Markdown heading line (a line starting with `#`) and on the page title line, a capitalized multi-word sequence that does not occur verbatim in the allowed sources counts as a new name only if at least one of its words, lowercased and stemmed with the key-term stemmer (`common.stem`), occurs nowhere in the allowed sources. Outside headings and the title the rule is unchanged (the sequence must occur verbatim), the sentence-initial word is still dropped as before, and numbers and URLs are checked as before. Reason: Title Case heading words were read as new names. In the timing smoke (the held-out query of amendment 8, whose outcomes are discarded), placebo P2, which paraphrases question headings, was rejected for "name 'FTC Listed', name 'Transparency Scores'" although both words of 'Transparency Scores' occur in the page in lower case; the literal rule would invalidate P2 (the control for arm 2) systematically and could hit arms 2 and 12. A heading that brings in a word absent from the sources (such as 'FTC' on a page that never names it) still fails. No other check and no threshold changes. Made 2026-10-24, before the freeze, before any main or replication page was edited and before any judge answer was read.
