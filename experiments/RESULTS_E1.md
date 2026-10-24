# E1 results: which suggestions change citation?

> Content check on a local model over a fixed page set. It does not predict live AI engines.

Protocol: experiments/PREREG_E1.md (r2). Citation score (5 - r) / 4: 1 when the target is cited first, 0 when it is uncited, 0.25 per rank position. d is the arm minus its reference version, averaged over seeds and then judges within each query. Tests: two-sided sign-flip over queries (exact when n <= 12, otherwise 100,000 draws), Holm within each family; intervals are 95% and 90% percentile bootstraps (10,000 resamples) and are not adjusted. 'no effect larger than δ' means the 90% CI lies within +-0.03.

## Set: main

Mode: two-judge (verdict judges: gemma-4-12b, qwen3.8-27b). Labels carry: Gemma-edited. Queries analyzed: 80; refused for prompt length: 0.

Holm families (alpha 0.05): A (tool checks): m = 2; B (candidate checks): m = 2; ALL: m = 2. Arms with fewer than 30 analyzable queries are 'insufficient n'.

### Primary contrasts

| Arm | Ref | Family | n | d | 95% CI | 90% CI | p | p (Holm) | MDE | Label |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | P2 | A (tool checks) | 17 | -0.015 | [-0.031, +0.000] | [-0.028, -0.002] | 0.116 | n/a | 0.026 | insufficient n |
| 3 | P3 | A (tool checks) | 33 | -0.007 | [-0.031, +0.016] | [-0.027, +0.013] | 0.619 | 0.619 | 0.039 | no effect larger than δ |
| 4 | original | A (tool checks) | 0 | n/a | n/a | n/a | n/a | n/a | n/a | not run |
| 5 | P5 | A (tool checks) | 4 | +0.023 | [-0.020, +0.062] | [-0.020, +0.062] | 0.375 | n/a | 0.082 | insufficient n |
| 6 | P6 | A (tool checks) | 26 | +0.029 | [-0.008, +0.075] | [-0.003, +0.067] | 0.226 | n/a | 0.069 | insufficient n |
| 7 | P7 | A (tool checks) | 25 | -0.013 | [-0.038, +0.009] | [-0.034, +0.006] | 0.343 | n/a | 0.039 | insufficient n |
| 8 | P8 | A (tool checks) | 20 | +0.008 | [-0.016, +0.030] | [-0.013, +0.027] | 0.577 | n/a | 0.039 | insufficient n |
| 9 | original | A (tool checks) | 54 | +0.027 | [+0.010, +0.043] | [+0.013, +0.041] | 0.003 | 0.006 | 0.027 | helps, possibly through length or query-term overlap |
| 10 | P10 | A (tool checks) | 8 | +0.004 | [-0.016, +0.027] | [-0.012, +0.023] | 1.000 | n/a | 0.035 | insufficient n |
| 11 | original | B (candidate checks) | 30 | +0.000 | [-0.017, +0.016] | [-0.014, +0.014] | 1.000 | 1.000 | 0.027 | no effect larger than δ |
| 12 | P12 | B (candidate checks) | 33 | +0.035 | [+0.008, +0.066] | [+0.012, +0.060] | 0.018 | 0.037 | 0.047 | helps, possibly through length or query-term overlap |
| 14 | original | B (candidate checks) | 7 | +0.009 | [-0.025, +0.040] | [-0.018, +0.036] | 0.703 | n/a | 0.056 | insufficient n |
| ALL | P_ALL | ALL | 53 | +0.071 | [+0.039, +0.109] | [+0.044, +0.102] | <0.001 | <0.001 | 0.057 | helps, possibly through length or query-term overlap |
| ALL | original | ALL | 78 | +0.049 | [+0.024, +0.076] | [+0.028, +0.071] | <0.001 | <0.001 | 0.042 | helps, possibly through length or query-term overlap |
| 1 | original | descriptive | 24 | +0.007 | [-0.008, +0.023] | [-0.006, +0.020] | 0.489 | n/a | 0.024 | descriptive |
| 13 | original | descriptive | 42 | +0.005 | [-0.010, +0.020] | [-0.008, +0.018] | 0.574 | n/a | 0.023 | descriptive |

### Exclusions and edit statistics

