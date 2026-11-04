# E5 freeze manifest

Frozen 2026-11-03 03:07 PST, at the commit that adds this file (its parent is 2e780ef, PLAN_E5.md r2 with amendments 1 to 3). No E5 version has been judged and no E5 answer exists. Everything after this commit that touches the E5 pipeline is logged in the freeze log below or reported as an added analysis.

## Plan
- experiments/PLAN_E5.md: r2 (7c1c725) with amendments 1 (a98da69), 2 (0df6f1e) and 3 (2e780ef).

## Engine and bridge (never rebuilt for E5)
- E1 engine bundle experiments/e1/out/bundle/engine_cli.js: sha256 1b8e30dbea4e01134302d302fe457e03e2e16baff658c891a9fb3e89fa5a4c47 (applicability, spans, every validation).
- Questions bridge experiments/e5/out/bundle/questions_cli.js: sha256 9aefe8aebbd79118b2078814d5ff1e55eeb0dfee60f7789d576b1265a75240ce, built from f6e8903 (packages at eeaf562); see experiments/e5/bundles.json.

## Models (Hugging Face snapshot revisions in the cluster cache)
- google/gemma-4-31B-it (editor, local-model questions): 842da3794eaa0b77d5f08bae87a17459d91ff475
- google/gemma-4-12B-it (primary judge): 707f0a3b8a3c7ad586ed01e27eafbad8a27dd0f7
- Qwen/Qwen3.8-27B (second judge): 1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0

## Local inputs (gitignored: they hold third-party page text; sha256 only)

| File | sha256 |
|---|---|
| experiments/e5/data/applicability.json | bf6cc63b1fca4a6a20a8f3c1404f694c4b807ead42bf431df11dc13a9728c740 |
| experiments/e5/data/applicability.jsonl | c37ea3383636e78748670413812e67a37c921d2240d5a76bfb0ffd547eb7c1ef |
| experiments/e5/data/edit_applicability.jsonl | 8e0ac9f6e6d9bf94d4ddf7f1f19cef5968752ac6e1e8c7071f7bd40e9876d857 |
| experiments/e5/data/edit_questions.jsonl | 9d713662dc6992034e82fad09105f005de09798f91bf17cde0d70faabbb4433e |
| experiments/e5/data/edit_texts.json | a7eea80370bf0a8d801d92f5e6dff36bbd26298ec31fecbb42f84245ed317c29 |
| experiments/e5/data/edit_texts.jsonl | fa16a8c99c24a58ae3f15685a07788e2c6b4ebb425b81247ee08ca74054a12c6 |
| experiments/e5/data/engine_original.jsonl | 4a0f45fd707301d3ca0712fbecff4ea5f38364ce1f368da09a118b9e1206cf14 |
| experiments/e5/data/make_versions.json | a6c116a8130fc39ccd4c1f4296dc2bea8bc6428428ded4bf79050d7579f7341f |
| experiments/e5/data/pages.jsonl | d71289032d00f7b8bdce9176e4033a7114c3b703d23cffb80d4a92fa9e2fcd13 |
| experiments/e5/data/prerun_counts.json | 13c5d79acfb30f0ee5942f3cf9593577f5f078b50437d547544e7b70396347f0 |
| experiments/e5/data/prompt_build.json | df7612ba8fc13ea33c3a5c5ef42fcdc89d18a44aff56e0af129ec061e2f01b09 |
| experiments/e5/data/prompts.jsonl | 8c66b3f6ce084a213b88ad5acf312ae9afc5fdc0a7ae280c653ebbf4357c0cca |
| experiments/e5/data/versions.jsonl | 17d0d1360a972c7b5b55b2e1d5497bafd9981e99362b0759d9269734b04e6f6c |

## Null simulation
- experiments/e5/freeze/null_simulation_e5.json (1,000 simulations, labels shuffled within query): familywise false-positive rate 0.048 (MC SE 0.007) for the gate plus the Holm family.

## Tests at the freeze
- E1 296, E2 34, E3 22, E5 121 (python3 -I -m unittest discover -s experiments/<e>/tests), all OK.

## Freeze log (anything after this commit)
- 2026-11-03 03:12 PST: added experiments/e5/e5_chain.sbatch, an operational wrapper that runs several batch files through E1's generate.sbatch unchanged in one allocation (per-user submit limits are full). No prompt, setting, version or analysis changes.
- 2026-11-03 12:53 PST: two step-2 jobs ran with overlap (11595281 accepted despite 'sbatch: Unexpected message received'; 11595352 from the retry loop); both reported identical counts (9L valid 54/44/71/53; 33,056 prompts, 32 files, 0 refused). Verification: hashes of every step-2 output saved, a solo rerun (11596438) must reproduce them byte for byte before tier 2 is submitted.
- 2026-11-03 13:43 PST: duplicate submissions of the Gemma 9L chain (the submit check used sacct -S, which lists no pending job) were cancelled before any of them wrote an answer file (11597110, 11597286 never started; 11597289 cancelled after 1 min 42 s of model loading); one chain per batch set remains (11596887). Answers are unaffected: generate.sbatch writes a batch's file only when the batch completes and refuses an existing one.
- 2026-11-03 15:33 PST: every E5 batch answered (32 files, 0 cut at max tokens) and copied back with matching hashes (prompts.jsonl sha256 d7571608...). The environment check on a GPU node (job 11600609) was submitted after the jobs instead of before (deviation; each job log records torch, CUDA and GPU). Scoring and the single planned analysis run now.
- 2026-11-03 17:36 PST: after the first analysis (snapshot 15:34:20 PST). (1) The 12:53 entry's check: the solo step-2 rerun 11596438 reproduced all 36 step-2 output files byte for byte (verified by the controller during the run and stated in commit 75a5bde's message; the hash list itself is not in the repo). (2) GPU types, from one read-only grep of the job logs (ce-e5-*.out) on Explorer: 34 torch lines, all torch 2.13.0+cu130, on H200 (17), A100-SXM4-40GB (11) and A100-SXM4-80GB (6); the grep dropped file names, so the per-job mapping is in those logs. The judge jobs therefore ran on three GPU types (e5_chain.sbatch requests a generic gpu:1). (3) experiments/e5/data/env_check.json (job 11600609, run after the jobs, see 15:33): sha256 4c2a76ada06ea1b5633617a64032687146b0965db744c073a50b1f73a5a8b3c1, 0 mismatches with E1's records; vLLM 0.31.0, torch 2.13.0, transformers 5.17.0; the three model revisions equal this manifest's; that node's GPU A100-SXM4-80GB. (4) Amendment 3's sensitivity rows (every 9G contrast, and every 9K or 9L contrast with an edit text equal to q, also without those queries: main 9L 11, 9G 3, 9K 0; replication none) had been omitted from the first analysis and were added afterwards on the same snapshot, with the copied-sentence counts (validity.sentence_vs_9), one added analysis (the gate without geo-test-325, which shares 3 of its 4 pages with E1's geo-test-301) and report wording fixes. The rerun at 17:31:55 PST logged the same 50 input sha256 values, and every value of the first analysis_e5.json came back identical. No planned label or reading changed. (5) smoke_e5.py now starts from the local build's versions (the smoke test had failed since the edit job's rows were merged at 12:55); no prompt, answer or analysis change. (6) Committed aggregates in experiments/results/e5/ through experiments/e5/sanitize_e5.py (nothing to remove). Tests: E1 296, E2 34, E3 22, E5 139, all OK.
