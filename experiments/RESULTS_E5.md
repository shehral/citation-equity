# E5 results: does the reader's-words gain survive when the writer has only a keyword?

In E1 to E3 the only edits that clearly raised citation put the reader's own words near the top of the page, and every one of them used the exact question the page was then judged on. A writer never sees that question; at best they have a keyword. E5 asks three things. Does the gain from adding the reader's exact question as a section under the title hold on GEO-bench test queries E1 never used? Does the edit still help when its heading carries only the two rarest key words of the reader's question? And does it help when the heading is a question a local model wrote from that keyword? Every answer is judged against the reader's true question; only the text used to make the edit changes. The pages, judges, seeds, score and statistics are E1's.

Every section edit adds one heading under the title and copies beneath it the page sentence that best matches the heading's words, so the copied sentence can differ between versions as well as the heading. "A section without the reader's words" is E2's control: the same kind of section built from a page sentence that holds the fewest of the reader's key words. On the main set the copied sentence differs from the exact question's for "a keyword's two words" on 73 of 168 queries, "a question a local model wrote from the keyword" on 77 of 169 queries, "a question in the page's own words" on 96 of 146 queries and "a section without the reader's words" on 166 of 167 queries; only "all the reader's key words, without the exact question" (168 of 168) always copies the same sentence. The heading-only comparison is the same-sentence subset in the ladder below (the reader's exact question vs a keyword's two words, 95 queries).

A question a local model wrote from the keyword: on 11 of the 169 main queries with a valid version, the local model wrote the reader's exact question (PLAN_E5 amendment 3 flags these; its section below reports every contrast without them). 7 of those 11 versions are byte-identical to the exact question's version, so their prompts are identical too (14 of 14 prompt sets compared, one per query and judge). They were answered in different batches of the one run, so they are a measured within-run noise floor for identical prompts: 4 of their 14 judge cells differ (all lower on the local model's copy; at most 0.0625), and the mean per-query difference (the local model's copy minus the exact question's) is -0.011 over 7 queries (exact sign-flip p 0.125). Identical prompts do not give identical cells within the run, whatever the source (batch composition, or the GPU type, which varied across the run's jobs; the freeze log lists them); the drift check below measures the same kind of noise between runs.

Queries: 260 on the main set (80 from E1 and 180 new: 72 five-page and 108 four-page) and 60 on the replication set (C-SEO Bench). d is the citation score of the edited page minus the score of the version it is compared with, averaged over 8 seeds and the judges per query and then over queries; positive d means the edit helped the page get cited. A result needs at least 30 queries.

The analysis ran once, on the answer files present at 2026-11-04T01:31:55+00:00; the sha256 of each of its 50 input files (32 answer files among them) is in analysis_e5.json.

## Planned results

Main set. Step 1 is the gate. The four tests of step 2 are one family with Holm's correction, read only if the gate passes. Step 4 is its own test. Step 5 sets the tool's reader's-words label; it is a cumulative estimate that includes E1's queries. Each step is at alpha 0.05. "Detectable" is the smallest mean d the step could detect with 80% power, from the realized spread.

| Step | Edit | Compared with | Queries | d | 95% CI | 90% CI | p | p (Holm) | Detectable | Result | Judges and run |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 (new queries) | the reader's exact question | the unedited page | 115 | +0.039 | [+0.023, +0.056] | [+0.026, +0.053] | <0.001 | <0.001 | 0.024 | helps, possibly through length or query-term overlap | both judges, one run |
| 2 | a keyword's two words | the unedited page | 168 | +0.016 | [+0.006, +0.026] | [+0.008, +0.024] | 0.002 | 0.006 | 0.017 | helps, possibly through length or query-term overlap | both judges, one run |
| 2 | a keyword's two words | a section without the reader's words | 166 | +0.018 | [+0.007, +0.029] | [+0.009, +0.027] | 0.001 | 0.006 | 0.019 | helps, possibly through length or query-term overlap | both judges, one run |
| 2 | a question a local model wrote from the keyword | the unedited page | 169 | +0.008 | [-0.002, +0.018] | [-0.000, +0.016] | 0.126 | 0.142 | 0.018 | no effect larger than 0.03 | both judges, one run |
| 2 | a question a local model wrote from the keyword | a section without the reader's words | 167 | +0.010 | [-0.001, +0.020] | [+0.001, +0.019] | 0.071 | 0.142 | 0.019 | no effect larger than 0.03 | both judges, one run |
| 4 | the keyword's missing words worked into the top | a rewording of the spans the keyword edit changed (placebo) | 69 | +0.004 | [-0.012, +0.019] | [-0.009, +0.017] | 0.677 | 0.677 | 0.023 | no effect larger than 0.03 | both judges, one run |
| 5: every main query with a valid arm 9 (169) | the reader's exact question | the unedited page | 169 | +0.035 | [+0.023, +0.048] | [+0.025, +0.045] | <0.001 | <0.001 | 0.018 | helps, possibly through length or query-term overlap | both judges, one run |

Replication set, its own Holm family (no gate):

