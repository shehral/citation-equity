# E5 pre-run counts

Generated 2026-11-03T02:36:16-08:00 from the local build (E1's pinned engine, E1's validators), before any E5 answer. Numbers only. Machine-readable: `data/prerun_counts.json` (gitignored folder).

Inputs of the cluster run, sha256 (the files stay in the gitignored `data/` folder; versions.jsonl holds the deterministic versions and E1's own 12 and P12 until the edit job's rows are merged):

- pages.jsonl `d71289032d00f7b8bdce9176e4033a7114c3b703d23cffb80d4a92fa9e2fcd13`
- edit_texts.jsonl `fa16a8c99c24a58ae3f15685a07788e2c6b4ebb425b81247ee08ca74054a12c6`
- applicability.jsonl `c37ea3383636e78748670413812e67a37c921d2240d5a76bfb0ffd547eb7c1ef`
- edit_applicability.jsonl `8e0ac9f6e6d9bf94d4ddf7f1f19cef5968752ac6e1e8c7071f7bd40e9876d857`
- edit_questions.jsonl `9d713662dc6992034e82fad09105f005de09798f91bf17cde0d70faabbb4433e`
- engine_original.jsonl `4a0f45fd707301d3ca0712fbecff4ea5f38364ce1f368da09a118b9e1206cf14`
- versions.jsonl `17d0d1360a972c7b5b55b2e1d5497bafd9981e99362b0759d9269734b04e6f6c`
- engine_cli.js (E1's) `1b8e30dbea4e01134302d302fe457e03e2e16baff658c891a9fb3e89fa5a4c47`
- questions_cli.js `9aefe8aebbd79118b2078814d5ff1e55eeb0dfee60f7789d576b1265a75240ce`

## Applicable and valid versions

Applicable / valid per stratum. A dash: not built in E5. Projected values (the edit job's versions) are in brackets: 9L at 9K's valid count, 12 and 12K at E1's arm 12 rate (50 of 63), placebos at E1's P12 rate (33 of 50). On E1's queries (e1), 12 and P12 are E1's own versions, copied and re-answered in tier 3 (PLAN_E5 amendment 2); P12's first number there is 12's valid count (the placebo needs a valid 12).

| Version | e1 | e3 | e3-four | replication |
|---|---|---|---|---|
| original | 80 / 80 | 72 / 72 | 108 / 108 | 60 / 60 |
| 9 | 55 / 54 | 45 / 44 | 72 / 71 | 53 / 52 |
| 9P | 55 / 55 | 45 / 45 | 72 / 69 | 53 / 53 |
| 9K | 55 / 54 | 45 / 44 | 71 / 70 | 53 / 53 |
| 9L | / [54] | / [44] | / [70] | / [53] |
| 9A | 55 / 54 | 45 / 44 | 71 / 70 | 53 / 52 |
| 9G | 47 / 46 | 36 / 36 | 66 / 65 | 42 / 41 |
| 12 | 63 / 50 | 53 / [42] | 91 / [72] | - |
| P12 | 50 / 33 | / [28] | / [48] | - |
| 12K | 37 / [29] | 34 / [27] | 61 / [48] | - |
| P12K | / [19] | / [18] | / [32] | - |

## Edit texts

| | main | replication |
|---|---|---|
| q' template: kept | 232 | 56 |
| q' template: what-is | 26 | 4 |
| q' template: how-to | 2 | 0 |
| templates among valid 9K: kept | 149 | 49 |
| templates among valid 9K: what-is | 17 | 4 |
| templates among valid 9K: how-to | 2 | 0 |
| q' equals q (exact) | 0 | 0 |
| q' equals q (ignoring case, spaces, ?) | 0 | 0 |
| q_G equals q (exact) | 2 | 0 |
| q_G equals q (ignoring case, spaces, ?) | 4 | 0 |
| q_G origin: title | 55 | 0 |
| q_G origin: topic | 174 | 49 |
| q_G origin: none | 31 | 11 |
| 9A text equals q | 1 | 1 |
| k equals the 9A text (q has at most two key terms) | 34 | 3 |
| key terms 1 | 6 | 0 |
| key terms 2 | 28 | 3 |
| key terms 3 | 54 | 7 |
| key terms 4 | 73 | 24 |
| key terms 5 or more | 99 | 26 |

Edit texts that are q itself (ignoring case, spaces and a final question mark): there the version makes arm 9's edit, up to the heading's case, so it measures arm 9, not a guess. Flag them in the report.

| Query | Stratum | Version | Exactly q | Version built | Same text as arm 9 |
|---|---|---|---|---|---|
| geo-test-226 | e1 | 9G | yes | not applicable |  |
| geo-test-330 | e1 | 9G | no (case) | valid | no |
| cseo-web-171 | replication | 9A | yes | not applicable |  |
| geo-test-924 | e3 | 9A | yes | not applicable |  |
| geo-test-428 | e3-four | 9G | no (case) | valid | no |
| geo-test-618 | e3-four | 9G | yes | valid | yes |

## Valid versions: same sentence as arm 9, the tool's view, length

Same sentence: the version copies arm 9's sentence (only the heading differs). Tool gate: the tool (current engine) would suggest the edit (question-coverage with the edit text under 0.9 on the original). Covers: the tool counts the edited page as covering the edit text / q.

| Stratum | Version | Valid | Same sentence | Tool gate | Covers edit text | Covers q | Mean length ratio | Mean key-term change |
|---|---|---|---|---|---|---|---|---|
| e1 | original | 80 |  |  |  |  | 1.0 | 0.0 |
| e1 | 9 | 54 |  | 54 | 18 | 18 | 1.0341 | 7.685 |
| e1 | 9P | 55 |  |  |  |  | 1.0356 | 0.164 |
| e1 | 9K | 54 | 31 | 43 | 21 | 8 | 1.0224 | 4.574 |
| e1 | 9A | 54 | 54 | 54 | 18 | 18 | 1.0285 | 7.63 |
| e1 | 9G | 46 | 17 | 28 | 28 | 2 | 1.0225 | 3.196 |
| e1 | 12 | 50 |  | 33 | 18 | 18 | 1.0134 | 6.08 |
| e1 | P12 | 33 |  |  |  |  | 0.9996 | 0.0 |
| e3 | original | 72 |  |  |  |  | 1.0 | 0.0 |
| e3 | 9 | 44 |  | 44 | 14 | 14 | 1.033 | 8.045 |
| e3 | 9P | 45 |  |  |  |  | 1.0324 | 0.0 |
| e3 | 9K | 44 | 22 | 40 | 18 | 7 | 1.0198 | 4.227 |
| e3 | 9A | 44 | 44 | 44 | 14 | 14 | 1.0285 | 8.0 |
| e3 | 9G | 36 | 10 | 23 | 25 | 1 | 1.0235 | 2.611 |
| e3-four | original | 108 |  |  |  |  | 1.0 | 0.0 |
| e3-four | 9 | 71 |  | 71 | 14 | 14 | 1.0345 | 8.042 |
| e3-four | 9P | 69 |  |  |  |  | 1.0334 | 0.0 |
| e3-four | 9K | 70 | 42 | 64 | 23 | 9 | 1.0245 | 4.257 |
| e3-four | 9A | 70 | 70 | 70 | 14 | 14 | 1.0296 | 8.057 |
| e3-four | 9G | 65 | 23 | 45 | 39 | 4 | 1.0286 | 3.308 |
| replication | original | 60 |  |  |  |  | 1.0 | 0.0 |
| replication | 9 | 52 |  | 52 | 24 | 24 | 1.0417 | 9.173 |
| replication | 9P | 53 |  |  |  |  | 1.0331 | 0.038 |
| replication | 9K | 53 | 29 | 49 | 20 | 17 | 1.0352 | 6.264 |
| replication | 9A | 52 | 52 | 52 | 24 | 24 | 1.037 | 9.135 |
| replication | 9G | 41 | 5 | 11 | 30 | 0 | 1.0274 | 2.561 |

## Planned contrasts: queries with both versions valid

| Contrast | n |
|---|---|
| gate 9 vs original (new) | 115 |
| 9K vs original (main) | 168 |
| 9K vs 9P (main) | 166 |
| 9L vs original (main) | after the edit job (projected about 9K's) |
| step 5: 9 vs original (main) | 169 |
| replication 9K vs original | 53 |
| replication 9K vs 9P | 53 |
| 9 vs 9K, same sentence (main) | 95 |
| 9K vs original, tool gate (main) | 147 |
| 12K vs P12K (main) | after the edit job (projected: 69) |

## Answers and GPU-hours

Judges Gemma-4-12B-it and Qwen3.8-27B, 8 seeds. Built now (tier 1, and tier 3's 9A, 9G and E1's own 12 and P12): 23,600 answers; projected after the edit job (tier 2: 9L, 12K, P12K; tier 3: 12 and P12 on the new queries): 9,344. Total about 32,944 answers, about 10.63 GPU-hours of judging at E1's 3,100 answers per GPU-hour (tier 1 alone 5.08). Token counts: none (the cluster build counts with the judges' tokenizers and may refuse a query over 31,000 tokens; E1 and E3 refused none).

| Judge | Batch | Answers (main + replication) |
|---|---|---|
| gemma-4-12b | tier1 | 7,872 (6,128 + 1,744) |
| gemma-4-12b | tier2-12K (projected) | 1,384 (1,384 + 0) |
| gemma-4-12b | tier2-9L (projected) | 1,768 (1,344 + 424) |
| gemma-4-12b | tier3 | 3,928 (3,184 + 744) |
| gemma-4-12b | tier3-12 (projected) | 1,520 (1,520 + 0) |
| qwen3.8-27b | tier1 | 7,872 (6,128 + 1,744) |
| qwen3.8-27b | tier2-12K (projected) | 1,384 (1,384 + 0) |
| qwen3.8-27b | tier2-9L (projected) | 1,768 (1,344 + 424) |
| qwen3.8-27b | tier3 | 3,928 (3,184 + 744) |
| qwen3.8-27b | tier3-12 (projected) | 1,520 (1,520 + 0) |

## Projected job hours (for the queue projection)

Wall-clock per job at the judges' measured E1 and E3 rates (gemma-4-12b on an A100 80 GB: 243 s load, 1.14 s per prompt; gemma-4-12b on an A100 40 GB: 223 s load, 1.66 s per prompt; qwen3.8-27b on an H200: 717 s load, 0.9 s per prompt; the slowest job of 1,900 prompts or more on each GPU type). `gpu:a100` can land on either A100, so Gemma has two columns. All jobs together: 11.5 to 13.84 GPU-hours. A job over about 3 hours can be split with `build_prompts_e5.py --shards N` (files at query boundaries) when GPUs are free.

| Batch | Prompts | Hours, A100 80 GB | Hours, A100 40 GB | Hours, H200 |
|---|---|---|---|---|
| e5-main.gemma-4-12b.tier1 | 6,128 | 2.01 | 2.89 |  |
| e5-main.gemma-4-12b.tier3 | 3,184 | 1.08 | 1.53 |  |
| e5-main.qwen3.8-27b.tier1 | 6,128 |  |  | 1.73 |
| e5-main.qwen3.8-27b.tier3 | 3,184 |  |  | 1.0 |
| e5-replication.gemma-4-12b.tier1 | 1,744 | 0.62 | 0.87 |  |
| e5-replication.gemma-4-12b.tier3 | 744 | 0.3 | 0.41 |  |
| e5-replication.qwen3.8-27b.tier1 | 1,744 |  |  | 0.64 |
| e5-replication.qwen3.8-27b.tier3 | 744 |  |  | 0.39 |
| e5-main.gemma-4-12b.tier2-12K (projected) | 1,384 | 0.51 | 0.7 |  |
| e5-main.qwen3.8-27b.tier2-12K (projected) | 1,384 |  |  | 0.55 |
| e5-main.gemma-4-12b.tier2-9L (projected) | 1,344 | 0.49 | 0.68 |  |
| e5-main.qwen3.8-27b.tier2-9L (projected) | 1,344 |  |  | 0.54 |
| e5-replication.gemma-4-12b.tier2-9L (projected) | 424 | 0.2 | 0.26 |  |
| e5-replication.qwen3.8-27b.tier2-9L (projected) | 424 |  |  | 0.31 |
| e5-main.gemma-4-12b.tier3-12 (projected) | 1,520 | 0.55 | 0.76 |  |
| e5-main.qwen3.8-27b.tier3-12 (projected) | 1,520 |  |  | 0.58 |
