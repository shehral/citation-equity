# Evidence behind the checks

Citation Equity scores a draft on eleven checks. Six come from Prof. Akram Bayat's design for the project (her concept-level list of what makes content easy for AI answer engines to use); four more were added because the research literature tests them: cited sources, a direct-answer lead, answers to the author's target questions, and explicit comparisons; and one, your reader's words up top, was added because it helped in this project's own test (E1). This page says, for each check, how strong the evidence is, what the studies actually did, and where to read them. Every source listed here was opened and read on 2026-10-23; the working notes with quotes are in [research/evidence-notes.md](research/evidence-notes.md).

## Why the score is not a prediction

The AI-ready score is a content check. It counts things in your draft that some studies have linked to being cited or used by AI answer engines. It is not a prediction of whether ChatGPT, Perplexity or Google will cite your page, for four reasons:

1. **Most results come from fixed test setups.** The best-known numbers come from experiments where the page was already one of a handful of sources pasted into the model's prompt. Whether a page gets found in the first place (crawling, search, ranking) was not part of the test. When SAGEO Arena put retrieval back in, rewrites that helped in the fixed setup often made pages harder to find.
2. **The studies disagree.** The rewrites that looked best in the original GEO paper (adding statistics, quotations and citations) mostly showed no gain, or a loss, in the larger C-SEO Bench study, which measured citation rank instead of share of answer text.
3. **Engines differ and change.** Results vary by model, by topic and over time. A check that helps on one engine may do nothing on another.
4. **Our weights are ours.** Neither Prof. Bayat's design nor any study gives weights or thresholds for a score. Every number in the score is a choice we made, and you can see and change it.

The Martinez (2026) survey of 45 studies sums up the state of the field: content that is already in front of the model can change whether and how it is cited, but no technique has shown a stable effect on being found across engines over time, and citation scores have not been shown to predict clicks or revenue. The test bench in this project reports a measured outcome separately from the score, on a local model and a fixed page set, for the same reason.

## How grades are assigned

Each check gets one of four grades. The grade describes the research, not your draft.

| Grade | What it means |
|---|---|
| **strong** | At least two independent controlled studies found a gain, including one with real retrieval or live engines, and no study we opened found a null or negative result. |
| **moderate** | The studies we opened point the same way (toward a gain), at least one of them is controlled, and none found a null or negative result. The evidence may be indirect. |
| **mixed** | At least one study found a null or negative result (no effect, or harm), whether or not other studies found a gain. Mixed checks are still reported; in the evidence preset they get a low weight. |
| **untested** | No study we opened tests the check directly. The check rests on how these systems work or on practitioner advice. |

Rules we followed:

- A null or negative result in part of a study (some domains, some engine models) counts as a null or negative finding, even when the same study found a gain elsewhere.
- A claim goes in only if we found it in the paper itself. Claims we could not verify were dropped (see the notes).
- Observational studies (which compare pages that happen to differ) can support a grade but cannot by themselves make it strong, because better pages may differ in many ways at once.
- A study that tests a nearby practice (for example, a whole-page summary rather than a per-section answer) counts as indirect evidence, and the summary says so.

No check is graded strong or moderate today. Nine are mixed and two are untested. Seven of the eleven checks count toward the score; four (question headings, lists, cited sources and direct answer first) are notes that are not scored, because our own tests found no effect larger than 0.03 for them. Our tests change no grade.

## Our own test (E1)

E1 is this project's pre-registered test of the checks ([experiments/PREREG_E1.md](../experiments/PREREG_E1.md), results in [experiments/RESULTS_E1.md](../experiments/RESULTS_E1.md)). Each check's fix was applied to real pages, and two local models (Gemma-4-12B and Qwen3.8-27B judges, Gemma-edited) answered each query from a fixed set of four sources. d is the change in citation score, where a page cited first scores 1 and an uncited page 0, against a paraphrase of the same passages (or the original page where the plan says so). Labels below are for the main set's primary contrast. E1 changes no grade. For seven checks E1 had too few pages for a verdict; E3 (below) asked again with more pages, and its pooled result is the one the tool now uses for them. E1's numbers stay here as the record of what E1 found.

| Check | E1 label | d and interval | What the tool does |
|---|---|---|---|
| `standalone-paragraphs` | descriptive, no verdict by design | d +0.007, 95% CI [-0.008, +0.023], n 24 | Grade kept, E1 shown |
| `question-headings` | insufficient n | d -0.015, 95% CI [-0.031, +0.000], n 17 | Replaced by E3 |
| `lists` | no effect larger than 0.03 | d -0.007, 90% CI [-0.027, +0.013], n 33 | Not scored: weight 0 in both presets; still reported and still suggests |
| `tables` | not run (no valid edit) | none | Replaced by E3 |
| `statistics` | insufficient n | d +0.023, 95% CI [-0.020, +0.062], n 4 | Replaced by E3 |
| `expert-quotes` | insufficient n | d +0.029, 95% CI [-0.008, +0.075], n 26 | Replaced by E3 |
| `cited-sources` | insufficient n | d -0.013, 95% CI [-0.038, +0.009], n 25 | Replaced by E3 |
| `direct-answer-lead` | insufficient n | d +0.008, 95% CI [-0.016, +0.030], n 20 | Replaced by E3 |
| `question-coverage` | helps, possibly through length or query-term overlap | d +0.027, 95% CI [+0.010, +0.043], n 54, Holm p 0.006; replication d +0.036, 95% CI [+0.016, +0.059], n 52 | Weight kept; the measured label is shown on the check and its suggestions |
| `comparisons` | insufficient n | d +0.004, 95% CI [-0.016, +0.027], n 8 | Replaced by E3 |
| `reader-words` | helps, possibly through length or query-term overlap | d +0.035, 95% CI [+0.008, +0.066], n 33, Holm p 0.037 (the candidate check for query wording) | Added as a check at the usual weight; the measured label is shown on the check and its suggestions |