| Arm | Applicable | Valid | Validity exclusions | Over 20% | Dropped cells | Edit distance | Length ratio | Key-term change |
|---|---|---|---|---|---|---|---|---|
| 1 | 25 | 24 | 1 | no | 0 | 10.958 | 1.006 | +0.917 |
| 2 | 50 | 27 | 23 | yes | 0 | 19.185 | 1.011 | +0.556 |
| 3 | 46 | 39 | 7 | no | 0 | 15.000 | 0.997 | +0.026 |
| 4 | 4 | 0 | 4 | yes | 0 | n/a | n/a | n/a |
| 5 | 32 | 11 | 21 | yes | 0 | 17.818 | 1.023 | +2.545 |
| 6 | 59 | 36 | 23 | yes | 0 | 26.056 | 1.034 | +3.139 |
| 7 | 38 | 30 | 8 | yes | 0 | 1.800 | 1.002 | +3.800 |
| 8 | 34 | 25 | 9 | yes | 0 | 46.840 | 1.022 | +1.880 |
| 9 | 55 | 54 | 1 | no | 0 | 32.074 | 1.034 | +7.685 |
| 10 | 21 | 8 | 13 | yes | 0 | 18.250 | 1.026 | +0.875 |
| 11 | 30 | 30 | 0 | no | 0 | 16.300 | 1.018 | +1.867 |
| 12 | 63 | 50 | 13 | yes | 0 | 11.700 | 1.013 | +6.080 |
| 13 | 43 | 42 | 1 | no | 0 | 8.881 | 1.008 | +0.286 |
| 14 | 7 | 7 | 0 | no | 0 | 4.000 | 1.005 | +0.000 |
| ALL | 79 | 78 | 1 | no | 0 | 71.115 | 1.061 | +10.359 |
| P2 | 27 | 17 | 10 | yes | 0 | 6.824 | 1.000 | +0.000 |
| P3 | 39 | 33 | 6 | no | 0 | 56.697 | 0.998 | +0.000 |
| P5 | 11 | 4 | 7 | yes | 0 | 5.000 | 1.000 | +0.000 |
| P6 | 36 | 26 | 10 | yes | 0 | 6.231 | 1.000 | -0.038 |
| P7 | 30 | 25 | 5 | no | 0 | 13.360 | 0.999 | +0.000 |
| P8 | 25 | 20 | 5 | no | 0 | 8.800 | 1.000 | +0.000 |
| P10 | 8 | 8 | 0 | no | 0 | 5.750 | 1.000 | +0.000 |
| P12 | 50 | 33 | 17 | yes | 0 | 13.152 | 1.000 | +0.000 |
| P_ALL | 75 | 53 | 22 | yes | 0 | 37.868 | 0.998 | +0.038 |

### Secondary (reported, no verdicts)

Arm minus original:

| Arm | n | d | 95% CI | p |
|---|---|---|---|---|
| 1 | 24 | +0.007 | [-0.008, +0.023] | 0.489 |
| 2 | 27 | -0.010 | [-0.030, +0.009] | 0.367 |
| 3 | 39 | +0.000 | [-0.015, +0.015] | 1.000 |
| 4 | 0 | n/a | n/a | n/a |
| 5 | 11 | +0.013 | [-0.014, +0.040] | 0.452 |
| 6 | 36 | +0.024 | [-0.007, +0.056] | 0.158 |
| 7 | 30 | -0.009 | [-0.029, +0.010] | 0.404 |
| 8 | 25 | -0.005 | [-0.029, +0.017] | 0.722 |
| 9 | 54 | +0.027 | [+0.010, +0.043] | 0.003 |
| 10 | 8 | +0.004 | [-0.016, +0.033] | 0.969 |
| 11 | 30 | +0.000 | [-0.017, +0.016] | 1.000 |
| 12 | 50 | +0.035 | [+0.013, +0.060] | 0.005 |
| 13 | 42 | +0.005 | [-0.010, +0.020] | 0.574 |
| 14 | 7 | +0.009 | [-0.025, +0.040] | 0.703 |
| ALL | 78 | +0.049 | [+0.024, +0.076] | <0.001 |

Per judge, cited at all, PAWC share and valid-answer rate (each arm against its Ref):