| Step | Edit | Compared with | Queries | d | 95% CI | 90% CI | p | p (Holm) | Detectable | Result | Judges and run |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R | a keyword's two words | the unedited page | 53 | +0.009 | [-0.010, +0.031] | [-0.007, +0.027] | 0.421 | 0.454 | 0.037 | no effect larger than 0.03 | both judges, one run |
| R | a keyword's two words | a section without the reader's words | 53 | +0.025 | [+0.006, +0.043] | [+0.009, +0.040] | 0.013 | 0.039 | 0.033 | helps | both judges, one run |
| R | a question a local model wrote from the keyword | the unedited page | 53 | +0.013 | [-0.006, +0.033] | [-0.004, +0.029] | 0.227 | 0.454 | 0.034 | no effect larger than 0.03 | both judges, one run |
| R | a question a local model wrote from the keyword | a section without the reader's words | 53 | +0.028 | [+0.008, +0.048] | [+0.011, +0.045] | 0.009 | 0.038 | 0.035 | helps, possibly through length or query-term overlap | both judges, one run |

Notes:

- the reader's exact question vs the unedited page: the gain may come from the edit making the page longer or repeating the query's words; once those are accounted for, the remaining effect is not clearly above zero.
- a keyword's two words vs the unedited page: the gain may come from the edit making the page longer or repeating the query's words; once those are accounted for, the remaining effect is not clearly above zero.
- a keyword's two words vs the unedited page: the helps label rests mainly on Qwen3.8-27B, the second judge (d +0.021 [+0.007, +0.036], p 0.004); Gemma-4-12B, the primary judge, alone gives d +0.010 [-0.002, +0.023] (p 0.116).
- a keyword's two words vs a section without the reader's words: the gain may come from the edit making the page longer or repeating the query's words; once those are accounted for, the remaining effect is not clearly above zero.
- a question a local model wrote from the keyword vs a section without the reader's words (replication set): the gain may come from the edit making the page longer or repeating the query's words; once those are accounted for, the remaining effect is not clearly above zero.
- a question a local model wrote from the keyword vs a section without the reader's words (replication set): the helps label rests mainly on Gemma-4-12B, the primary judge (d +0.045 [+0.021, +0.074], p <0.001); Qwen3.8-27B, the second judge, alone gives d +0.011 [-0.017, +0.037] (p 0.460).

## What the results mean