Applying every applicable fix together raised the citation score by +0.049 (95% CI [+0.024, +0.076], n 78) against the original page and by +0.071 against a paraphrase of the same passages, possibly through length or query-term overlap. A candidate check for query wording (working the query's missing key terms into the title, the first heading and the first paragraph) also helped, by d +0.035 against its paraphrase (Holm p 0.037), possibly through query-term overlap; it is now the `reader-words` check. These are local models in a fixed context of four sources, not ChatGPT, Perplexity or Google.

A follow-up test, E2 ([experiments/RESULTS_E2.md](../experiments/RESULTS_E2.md)), asked why the question-coverage fix helped. The heading form adds nothing: a question heading against the same words as plain text gave d +0.003 on the main set and -0.001 on the replication set, no effect larger than 0.03 on either. The question's words carry the gain: against a heading of the same size without them, d +0.048 on the replication set (helps) and +0.017 on the main set (inconclusive). So the question-coverage advice asks for the reader's question in your own words near the top, with a heading optional. With a different editor (Qwen3.8-27B) and judges, the query-wording gain kept its sign (d +0.029, 95% CI [+0.003, +0.061], n 29).

## E3: seven checks, more pages

E3 asked E1's question again for the seven checks E1 could not judge ([experiments/PLAN_E3.md](../experiments/PLAN_E3.md), results in [experiments/RESULTS_E3.md](../experiments/RESULTS_E3.md)). It used E1's editor, prompts, judges (Gemma-4-12B and Qwen3.8-27B, Gemma-edited), seeds, score and statistics, and added pages: 260 queries in all, 80 from E1 and 180 new, with one more attempt for each edit to pass E1's validity checks. A check gets a verdict when at least 30 queries have a valid edit and placebo; four did, and they were tested together with Holm's correction. A "no effect larger than 0.03" verdict means the 90% interval lies within ±0.03. E3 changes no grade either.

| Check | E3 label | d and interval | What the tool does |
|---|---|---|---|
| `question-headings` | no effect larger than 0.03 | d -0.016, 90% CI [-0.028, -0.004] (95% CI [-0.030, -0.002]), n 57, Holm p 0.164 | Not scored: weight 0 in both presets; still reported and still suggests, its "?" edit included |
| `tables` | insufficient n | d -0.027, 95% CI [-0.054, -0.001], n 11 | Grade kept, E3 shown |
| `statistics` | insufficient n | d -0.007, 95% CI [-0.045, +0.026], n 11 | Grade kept, E3 shown |
| `expert-quotes` | inconclusive | d +0.026, 95% CI [+0.001, +0.053], n 62, Holm p 0.179 | Grade kept, E3 shown ("unclear, leaning positive") |
| `cited-sources` | no effect larger than 0.03 | d -0.010, 90% CI [-0.023, +0.002] (95% CI [-0.026, +0.004]), n 49, Holm p 0.228 | Not scored: weight 0 in both presets; still reported and still suggests |
| `direct-answer-lead` | no effect larger than 0.03 | d +0.012, 90% CI [+0.002, +0.022] (95% CI [+0.000, +0.023]), n 66, Holm p 0.179 | Not scored: weight 0 in both presets; still reported and still suggests |
| `comparisons` | insufficient n | d +0.003, 95% CI [-0.020, +0.026], n 24 | Grade kept, E3 shown |

"No effect larger than 0.03" is not "no effect": an effect smaller than that, either way, cannot be ruled out. Attributed quotes leaned positive, but not by enough to survive the correction for testing four checks at once. Tables, statistics and comparisons still had too few valid pages for a verdict. In Start here, fixes of an unscored check come after those of the scored checks, and a custom weight can count any of them again. As with E1, these are local models in a fixed context of four sources, not ChatGPT, Perplexity or Google.

## The studies

| Study | Setting | What was measured |
|---|---|---|
| [Aggarwal et al. 2024, GEO](https://arxiv.org/abs/2311.09735) (KDD 2024) | Top five Google results pasted into GPT-3.5-turbo; one source rewritten by an LLM | Share of the answer's words attributed to the source, weighted by position |
| [Puerto et al. 2025, C-SEO Bench](https://arxiv.org/abs/2506.11097) (NeurIPS 2025 Datasets and Benchmarks) | Same kind of rewrites over six domains (shopping and question answering) and four engine models | Change in the source's citation rank, with significance tests |
| [Vishwakarma et al. 2026, What Gets Cited](https://arxiv.org/abs/2605.25517) (SIGIR 2026) | Two matched product pages in the prompt, differing in one factor; 252,000 trials over six LLMs | Which page gets the first citation |
| [Kim et al. 2026, SAGEO Arena](https://arxiv.org/abs/2602.12187) (KDD 2026) | Full search pipeline over a large web corpus: retrieve, rerank, then generate | Visibility at each stage separately |
| [Zhang, He, Yao 2026](https://arxiv.org/abs/2604.25707) (preprint, GEO Citation Lab data) | 602 prompts on ChatGPT, Google AI Overview/Gemini and Perplexity; 72 features per cited page | An influence score for how much a cited page shaped the answer (observational) |
| [Wan et al. 2024, ConflictingQA](https://aclanthology.org/2024.acl-long.403/) (ACL 2024) | Pages on contested questions, edited one way at a time | How often the model's answer sides with the edited page |
| [Wu et al. 2025, AutoGEO](https://arxiv.org/abs/2510.11438) (preprint) | Engines asked to explain their preferences; rules extracted | Preference rules per engine |
| [Yu et al. 2026, GEO-SFE](https://arxiv.org/abs/2603.29979) (preprint) | 200 articles restructured, tested on six engines | Citation rate and a visibility score |
| [Martinez 2026](https://arxiv.org/abs/2607.14035) (survey) | Review of 45 studies, 2023 to 2026 | Confidence ratings for the field's main claims |

## Standalone paragraphs (`standalone-paragraphs`)

Grade: **untested**

No study we opened tests whether paragraphs that make sense on their own get cited more. The check rests on how these systems work: many split a page into passages and pick passages one at a time, so a paragraph that opens with "This" or "It" can lose its meaning once lifted out.

**What the studies did.** SAGEO Arena builds its search pipeline the way production systems are described: pages are cut into passages and passages are retrieved and reranked one by one. That explains why a self-contained paragraph could matter, but the benchmark does not test it. Zhang, He and Yao propose that useful pages have "paragraphs that each carry a distinct claim", as a hypothesis for later testing. A web search for a controlled test found only practitioner guides.

**Sources**

- Kim et al. 2026, [SAGEO Arena](https://arxiv.org/abs/2602.12187): describes generative search as chunking documents and retrieving them at the passage level.
- Zhang, He, Yao 2026, [From Citation Selection to Citation Absorption](https://arxiv.org/abs/2604.25707): proposes distinct-claim paragraphs as a hypothesis; observational, no causal claim.

## Question headings (`question-headings`)

Grade: **mixed**

No controlled study we opened tests question-style headings, and the closest evidence does not favour them. Across three AI search platforms, cited pages in Q&A format shaped answers slightly less than other pages (about 6% lower), and a controlled study found that formatting-only changes made little difference to which page was cited.

**What the studies did.** Zhang, He and Yao compared cited pages in Q&A format with other cited pages and found a mean influence of 0.0947 against 0.1005, which they call "the important negative case": the question format is a wrapper, and what helps is the evidence inside. What Gets Cited ran matched pairs of pages that differed only in formatting (dense paragraphs versus organized sections) and found no consistent effect on the first citation. Martinez rates formatting alone as generalizing poorly and advises testing headings without assuming which way the effect goes.

A question heading can still help a reader scan the page. The evidence says not to expect the heading by itself to earn citations.

**Sources**

- Zhang, He, Yao 2026, [From Citation Selection to Citation Absorption](https://arxiv.org/abs/2604.25707): Q&A format 5.74% lower mean influence; observational.
- Vishwakarma et al. 2026, [What Gets Cited](https://arxiv.org/abs/2605.25517): formatting-only differences had no consistent effect in 252,000 controlled trials.
- Martinez 2026, [critical survey](https://arxiv.org/abs/2607.14035): document structure has "moderate and heterogeneous" support; test headings "without assuming the direction of effect".

## Lists (`lists`)

Grade: **mixed**

Pages that shape AI answers the most tend to have more lists, but a controlled test of formatting alone found no effect. The list link may come from those pages being better overall, so use a list when the content really is a set of items or steps.

**What the studies did.** In the observational study, pages in the top quarter by influence had a list density of 0.428 against 0.048 for the bottom quarter; they also had about twelve times as many headings and were about eleven times longer, so lists are one of many differences. What Gets Cited found no consistent effect from formatting-only edits. A preprint (GEO-SFE) restructured 200 articles, changing headings, chunking, lists, tables and emphasis together, and reported citation rate rising from 45.0% to 52.8% across six engines; lists were not tested on their own.

**Sources**

- Zhang, He, Yao 2026, [From Citation Selection to Citation Absorption](https://arxiv.org/abs/2604.25707): list density 0.428 versus 0.048, top versus bottom quarter; observational.
- Vishwakarma et al. 2026, [What Gets Cited](https://arxiv.org/abs/2605.25517): formatting-only differences had no consistent effect.
- Yu et al. 2026, [GEO-SFE](https://arxiv.org/abs/2603.29979): bundled structural rewrite raised citation rate from 45.0% to 52.8%; preprint, lists not isolated.

## Statistics (`statistics`)

Grade: **mixed**

Adding statistics raised visibility in the original GEO experiment, where the page was already one of five sources given to the model, but C-SEO Bench found that adding statistics lowered a page's citation rank in 19 of 24 settings. Pages that contain real numbers are used more in AI answers, so aim for relevant, checkable figures rather than more numbers.

**What the studies did.** In GEO, an LLM rewrote one of the five sources to "include quantitative statistics instead of qualitative discussion, wherever possible", and that source's position-weighted share of the answer rose from 19.3 to 25.2. C-SEO Bench applied the same kind of rewrite across six domains and four engine models and measured citation rank instead: the paper reports that the rewrite lowered rankings in 19 of 24 evaluated settings (it does not say how those 24 divide across domains and models), and in the main experiment no rewrite helped in question answering. Observational data still links numbers to use: cited pages containing numbers had a 61.55% higher influence score. Martinez puts it plainly: the criterion is not to add numbers, but to give relevant, verifiable, dated and attributed evidence. A made-up figure may get reused and still mislead readers.

**Sources**

- Aggarwal et al. 2024, [GEO](https://arxiv.org/abs/2311.09735): Statistics Addition, position-adjusted word count 19.3 to 25.2, five-source fixed setup.
- Puerto et al. 2025, [C-SEO Bench](https://arxiv.org/abs/2506.11097): "the Statistics method decreases rankings in 19 out of 24 evaluated settings"; only 3 of 54 method and domain cases significant in the main experiment.
- Zhang, He, Yao 2026, [From Citation Selection to Citation Absorption](https://arxiv.org/abs/2604.25707): pages with numbers, 61.55% higher mean influence; observational.
- Martinez 2026, [critical survey](https://arxiv.org/abs/2607.14035): give "relevant, verifiable, dated, and properly attributed evidence", not more numbers.

## Tables (`tables`)

Grade: **untested**

No study we opened tests tables on their own. Comparison content, which tables often carry, was linked to more citations and more use in answers, while formatting-only changes showed little effect, so use a table to present a real comparison rather than to raise a score.

**What the studies did.** What Gets Cited found that a page without comparisons to alternatives lost the first citation more often (one of the factors significant in at least four of six models), but it tested the comparison content, not the table format, and formatting-only edits had no consistent effect. The observational study found that cited pages with comparison content had a 55.28% higher influence score; it reports no result for tables. Martinez advises testing tables without assuming which way the effect goes.

**Sources**

- Vishwakarma et al. 2026, [What Gets Cited](https://arxiv.org/abs/2605.25517): missing comparisons lowered first-citation odds; tables not tested as such.
- Zhang, He, Yao 2026, [From Citation Selection to Citation Absorption](https://arxiv.org/abs/2604.25707): comparison content, 55.28% higher mean influence; observational.
- Martinez 2026, [critical survey](https://arxiv.org/abs/2607.14035): test tables "without assuming the direction of effect".

## Expert quotes (`expert-quotes`)

Grade: **mixed**

Adding quotations gave the largest gain in the original GEO experiment, the source of the popular "up to 40%" figure, but C-SEO Bench found no significant gain from added quotes when it measured citation rank. That 40% is a bigger share of answer text in one fixed five-source setup, not more clicks or a better chance of being found.

**What the studies did.** GEO's Quotation Addition rewrite raised the source's position-weighted share from 19.3 to 27.2, about 41% in relative terms; this is where "up to 40%" comes from. Martinez explains the limits: the page was already one of the five sources in the prompt, the metric is a share of answer text, and no clicks or traffic were measured; the survey rejects "GEO increases visibility by 40%" as a general claim. C-SEO Bench found no significant ranking gain from the Quotes rewrite in its main experiment.

A quote from a named expert can still add real information for readers. Attribute it properly, and do not expect the quote alone to lift citations.

**Sources**

- Aggarwal et al. 2024, [GEO](https://arxiv.org/abs/2311.09735): Quotation Addition, 27.2 versus 19.3, five-source fixed setup.
- Martinez 2026, [critical survey](https://arxiv.org/abs/2607.14035): the 40% figure is "a relative maximum on one metric under a specific configuration".
- Puerto et al. 2025, [C-SEO Bench](https://arxiv.org/abs/2506.11097): no significant gain from the Quotes rewrite in the main experiment.

## Cited sources (`cited-sources`)

Grade: **mixed**

Adding citations to credible sources helped in the original GEO experiment, especially for lower-ranked pages, but later tests found little or no gain from adding references alone. Claims backed by concrete evidence did win citations in a controlled study, so link sources where they support a specific claim.

**What the studies did.** GEO's Cite Sources rewrite raised the share from 19.3 to 24.6, and when all five sources were rewritten the fifth-ranked page gained 115.1% while the top-ranked one lost 30.3%. C-SEO Bench found no significant ranking gain from its Citations rewrite in the main experiment. ConflictingQA edited pages on contested questions and found that adding scientific references had a neutral or negative effect on whether models sided with the page, while making the page more relevant to the question helped a lot. What Gets Cited found that claims backed by evidence such as tests or certifications beat the same claims without it.

**Sources**

- Aggarwal et al. 2024, [GEO](https://arxiv.org/abs/2311.09735): Cite Sources, 19.3 to 24.6; fifth-ranked source +115.1%.
- Puerto et al. 2025, [C-SEO Bench](https://arxiv.org/abs/2506.11097): no significant gain from the Citations rewrite in the main experiment.
- Wan et al. 2024, [ConflictingQA](https://aclanthology.org/2024.acl-long.403/): models largely ignore "whether a text contains scientific references".
- Vishwakarma et al. 2026, [What Gets Cited](https://arxiv.org/abs/2605.25517): claims with supporting evidence won the first citation, significant in at least four of six models.

## Direct-answer lead (`direct-answer-lead`)

Grade: **mixed**

Some studies found that answering the question at the top helps, but the gains were narrow: an added top-of-page summary helped in only two product domains and made no difference for question answering or for one of the engine models. All of the evidence is indirect (case studies, an added summary, rules learned from engines), so treat this check as a sensible habit rather than a proven lever.

**What the studies did.** In SAGEO Arena's full pipeline, case studies found that putting the direct answer in early paragraphs improved reranking, while moving the answer later caused significant rank drops even though the answer was still on the page. In C-SEO Bench, a short summary added to the top of the page was one of only two rewrites with a significant gain, in the retail and video games domains; no rewrite made a significant difference in question answering, or for the Haiku 3.5 engine model. SAGEO Arena also found that in its shopping domain every rewrite it tested lowered citation, and that AutoGEO's rewrite (which applies "Conclusion First" among many other rules) caused the largest drop in being retrieved. In ConflictingQA, starting a page with a line saying which question it is about substantially raised how often models sided with it. AutoGEO's preference rules for Gemini, GPT and Claude all include "state the key conclusion at the beginning of the document". These test a page-level answer or summary; none tests an answer at the start of every section, which is what this check looks for.

**Sources**

- Kim et al. 2026, [SAGEO Arena](https://arxiv.org/abs/2602.12187): early answer placement improved reranking; displacing it caused significant rank drops; in shopping, every rewrite tested lowered citation.
- Puerto et al. 2025, [C-SEO Bench](https://arxiv.org/abs/2506.11097): a summary at the top of the page gave significant gains in two product domains; no significant gain in question answering or for Haiku 3.5.
- Wan et al. 2024, [ConflictingQA](https://aclanthology.org/2024.acl-long.403/): a question prefix substantially raised win rate.
- Wu et al. 2025, [AutoGEO](https://arxiv.org/abs/2510.11438): "Conclusion First" rule for all three engines; preprint.

## Question coverage (`question-coverage`)

Grade: **mixed**

Relevance to the question is the most repeatable finding in the studies we opened: in controlled tests, edits that made a page address the question more directly made models use it more. This check measures a narrow stand-in for that (the question's key words in a short opening sentence), and in the largest controlled study, pages missing the question's terms lost the first citation in only four of six models. Answer the questions your readers really ask, in plain words, and do not repeat key words for their own sake.

**What the check looks for.** You enter the questions your readers ask (the check does not apply without them). For each question, the check takes its key words (small words like "what", "is" and "the" are dropped, and endings like "-s" and "-ing" are trimmed), finds the H2 or H3 heading that shares at least half of them, or else the paragraph whose first sentence matches best, and counts the question as answered when that section opens with a plain sentence of 8 to 40 words that is not itself a question and contains at least 60% of the key words. These thresholds are ours.

**What the studies did.** ConflictingQA edited pages on contested questions one way at a time: edits that made a page more relevant to the question, such as adding a single sentence that makes its stance on the question obvious or starting it with "The following text is about the question", had a substantial positive effect on how often models sided with the page, while stylistic edits did not. What Gets Cited tested pages that lacked query terms the competing page had (its "Keyword Gap" factor): the page with the terms won the first citation, significantly in four of six models (Kimi K2, GPT-5 Nano, GPT-5 Mini, GPT-5.2) and not significantly in Gemini 2.5 Flash or Claude 3.5 Sonnet. In SAGEO Arena's reranking case studies, adding content that directly addresses the query's information need and placing the answer early raised a page's rank, and rewrites that mentioned the query's terms without addressing the question did well at retrieval but lost at reranking and generation. Martinez rates query-document relevance as strong in controlled settings, on the condition of a well-defined intent and no fabrication. None of these tests our exact rule, so the check is a writing habit with good reasons behind it, not a measured lever.

**Sources**

- Wan et al. 2024, [ConflictingQA](https://aclanthology.org/2024.acl-long.403/): relevance edits (a question prefix, one added sentence that makes the page's stance obvious) had "a substantial positive effect"; stylistic edits were neutral or negative.
- Vishwakarma et al. 2026, [What Gets Cited](https://arxiv.org/abs/2605.25517): pages missing query terms lost the first citation, significant in four of six models.
- Kim et al. 2026, [SAGEO Arena](https://arxiv.org/abs/2602.12187): content that "directly addresses the query's informational need" and an early answer raised reranking position; query terms without an answer lost at reranking and generation.
- Martinez 2026, [critical survey](https://arxiv.org/abs/2607.14035): query-document relevance is "strong in controlled settings"; "explicitly address genuine information needs".

## Comparisons (`comparisons`)

Grade: **mixed**

In a controlled study, product pages with no comparison to alternatives lost the first citation more often, but the effect was significant in only four of six models. An observational study found that pages with comparison content shaped AI answers more. No study tests comparison wording on its own, so compare options where readers really choose between them, with real differences, and skip it where they do not.

**What the check looks for.** In drafts of 300 words or more, any heading, sentence or table row with explicit comparison language: "vs", "versus", "compared with" or "compared to", "than" (but not "more than 25 seconds"), "unlike", "instead of", "rather than", "alternatives", "pros and cons", "which is better", or a question heading of the form "X or Y?". One is enough to pass. The check never writes a comparison for you, because only you know the real differences.

**What the studies did.** What Gets Cited compared matched product pages that differed only in whether they compared the product with alternatives. The page with the comparison won the first citation with odds ratios of 7.45 (Gemini 2.5 Flash), 4.55 (Claude 3.5 Sonnet), 4.72 (Kimi K2) and 2.14 (GPT-5 Nano), all significant, and 1.78 (GPT-5 Mini) and 1.61 (GPT-5.2), which were not significant. The test used shopping-style pages with two sources per trial. Zhang, He and Yao found that cited pages with comparison content had a 55.28% higher mean influence score (0.1389 against 0.0894), and that comparison was the second most influential role a cited passage played in an answer; they list "adding comparison sections will increase future absorption" as a claim their observational data cannot establish. Martinez rates extractable evidence, including comparisons, as moderate to strong support when it is truthful and fits the reader's intent.

**Sources**

- Vishwakarma et al. 2026, [What Gets Cited](https://arxiv.org/abs/2605.25517): with versus without comparisons, significant in four of six models, not in GPT-5 Mini or GPT-5.2.
- Zhang, He, Yao 2026, [From Citation Selection to Citation Absorption](https://arxiv.org/abs/2604.25707): comparison content, 55.28% higher mean influence; observational.
- Martinez 2026, [critical survey](https://arxiv.org/abs/2607.14035): "verifiable figures, definitions, and comparisons" have "moderate to strong" support, given "compatible truthfulness, attribution, and intent".

## Your reader's words up top (`reader-words`)

Grade: **mixed**

Using your reader's own words where the page opens can help it get picked, but piling in query words is not the same thing. In an early controlled study, a rewrite that added more of the query's keywords lowered the page's share of the answer, and in the largest controlled study, pages missing the query's terms lost the first citation in only four of six models. Work the reader's words into the title or opening where they fit naturally, and leave them out where they do not.

**What the check looks for.** It measures the questions you typed or imported when there are any; otherwise the page's own questions, made from its title (when the title is a question) and its topic ("What is ...?", "How does ... work?"). It never uses a question made from a section heading, and without any question it does not apply. For each question it takes the same key words as the question-coverage check, leaving out common verbs ("work", "use", "take", "make"), and counts how many appear in the title (the first H1), the first heading after it or the first paragraph. A question section does not push those down: the check reads every heading down to the first one that is not a question, and every paragraph down to the first one outside a question section, so with the same questions, adding a question section never lowers the score. On a page whose sections are all questions, this reaches further down than the title, first heading and first paragraph that our test edited. A question asked twice counts once. The score is that share, averaged over the questions. The advice names up to three missing words per question and says where they could go; it never names a word that is already there and never writes the words in for you.

**What the studies did.** GEO's Keyword Stuffing rewrite ("Modifies content to include more keywords from the query, as expected in classical SEO optimization") lowered the source's position-weighted share of the answer from 19.3 at baseline to 17.7, and the authors find such methods offer "little to no improvement"; it added keywords anywhere in the page, not into the title and opening. What Gets Cited tested pages missing query terms that the competing page had: the page with the terms won the first citation, significantly in four of six models and not in Gemini 2.5 Flash or Claude 3.5 Sonnet. In SAGEO Arena, rewrites that mentioned the query's terms without addressing the question did well at retrieval but lost at reranking and generation. ConflictingQA found that opening a page with a line naming the question it answers substantially raised how often models sided with it. The rubric counts the stuffing result and the two null models as null or negative findings, so the grade is mixed.

**Our own test.** E1's candidate check for query wording worked the query's missing key terms into the title, the first heading and the first paragraph, adding only key terms and function words. Against a paraphrase of the same spans it raised the citation score by d +0.035 (95% CI [+0.008, +0.066], n 33, Holm p 0.037), possibly through query-term overlap; the replication set had too few valid edits for a verdict (n 12). In E2, with a different editor (Qwen3.8-27B) and different judges, the gain kept its sign (d +0.029, 95% CI [+0.003, +0.061], n 29). These are local models in a fixed context of four sources.

**Sources**

- Aggarwal et al. 2024, [GEO](https://arxiv.org/abs/2311.09735): Keyword Stuffing, 17.7 versus 19.3 at baseline, five-source fixed setup.
- Vishwakarma et al. 2026, [What Gets Cited](https://arxiv.org/abs/2605.25517): pages missing query terms lost the first citation, significant in four of six models.
- Kim et al. 2026, [SAGEO Arena](https://arxiv.org/abs/2602.12187): query terms without an answer did well at retrieval, lost at reranking and generation.
- Wan et al. 2024, [ConflictingQA](https://aclanthology.org/2024.acl-long.403/): a question prefix substantially raised win rate.

## Site readiness

Site readiness is a separate report about the published page and its site, not the draft. It is not part of the AI-ready score: no readiness item changes a score, and the score never looks at readiness. Five items read the page's HTML (or the draft's front matter) and run in the browser on the workspace's Your site page (`/site`), which sends nothing anywhere; two need a fetch of the live site and run from the command line with `ce site <url>`.

The grades use the same four words, with one difference: for readiness, the documentation an answer engine publishes about its own crawlers and AI features counts as evidence, because it says what that engine does with a page. The rules:

| Grade | What it means for a readiness item |
|---|---|
| **strong** | Two or more operators of AI answer engines document that the item decides whether a page can appear in their answers, and no source we opened says otherwise. |
| **moderate** | One operator documents it, or a measurement of crawler behaviour supports it, and no source we opened says otherwise. |
| **mixed** | An operator says the item is not needed, or a study found no effect, or the effect cuts both ways. |
| **untested** | No operator documentation or study we opened ties the item to AI answers. The item rests on general search guidance. |

Every page below was opened and read on 2026-10-23.

### Byline (`byline`)

Grade: **untested**

No study we opened tests whether a byline changes how AI answer engines use or cite a page. Google asks publishers to make clear who created a page, with a byline where readers expect one, but says this is about trust and is not itself a ranking factor.

**What the check looks for.** An author in JSON-LD (`author.name`), a `<meta name="author">` tag, `rel="author"`, `itemprop="author"` or a `byline` element, or `author`/`authors` in the draft's front matter. A byline written as plain text ("By Ana Lima") cannot be told apart from other text, so a warning here means "check the page", not "there is no byline".

**Sources**

- Google Search Central, [Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content): asks "Do pages carry a byline, where one might be expected?"; says E-E-A-T "itself isn't a specific ranking factor".

### Publication dates (`dates`)

Grade: **mixed**

A controlled study found that the date a passage states changes how language-model rerankers order it: newer dates moved up and older ones moved down. A date can therefore help a fresh page and hurt an old one, so keep the published and updated dates accurate rather than adding dates for their own sake.

**What the study did.** Fang and colleagues added artificial publication dates to passages from the TREC Deep Learning 2021 and 2022 collections and had seven LLM rerankers (including GPT-4o and Qwen-2.5) reorder them. Newer passages ranked consistently higher, the top ten's mean year rose by as much as 4.78 years, and preferences between equally relevant passages reversed up to 25% of the time. The dates were written into the passage text; the study does not test date metadata. It is a preprint.

**Sources**

- Fang et al. 2025, [Do Large Language Models Favor Recent Content?](https://arxiv.org/abs/2509.11353): recency bias in seven LLM rerankers; preprint.

### Structured data (`structured-data`)

Grade: **mixed**

Google says no special schema.org markup is needed to appear in its AI features, and a matched study of pages that added JSON-LD found no meaningful rise in AI citations. Structured data can still describe the page accurately for search engines; keep it matching the visible text.

**What the sources say.** Google's page on AI features says there is "no special schema.org structured data that you need to add" for AI Overviews or AI Mode, and that structured data should match the visible text. Ahrefs followed 1,885 pages that were already cited in AI Overviews and added JSON-LD, against matched pages that did not, for 30 days either side: AI Overview citations changed by -4.6%, AI Mode by +2.4% and ChatGPT by +2.2%, the last two not distinguishable from zero. It is an industry study that pooled all schema types. The check lists the JSON-LD `@type` values it finds and notes Article, BlogPosting, NewsArticle, FAQPage and HowTo. It also notes, for information only, whether `sameAs` links the author or organization (a Person or Organization node, or the article's `author`, `publisher` or `creator`) to their profiles on other sites. Google documents `sameAs` as "The URL of a page on another website with additional information about your organization", such as a social media or review profile, and does not tie it to ranking or AI features; no source we opened tests `sameAs` for AI citation, so this note does not change the item's status.

**Sources**

- Google Search Central, [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features): no special structured data needed; keep it matching visible text.
- Linehan and Guan 2026, [We Tracked 1,885 Pages Adding Schema](https://ahrefs.com/blog/schema-ai-citations/) (Ahrefs): no meaningful citation gain after adding JSON-LD.
- Google Search Central, [Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization): what `sameAs` is for.

### Indexing directives (`indexing-directives`)

Grade: **strong**

Google and Bing both document that indexing directives decide whether a page can appear in their AI answers: Google needs a page to be indexed and eligible for a snippet, so noindex, nosnippet and max-snippet:0 keep it out, and Bing keeps pages marked NOARCHIVE out of its chat answers.

**What the check looks for.** `noindex`, `none`, `nosnippet` or `max-snippet:0` in a `<meta name="robots">`, `googlebot` or `bingbot` tag, or (with `ce site`) in the `X-Robots-Tag` header, fail the item. `noarchive` or `nocache` give a warning, since Bing documents that they keep a page out of, or shorten it in, its chat answers.

**Sources**

- Google Search Central, [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features): a page "must be indexed and eligible to be shown in Google Search with a snippet"; nosnippet, data-nosnippet, max-snippet and noindex limit what is shown.
- Bing Webmaster Blog 2023, [new options to control usage of content in Bing Chat](https://blogs.bing.com/webmaster/september-2023/Announcing-new-options-for-webmasters-to-control-usage-of-their-content-in-Bing-Chat): "Content tagged NOARCHIVE will not be included in Bing Chat answers".

### Canonical URL (`canonical`)

Grade: **untested**

No study we opened tests whether a canonical URL changes AI citation. For search engines it tells which of several duplicate URLs to show and where to consolidate signals, which matters most when the same article lives at more than one address.

**Sources**

- Google Search Central, [How to specify a canonical URL](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls): rel="canonical" is "a strong signal that the specified URL should become canonical".

### AI crawler access (`crawler-access`)

Grade: **strong**

The answer engines' own documentation says a page their search crawler may not fetch is left out of their answers: OpenAI, Anthropic and Perplexity each name a search crawler, and Google asks that robots.txt allow crawling. Blocking a training crawler such as GPTBot or Google-Extended does not, by their accounts, remove a page from search answers.

**What the check does.** `ce site <url>` reads the site's robots.txt with robots-parser and asks, for each crawler below, whether it may fetch that URL. A blocked AI search, user-fetch or search engine crawler (Googlebot, Bingbot, Applebot) fails the item, since such a block can keep the page out of that engine's results and the answers built on them; otherwise a blocked training crawler warns (that is a legitimate choice, and the report just says so); otherwise it passes. For Google-Extended the warning adds that Google says the token also controls grounding in Gemini Apps. A missing robots.txt (HTTP 4xx) allows everything. A robots.txt that cannot be read (a network error or HTTP 5xx) is treated the way RFC 9309 tells crawlers to treat it: as disallowing everything. Two operators say their user-initiated fetchers may not follow robots.txt at all (ChatGPT-User, Perplexity-User), so for those the result describes the site's stated policy, not what the fetcher will do.

| Token | Operator | Purpose | Documentation |
|---|---|---|---|
| GPTBot | OpenAI | training | [OpenAI crawlers](https://developers.openai.com/api/docs/bots) |
| OAI-SearchBot | OpenAI | search | same page |
| ChatGPT-User | OpenAI | user-fetch | same page |
| ClaudeBot | Anthropic | training | [Anthropic crawlers](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) |
| Claude-SearchBot | Anthropic | search | same page |
| Claude-User | Anthropic | user-fetch | same page |
| PerplexityBot | Perplexity | search | [Perplexity crawlers](https://docs.perplexity.ai/guides/bots) |
| Perplexity-User | Perplexity | user-fetch | same page |
| Googlebot | Google | search-engine (Search, and through it AI Overviews and AI Mode) | [Google's common crawlers](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers) |
| Google-Extended | Google | training (a robots.txt token only: Gemini training and grounding; no effect on Search) | same page |
| Bingbot | Microsoft (Bing) | search-engine | [Which crawlers does Bing use?](https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0) |
| Applebot | Apple | search-engine (Spotlight, Siri and Safari search) | [About Applebot](https://support.apple.com/en-us/119829) |
| Applebot-Extended | Apple | training (a robots.txt token only; no effect on search) | same page |
| CCBot | Common Crawl | training (an open crawl archive that many language models are trained on) | [CCBot](https://commoncrawl.org/ccbot) |

The Bing page builds its text with JavaScript, so we read it through a search engine's copy of the page, which names Bingbot as Bing's standard crawler. Meta and other operators are not listed because we did not verify their documentation for this release.

**Sources**

- OpenAI, [Overview of OpenAI Crawlers](https://developers.openai.com/api/docs/bots): "Sites that are opted out of OAI-SearchBot will not be shown in ChatGPT search answers".
- Anthropic, [Does Anthropic crawl data from the web?](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler): disabling Claude-SearchBot "may reduce your site's visibility and accuracy in user search results".
- Perplexity, [Perplexity Crawlers](https://docs.perplexity.ai/guides/bots): PerplexityBot surfaces and links sites in Perplexity's search results and is not used for training.
- Google Search Central, [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features): ensure "crawling is allowed in robots.txt, and by any CDN or hosting infrastructure".

### Renders without JavaScript (`renders-without-js`)

Grade: **moderate**

A large measurement of crawler traffic found that the AI crawlers of OpenAI, Anthropic and Perplexity fetch pages without running JavaScript, so text that only appears after scripts run is invisible to them. Google renders JavaScript for Search and Gemini but still recommends server-side rendering because not all bots run it.

**What the check does.** `ce site <url>` fetches the page's raw HTML, runs no scripts, and extracts the main text with Defuddle. 200 words or more passes, 50 to 199 warns, fewer than 50 fails. A page that only fills an empty `<div id="root">` from JavaScript fails. An HTTP error page fails too, since crawlers get no article from it.

**Sources**

- Zecchini et al. 2024, [The rise of the AI crawler](https://vercel.com/blog/the-rise-of-the-ai-crawler) (Vercel): "none of the major AI crawlers currently render JavaScript"; AppleBot and Googlebot do.
- Google Search Central, [Understand the JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics): "not all bots can run JavaScript", so server-side or pre-rendering "is still a great idea".

## Off-page

AI answers cite third-party pages heavily, so part of being cited happens off your own page: being present, accurately and openly, where answer engines already look. The workspace's Who gets cited page (`/cited`) and `ce sources` show which sites the answers to your own questions cite, grouped by kind, and give one advice card per kind: what to do, what to avoid, and how well the advice is supported. Like site readiness, this is not part of the AI-ready score.

The answers come from `ce live` (the Gemini API with Google Search) or from answers you copy by hand out of ChatGPT, Perplexity, Gemini or Copilot and paste in. Pasted text is parsed in your browser and sent nowhere. The tool never posts, contacts anyone, writes reviews or reads consumer AI apps for you.

**How a site's kind is decided.** `classifyDomain` matches the host (or any subdomain of it) against a short list in `packages/engine/src/offpage.ts`: Reddit, Quora and the Stack Exchange sites are forums; Wikipedia and its sister projects, wikiHow and Fandom are wikis; YouTube, Vimeo, TikTok and Twitch are video; G2, Capterra, TrustRadius, Trustpilot, Yelp, Tripadvisor and Glassdoor are review platforms; wire services, newspapers and editorial sites such as Forbes, TechRadar and NerdWallet are news; Britannica, Merriam-Webster, the NIH, the CDC, the WHO, Mayo Clinic and similar, plus any `.gov`, `.edu`, `.mil` or `gov.uk` host, are reference; LinkedIn, Facebook, Instagram, X, Threads, Pinterest and Bluesky are social; Amazon, eBay, Etsy and large retailers are commerce. Everything else, including your own blog and Medium, is "blog or other". A subdomain of a listed site counts as that site (`old.reddit.com` as `reddit.com`, `en.wikipedia.org` as `wikipedia.org`). An answer counts once for a domain however many times it links it. Your own domain counts with its `www.` form and every subdomain, and is reported apart.

**How the advice is graded.** Every study we found counts which domains AI answers cite. None tests whether taking part on a site gets your own page cited, and all of them are observational, so under the rules above no card can be strong. The grades say how well the counts support "answer engines cite this kind of site":

| Grade | What it means for an off-page card |
|---|---|
| **strong** | Not given: it would need a controlled test of taking part, which no study we opened has run. |
| **moderate** | For at least one engine that some study we opened gives a full top ten for, every such full top ten has sites of this kind in it, and no study reports the kind's share falling sharply. A kind seen only in a partial list (Semrush's first five) cannot reach moderate. |
| **mixed** | Some study puts the kind among an engine's most cited, but for every such engine another study's top ten leaves it out, or a study reports the kind's share falling sharply. |
| **untested** | No study we opened puts sites of this kind among any engine's most cited. |

The three citation studies are industry studies by companies that sell AI-visibility tools, and they measure different things: [Profound](https://www.tryprofound.com/blog/ai-platform-citation-patterns) (680 million citations, August 2024 to June 2025; shares of each engine's ten most cited sources; collection method not described), [Ahrefs](https://ahrefs.com/blog/top-10-most-cited-domains-ai-assistants) (Brand Radar, June 2025; share of mentions) and [Semrush](https://www.semrush.com/blog/most-cited-domains-ai/) (230,000+ prompts, weekly from 14 July to 12 October 2025; share of responses). The platform rules and the US Federal Trade Commission guidance behind each "avoid" line were opened and read on 2026-10-23.

Profound and Ahrefs publish a full top ten for each engine (Ahrefs' as charts in the article); Semrush's text names only each engine's first five, so it can show a kind present but never absent. The grades apply the rules above to these lists, as read on 2026-10-23, and an engine test checks every card against them:

| Engine | Profound top ten (share of top ten) | Ahrefs top ten (mention share, chart) | Semrush first five (share of responses) |
|---|---|---|---|
| ChatGPT | Wikipedia, Reddit, Forbes, G2, TechRadar, NerdWallet, Business Insider, New York Post, Toxigon, Reuters | wikipedia.org, reuters.com, apple.com, justwatch.com, as.com, amazon.com, apnews.com, google.com, axios.com, uol.com.br | Wikipedia, Reddit, Medium, Forbes, LinkedIn |
| Google AI Overviews | Reddit, YouTube, Quora, LinkedIn, Gartner, NerdWallet, Forbes, Wikipedia, Business Insider, Medium | wikipedia.org, youtube.com, reddit.com, quora, translate.google.com, healthline.com, mayoclinic.org, clevelandclinic.org, nih.gov, medicalnewstoday.com | not studied |
| Perplexity | Reddit, YouTube, Gartner, Yelp, LinkedIn, Forbes, NerdWallet, Tripadvisor, G2, PCMag | youtube.com, wikipedia.org, apple.com, google.com, healthline.com, tuasaude.com, justwatch.com, imdb.com, microsoft.com, instagram.com | Reddit, LinkedIn, NIH, Microsoft, Google |
| Google AI Mode | not studied | not studied | LinkedIn, YouTube, Reddit, Google, Google Blog |

### Forums and Q&A sites (`forum`)

Grade: **mixed**

Forums are heavily cited, but the studies disagree by engine and over time. Profound found Reddit the top source for Google AI Overviews (21.0% of the top ten) and Perplexity (46.7%); Ahrefs found Reddit and Quora high only in AI Overviews, outside the top ten in ChatGPT and Perplexity; Semrush saw ChatGPT cite Reddit in close to 60% of responses in early August 2025 and about 10% by mid-September.

**What to avoid, and why.** Reddit's Rule 2: "Participate authentically in communities where you have a personal interest, and do not spam or engage in disruptive behaviors (including content manipulation)". Stack Overflow: "if you mention your product, website, etc. ... you must disclose your affiliation in your post."

**Sources**

- Profound 2025, [AI Platform Citation Patterns](https://www.tryprofound.com/blog/ai-platform-citation-patterns); Ahrefs 2025, [The 10 Most Mentioned Domains](https://ahrefs.com/blog/top-10-most-cited-domains-ai-assistants); Semrush 2025, [The Most-Cited Domains in AI](https://www.semrush.com/blog/most-cited-domains-ai/).
- Reddit, [Reddit Rules](https://redditinc.com/policies/reddit-rules); Stack Overflow, [How to not be a spammer](https://stackoverflow.com/help/promotion).

### Wikipedia and other wikis (`wiki`)

Grade: **mixed**

Wikipedia is among the most cited domains in every study we opened, above all in ChatGPT (47.9% of its top ten in Profound's data; 16.3% of mentions in Ahrefs'). Semrush saw ChatGPT's Wikipedia citations fall from about 55% of responses to under 20% in September 2025, and found Wikipedia in about 2% of Google AI Mode responses.

**What to avoid, and why.** You cannot place yourself on Wikipedia. Its conflict-of-interest guideline says "COI editors are strongly discouraged from editing affected articles directly", expects them to disclose the connection, and points them to proposing changes on the talk page; the Wikimedia terms of use require paid editors to disclose their employer and client. Its notability guideline asks for "significant coverage in reliable sources that are independent of the subject", which excludes the subject's own site, press releases and advertising.

**Sources**

- Profound 2025; Ahrefs 2025; Semrush 2025 (as above).
- Wikipedia, [Conflict of interest](https://en.wikipedia.org/wiki/Wikipedia:Conflict_of_interest) and [Notability](https://en.wikipedia.org/wiki/Wikipedia:Notability).

### Video (`video`)

Grade: **moderate**

YouTube is among the top sources for Google AI Overviews and Perplexity in Profound's data (18.8% and 13.9% of the top ten) and Ahrefs' (9.5% and 16.1% of mentions), and Semrush found it second in Google AI Mode. Ahrefs found it missing from ChatGPT's top ten.

**What to avoid, and why.** YouTube asks creators to flag "branded content, sponsorships, endorsements, or other commercial relationships" with the paid promotion setting, which adds a disclosure label.

**Sources**

- Profound 2025; Ahrefs 2025; Semrush 2025 (as above).
- YouTube Help, [Add branded content restrictions & disclosure labels](https://support.google.com/youtube/answer/154235).

### Review platforms (`reviews`)

Grade: **mixed**

In Profound's data G2 is among the ten most cited sources of ChatGPT (6.7%) and Perplexity (4.0%), and Yelp (5.8%) and Tripadvisor (4.1%) among Perplexity's, but Ahrefs' top tens for those two engines have no review site, and Semrush names none among its first five.

**What to avoid, and why.** The FTC's Consumer Reviews and Testimonials Rule, in effect since 21 October 2024, covers fake or false reviews, reviews bought on condition of a particular sentiment, insider reviews and review suppression, and courts may impose "civil penalties for knowing violations". The FTC's Endorsement Guides ask friends, relatives and anyone given a product or discount to disclose that connection.

**Sources**

- Profound 2025; Ahrefs 2025; Semrush 2025 (as above).
- FTC, [Consumer Reviews and Testimonials Rule: Questions and Answers](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers); FTC, [Endorsement Guides: What People Are Asking](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking).

### News and editorial sites (`news`)

Grade: **moderate**

News and editorial sites fill much of ChatGPT's top ten in Profound's data (Forbes 6.8%, TechRadar 5.5%, NerdWallet 5.1%, Business Insider 4.9%, New York Post 4.4%, Reuters 3.4%), and Ahrefs writes that "News outlets like Reuters, Apple News (AP), and AS.com feature prominently in ChatGPT".

**What to avoid, and why.** Google's spam policies count "Buying or selling links for ranking purposes" and "links with optimized anchor text in articles, guest posts, or press releases distributed on other sites" as link spam.

**Sources**

- Profound 2025; Ahrefs 2025 (as above).
- Google Search Central, [Spam policies for Google web search](https://developers.google.com/search/docs/essentials/spam-policies).

### Reference, health and government sites (`reference`)

Grade: **mixed**

Ahrefs writes that "Health/medical sites (Mayo Clinic, Cleveland Clinic) register in AI Overviews" and has Mayo Clinic, Cleveland Clinic and the NIH in that engine's top ten, and Semrush lists the NIH third among Perplexity's most cited domains. Profound's top tens for Google AI Overviews and Perplexity have no reference site, nor does Ahrefs' for Perplexity. These sites are cited for what they publish themselves, so the advice is to cite them accurately, not to try to appear on them.

**Sources**

- Profound 2025; Ahrefs 2025; Semrush 2025 (as above).

### Professional and social networks (`social`)

Grade: **moderate**

All three studies put a social network among Perplexity's most cited sources: LinkedIn is 5.3% of its top ten in Profound's data and second in Semrush's, and Instagram is tenth in Ahrefs'. LinkedIn is also 13.0% of Google AI Overviews' top ten in Profound's data, and Semrush found it the most cited domain in Google AI Mode (nearly 15% of responses) and fifth in ChatGPT. The card also suggests listing your profiles under `sameAs` in your JSON-LD, which Google documents for profile pages on other sites; no source we opened tests that for AI citation.

**What to avoid, and why.** The FTC's Endorsement Guides: a sponsored endorser's "connection to the company should be disclosed everywhere you endorse the product".

**Sources**

- Profound 2025; Ahrefs 2025; Semrush 2025 (as above).
- FTC, Endorsement Guides (as above); Google Search Central, [Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization).

### Shops and marketplaces (`commerce`)

Grade: **mixed**

Ahrefs puts Amazon sixth in ChatGPT's top ten, but Profound's ChatGPT top ten has no marketplace, and no other list we opened has one. The FTC review rule applies to product listings as it does anywhere else.

**Sources**

- Profound 2025; Ahrefs 2025 (as above).
- FTC, Consumer Reviews and Testimonials Rule (as above).

### Blogs and other sites (`blog-or-other`)

Grade: **moderate**

Medium, a blogging platform, is in Google AI Overviews' top ten in Profound's data (3.9%) and third in ChatGPT in Semrush's. More to the point, in Profound's data the ten most cited domains together held 16.3% of ChatGPT's citations, 10.3% of Google AI Overviews' and 14.2% of Perplexity's (our sums of the shares it lists), and no single domain more than 7.8%. Most citations go to other sites, which is where your own page competes; the rest of this tool is about that page.

**What to avoid, and why.** Google's spam policies count bought links and excessive link exchanges as link spam, and "Scaled content abuse is when many pages are generated for the primary purpose of manipulating search rankings".

**Sources**

- Profound 2025; Semrush 2025 (as above); Google Search Central, Spam policies (as above).

## Keeping this current

The registry behind this page lives in `packages/engine/src/evidence.ts` (checks, with their E1 and E3 outcomes from `packages/engine/src/e1.ts`), `packages/engine/src/readiness.ts` (site readiness) and `packages/engine/src/offpage.ts` (off-page). When a new study changes a grade, update the registry, this page and the notes together; the engine tests check that every graded check has a linked source and that this page states the same grade as the registry.
