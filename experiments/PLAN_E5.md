# E5: does the reader's-words gain survive when the writer has only a keyword?

Written 2026-11-03, before any E5 page version was built or any E5 answer generated. Revision r2, after three independent critiques of r1 (statistics, construct validity, feasibility against the code and data). E5 reuses E1's pages, editor, prompts, validators, judges, seeds, citation score and statistics (experiments/PREREG_E1.md) and E3's extra queries (experiments/PLAN_E3.md). Only what differs is written here.

## Question

In E1 to E3 the only edits that clearly raised citation added the reader's own words near the top of the page: the query as a section under the title (arm 9, +0.027 on the main set, +0.036 on the replication set) and the query's missing key words worked into the title, first heading and first paragraph (arm 12, +0.035 against its placebo). E2 found that the words carry the gain on the replication set (9 vs 9P helps) and pointed the same way on the main set (+0.017, inconclusive).

Every one of those edits used the exact query the page was then judged on. A writer never sees that query. At best they have a keyword (from Search Console, Bing Webmaster Tools or a guess), and the tool can turn a keyword into a question with a template or with a local model. E5 asks three things:

1. **New queries.** Does arm 9's gain hold on 180 GEO-bench test queries E1 never used?
2. **Missing words.** Does the edit still help when it carries only the two rarest key words of the reader's query and no other word (9K)?
3. **Wrong words.** Does it help when it carries the question the tool's local-model path writes from that keyword (9L), which can hold words the reader never used?

Every answer is produced and scored against the true query q. Only the text used to make the edit changes.

## Query sets

- **Main set: GEO-bench, pooled.** E1's 80 main queries plus E3's 180 new ones (72 five-page, 108 four-page), with E1's and E3's pages, roles and draws. Arms 9 and 12 build their edits from the target page alone, so four-page queries take every E5 version. E1's timing query stays out.
- **Replication set: C-SEO Bench `web`**, E1's 60 queries, run the same way and reported separately.
- The new queries are not a random sample: 108 are four-page fallback queries, all come later in dataset order, and they are longer (mean key-term count 4.11 in E1, 4.39 in E3 five-page, 4.70 in E3 four-page). Arm 9's gain rose with query length in E1. Every planned contrast is therefore also reported in three strata (E1, E3 five-page, E3 four-page), and the new-query estimate is also given reweighted to E1's key-term-count distribution (levels: 2 or fewer, 3, 4, 5 or more).

## The edit texts

All are computed from the query, the page pool and the original page only, before any E5 answer exists. A table of every query's k, q', the template used, q_L and q_G, with its sha256, is part of the freeze commit.

**Keyword k.** K(q) is E1's `common.content_terms(q)` (stemmed content words in query order). k is the two terms of K(q) that occur in the fewest pages of the set's page pool, kept in q's order and written as q's own surface word for each (its first occurrence, lowercased); ties go to the term that comes first in q; a query with one or two key terms keeps all of them. The page pool is the `pages.jsonl` rows of the set's admitted queries (main: E1 main, E3 five-page and E3 four-page; replication: E1's replication rows), the timing query excluded, text only, each distinct normalized text (by sha256) counted once.

**Keyword question q' (9K, 12K).** `keywordQuestion(k).text` from the tool's engine. Where no template fits, q' is k exactly as the tool returns it (lowercase). Pre-run counts on the main set: 231 of 260 queries keep k as written, 27 become "What is/are ...?", 2 become "How to ...?". By construction K(q') is k, a subset of K(q): q' holds no word outside q and only drops reader words. 9K therefore bounds the cost of missing words, not of wrong ones.

**Local-model question q_L (9L).** The tool's own path for questions from keywords (`packages/bench/src/questions-llm.ts`): `keywordQuestionsPrompt([k], 1)` sent to Gemma-4-31B-it with the tool's generation settings (its default temperature, seed 1, thinking off), parsed by the tool's rule (the first line that ends in "?" after the tool's line cleaning). Not applicable when no line qualifies. This is the only edit text that can carry words the reader did not use. It is generated in the editing job, after the freeze and before any answer.

