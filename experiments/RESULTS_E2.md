# E2 results: why does the question-as-heading edit help?

_Content check on a local model over a fixed page set. It does not predict live AI engines._

Plan: experiments/PLAN_E2.md (written before any E2 version or answer existed). Statistics as in E1: the unit is the query, d is averaged over 8 seeds and then over the two judges, a two-sided sign-flip test, 95% and 90% bootstrap intervals over queries. Labels: helps, hurts, no effect larger than δ = 0.03, inconclusive, model-dependent; fewer than 30 queries gives no label (insufficient n).

## E2a: heading markup or the query's words?

Each set has two planned tests, one Holm family at alpha 0.05: 9 vs 9W (the effect of the heading markup) and 9 vs 9P (the effect of the query's words, with position, markup and length held). 9W and 9P against the original are reported without a verdict. The original's and arm 9's answers are E1's.

### Main set

Judges: gemma-4-12b, qwen3.8-27b (two-judge). Queries: 80. Planned tests with enough queries to test: 2 of 2 (Holm over those, alpha 0.05).

Planned tests (d is the score of arm 9 minus the score of the other version):

| Contrast | What it isolates | n | d | 95% CI | 90% CI | p | p (Holm) | Smallest detectable d | Label |
|---|---|---|---|---|---|---|---|---|---|
| 9 vs 9W | the heading markup | 54 | +0.003 | [-0.009, +0.016] | [-0.007, +0.014] | 0.628 | 0.628 | 0.021 | no effect larger than δ |
| 9 vs 9P | the query's words | 54 | +0.017 | [+0.001, +0.033] | [+0.003, +0.031] | 0.045 | 0.089 | 0.026 | inconclusive |

Reported without a verdict (each new version against the unedited page):

| Contrast | n | d | 95% CI | p | Label |
|---|---|---|---|---|---|
| 9W vs original | 54 | +0.023 | [+0.006, +0.041] | 0.013 | reported without a verdict |
| 9P vs original | 54 | +0.010 | [-0.007, +0.027] | 0.295 | reported without a verdict |

**Reading.** The plan gives no reading for this pair of labels (9 vs 9W: no effect larger than δ; 9 vs 9P: inconclusive), so no reading is drawn.

Length and key-term regression (reported only; it does not change a label):

| Contrast | Intercept | 95% CI | Regressors without variance |
|---|---|---|---|
| 9 vs 9W | +0.003 | [-0.010, +0.016] | dlog_length constant at +0.000, dkey_terms constant at +0.000 |
| 9 vs 9P | -0.001 | [-0.043, +0.042] | none |

Versions:

| Version | Queries | Valid | Invalid | Length ratio | Key-term change | Edit distance |
|---|---|---|---|---|---|---|
| 9 (query as a heading) | 55 | 54 | 1 | 1.034 | +7.685 | 32.074 |
| 9W (query as plain text) | 54 | 54 | 0 | 1.034 | +7.685 | 32.074 |
| 9P (a heading without the query's words) | 54 | 54 | 0 | 1.035 | +0.167 | 31.426 |

### Replication set

Judges: gemma-4-12b, qwen3.8-27b (two-judge). Queries: 60. Planned tests with enough queries to test: 2 of 2 (Holm over those, alpha 0.05).

Planned tests (d is the score of arm 9 minus the score of the other version):

| Contrast | What it isolates | n | d | 95% CI | 90% CI | p | p (Holm) | Smallest detectable d | Label |
|---|---|---|---|---|---|---|---|---|---|
| 9 vs 9W | the heading markup | 52 | -0.001 | [-0.014, +0.012] | [-0.012, +0.010] | 0.931 | 0.931 | 0.021 | no effect larger than δ |
| 9 vs 9P | the query's words | 52 | +0.048 | [+0.027, +0.071] | [+0.030, +0.067] | <0.001 | <0.001 | 0.036 | helps |

Reported without a verdict (each new version against the unedited page):

| Contrast | n | d | 95% CI | p | Label |
|---|---|---|---|---|---|
| 9W vs original | 52 | +0.037 | [+0.019, +0.057] | <0.001 | reported without a verdict |
| 9P vs original | 52 | -0.012 | [-0.029, +0.004] | 0.173 | reported without a verdict |

**Reading.** The query's words carry the gain; the tool's advice becomes "use your reader's words near the top", and question headings stay mixed evidence.

Length and key-term regression (reported only; it does not change a label):

| Contrast | Intercept | 95% CI | Regressors without variance |
|---|---|---|---|
| 9 vs 9W | -0.001 | [-0.014, +0.013] | dlog_length constant at +0.000, dkey_terms constant at +0.000 |
| 9 vs 9P | +0.032 | [-0.032, +0.097] | none |

Versions:

| Version | Queries | Valid | Invalid | Length ratio | Key-term change | Edit distance |
|---|---|---|---|---|---|---|
| 9 (query as a heading) | 53 | 52 | 1 | 1.042 | +9.173 | 43.654 |
| 9W (query as plain text) | 52 | 52 | 0 | 1.042 | +9.173 | 43.654 |
| 9P (a heading without the query's words) | 52 | 52 | 0 | 1.033 | +0.038 | 36.385 |

The smallest detectable d is the difference the test would find 80% of the time at the planned alpha; smaller effects cannot be ruled out.

## E2b: the editor check

Editor: Qwen/Qwen3.8-27B. Judges: gemma-4-12b, qwen3.5-9b (two-judge). Queries: 80 (main set).

| Contrast | n | d (Qwen edits) | 95% CI | p | d in E1 (Gemma edits) | E1 label | E2b label |
|---|---|---|---|---|---|---|---|
| 12 vs P12 | 29 (fewer than 30) | +0.029 | [+0.003, +0.061] | 0.051 | +0.035 | helps, possibly through length or query-term overlap | stands |
| ALL vs P_ALL | 44 | +0.069 | [+0.038, +0.104] | <0.001 | +0.071 | helps, possibly through length or query-term overlap | stands |

A label stands when d keeps the sign it had in E1; otherwise it becomes editor-dependent. The p-values are shown for reference; the rule is the sign.

Each Qwen-edited version against the unedited page, reported without a verdict:

| Contrast | n | d | 95% CI | Label |
|---|---|---|---|---|
| 12 vs original | 49 | +0.028 | [+0.006, +0.054] | reported without a verdict |
| P12 vs original | 29 | -0.004 | [-0.022, +0.014] | reported without a verdict |
| ALL vs original | 77 | +0.055 | [+0.036, +0.077] | reported without a verdict |
| P_ALL vs original | 44 | -0.004 | [-0.020, +0.012] | reported without a verdict |

Versions (pages whose Qwen edit failed validation are listed, not replaced):

| Version | Queries | Valid | Invalid | Length ratio | Key-term change | Edit distance |
|---|---|---|---|---|---|---|
| 12 | 63 | 49 | 14 | 1.009 | +4.898 | 9.429 |
| P12 | 49 | 29 | 20 | 0.999 | -0.034 | 11.276 |
| ALL | 79 | 77 | 2 | 1.058 | +9.494 | 66.390 |
| P_ALL | 71 | 44 | 27 | 0.997 | -0.182 | 41.136 |

- 12 failed on 14 pages: geo-test-104, geo-test-129, geo-test-154, geo-test-160, geo-test-166, geo-test-187, geo-test-228, geo-test-30, geo-test-317, geo-test-328, geo-test-344, geo-test-349, geo-test-60, geo-test-62.

- P12 failed on 20 pages: geo-test-149, geo-test-16, geo-test-168, geo-test-20, geo-test-251, geo-test-297, geo-test-300, geo-test-303, geo-test-311, geo-test-322, geo-test-324, geo-test-338, geo-test-341, geo-test-355, geo-test-41, geo-test-48, geo-test-57, geo-test-7, geo-test-84, geo-test-89.

- ALL failed on 2 pages: geo-test-16, geo-test-335.

- P_ALL failed on 27 pages: geo-test-100, geo-test-129, geo-test-154, geo-test-160, geo-test-20, geo-test-204, geo-test-228, geo-test-272, geo-test-297, geo-test-303, geo-test-311, geo-test-317, geo-test-322, geo-test-324, geo-test-333, geo-test-334, geo-test-338, geo-test-341, geo-test-345, geo-test-348, geo-test-354, geo-test-41, geo-test-62, geo-test-66, geo-test-7, geo-test-84, geo-test-89.
