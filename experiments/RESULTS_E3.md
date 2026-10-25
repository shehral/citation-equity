# E3 results: seven checks with more queries and one more attempt per edit

E1 gave no verdict for these checks because fewer than 30 queries had a valid edit and placebo. E3 asks E1's question again with more pages: the 72 five-page GEO-bench test queries E1 did not use, the four-page queries for the checks that need no second page, and one more editing attempt for every pair. The pages, prompts, judges, seeds, score and statistics are E1's.

Queries in the pooled analysis: 260 (80 from E1, 180 new). Answers come from Gemma-4-12B and Qwen3.8-27B.

A check gets a verdict when at least 30 queries have a valid pair. 4 checks reach that (question headings, attributed quotes, cited sources, direct answer first); they are tested together, with Holm's correction at 0.05.

## Pooled result

d is the citation score of the edited page minus the score of its reference (each check's placebo, which rewords the same spans without the change; for tables, the unedited page), averaged over seeds and judges per query and then over queries. Positive d means the edit helped the page get cited.

| Check | Compared with | Queries | d | 95% CI | p | p (Holm) | E3 result | E1 result |
|---|---|---|---|---|---|---|---|---|
| Question headings (arm 2) | placebo (P2) | 57 | -0.016 | [-0.030, -0.002] | 0.041 | 0.164 | no effect larger than 0.03 | too few queries for a verdict (n 17) |
| Tables (arm 4) | the unedited page | 11 | -0.027 | [-0.054, -0.001] | 0.109 | n/a | too few queries for a verdict | not run (n 0) |
| Statistics (arm 5) | placebo (P5) | 11 | -0.007 | [-0.045, +0.026] | 0.812 | n/a | too few queries for a verdict | too few queries for a verdict (n 4) |
| Attributed quotes (arm 6) | placebo (P6) | 62 | +0.026 | [+0.001, +0.053] | 0.060 | 0.179 | inconclusive | too few queries for a verdict (n 26) |
| Cited sources (arm 7) | placebo (P7) | 49 | -0.010 | [-0.026, +0.004] | 0.228 | 0.228 | no effect larger than 0.03 | too few queries for a verdict (n 25) |
| Direct answer first (arm 8) | placebo (P8) | 66 | +0.012 | [+0.000, +0.023] | 0.060 | 0.179 | no effect larger than 0.03 | too few queries for a verdict (n 20) |
| Explicit comparisons (arm 10) | placebo (P10) | 24 | +0.003 | [-0.020, +0.026] | 0.875 | n/a | too few queries for a verdict | too few queries for a verdict (n 8) |

Notes:

- Tables (arm 4): 11 queries with a valid pair, under the 30 needed for a verdict.
- Statistics (arm 5): 11 queries with a valid pair, under the 30 needed for a verdict.
- Explicit comparisons (arm 10): 24 queries with a valid pair, under the 30 needed for a verdict.

## Where the queries come from

The same contrasts on parts of the pooled set, without verdicts. If the extra attempt moved the estimate, E1's queries with the extra attempt differ from E1's queries as E1 ran them; if the new queries behave differently, they differ from both.

| Check | E3's new queries only | E1's queries, with E3's extra attempt | E1's queries as E1 ran them |
|---|---|---|---|
| Question headings (arm 2) | n 40, d -0.016 [-0.036, +0.003] | n 17, d -0.015 [-0.031, +0.000] | n 17, d -0.015 [-0.031, +0.000] |
| Tables (arm 4) | n 7, d -0.011 [-0.040, +0.016] | n 4, d -0.055 [-0.105, -0.012] | no valid pair |
| Statistics (arm 5) | n 7, d -0.025 [-0.076, +0.016] | n 4, d +0.023 [-0.020, +0.062] | n 4, d +0.023 [-0.020, +0.062] |
| Attributed quotes (arm 6) | n 35, d +0.024 [-0.010, +0.059] | n 27, d +0.029 [-0.006, +0.073] | n 26, d +0.029 [-0.008, +0.075] |
| Cited sources (arm 7) | n 24, d -0.007 [-0.025, +0.011] | n 25, d -0.013 [-0.038, +0.009] | n 25, d -0.013 [-0.038, +0.009] |
| Direct answer first (arm 8) | n 46, d +0.014 [+0.000, +0.027] | n 20, d +0.008 [-0.016, +0.030] | n 20, d +0.008 [-0.016, +0.030] |
| Explicit comparisons (arm 10) | n 16, d +0.002 [-0.031, +0.035] | n 8, d +0.004 [-0.016, +0.027] | n 8, d +0.004 [-0.016, +0.027] |

## Edits that passed validation (pooled)

Applicable: the check flagged something to change on the page. Valid: the edit passed E1's six validity checks within the attempts it had (two in E1, three in E3).

| Version | Applicable | Valid | Failed validation | Length ratio | Key-term change |
|---|---|---|---|---|---|
| Question headings (2) | 185 | 104 | 81 | 1.017 | +0.885 |
| Tables (4) | 16 | 11 | 5 | 1.002 | +0.000 |
| Statistics (5) | 65 | 22 | 43 | 1.017 | +2.636 |
| Attributed quotes (6) | 117 | 77 | 40 | 1.029 | +3.117 |
| Cited sources (7) | 76 | 61 | 15 | 1.002 | +3.508 |
| Direct answer first (8) | 126 | 86 | 40 | 1.025 | +2.721 |
| Explicit comparisons (10) | 67 | 30 | 37 | 1.021 | +1.200 |
| placebo for question headings (P2) | 104 | 57 | 47 | 1.000 | -0.018 |
| placebo for statistics (P5) | 22 | 11 | 11 | 1.000 | +0.000 |
| placebo for attributed quotes (P6) | 77 | 62 | 15 | 1.000 | -0.016 |
| placebo for cited sources (P7) | 61 | 49 | 12 | 0.999 | +0.000 |
| placebo for direct answer first (P8) | 86 | 66 | 20 | 1.000 | -0.015 |
| placebo for explicit comparisons (P10) | 30 | 24 | 6 | 1.000 | +0.000 |

E1's published results stay as they are; the tool's labels for these checks change only through this pooled result, by E1's rule table.

Content check on a local model over a fixed page set. It does not predict live AI engines.
