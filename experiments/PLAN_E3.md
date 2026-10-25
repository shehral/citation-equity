# E3: enough pages for the checks E1 could not judge

Written 2026-10-24, before any E3 page version was built or any E3 answer generated. E3 reuses E1's editor, prompts, validators, judges, seeds, score and statistics (experiments/PREREG_E1.md); only what differs is written here.

## Question

E1 gave no verdict for six of the tool's checks because fewer than 30 queries had a valid edit and placebo: question headings (arm 2, n 17), statistics (5, n 4), attributed quotes (6, n 26), cited sources (7, n 25), direct answer first (8, n 20) and explicit comparisons (10, n 8). Tables (4) never produced a valid edit. E3 asks the same question as E1 for these arms, with more queries and a fairer chance for each edit to pass validation.

## What changes from E1

1. **More queries.** E1 admitted 80 of the 153 GEO-bench test queries that had five usable pages (plus one held out for timing). E3 adds the other 72, with E1's own draw rule (target, donor and competitors by the same sha256 rule). Their pages are already fetched and normalized; nothing new is fetched.
2. **Four-page queries for the arms that need no donor.** Arms 2, 4, 8 and 10 build their edits from the target page alone, so a query with four usable pages (target plus three competitors, the same four-source prompt) can take them. E3 admits those queries for these four arms only, with the same draw rule minus the donor.
3. **One more attempt per edit.** E1 allowed an edit (and its placebo) one regenerate with the validator's message. E3 allows two, for every pair: E1 pairs that failed get one more attempt now, and new pairs get up to three attempts from the start. Validators and thresholds do not change. A pair that passes keeps its earlier version; nothing that already passed is regenerated.
4. **The tables edit.** All four E1 tables edits failed with "after the edit the tables check is not applicable". If inspection shows the validator rejects correct conversions (the key-value run becomes a table, so the check has nothing left to flag), the validator counts "not applicable because the flagged run is now a table" as a pass. The rule and the evidence for it are written below as amendment 1 before any tables answer is generated. If the edits are wrong instead, the arm is reported as not run.

## Analysis

- The unit and statistics are E1's. Each arm's primary contrast is E1's (arm vs its placebo; tables vs the original).
- **The E3 result is pooled:** every query with a valid pair, E1's and new ones together. The answers E1 already has are reused (same prompts, judges, seeds and settings); only new versions and new queries get new answers.
- Holm family at alpha 0.05 over the arms in {2, 4, 5, 6, 7, 8, 10} that reach 30 analyzable queries; labels as in E1 (helps, hurts, no effect larger than 0.03, inconclusive, model-dependent), with the confound regression and its "possibly through length or query-term overlap" note.
- Reported beside it, without verdicts: each arm on the new queries alone, and on E1's queries with the extra attempt, so a reader can see whether the added attempt or the added queries move the estimate.
- E1's published results stay as they are; the tool's labels for these arms change only through E3's pooled result, by E1's rule table.

## Expected size

From E1's applicability and validity rates, the pooled n should roughly double for arms 2, 6, 7 and 8 (to about 45-70) and reach about 20-35 for 5 and 10. Tables applies rarely (4 of 80 pages), so it will likely stay under 30; if so, the report says so.

## Runs

- Editing: Gemma-4-31B-it, E1's prompts and settings, one job per set of new or retried pairs.
- Answers: Gemma-4-12B-it and Qwen3.8-27B, 8 seeds, for new versions and new queries' originals.
- E1's allocation and environment; about 10 to 20 GPU-hours.

## Amendments

1. **The tables edit is a correct conversion; "not applicable" after it now passes** (2026-10-24, after re-running E1's four tables edits and before any tables answer was generated). In all four E1 pages (geo-test-25, 154, 301 and 315) the tables check flagged one Key: value list (71, 5, 4 and 7 items; bold or plain keys, two of them numbered lists), and that list was the only reason its section needed a table: before the edit the check was applicable with score 0, one section needing a table, no comparison wording and one suggestion. The edit replaced exactly that list with the check's own two-column table: one row per item in the same order, each key and value verbatim (the bold markers and list numbers are gone), and the parser reads it as a table in the same section. With the list gone the check has nothing left to flag and reports not applicable, which E1's validator counted as a failure; every other check passed. Rule, for arm 4's own version only: when the tables check is not applicable after the edit, the edit passes if every edit replaced exactly the range of one of the check's edit suggestions, which is the range of one list; that list has at least 3 items and every item splits as Key: value (the engine's rule); the replacement is exactly the `| Item | Detail |` table of those pairs; and the edited page has a table at exactly the replacement's place with one row per item plus the header (`validate.converted_to_table`). An ALL step and every other rule are unchanged. With this rule all four E1 edits pass. Over the pool E3 draws from (80 E1, 72 new five-page and 108 four-page queries; the timing query left out) the drawn target has a tables edit in 16 queries (4, 9 and 3); 66 target-eligible pages have one. All 16 edits are correct conversions by this test; 11 pass, and 5 fail on the unchanged "did not rise" rule, because a converted section leaves the check's denominator while another section the check flags only for advice (comparison wording) remains. So the tables arm can reach at most 11 queries (16 if that rule also changed, which this amendment does not do), below 30, and the report says so.