**All key words, no echo (9A).** K(q)'s terms as q writes them (each term's first surface word, lowercased), in q's order, joined by single spaces, with no stopwords. It holds every reader key word but not the exact query string the judge prompt shows.

**Page question q_G (9G).** The first of the engine's `pageQuestions` on `# <title>`, a blank line and the page text (the way the workspace sees a draft with a title); on C-SEO, whose documents have no title, on the text alone. Not applicable when the list is empty. 9G is a question section written only in the page's own words: a question-form placebo, not a test of the tool's default (which suggests no edit when the writer enters nothing).

## Versions

| Version | Edit | Edit text | Built by |
|---|---|---|---|
| original | none (re-answered in E5, see Runs) | | |
| 9 | arm 9 | q | deterministic (E1's `arm9`) |
| 9P | E2's words-free section: `## <first N words of S>` then S, S the body sentence with the fewest key terms of q (PLAN_E2.md, amendment 1) | | deterministic (E2's `arm9p`) |
| 9K | arm 9 | q' | deterministic |
| 9L | arm 9 | q_L | deterministic, from q_L |
| 9A | arm 9 | the 9A text | deterministic |
| 9G | arm 9 | q_G | deterministic |
| 12K | arm 12 | q' | Gemma-4-31B-it, E1's arm 12 prompt with q' as the question |
| P12K | E1's P12 placebo on the spans 12K changed | | Gemma-4-31B-it, E1's P12 prompt with q |
| 12, P12 | arm 12 and its placebo on the new queries | q | Gemma-4-31B-it, E1's prompts |

- Arm 9 with an edit text x: `## x` directly under the title, then the page's prose sentence with the most distinct key terms of x (earliest on ties): E1's `deterministic_arms.arm9(text, eng, x)`.
- Arm 12 with x: E1's `prompts/arm12.txt` with x as the question and `missing_terms(x, ...)`; validated as arm 12 with x as the question (check 2: every key term of x is now in the title, first heading or first paragraph; check 3: x's words are allowed; length within 0.95x to 1.10x).
- P12K paraphrases exactly the spans 12K changed, in the original's coordinates, with E1's P12 prompt and E1's placebo validator, both given q (so it keeps every key term of q the spans contain and adds none; K(q') is a subset of K(q)).
- Editor settings are E1's: temperature 0, at most 4,096 new tokens, two attempts (one regenerate with the validator's message).
- On the replication set, 9P is E2's existing version where it exists.

## Applicability and validity

- **Estimand.** The arm 9 family is applicable where arm 9 is applicable by E1's rule, which uses the true q (`question-coverage` with q scores under 0.9 on the original). The estimand is therefore "pages that do not already answer the reader's true question". For E1's queries this is E1's frozen table; for the new queries it is computed now with E1's rule and E1's engine. 9K, 9L, 9A and 9G also need their edit text to differ from the page's existing first H2 (ignoring case).
- Validity for every arm 9 version is arm 9's feature (E1 amendment 1): the edit text appears as an H2 directly under the title, followed by a sentence copied verbatim from the page, and nothing else changes. For 9P, E2's rule.
- **12K** is applicable where `missing_terms(q', ...)` is not empty (pre-run: 132 main queries); **12** on the new queries by E1's rule. C-SEO has only 15 applicable targets for 12K, so 12K is not run there.
- **Engine pinned.** Applicability, spans and every validation run on E1's engine bundle (`experiments/e1/out/bundle/engine_cli.js`, sha256 `1b8e30dbea4e01134302d302fe457e03e2e16baff658c891a9fb3e89fa5a4c47`), unchanged, so E5's rules equal E1's. The questions bridge (keywordQuestion, pageQuestions) is a separate bundle built from a named commit. Both hashes and the commit are in the freeze. The tool's engine may change during E5; E5 never rebuilds E1's bundle.
- The report gives, per version: applicable and valid counts, exclusions by reason, length ratio, change in q's key-term count, and the share of edited pages the tool itself (current engine) marks as covering the edit text and q.

## Measurement and statistics

