# E2: why does the question-as-heading edit help?

Written 2026-10-24, before any E2 page version was built or any E2 answer generated. E2 reuses E1's pages, prompts, judges, seeds, score and statistics (experiments/PREREG_E1.md); only what differs is written here.

## Question

In E1, one edit helped on both query sets: arm 9, which adds the query as an H2 directly under the title, followed by the page sentence that shares the most query key terms. Its gain shrank to an interval around zero once we controlled for the change in length and in query key terms. E2 asks which part of the edit carries the gain:

1. **The heading markup.** Does the same text help as much when it is plain text instead of a heading?
2. **The query's words.** Does adding a heading and a sentence of the same size help when they do not repeat the query's words?

A second, smaller part (E2b) runs the editor check that E1's plan already describes: the edits behind E1's other "helps" results were all written by Gemma, so we redo them with a different model family.

## E2a: two new versions of arm 9

Both are deterministic (no model writes them) and are inserted at the same position as arm 9 (directly under the title).

| Version | What is inserted | Holds fixed (vs arm 9) | Changes |
|---|---|---|---|
| 9 (from E1) | `## <query>` then the page sentence with the most query key terms | | |
| 9W, words without a heading | `<query>` as a plain paragraph, then the same sentence | every word | heading markup only |
| 9P, a section without the query's words | `## <first N words of sentence S>` then sentence S, where S is the page's prose sentence with the fewest query key terms (ties: closest in length to arm 9's sentence, then earliest) and N is the query's word count | position, markup, about the same length | the query's words |

Applicability: a query gets 9W and 9P only where E1's arm 9 version is valid (54 main queries, 52 replication queries). Validity checks: the version differs from the original; for 9P, the inserted text adds no query key term beyond those already in sentence S (it is copied from the page, so it brings no new word to the page). The report gives, per version, the length ratio and the change in query key-term count, as in E1.

**Contrasts** (unit: the query; d averaged over 8 seeds, then over the two judges, exactly as in E1):

- Planned tests, one Holm family at alpha 0.05: **9 vs 9W** (the effect of the heading markup) and **9 vs 9P** (the effect of the query's words, with position, markup and length held).
- Reported without a test verdict: 9W vs original and 9P vs original.
- The same four contrasts on the replication set (C-SEO Bench), reported separately.

**Reading the result** (the same labels as E1: helps, hurts, no effect larger than 0.03, inconclusive):

- 9 vs 9W helps, 9 vs 9P no effect: the heading markup carries the gain; the tool keeps "use question headings" as written.
- 9 vs 9P helps, 9 vs 9W no effect: the query's words carry it; the tool's advice becomes "use your reader's words near the top", and question-headings stays mixed evidence.
- Both help: both matter. Neither: the gain is position or length; the tool says so.

**Size and power.** With n = 54 and E1's observed spread for arm 9 (SD of d about 0.03), the smallest difference this can detect is about 0.015 to 0.02. Effects smaller than that cannot be ruled out, and the report says so.

## E2b: the editor check from E1's plan

As written in PREREG_E1.md ("Editor-family check"): the E1 arms labelled helps that a model wrote (arm 12 and ALL, with their placebos P12 and P_ALL; arm 9 is deterministic and needs no check) are edited again by Qwen3.8-27B with the same prompts, spans and validators, on the main set. The new versions, and the originals, are judged by Gemma-4-12B and Qwen3.5-9B (Qwen3.8-27B is the editor here, so it is not a judge). Each label stands if d keeps its sign; otherwise it becomes "editor-dependent". The pages Qwen's edits fail validation on are reported, not replaced.

## Runs

- E2a: about 106 queries x 2 versions x 8 seeds x 2 judges, about 3,400 answers. The original and arm 9 answers are reused from E1 (same prompts, judges, seeds and settings).
- E2b: one editing job (Qwen3.8-27B, one H200), then about 80 queries x 5 versions x 8 seeds x 2 judges, about 6,400 answers.
- E1's Slurm allocation (set in local.env), environment and settings. Total about 3 to 5 GPU-hours.

## What we will not do

No change to E1's results or labels except the "editor-dependent" relabel that E2b's rule allows. No new arms beyond these. Any choice made after the answers exist is reported as an added analysis.

## Amendments (made before any E2 answer was generated)

1. **Sentence S of 9P must be body text** (2026-10-24, after building the versions and before any run). The first build took page furniture as S where it had the fewest key terms (for example a "Comment / Corporate Communications Address" line). S is now chosen only among sentences that are one line, have at least 8 words, start with a capital letter or digit and end with ., ! or ?; a page with no such sentence gets no 9P. With this rule all 106 queries keep a valid 9P, S never contains a query key term, and one S is still a cookie notice (replication query cseo-web-194), which we report rather than filter. Reason: a 9P made of page furniture would make "the query's words" look more important than they are.
2. The Slurm account line under Runs was replaced by "E1's allocation (set in local.env)" so the repository's no-personal-details test passes; the account is unchanged.