The gate (the reader's exact question on the new queries): helps, possibly through length or query-term overlap, d +0.039 [+0.023, +0.056] over 115 queries. The gate passed, so the four guess tests carry verdicts.

Added analysis, after the results: one of the gate's new queries is not wholly new: geo-test-325 shares 3 of its 4 pages with E1's geo-test-301 (its target is one of geo-test-301's competitors, and two of its three competitors are geo-test-301's target and donor). Without it the gate is d +0.039 [+0.023, +0.056] over 114 queries (p <0.001), reported without a verdict.

Whether each guess keeps the gain is read with a margin of 0.015, about half of arm 9's gain, fixed before any answer: it keeps the gain if it helps against the unedited page and against a section without the reader's words, and the lower end of the 90% interval of d(guess - exact question) is above -0.015; it loses the gain if the exact question beats it with a 95% interval above zero; otherwise it is partly kept, unclear.

| Guess | Queries | d(guess - exact) | 90% CI | d(exact - guess) | 95% CI | Reading |
|---|---|---|---|---|---|---|
| a keyword's two words | 168 | -0.019 | [-0.029, -0.010] | +0.019 | [+0.008, +0.031] | loses the gain |
| a question a local model wrote from the keyword | 169 | -0.027 | [-0.037, -0.017] | +0.027 | [+0.015, +0.039] | loses the gain |

- a keyword's two words: on the new queries alone, d(exact - guess) is +0.015 [+0.0001, +0.030] (n 114, p 0.058), its 95% interval above 0 by less than 0.001; the guess keeps 0.65 [0.41, 0.93] of the gain there; reweighted to E1's query lengths, d(guess - exact) is -0.010 [-0.024, +0.003].
- a question a local model wrote from the keyword: on the new queries alone, d(exact - guess) is +0.030 [+0.014, +0.047] (n 115, p <0.001), its 95% interval above 0; the guess keeps 0.28 [0.00, 0.54] of the gain there; reweighted to E1's query lengths, d(guess - exact) is -0.023 [-0.038, -0.009].
- The pooled readings in the table are the planned ones. They partly rest on E1's queries, where arm 9 was followed up because it passed, so its gain there may be overstated (d(guess - exact) on E1's queries: a keyword's two words -0.029 (n 54), a question a local model wrote from the keyword -0.021 (n 54)).

The plan's lines for each guess, as pre-registered for this result and kept as written:

- a keyword's two words. Tool: The label covers only full reader questions; keywords and questions made from them are "a guess; untested". Paper: Main limit: "the gain needs most of the reader's words, which publishers rarely see".
- a question a local model wrote from the keyword. Tool: The label covers only full reader questions; keywords and questions made from them are "a guess; untested". Paper: Main limit: "the gain needs most of the reader's words, which publishers rarely see".

### Reading these lines against the data

The lines above are the plan's text for a guess that loses the gain. They call keyword inputs untested and say the gain needs most of the reader's words. The measured numbers add this:

- A keyword's two words did help, Holm-significant against both references (against the unedited page: helps, possibly through length or query-term overlap, d +0.016, Holm p 0.006; against a section without the reader's words: helps, possibly through length or query-term overlap, d +0.018, Holm p 0.006); against the unedited page the label rests mainly on Qwen3.8-27B; on the new queries it kept 0.65 (about two-thirds) of the exact question's gain (90% CI 0.41 to 0.93).
- A question a local model wrote from the keyword showed no effect larger than 0.03 (against the unedited page: no effect larger than 0.03, d +0.008, Holm p 0.142; against a section without the reader's words: no effect larger than 0.03, d +0.010, Holm p 0.142); on the new queries it kept 0.28 of the exact question's gain (90% CI 0.00 to 0.54).

The shortfall tracks the exact query string, which the judge's prompt also shows, rather than the words the keyword drops. The exact question vs all the reader's key words gives d +0.014 [+0.005, +0.025] (p 0.005, 168 queries); all the key words vs the keyword's two words gives d +0.005 [-0.005, +0.014] (p 0.311, not significant, 168 queries).

The tool therefore labels keyword questions "May help less" and local-model questions "No effect in our test". Those label words are a copy decision made after the results and are recorded here as such; the statistical readings above are the plan's.

### Step 4, step 5 and the page-question placebo

- Missing words (step 4): The "missing words" list keeps its current label. Rule: 12K vs P12K helps (E1's "helps, possibly through length or query-term overlap" counts as helps) and 12K vs original above 0 (its mean d, no test); the keyword's missing words worked into the top vs the unedited page d +0.012 [-0.002, +0.026] (n 109).
- The tool's reader's-words label (step 5, a cumulative estimate over every main query with a valid arm 9, E1's queries included): helps, possibly through length or query-term overlap; the tool's action: measured label on the suggestion (effect, CI, models), with E1's note on length or query-term overlap.
- 9G is a question-form placebo in the page's own words; it is never read as evidence about the tool's default.

## Amendment 3 sensitivity: without the queries whose edit text is the reader's question

PLAN_E5 amendment 3 keeps in, flagged, the versions whose edit text equals the reader's question q (ignoring case, spaces and a final question mark), and reports every page-question contrast, and every keyword or local-model contrast with such a version, also without those queries. These rows were left out of the first analysis by omission and added afterwards on the same snapshot of answers. They sit beside the planned results without a verdict of their own and change no planned label or reading.

Main set, flagged versions: a keyword's two words (9K) 0; a question a local model wrote from the keyword (9L) 11 (E1's queries 5, E3 five-page 3, E3 four-page 3); a question in the page's own words (9G) 3 (E1's queries 1, E3 four-page 2).

Replication set, flagged versions: none.

Main set, step 2's Holm family with each guess's flagged queries left out (Holm re-run over the four tests; the gate is unchanged, so E1's rules apply as planned):

| Edit | Compared with | Queries (planned) | Queries without flagged | d | 95% CI | 90% CI | p | p (Holm) | E1's rules would give | Planned result |
|---|---|---|---|---|---|---|---|---|---|---|
| a keyword's two words | the unedited page | 168 | 168 | +0.016 | [+0.006, +0.026] | [+0.008, +0.024] | 0.002 | 0.006 | helps, possibly through length or query-term overlap | helps, possibly through length or query-term overlap |
| a keyword's two words | a section without the reader's words | 166 | 166 | +0.018 | [+0.007, +0.029] | [+0.009, +0.027] | 0.001 | 0.006 | helps, possibly through length or query-term overlap | helps, possibly through length or query-term overlap |
| a question a local model wrote from the keyword | the unedited page | 169 | 158 | +0.009 | [-0.001, +0.020] | [+0.001, +0.018] | 0.085 | 0.085 | no effect larger than 0.03 | no effect larger than 0.03 |
| a question a local model wrote from the keyword | a section without the reader's words | 167 | 156 | +0.012 | [+0.001, +0.023] | [+0.003, +0.021] | 0.036 | 0.072 | no effect larger than 0.03 | no effect larger than 0.03 |

Retention without the flagged queries:

| Guess | Queries (planned) | Queries without flagged | d(guess - exact) | 90% CI | d(exact - guess) | 95% CI | Reading | Planned reading |
|---|---|---|---|---|---|---|---|---|
| a keyword's two words | 168 | 168 | -0.019 | [-0.029, -0.010] | +0.019 | [+0.008, +0.031] | loses the gain | loses the gain |
| a question a local model wrote from the keyword | 169 | 158 | -0.028 | [-0.039, -0.018] | +0.028 | [+0.015, +0.041] | loses the gain | loses the gain |

Share of the exact question's gain kept, without the flagged queries:

| Queries | Guess | n | Share kept (90% CI) | d(guess - exact question) |
|---|---|---|---|---|
| new queries | a question a local model wrote from the keyword | 107 | 0.31 [0.03, 0.57] | n 109, d -0.031 [-0.048, -0.014] |
| E1's queries | a question a local model wrote from the keyword | 49 | 0.28 [-0.14, 0.64] | n 49, d -0.022 [-0.039, -0.006] |

The page-question placebo without its flagged queries (no verdict, as planned):

| Edit | Compared with | Scope | Queries | d | 95% CI | p |
|---|---|---|---|---|---|---|
| a question in the page's own words | the unedited page | pooled, without the flagged 9G queries | 144 | +0.007 | [-0.004, +0.017] | 0.211 |
| a keyword's two words | a question in the page's own words | pooled, without the flagged 9K and 9G queries | 142 | +0.010 | [+0.001, +0.020] | 0.033 |

### Main set, without the flagged queries: kept keyword or template question, and pages the tool would flag

The tool turns most keywords into headings unchanged (kept); a few become a template question. The last columns keep only the pages where the tool, given the keyword's question, would also suggest the edit (question coverage under 0.9).

| Guess vs the unedited page | All | Kept keyword | Template question | Tool would suggest it |
|---|---|---|---|---|
| a question a local model wrote from the keyword | n 158, d +0.009 [-0.001, +0.020] | n 139, d +0.007 [-0.004, +0.018] | n 19, d +0.025 [-0.003, +0.055] | n 136, d +0.010 [-0.002, +0.022] |

For the local model's question itself as the tool's input: n 130, d +0.005 [-0.006, +0.017].

### Identical prompts: a measured within-run noise floor

7 of the 11 flagged local-model versions are byte-identical to the exact question's version, so their prompts are identical (14 of 14 prompt sets compared, one per query and judge). They were answered in different batches of the one run, possibly on different GPU types (the freeze log lists the run's). Cell difference: the local model's copy minus the exact question's, per judge.

| Query | Stratum | Gemma-4-12B | Qwen3.8-27B | d (mean over judges) |
|---|---|---|---|---|
| geo-test-301 | E1's queries | -0.06250 | +0.00000 | -0.03125 |
| geo-test-310 | E1's queries | +0.00000 | +0.00000 | +0.00000 |
| geo-test-312 | E3 four-page | +0.00000 | -0.03125 | -0.01562 |
| geo-test-328 | E1's queries | +0.00000 | -0.03125 | -0.01562 |
| geo-test-330 | E1's queries | +0.00000 | +0.00000 | +0.00000 |
| geo-test-339 | E3 four-page | +0.00000 | +0.00000 | +0.00000 |
| geo-test-348 | E1's queries | +0.00000 | -0.03125 | -0.01562 |

4 of 14 judge cells differ (Gemma-4-12B 1 of 7, Qwen3.8-27B 3 of 7; 4 lower and 0 higher on the local model's copy; mean absolute cell difference 0.0112, largest 0.0625). Mean per-query difference -0.01116 over 7 queries (exact sign-flip p 0.125; too few queries for a bootstrap interval).

Replication set: no 9K, 9L or 9G version here has an edit text equal to q, so its rows are the planned and reported ones.

Every planned label and reading is unchanged without the flagged queries.

## Reported without a verdict

These are shown for understanding and get no verdict; each gives its number of queries. Short labels in the tables below: original: the unedited page; 9: the reader's exact question; 9P: a section without the reader's words; 9K: a keyword's two words; 9L: a question a local model wrote from the keyword; 9A: all the reader's key words, without the exact question; 9G: a question in the page's own words; 12: the reader's missing words worked into the top; P12: a rewording of the same spans (placebo for the reader's missing words); 12K: the keyword's missing words worked into the top; P12K: a rewording of the spans the keyword edit changed (placebo).

### Main set: the ladder of reader words, the page-question placebo and the rewrite edits

The ladder: all key words vs the keyword's two words shows the words the keyword drops; the exact question vs all key words shows the exact-string echo of the judge's prompt; the exact question vs the keyword's two words on the queries where both copy the same sentence differs only in the heading.

| Edit | Compared with | Scope | Queries | d | 95% CI | p | Judges and run |
|---|---|---|---|---|---|---|---|
| all the reader's key words, without the exact question | a keyword's two words | pooled | 168 | +0.005 | [-0.005, +0.014] | 0.311 | both judges, one run |
| the reader's exact question | all the reader's key words, without the exact question | pooled | 168 | +0.014 | [+0.005, +0.025] | 0.005 | both judges, one run |
| the reader's exact question | a keyword's two words | same-sentence subset | 95 | +0.018 | [+0.006, +0.030] | 0.005 | both judges, one run |
| a question in the page's own words | the unedited page | pooled | 147 | +0.007 | [-0.003, +0.017] | 0.195 | both judges, one run |
| a keyword's two words | a question in the page's own words | pooled | 145 | +0.010 | [+0.001, +0.019] | 0.036 | both judges, one run |
| the keyword's missing words worked into the top | the unedited page | new queries | 77 | +0.012 | [-0.004, +0.028] | 0.156 | both judges, one run |
| a rewording of the spans the keyword edit changed (placebo) | the unedited page | new queries | 46 | +0.009 | [-0.005, +0.024] | 0.268 | both judges, one run |
| the keyword's missing words worked into the top | the reader's missing words worked into the top | new queries | 67 | -0.028 | [-0.047, -0.010] | 0.004 | both judges, one run |
| the reader's missing words worked into the top | a rewording of the same spans (placebo for the reader's missing words) | new queries | 74 | +0.036 | [+0.019, +0.053] | <0.001 | both judges, one run |
| the keyword's missing words worked into the top | the unedited page | pooled | 109 | +0.012 | [-0.002, +0.026] | 0.103 | both judges, one run |
| a rewording of the spans the keyword edit changed (placebo) | the unedited page | pooled | 69 | +0.005 | [-0.006, +0.018] | 0.398 | both judges, one run |
| the keyword's missing words worked into the top | the reader's missing words worked into the top | pooled | 95 | -0.030 | [-0.047, -0.014] | <0.001 | both judges, one run |
| the reader's missing words worked into the top | a rewording of the same spans (placebo for the reader's missing words) | pooled | 107 | +0.035 | [+0.020, +0.051] | <0.001 | both judges, one run |

### Replication set: the ladder of reader words, the page-question placebo and the rewrite edits

The ladder: all key words vs the keyword's two words shows the words the keyword drops; the exact question vs all key words shows the exact-string echo of the judge's prompt; the exact question vs the keyword's two words on the queries where both copy the same sentence differs only in the heading.

| Edit | Compared with | Scope | Queries | d | 95% CI | p | Judges and run |
|---|---|---|---|---|---|---|---|
| all the reader's key words, without the exact question | a keyword's two words | pooled | 52 | +0.007 | [-0.006, +0.021] | 0.355 | both judges, one run |
| the reader's exact question | all the reader's key words, without the exact question | pooled | 52 | +0.025 | [+0.005, +0.047] | 0.019 | both judges, one run |
| the reader's exact question | a keyword's two words | same-sentence subset | 29 | +0.056 | [+0.029, +0.089] | <0.001 | both judges, one run |
| a question in the page's own words | the unedited page | pooled | 41 | -0.010 | [-0.029, +0.009] | 0.325 | both judges, one run |
| a keyword's two words | a question in the page's own words | pooled | 41 | +0.021 | [+0.001, +0.044] | 0.058 | both judges, one run |
| a keyword's two words | the reader's exact question | pooled | 52 | -0.032 | [-0.055, -0.011] | 0.004 | both judges, one run |
| a question a local model wrote from the keyword | the reader's exact question | pooled | 52 | -0.029 | [-0.051, -0.009] | 0.008 | both judges, one run |

### Share of the exact question's gain each guess keeps

(guess - section without the reader's words) / (exact question - section without the reader's words), on the same queries, with a bootstrap 90% interval. It is not estimable when the denominator's 95% interval includes 0 or more than 2.5% of resamples give a denominator at or below 0; then only d(guess - exact question) is given.

| Queries | Guess | n | Share kept (90% CI) | d(guess - exact question) |
|---|---|---|---|---|
| new queries | a keyword's two words | 112 | 0.65 [0.41, 0.93] | n 114, d -0.015 [-0.030, -0.000] |
| new queries | a question a local model wrote from the keyword | 113 | 0.28 [0.00, 0.54] | n 115, d -0.030 [-0.047, -0.014] |
| E1's queries | a keyword's two words | 54 | -0.08 [-0.87, 0.37] | n 54, d -0.029 [-0.046, -0.012] |
| E1's queries | a question a local model wrote from the keyword | 54 | 0.22 [-0.30, 0.59] | n 54, d -0.021 [-0.037, -0.007] |

E1's queries: arm 9 was followed up because it passed on these queries, so its gain here may be overstated and the share understated.

### Main set: by the number of key words in the reader's question

The keyword keeps min(1, 2/|K(q)|) of the reader's key words, which is set by query length, so this is a breakdown by query length, not a dose. Cells under 10 queries are merged.

| Key words in q | d(keyword's two words - exact question) | d(exact question vs unedited page) |
|---|---|---|
| 2 or fewer | n 19, d -0.018 [-0.037, +0.000] | n 20, d +0.010 [-0.016, +0.037] |
| 3 | n 22, d +0.004 [-0.017, +0.024] | n 22, d +0.009 [-0.011, +0.029] |
| 4 | n 58, d -0.008 [-0.026, +0.010] | n 58, d +0.028 [+0.009, +0.049] |
| 5 or more | n 69, d -0.037 [-0.059, -0.016] | n 69, d +0.056 [+0.035, +0.079] |

### Main set: kept keyword or template question, and pages the tool would flag

The tool turns most keywords into headings unchanged (kept); a few become a template question. The last columns keep only the pages where the tool, given the keyword's question, would also suggest the edit (question coverage under 0.9).

| Guess vs the unedited page | All | Kept keyword | Template question | Tool would suggest it |
|---|---|---|---|---|
| a keyword's two words | n 168, d +0.016 [+0.006, +0.026] | n 149, d +0.015 [+0.005, +0.026] | n 19, d +0.021 [-0.007, +0.051] | n 147, d +0.018 [+0.008, +0.029] |
| a question a local model wrote from the keyword | n 169, d +0.008 [-0.002, +0.018] | n 150, d +0.006 [-0.005, +0.016] | n 19, d +0.025 [-0.003, +0.055] | n 147, d +0.008 [-0.003, +0.019] |

For the local model's question itself as the tool's input: n 141, d +0.004 [-0.007, +0.015].

### Replication set: by the number of key words in the reader's question

The keyword keeps min(1, 2/|K(q)|) of the reader's key words, which is set by query length, so this is a breakdown by query length, not a dose. Cells under 10 queries are merged.

| Key words in q | d(keyword's two words - exact question) | d(exact question vs unedited page) |
|---|---|---|
| 2 or fewer + 3 + 4 | n 31, d -0.027 [-0.049, -0.005] | n 31, d +0.034 [+0.009, +0.064] |
| 5 or more | n 21, d -0.039 [-0.084, +0.000] | n 21, d +0.057 [+0.014, +0.106] |

### Replication set: kept keyword or template question, and pages the tool would flag

The tool turns most keywords into headings unchanged (kept); a few become a template question. The last columns keep only the pages where the tool, given the keyword's question, would also suggest the edit (question coverage under 0.9).

| Guess vs the unedited page | All | Kept keyword | Template question | Tool would suggest it |
|---|---|---|---|---|
| a keyword's two words | n 53, d +0.009 [-0.010, +0.031] | n 49, d +0.007 [-0.014, +0.030] | n 4, d +0.043 [+0.008, +0.098] | n 49, d +0.012 [-0.009, +0.035] |
| a question a local model wrote from the keyword | n 53, d +0.013 [-0.006, +0.033] | n 49, d +0.012 [-0.007, +0.033] | n 4, d +0.023 [-0.047, +0.133] | n 49, d +0.017 [-0.002, +0.038] |

For the local model's question itself as the tool's input: n 49, d +0.016 [-0.004, +0.037].

### Planned contrasts per judge, per stratum and reweighted

Per judge: each judge's mean d on the contrast's queries (for a contrast run on Gemma alone, Qwen's own complete queries, secondary). Per stratum: E1's queries, E3's five-page and four-page queries. Reweighted: the new-query estimate with E1's mix of query lengths.

| Step | Contrast | Gemma-4-12B | Qwen3.8-27B | E1's queries | E3 five-page | E3 four-page | New, reweighted to E1 |
|---|---|---|---|---|---|---|---|
| gate | 9 vs original | n 115, d +0.028 [+0.009, +0.047] | n 115, d +0.050 [+0.028, +0.074] | no query | n 44, d +0.023 [+0.003, +0.046] | n 71, d +0.049 [+0.027, +0.071] | +0.033 [+0.019, +0.047] (n 115) |
| step 2 | 9K vs original | n 168, d +0.010 [-0.002, +0.023] | n 168, d +0.021 [+0.007, +0.036] | n 54, d -0.003 [-0.017, +0.011] | n 44, d +0.022 [+0.000, +0.045] | n 70, d +0.026 [+0.012, +0.042] | +0.023 [+0.011, +0.035] (n 114) |
| step 2 | 9K vs 9P | n 166, d +0.019 [+0.006, +0.032] | n 166, d +0.017 [+0.002, +0.033] | n 54, d -0.002 [-0.018, +0.014] | n 44, d +0.043 [+0.021, +0.067] | n 68, d +0.017 [+0.000, +0.033] | +0.027 [+0.014, +0.040] (n 112) |
| step 2 | 9L vs original | n 169, d +0.004 [-0.009, +0.016] | n 169, d +0.012 [-0.001, +0.027] | n 54, d +0.005 [-0.010, +0.021] | n 44, d +0.005 [-0.017, +0.026] | n 71, d +0.012 [-0.004, +0.028] | +0.010 [-0.003, +0.024] (n 115) |
| step 2 | 9L vs 9P | n 167, d +0.012 [-0.002, +0.025] | n 167, d +0.008 [-0.007, +0.023] | n 54, d +0.006 [-0.008, +0.019] | n 44, d +0.026 [+0.003, +0.048] | n 69, d +0.003 [-0.016, +0.021] | +0.014 [+0.001, +0.028] (n 113) |
| retention | 9K vs 9 | n 168, d -0.015 [-0.030, -0.000] | n 168, d -0.023 [-0.040, -0.007] | n 54, d -0.029 [-0.046, -0.012] | n 44, d -0.001 [-0.022, +0.018] | n 70, d -0.023 [-0.044, -0.003] | -0.010 [-0.024, +0.003] (n 114) |
| retention | 9L vs 9 | n 169, d -0.022 [-0.036, -0.008] | n 169, d -0.032 [-0.048, -0.016] | n 54, d -0.021 [-0.037, -0.007] | n 44, d -0.019 [-0.044, +0.005] | n 71, d -0.037 [-0.059, -0.017] | -0.023 [-0.038, -0.009] (n 115) |
| step 4 | 12K vs P12K | n 69, d +0.002 [-0.017, +0.021] | n 69, d +0.005 [-0.017, +0.029] | n 23, d +0.014 [-0.015, +0.041] | n 15, d +0.010 [-0.020, +0.041] | n 31, d -0.007 [-0.031, +0.016] | +0.001 [-0.019, +0.020] (n 46) |
| 12K vs original | 12K vs original | n 109, d +0.008 [-0.011, +0.027] | n 109, d +0.015 [-0.002, +0.034] | n 32, d +0.011 [-0.017, +0.039] | n 29, d +0.010 [-0.012, +0.033] | n 48, d +0.013 [-0.007, +0.036] | +0.011 [-0.005, +0.027] (n 77) |
| step 5 | 9 vs original | n 169, d +0.025 [+0.011, +0.040] | n 169, d +0.044 [+0.027, +0.063] | n 54, d +0.026 [+0.009, +0.044] | n 44, d +0.023 [+0.003, +0.046] | n 71, d +0.049 [+0.027, +0.071] | +0.033 [+0.019, +0.047] (n 115) |

E1's length and key-term regression per planned test (the intercept is the effect at no change in length or key-term count):

| Step | Contrast | Note | Intercept | 95% CI |
|---|---|---|---|---|
| gate | 9 vs original | after the length and key-term regression the remaining effect's 95% CI includes 0 | +0.007 | [-0.037, +0.051] |
| step 2 | 9K vs original | after the length and key-term regression the remaining effect's 95% CI includes 0 | +0.018 | [-0.016, +0.052] |
| step 2 | 9K vs 9P | after the length and key-term regression the remaining effect's 95% CI includes 0 | +0.023 | [-0.013, +0.059] |
| step 2 | 9L vs original | after the length and key-term regression the remaining effect's 95% CI includes 0 | +0.005 | [-0.028, +0.038] |
| step 2 | 9L vs 9P | after the length and key-term regression the remaining effect's 95% CI includes 0 | -0.010 | [-0.041, +0.021] |
| step 4 | 12K vs P12K | after the length and key-term regression the remaining effect's 95% CI includes 0 | +0.024 | [-0.015, +0.064] |
| step 5 | 9 vs original | after the length and key-term regression the remaining effect's 95% CI includes 0 | -0.004 | [-0.037, +0.029] |

## Edits that passed validation

Not applicable: the edit does not apply to the page by E1's rule (the page already answers the reader's true question; for a guess, also when its heading is the page's first heading already or, for the page question, when the tool finds none), or the editor found nothing to change. Valid: the edit passed E1's checks. Length ratio and key-term change are the means over valid edits (the change counts the reader's key words). The tool columns give the share of valid edits the current tool marks as covering the edit's own text, as covering the reader's question q, and (for the heading edits, judged on the unedited page) as a page where it would suggest the edit.

Main set:

| Version | Queries | Not applicable | Applicable | Valid | Failed validation | Length ratio | Key-term change | Same sentence as 9 | Tool: covers the edit text | Tool: covers q | Tool: would suggest the edit | From an earlier run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| the unedited page (original) | 260 | 0 | 260 | 260 | 0 | 1.000 | +0.000 | n/a | n/a | n/a | n/a | 0 |
| the reader's exact question (9) | 260 | 88 | 172 | 169 | 3 | 1.034 | +7.929 | n/a | 27% (46 of 169) | 27% (46 of 169) | 100% (169 of 169) | 0 |
| a section without the reader's words (9P) | 260 | 88 | 172 | 169 | 3 | 1.034 | +0.053 | n/a | n/a | n/a | n/a | 0 |
| a keyword's two words (9K) | 260 | 89 | 171 | 168 | 3 | 1.023 | +4.351 | 95 | 37% (62 of 168) | 14% (24 of 168) | 88% (147 of 168) | 0 |
| a question a local model wrote from the keyword (9L) | 260 | 88 | 172 | 169 | 3 | 1.028 | +4.456 | 92 | 36% (60 of 169) | 15% (26 of 169) | 83% (141 of 169) | 0 |
| all the reader's key words, without the exact question (9A) | 260 | 89 | 171 | 168 | 3 | 1.029 | +7.905 | 168 | 27% (46 of 168) | 27% (46 of 168) | 100% (168 of 168) | 0 |
| a question in the page's own words (9G) | 260 | 111 | 149 | 147 | 2 | 1.025 | +3.102 | 50 | 63% (92 of 147) | 5% (7 of 147) | 65% (96 of 147) | 0 |
| the reader's missing words worked into the top (12) | 260 | 53 | 207 | 167 | 40 | 1.013 | +6.892 | n/a | 26% (44 of 167) | 26% (44 of 167) | 67% (112 of 167) | 0 |
| a rewording of the same spans (placebo for the reader's missing words) (P12) | 260 | 53 | 167 | 107 | 60 | 0.999 | -0.009 | n/a | n/a | n/a | n/a | 0 |
| the keyword's missing words worked into the top (12K) | 260 | 128 | 132 | 109 | 23 | 1.006 | +3.431 | n/a | 16% (17 of 109) | 15% (16 of 109) | 89% (97 of 109) | 0 |
| a rewording of the spans the keyword edit changed (placebo) (P12K) | 260 | 128 | 109 | 69 | 40 | 0.999 | -0.058 | n/a | n/a | n/a | n/a | 0 |

Not applicable, most common reasons: 9: the question-coverage check scores # (# or more) (88); 9P: the question-coverage check scores # (# or more) (88); 9K: arm # is not applicable: the question-coverage check scores # (88); 9K: the edit text is the page's first H# already (1); 9L: arm # is not applicable: the question-coverage check scores # (88); 9A: arm # is not applicable: the question-coverage check scores # (88); 9A: the edit text is the page's first H# already (1); 9G: arm # is not applicable: the question-coverage check scores # (88); 9G: no page question (pageQuestions is empty) (22); 9G: the edit text is the page's first H# already (1); 12: feature already present: every key term is in the title, first heading or first  (53); P12: feature already present: every key term is in the title, first heading or first  (53); 12K: feature already present: every key term of q (128); P12K: feature already present: every key term of q (128).

Most common reasons for failing validation: 9: invalid: The page length went from # to # words (2); 9: invalid: the page has no prose sentence (1); 9P: invalid: the page has no body sentence for #P (2); 9P: invalid: the page has no prose sentence (1); 9K: invalid: The page length went from # to # words (2); 9K: invalid: the page has no prose sentence (1); 9L: invalid: The page length went from # to # words (2); 9L: invalid: the page has no prose sentence (1); 9A: invalid: The page length went from # to # words (2); 9A: invalid: the page has no prose sentence (1); 9G: invalid: The page length went from # to # words (1); 9G: invalid: the page has no prose sentence (1); 12: invalid: Add only the query (19); 12: invalid: Do not add facts that are not in the allowed sources (11); 12: invalid: The answer must be one JSON object mapping span ids to replacements (10); P12: invalid: Do not add facts that are not in the allowed sources (42); P12: invalid: The paraphrase changed the question-headings check (6); P12: invalid: The paraphrase changed the comparisons check (3); 12K: invalid: Add only the query (13); 12K: invalid: Do not add facts that are not in the allowed sources (5); 12K: invalid: The answer must be one JSON object mapping span ids to replacements (4); P12K: invalid: Do not add facts that are not in the allowed sources (27); P12K: invalid: The paraphrase changed the question-headings check (3); P12K: invalid: The answer must be one JSON object mapping span ids to replacements (2).

Replication set:

| Version | Queries | Not applicable | Applicable | Valid | Failed validation | Length ratio | Key-term change | Same sentence as 9 | Tool: covers the edit text | Tool: covers q | Tool: would suggest the edit | From an earlier run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| the unedited page (original) | 60 | 0 | 60 | 60 | 0 | 1.000 | +0.000 | n/a | n/a | n/a | n/a | 0 |
| the reader's exact question (9) | 60 | 7 | 53 | 52 | 1 | 1.042 | +9.173 | n/a | 46% (24 of 52) | 46% (24 of 52) | 100% (52 of 52) | 0 |
| a section without the reader's words (9P) | 60 | 7 | 53 | 53 | 0 | 1.033 | +0.038 | n/a | n/a | n/a | n/a | 0 |
| a keyword's two words (9K) | 60 | 7 | 53 | 53 | 0 | 1.035 | +6.264 | 29 | 38% (20 of 53) | 32% (17 of 53) | 92% (49 of 53) | 0 |
| a question a local model wrote from the keyword (9L) | 60 | 7 | 53 | 53 | 0 | 1.042 | +6.208 | 26 | 32% (17 of 53) | 26% (14 of 53) | 92% (49 of 53) | 0 |
| all the reader's key words, without the exact question (9A) | 60 | 7 | 53 | 52 | 1 | 1.037 | +9.135 | 52 | 46% (24 of 52) | 46% (24 of 52) | 100% (52 of 52) | 0 |
| a question in the page's own words (9G) | 60 | 18 | 42 | 41 | 1 | 1.027 | +2.561 | 5 | 73% (30 of 41) | 0% (0 of 41) | 27% (11 of 41) | 0 |

Not applicable, most common reasons: 9: the question-coverage check scores # (# or more) (7); 9P: the question-coverage check scores # (# or more) (7); 9K: arm # is not applicable: the question-coverage check scores # (7); 9L: arm # is not applicable: the question-coverage check scores # (7); 9A: arm # is not applicable: the question-coverage check scores # (7); 9G: no page question (pageQuestions is empty) (11); 9G: arm # is not applicable: the question-coverage check scores # (7).

Most common reasons for failing validation: 9: invalid: The page length went from # to # words (1); 9A: invalid: The page length went from # to # words (1); 9G: invalid: The page length went from # to # words (1).

## Drift check

E5 answered the unedited page and the exact-question edit again. Here each is compared with the earlier runs' answers to the same prompts (E1, E3): E5 cell minus earlier cell for the same query, version and judge, averaged per query, with a 95% interval.

| Group | Queries | Cells | Mean difference | 95% CI |
|---|---|---|---|---|
| All | 320 | 852 | -0.001 | [-0.004, +0.002] |
| Gemma-4-12B | 320 | 426 | -0.001 | [-0.005, +0.003] |
| Qwen3.8-27B | 320 | 426 | -0.001 | [-0.006, +0.003] |
| the unedited page | 320 | 640 | -0.002 | [-0.005, +0.002] |
| the reader's exact question | 106 | 212 | +0.004 | [-0.002, +0.010] |
| main | 260 | 628 | -0.003 | [-0.006, +0.001] |
| replication | 60 | 224 | +0.005 | [-0.001, +0.011] |
| against E1 | 140 | 492 | +0.001 | [-0.003, +0.005] |
| against E3 | 180 | 360 | -0.003 | [-0.008, +0.001] |

The interval includes 0: no shift between runs is detected.

## Null simulation

With version labels shuffled within each query (1000 simulations, no true effect), the gate alone was significant in 4.8% of simulations, its own 5% level: a gate that passes is a significant gate, so the gate plus the family can never exceed the gate's rate. The family's own protection: the four guess tests with Holm's correction gave a false positive in 4.4% of simulations (Monte Carlo SE 0.6%) if they were never gated, and in 0.2% after the gate passed; the replication family in 4.4%.

E1 to E3's published results stay as they are; the tool's reader's-words label follows step 5, by E1's rule table.

Content check on a local model over a fixed page set. It does not predict live AI engines.