| Arm | Ref | Per-judge d | Cited at all | PAWC share | Valid rate |
|---|---|---|---|---|---|
| 2 | P2 | gemma-4-12b -0.028 (p 0.191); qwen3.8-27b -0.002 (p 1.000) | +0.000 | -0.006 | +0.000 |
| 3 | P3 | gemma-4-12b +0.007 (p 0.666); qwen3.8-27b -0.020 (p 0.251) | -0.002 | -0.006 | +0.000 |
| 4 | original | gemma-4-12b n/a (p n/a); qwen3.8-27b n/a (p n/a) | n/a | n/a | n/a |
| 5 | P5 | gemma-4-12b +0.016 (p 0.750); qwen3.8-27b +0.031 (p 0.500) | +0.000 | -0.015 | +0.000 |
| 6 | P6 | gemma-4-12b +0.047 (p 0.153); qwen3.8-27b +0.011 (p 0.620) | +0.029 | +0.007 | +0.000 |
| 7 | P7 | gemma-4-12b -0.020 (p 0.294); qwen3.8-27b -0.006 (p 0.758) | -0.005 | +0.003 | +0.000 |
| 8 | P8 | gemma-4-12b +0.014 (p 0.444); qwen3.8-27b +0.002 (p 1.000) | +0.022 | +0.002 | +0.000 |
| 9 | original | gemma-4-12b +0.018 (p 0.104); qwen3.8-27b +0.035 (p 0.009) | +0.020 | +0.020 | +0.000 |
| 10 | P10 | gemma-4-12b +0.004 (p 1.000); qwen3.8-27b +0.004 (p 1.000) | +0.008 | -0.012 | +0.000 |
| 11 | original | gemma-4-12b +0.009 (p 0.607); qwen3.8-27b -0.009 (p 0.570) | +0.004 | -0.007 | +0.000 |
| 12 | P12 | gemma-4-12b +0.043 (p 0.041); qwen3.8-27b +0.027 (p 0.121) | +0.027 | +0.020 | +0.002 |
| 14 | original | gemma-4-12b -0.013 (p 0.750); qwen3.8-27b +0.031 (p 0.312) | +0.000 | +0.001 | +0.000 |
| ALL | P_ALL | gemma-4-12b +0.084 (p <0.001); qwen3.8-27b +0.058 (p 0.006) | +0.054 | +0.039 | +0.000 |
| ALL | original | gemma-4-12b +0.054 (p <0.001); qwen3.8-27b +0.044 (p 0.006) | +0.042 | +0.027 | +0.000 |
| 1 | original | gemma-4-12b +0.004 (p 0.850); qwen3.8-27b +0.009 (p 0.713) | +0.016 | +0.000 | +0.000 |
| 13 | original | gemma-4-12b +0.010 (p 0.368); qwen3.8-27b -0.001 (p 1.000) | +0.003 | -0.008 | +0.000 |

d by target slot, and subgroups:

| Arm | Ref | Slot 1 / 2 / 3 / 4 | Wikipedia target | Wayback target | Any Wayback page in the prompt |
|---|---|---|---|---|---|
| 2 | P2 | -0.074 / +0.015 / +0.007 / -0.007 | n/a (n 0) | +0.000 (n 4) | -0.019 (n 9) |
| 3 | P3 | +0.021 / -0.028 / -0.011 / -0.008 | -0.047 (n 1) | +0.023 (n 6) | -0.008 (n 21) |
| 4 | original | n/a / n/a / n/a / n/a | n/a (n 0) | n/a (n 0) | n/a (n 0) |
| 5 | P5 | -0.016 / +0.047 / +0.016 / +0.047 | n/a (n 0) | +0.010 (n 3) | +0.023 (n 4) |
| 6 | P6 | +0.077 / +0.041 / -0.014 / +0.012 | n/a (n 0) | -0.013 (n 6) | +0.010 (n 15) |
| 7 | P7 | -0.040 / +0.015 / -0.010 / -0.018 | n/a (n 0) | -0.042 (n 6) | -0.025 (n 14) |
| 8 | P8 | -0.009 / +0.050 / -0.003 / -0.006 | n/a (n 0) | +0.062 (n 3) | +0.007 (n 12) |
| 9 | original | -0.038 / +0.046 / +0.050 / +0.049 | n/a (n 0) | +0.019 (n 13) | +0.029 (n 33) |
| 10 | P10 | -0.023 / +0.055 / -0.023 / +0.008 | n/a (n 0) | +0.008 (n 4) | +0.006 (n 5) |
| 11 | original | -0.029 / -0.025 / +0.004 / +0.050 | n/a (n 0) | +0.008 (n 6) | +0.003 (n 17) |
| 12 | P12 | +0.006 / +0.025 / +0.057 / +0.053 | n/a (n 0) | -0.010 (n 9) | +0.023 (n 17) |
| 14 | original | -0.062 / +0.036 / +0.089 / -0.027 | n/a (n 0) | +0.042 (n 3) | +0.028 (n 5) |
| ALL | P_ALL | +0.085 / +0.065 / +0.060 / +0.074 | n/a (n 0) | +0.041 (n 13) | +0.055 (n 28) |
| ALL | original | +0.024 / +0.050 / +0.051 / +0.070 | +0.031 (n 1) | +0.035 (n 19) | +0.051 (n 44) |
| 1 | original | +0.016 / -0.010 / +0.000 / +0.021 | +0.031 (n 1) | +0.016 (n 2) | +0.014 (n 11) |
| 13 | original | -0.031 / +0.016 / +0.004 / +0.030 | +0.031 (n 1) | +0.016 (n 9) | +0.016 (n 24) |