E1's, unchanged: four sources per prompt in E1's order and slot rotation, the GEO prompt with q, judges Gemma-4-12B-it (primary) and Qwen3.8-27B (thinking off), temperature 0.5, seeds 1 to 8, the rank-based citation score, cells as the mean over valid answers (at least 4 of 8), d per query averaged over seeds and then judges, the paired sign-flip test, percentile bootstrap intervals, the verdict rules (model-dependent, helps, hurts, no effect larger than 0.03, inconclusive, insufficient n under 30), and the confound regression's note.

**One run.** Every version of a query that enters a contrast, the original and arm 9 included, is answered in E5's run, so every planned contrast compares answers from the same run. Before the jobs, the vLLM version, model revision hashes, sampling settings and GPU type are logged and compared with E1's records. The earlier answers to the same prompts (E1, E3) are the drift check: regenerated minus earlier for the original and arm 9, with a 95% interval. A contrast whose E5 cells are incomplete at the analysis snapshot falls back to the earlier answers and is flagged "cross-run".

**Judges.** A contrast uses both judges only if Qwen has complete cells for every query Gemma has; otherwise it uses Gemma alone for all its queries and is labelled single-model.

## Contrasts

**Planned, main set.** Each step at alpha 0.05.

1. **Gate: 9 vs original on the 180 new queries.** An out-of-sample test of E1's arm 9 result.
2. **If the gate passes, one Holm family over four tests:** 9K vs original, 9K vs 9P, 9L vs original, 9L vs 9P (pooled over all queries with both versions valid). Against the original a guess shows whether the edit helps a writer; against 9P it shows whether the guessed words help beyond adding a section of the same size. If the gate fails, these four are reported with labels marked "descriptive (gate failed)".
3. **Retention, for each guess G in {9K, 9L}, a reading fixed now** (margin m = 0.015, about half of arm 9's gain):
   - **keeps the gain:** G vs original helps, G vs 9P helps, and the lower end of the 90% interval of d(G − 9) is above −0.015;
   - **loses the gain:** d(9 − G) > 0 with its 95% interval above 0;
   - otherwise **partly kept, unclear**.
4. **12K vs P12K, its own test** (alpha 0.05, E1's labels). The tool's measured label for "missing words" needs 12K vs P12K helps and 12K vs original above 0.
5. **The tool's reader's-words label** follows pooled 9 vs original over all 260 main queries at alpha 0.05, by E1's rule table. This is a cumulative estimate that includes E1's queries, and is named as such.

**Replication set, its own Holm family:** 9K vs original, 9K vs 9P, 9L vs original, 9L vs 9P.

**Reported without a verdict:**
- The ladder of reader words: 9K (two rarest words) vs 9A (all key words) vs 9 (the exact string); 9 vs 9A is the exact-string echo of the judge prompt, 9A vs 9K the words the keyword drops. Also 9 vs 9K on the queries where 9K copies the same sentence as 9 (only the heading differs).
- 9G vs original and 9K vs 9G.
- 12K vs original, P12K vs original, 12K vs 12, and 12 vs P12 on the new queries and pooled.
- The share of the exact-question gain each guess keeps, on the new queries only: (G − 9P) / (9 − 9P), with a bootstrap 90% interval, reported as "not estimable" when the denominator's 95% interval includes 0 or more than 2.5% of resamples give a denominator at or below 0 (then only d(G − 9) is given). E1's queries are reported separately, with the caveat that arm 9 was followed up because it passed there.
- Query length: d(9K − 9) by key-term count of q (2 or fewer, 3, 4, 5 or more; cells under 10 queries merged), with d(9 vs original) in the same cells. The share of q's key words a keyword keeps is fixed by query length (min(1, 2/|K(q)|)), so this is a breakdown by query length, not a dose.
- 9K vs original and 9L vs original split by template (kept keyword vs a template question) and restricted to the pages where the tool, given q', would also suggest the edit (question-coverage with q' under 0.9).
- Per judge, per stratum, and the reweighted new-query estimate.
- A null simulation of this structure (gate plus Holm family; arm labels shuffled), run with the analysis code and committed with the freeze.

## What the results mean

| Gate (9 on new queries) | Guess result | Tool | Paper |
|---|---|---|---|
| helps | a guess keeps the gain | "Put your readers' words up top" keeps its measured label for that input kind (keywords for 9K, local-model questions for 9L); other inputs stay "a guess; untested". | "The gain held when the edit carried only a keyword's words" (9K) or "a question written from a keyword" (9L). |
| helps | partly kept, unclear | The label covers full reader questions; keyword-based questions are labelled "a guess; may help less". | Reported with the retention numbers. |
| helps | a guess loses the gain | The label covers only full reader questions; keywords and questions made from them are "a guess; untested". | Main limit: "the gain needs most of the reader's words, which publishers rarely see". |
| no effect or inconclusive | any | The reader's-words label follows the pooled 260-query estimate (step 5); the Research page shows both. | Reported plainly next to E1's result; the guess results are descriptive. |

12K helps (step 4): the "missing words" list gets a measured label for keywords. 9G is never read as evidence about the tool's default.

## Size and power

Pre-run counts (local, E1's engine, E1's validators):
- **Arm 9 family, main:** arm 9 applicable on 172 queries (55 E1, 117 new); valid 9 on 115 new; 9K valid on 168 (54 E1 + 114 new); 9G valid on 147. **C-SEO:** 9K valid on 53, 9G on 41.
- **12K:** applicable on 132 main queries; at E1's validity rates (12: 50 of 63; P12: 33 of 50) about 65 to 70 analyzable pairs.
- **Detectable effects** (80% power, E1's formula, SD 0.063 for arm 9 contrasts, 0.086 for arm 12): gate at n 115, about 0.017; each Holm test at n about 165 (alpha 0.0125 at the strictest step), about 0.017; 12K vs P12K at n 65, about 0.031. A 90% interval at n 165 has a half-width of about 0.008. The report recomputes each from the realized spread.

## Runs and compute

1. **Build locally:** k, q', the 9A text, q_G, applicability for the new queries, the deterministic versions, the editor's task list, the prompts, and the pre-run counts. The 12K and P12K paths are smoke-tested locally with a fake editor backend on two real E5 queries (E3's precedent; E1's timing query has no 12K).
2. **Freeze commit** (plan, code, bundle hashes, edit-text table and its hash, null simulation).
3. **Cluster, in parallel:** tier 1 judge jobs from the locally built deterministic versions, and one Gemma-4-31B job that writes q_L, then 12K and P12K, then 12 and P12 on the new queries. Tier 2 and 3 judge jobs as their versions exist.
- **Tiers:** tier 1 = original, 9, 9P, 9K (both sets); tier 2 = 9L, 12K, P12K; tier 3 = 9A, 9G, and 12 and P12 on the new queries. Within a tier, Gemma before Qwen. Batches are ordered by a query order drawn now (sha256 of the query id), with all versions of a query adjacent, and only queries with complete cells are analyzed.
- **Expected size:** about 30,000 answers (about 14,600 in tier 1), about 10 GPU-hours of judging at E1's measured rate (3,100 answers per GPU-hour) and about 1 GPU-hour of editing; E1's allocation, environment and settings; offline vLLM jobs; no paid API.
- **Deadline and cuts.** The cluster's login rules change on 2026-11-06 at 09:00 US Eastern (06:00 PST) and its scratch space, which holds the model weights, is purged that day. Every answer must be copied back by 2026-11-06 05:00 PST. If the queue projects past that, cut in this order: tier 3; Qwen for tier 2; tier 2 on the replication set; within tier 2, 9L before 12K and P12K. Never cut: seeds below 8, tier 1, or the primary judge. Every cut depends only on completion status and the queue projection, never on outcomes, and is logged with a timestamp.
- **The analysis runs once,** on a snapshot of the answer files whose sha256 values are logged when it starts. Results that arrive later are reported as secondary and change no label.

## What we will not do

No change to the published results or labels of E1 to E3, except that the tool's reader's-words label follows step 5. No versions beyond those above. Any choice made after E5 answers exist is reported as an added analysis. Amendments are dated, written before any E5 answer is read, and listed below.

## Amendments

1. **Cut order within tier 2, clarified** (2026-11-03 01:58 PST, before any E5 version was judged and before any E5 answer existed). r2's cut list read "within tier 2, 9L before 12K and P12K", which can be read either way. It means: 12K and P12K are cut before 9L, and 9L's judge jobs are submitted first within tier 2. Reason: 9L is in the planned Holm family; 12K vs P12K is a separate test with lower power. No other rule changes.

2. **Gaps found while building, and corrected counts** (2026-11-03 02:11 PST, after building the pipeline on local data and before any E5 answer existed; none depends on an outcome).
   - **Keeps and loses at once.** When a guess meets both the "keeps the gain" and the "loses the gain" conditions (the exact question did better, by a significant amount smaller than the margin), the reading is "keeps the gain", and the report says the exact question did better by less than 0.015.
   - **A gate that is not "helps".** When the gate's label is hurts, model-dependent, insufficient n, no effect larger than 0.03 or inconclusive, no reading is drawn from the guesses (their labels are marked "descriptive (gate failed)"), and the reader's-words label follows step 5.
   - **"Helps" includes E1's confound note.** In the gate, the Holm family and the retention reading, a label of "helps, possibly through length or query-term overlap" counts as helps, as in E1; the note is kept in the report.
   - **Step 5's set.** Step 5 uses every main query with a valid arm 9 (about 169), not all 260.
   - **One run for arm 12 too.** E1's valid arm 12 and P12 versions on its main queries (50 and 33) are re-answered in tier 3 with 12 and P12 on the new queries (about 1,300 answers), so the pooled 12 vs P12 and 12K vs 12 are within the run. If tier 3 is cut, those two reported items fall back to E1's answers and are flagged cross-run.
   - **Null simulation.** Its output is committed under experiments/e5/freeze/ with the freeze.
   - **Counts.** Under the pool rule as written (distinct normalized texts), 232 of 260 main queries keep k as written, 26 become "What is/are ...?" and 2 become "How to ...?" (r2 said 231/27/2). Valid pre-run: 9 on the new queries 115, 9P 169 main and 53 C-SEO, 9K 168 and 53, 9A 168 and 52, 9G 147 and 41; 12K applicable on 132 main queries. Tier 1 is about 15,700 answers; the total is about 31,600 (about 10.2 GPU-hours at E1's rate).

3. **Rules as built, before the freeze** (2026-11-03 03:04 PST, after both sides of the pipeline were built and reviewed and before any E5 answer existed; none depends on an outcome).
   - **Arm 12's check 2 is E1's, unchanged:** the edit passes when fewer key terms of the edit text are missing from the title, first heading and first paragraph than on the original. r2's "every key term of x is now in those spans" misdescribed E1's validator; the validator itself is used as frozen in E1.
   - **Step 4's readings.** "12K vs P12K helps" includes "helps, possibly through length or query-term overlap", as amendment 2 does for the gate, the family and retention; the report says when that note decided the label. "12K vs original above 0" means its mean d is above 0, with no test.
   - **q_L is written by the editing job after the freeze.** That job reads no answer. Tier 1 and tier 3 judge jobs run beside it, so some answers can exist before q_L does, but no answer is read before every 9L version exists.
   - **What the freeze commits.** As in E1, the freeze commits the sha256 of the edit-text table and of every input file (experiments/e5/PRERUN.md and the freeze manifest), not the table itself, and the null simulation's output on the final structure.
   - **When an edit text equals q.** On 3 main queries the page's own question q_G equals q, so 9G is arm 9's edit there. They stay in, flagged (versions.jsonl field edit_text_is_q), and every 9G contrast is also reported without them. The same holds for any 9K or 9L text that equals q.
   - **Size.** With E1's own 12 and P12 re-answered (amendment 2), the total is about 32,900 answers, about 10.6 GPU-hours at E1's measured rate (11.5 to 13.8 GPU-hours summed over jobs at their measured per-model rates). Tier 1 is unchanged at about 15,700.
