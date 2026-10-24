# E1 freeze manifest

Written 2026-10-24 01:33 PDT at code commit `a2322d7` (feat/citation-equity), before any edited page of the main or replication set was generated and before any E1 answer was collected. The pre-registration is `experiments/PREREG_E1.md` (r3 with amendments 1 to 10).

## Sizes (owner decision)

- Main: 80 queries (target 80, floor 60), replication: 60 queries. Timing query `geo-test-939` held out of both (amendment 8).
- Private-individual screen: 0 of 80 dropped (controller read the admitted list).

## Data hashes (files are local and never committed)

| file | sha256 | lines |
|---|---|---|
| `pages.jsonl` | `b4ad4a6d84b403dbb94a6501bc83567084aeaf23b827aba5130cbc3938afb65a` | 705 |
| `applicability.jsonl` | `1f17fb793294c029da02514f232318cf537d4afb454319f7524930cd9c7fda77` | 2115 |
| `admission.json` | `fb08e42ed58eb45beaeb0fff87baa0d1a0fd439f950624e256562d094c8b61ab` | 25 |
| `candidates.jsonl` | `4125789c6af5ab4839306e1900b1707df034b88772003c3d904520908fec1229` | 3455 |
| `fetch_log.jsonl` | `6fc79e3a85580dba4e9850433530f881fa573715ed35cb4463d719812b386048` | 4259 |

## Frozen code and prompts (sha256)

| file | sha256 |
|---|---|
| `experiments/e1/analyze.py` | `bc53020bbe18edfc` |
| `experiments/e1/build_prompts.py` | `ff1037a530e79d77` |
| `experiments/e1/common.py` | `2b7186cd9efe7453` |
| `experiments/e1/deterministic_arms.py` | `d93bfa0f16663820` |
| `experiments/e1/draw.py` | `c2926489f3d1ad4f` |
| `experiments/e1/e1_common.py` | `9dc35adae52a0031` |
| `experiments/e1/editor.py` | `b9d5471b58536de9` |
| `experiments/e1/normalize.py` | `47c15f72461cc2e2` |
| `experiments/e1/report.py` | `52666a6bcdf654f8` |
| `experiments/e1/score.py` | `57d42f5ac77d7edc` |
| `experiments/e1/simulate_null.py` | `ca16a17a0bb3f03f` |
| `experiments/e1/timing_report.py` | `9c2e492f287849fb` |
| `experiments/e1/validate.py` | `c0049efa1f63a3ab` |
| `experiments/e1/validity_report.py` | `faaa574fcb2d7274` |
| `experiments/e1/applicability.ts` | `594d3a51baba0be2` |
| `experiments/e1/check_prompt_twin.ts` | `5405efdfe3142c82` |
| `experiments/e1/check_score_twin.ts` | `b337e3c1ca017d4a` |
| `experiments/e1/cseo_replication.ts` | `24cbd388b9412ad4` |
| `experiments/e1/e1_lib.ts` | `222253108750b32d` |
| `experiments/e1/engine_cli.ts` | `653d50d775e6deda` |
| `experiments/e1/engine_json.ts` | `fd81d68188f7c58b` |
| `experiments/e1/fetch_geobench.ts` | `399c24ed523ed1c4` |
| `experiments/e1/retrieval.ts` | `688d3460659f326a` |
| `experiments/e1/vitest.config.ts` | `178249b8de939cdf` |
| `experiments/e1/edit.sbatch` | `80702b3602e12e46` |
| `experiments/e1/generate.sbatch` | `77c3e72fec697f91` |
| `experiments/e1/normalize.sbatch` | `0110c64f87f5de70` |
| `experiments/e1/prompts/arm1.txt` | `b07bd3531feb0a3f` |
| `experiments/e1/prompts/arm10.txt` | `e74944566617b3bd` |
| `experiments/e1/prompts/arm12.txt` | `f8a60c10f01a6a93` |
| `experiments/e1/prompts/arm2.txt` | `f75f81b3e13dcebe` |
| `experiments/e1/prompts/arm3.txt` | `d291d04081fb5091` |
| `experiments/e1/prompts/arm5.txt` | `21dd1c6631cd8529` |
| `experiments/e1/prompts/arm6.txt` | `c0f415dbdf9bd309` |
| `experiments/e1/prompts/arm7.txt` | `64cd680b9be8430a` |
| `experiments/e1/prompts/arm8.txt` | `90a242c80f212531` |
| `experiments/e1/prompts/p10.txt` | `b5be9238468e7d0f` |
| `experiments/e1/prompts/p12.txt` | `21cfc712daa432ad` |
| `experiments/e1/prompts/p2.txt` | `664d659cc802d329` |
| `experiments/e1/prompts/p3.txt` | `089d5712e2fb8aba` |
| `experiments/e1/prompts/p5.txt` | `f5a206571b7e19cc` |
| `experiments/e1/prompts/p6.txt` | `59679b1c9d37f13a` |
| `experiments/e1/prompts/p7.txt` | `03ab21a512a2b8f3` |
| `experiments/e1/prompts/p8.txt` | `ab583e8617d31a59` |
| `experiments/e1/prompts/p_all.txt` | `9b765a08791aef17` |
| `experiments/explorer/batch_generate.py` | `edbd684f54e113b1` |
| `packages/bench/src/prompt.ts` | `3b1001587865c4f7` |

## Null simulation (shuffled labels, n = 80, 400 sims, seed 1; `null_simulation.json`)

- Family A (m = 9): familywise false-positive rate 0.0575 (Monte Carlo SE 0.0116); any unadjusted p <= 0.05: 0.3575
- Family B (m = 3): familywise false-positive rate 0.0400 (Monte Carlo SE 0.0098); any unadjusted p <= 0.05: 0.1325
- Family ALL (m = 2): familywise false-positive rate 0.0550 (Monte Carlo SE 0.0114); any unadjusted p <= 0.05: 0.0975

## Timing smoke (held-out query, outcomes discarded)

- Calibration runs: 7/14 valid before the editor fixes (amendments 9-10 and prompt changes), 13/15 after the first fix, 14/15 after amendment 10. The remaining invalid version is P_ALL (its paraphrase changed the standalone-paragraphs check), a legitimate exclusion.
- Editor: about 8 s per version on one H200 after a 36 s load. Judges (64 prompts each): Gemma-4-12B-it 2.4 s/prompt on an A100 (9 min load), Qwen3.8-27B 1.1 s/prompt on an H200 (6.6 min load).