Confound regression (d on change in log length and in query key-term count; intercept with 95% CI):

| Arm | Ref | Adjusted intercept | 95% CI | Regressors |
|---|---|---|---|---|
| 2 | P2 | -0.013 | [-0.039, +0.014] | dlog_length, dkey_terms |
| 3 | P3 | -0.002 | [-0.029, +0.024] | dlog_length, dkey_terms |
| 4 | original | n/a | n/a | no length data |
| 5 | P5 | +0.115 | [-1.579, +1.809] | dlog_length, dkey_terms |
| 6 | P6 | +0.017 | [-0.087, +0.121] | dlog_length, dkey_terms |
| 7 | P7 | -0.014 | [-0.056, +0.029] | dlog_length, dkey_terms |
| 8 | P8 | +0.001 | [-0.033, +0.035] | dlog_length, dkey_terms |
| 9 | original | -0.028 | [-0.075, +0.018] | dlog_length, dkey_terms |
| 10 | P10 | -0.035 | [-0.086, +0.016] | dlog_length, dkey_terms |
| 11 | original | -0.021 | [-0.060, +0.018] | dlog_length, dkey_terms |
| 12 | P12 | -0.032 | [-0.083, +0.018] | dlog_length, dkey_terms |
| 14 | original | -0.036 | [-0.108, +0.036] | dlog_length |
| ALL | P_ALL | +0.051 | [-0.018, +0.120] | dlog_length, dkey_terms |
| ALL | original | +0.042 | [-0.012, +0.096] | dlog_length, dkey_terms |
| 1 | original | +0.005 | [-0.023, +0.033] | dlog_length, dkey_terms |
| 13 | original | +0.011 | [-0.025, +0.047] | dlog_length, dkey_terms |

## Set: replication

Mode: two-judge (verdict judges: gemma-4-12b, qwen3.8-27b). Labels carry: Gemma-edited. Queries analyzed: 60; refused for prompt length: 0.

Holm families (alpha 0.05): replication: m = 2. Arms with fewer than 30 analyzable queries are 'insufficient n'.

### Primary contrasts

| Arm | Ref | Family | n | d | 95% CI | 90% CI | p | p (Holm) | MDE | Label |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | P5 | replication | 2 | -0.047 | [-0.109, +0.016] | [-0.109, +0.016] | 1.000 | n/a | 0.198 | insufficient n |
| 6 | P6 | replication | 18 | +0.026 | [-0.015, +0.068] | [-0.008, +0.061] | 0.259 | n/a | 0.067 | insufficient n |
| 7 | P7 | replication | 29 | -0.001 | [-0.024, +0.021] | [-0.020, +0.017] | 0.963 | n/a | 0.037 | insufficient n |
| 9 | original | replication | 52 | +0.036 | [+0.016, +0.059] | [+0.019, +0.055] | <0.001 | 0.002 | 0.036 | helps, possibly through length or query-term overlap |
| 11 | original | replication | 18 | +0.028 | [+0.003, +0.052] | [+0.007, +0.048] | 0.054 | n/a | 0.041 | insufficient n |
| 12 | P12 | replication | 12 | +0.020 | [-0.025, +0.065] | [-0.018, +0.057] | 0.471 | n/a | 0.076 | insufficient n |
| 14 | original | replication | 0 | n/a | n/a | n/a | n/a | n/a | n/a | not run |
| ALL | P_ALL | replication | 32 | +0.044 | [+0.006, +0.087] | [+0.011, +0.080] | 0.042 | 0.042 | 0.067 | helps, possibly through length or query-term overlap |

### Exclusions and edit statistics

| Arm | Applicable | Valid | Validity exclusions | Over 20% | Dropped cells | Edit distance | Length ratio | Key-term change |
|---|---|---|---|---|---|---|---|---|
| 5 | 21 | 3 | 18 | yes | 0 | 18.000 | 1.030 | +1.667 |
| 6 | 54 | 26 | 28 | yes | 0 | 23.423 | 1.025 | +2.500 |
| 7 | 33 | 30 | 3 | no | 0 | 10.300 | 1.009 | +1.800 |
| 9 | 53 | 52 | 1 | no | 0 | 43.654 | 1.042 | +9.173 |
| 11 | 18 | 18 | 0 | no | 0 | 19.611 | 1.020 | +2.389 |
| 12 | 28 | 14 | 14 | yes | 0 | 5.000 | 1.005 | +2.643 |
| ALL | 60 | 58 | 2 | no | 0 | 63.034 | 1.059 | +14.345 |
| P5 | 3 | 2 | 1 | yes | 0 | 7.500 | 1.001 | +0.000 |
| P6 | 26 | 18 | 8 | yes | 0 | 4.889 | 1.000 | +0.000 |
| P7 | 30 | 29 | 1 | no | 0 | 12.379 | 0.999 | -0.069 |
| P12 | 14 | 12 | 2 | no | 0 | 14.667 | 1.001 | -0.083 |
| P_ALL | 35 | 32 | 3 | no | 0 | 29.094 | 1.001 | -0.062 |

### Secondary (reported, no verdicts)

Arm minus original:

| Arm | n | d | 95% CI | p |
|---|---|---|---|---|
| 5 | 3 | -0.005 | [-0.062, +0.031] | 1.000 |
| 6 | 26 | +0.035 | [-0.009, +0.081] | 0.164 |
| 7 | 30 | -0.005 | [-0.022, +0.011] | 0.603 |
| 9 | 52 | +0.036 | [+0.016, +0.059] | <0.001 |
| 11 | 18 | +0.028 | [+0.003, +0.052] | 0.054 |
| 12 | 14 | +0.029 | [+0.001, +0.064] | 0.114 |
| 14 | 0 | n/a | n/a | n/a |
| ALL | 58 | +0.070 | [+0.031, +0.117] | <0.001 |

Per judge, cited at all, PAWC share and valid-answer rate (each arm against its Ref):

| Arm | Ref | Per-judge d | Cited at all | PAWC share | Valid rate |
|---|---|---|---|---|---|
| 5 | P5 | gemma-4-12b -0.062 (p 1.000); qwen3.8-27b -0.031 (p 1.000) | +0.000 | +0.003 | +0.000 |
| 6 | P6 | gemma-4-12b +0.085 (p 0.031); qwen3.8-27b -0.033 (p 0.153) | +0.045 | +0.018 | +0.000 |
| 7 | P7 | gemma-4-12b +0.013 (p 0.429); qwen3.8-27b -0.015 (p 0.436) | +0.002 | +0.008 | +0.000 |
| 9 | original | gemma-4-12b +0.041 (p 0.003); qwen3.8-27b +0.031 (p 0.048) | +0.032 | +0.018 | +0.000 |
| 11 | original | gemma-4-12b +0.021 (p 0.331); qwen3.8-27b +0.035 (p 0.068) | +0.003 | +0.004 | +0.000 |
| 12 | P12 | gemma-4-12b +0.010 (p 0.844); qwen3.8-27b +0.029 (p 0.148) | +0.036 | +0.008 | +0.000 |
| 14 | original | gemma-4-12b n/a (p n/a); qwen3.8-27b n/a (p n/a) | n/a | n/a | n/a |
| ALL | P_ALL | gemma-4-12b +0.055 (p 0.078); qwen3.8-27b +0.034 (p 0.203) | +0.053 | +0.039 | +0.000 |

Retrieval (BM25 over the pool; a negative rank change is better):

| Arm | Ref | n | Pool rank change | p | Own-4 rank change | Top-8 change |
|---|---|---|---|---|---|---|
| 5 | P5 | 2 | +0.000 | 1.000 | +0.000 | +0.000 |
| 6 | P6 | 18 | -1.722 | 0.124 | -0.111 | +0.000 |
| 7 | P7 | 29 | +0.000 | 1.000 | +0.000 | +0.000 |
| 9 | original | 52 | -2.250 | <0.001 | -1.038 | +0.058 |
| 11 | original | 18 | +0.000 | 1.000 | +0.000 | +0.000 |
| 12 | P12 | 12 | -3.333 | 0.016 | -1.167 | +0.083 |
| 14 | original | 0 | n/a | n/a | n/a | n/a |
| ALL | P_ALL | 32 | -1.750 | <0.001 | -0.875 | +0.031 |

d by target slot, and subgroups:

| Arm | Ref | Slot 1 / 2 / 3 / 4 | Wikipedia target | Wayback target | Any Wayback page in the prompt |
|---|---|---|---|---|---|
| 5 | P5 | -0.125 / -0.062 / +0.031 / -0.031 | n/a (n 0) | n/a (n 0) | n/a (n 0) |
| 6 | P6 | +0.090 / +0.017 / +0.014 / -0.017 | n/a (n 0) | n/a (n 0) | n/a (n 0) |
| 7 | P7 | +0.028 / -0.024 / +0.013 / -0.022 | n/a (n 0) | n/a (n 0) | n/a (n 0) |
| 9 | original | +0.019 / +0.028 / +0.050 / +0.048 | n/a (n 0) | n/a (n 0) | n/a (n 0) |
| 11 | original | +0.028 / -0.010 / +0.052 / +0.042 | n/a (n 0) | n/a (n 0) | n/a (n 0) |
| 12 | P12 | -0.042 / +0.089 / +0.031 / +0.000 | n/a (n 0) | n/a (n 0) | n/a (n 0) |
| 14 | original | n/a / n/a / n/a / n/a | n/a (n 0) | n/a (n 0) | n/a (n 0) |
| ALL | P_ALL | +0.098 / +0.004 / +0.037 / +0.039 | n/a (n 0) | n/a (n 0) | n/a (n 0) |

Confound regression (d on change in log length and in query key-term count; intercept with 95% CI):

| Arm | Ref | Adjusted intercept | 95% CI | Regressors |
|---|---|---|---|---|
| 5 | P5 | n/a | n/a | not separable from a constant change |
| 6 | P6 | -0.019 | [-0.097, +0.059] | dlog_length, dkey_terms |
| 7 | P7 | -0.006 | [-0.041, +0.029] | dlog_length, dkey_terms |
| 9 | original | -0.002 | [-0.065, +0.061] | dlog_length, dkey_terms |
| 11 | original | +0.056 | [+0.013, +0.099] | dlog_length, dkey_terms |
| 12 | P12 | +0.010 | [-0.112, +0.132] | dlog_length, dkey_terms |
| 14 | original | n/a | n/a | no length data |
| ALL | P_ALL | +0.032 | [-0.057, +0.121] | dlog_length, dkey_terms |

Replication support for removing a check from the score (d < 0 with unadjusted p < 0.05): 5 no (insufficient n), 6 no (insufficient n), 7 no (insufficient n), 9 no, 11 no (insufficient n), 12 no (insufficient n), 14 no (not run), ALL no.

## Power

Planned minimum detectable d at the strictest family-A Holm step: 0.022 at n = 60 and 0.018 at n = 80. The MDE column above is recomputed from each arm's realized SD of d. Effects below about 0.02 score units (0.08 rank positions) cannot be ruled out.

## Null simulation

400 simulations, 80 queries, 100000 sign-flip draws (synthetic null cells (2 judges, 8 answers per cell), version labels permuted within query). The familywise false-positive rate per Holm family should be about 5% or a little below:

| Family | m | Familywise rate (Holm) | MC SE | Any unadjusted p <= 0.05 |
|---|---|---|---|---|
| A (tool checks) | 9 | 0.058 | 0.012 | 0.357 |
| B (candidate checks) | 3 | 0.040 | 0.010 | 0.133 |
| ALL | 2 | 0.055 | 0.011 | 0.098 |

## Limits

Open models in a fixed context of 4 pre-selected sources; not ChatGPT, Perplexity or Google. The editor and the primary judge are both Gemma models. Arms 1 and 13 need passage-level retrieval and get no verdict. The optional mixed model was not run.
