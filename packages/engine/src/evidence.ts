import type { CheckId, Evidence, SourceRef } from './types';

// Evidence review of 2026-10-23. Every source below was opened and read; the
// research log with quotes is docs/research/evidence-notes.md and the public
// reading is docs/evidence.md. Grades: strong, moderate, mixed, untested.

type Work = Omit<SourceRef, 'claim'>;

const WORKS = {
  aggarwal2024: {
    id: 'aggarwal-2024-geo',
    citation:
      'Aggarwal, P., Murahari, V., Rajpurohit, T., Kalyan, A., Narasimhan, K., & Deshpande, A. (2024). GEO: Generative Engine Optimization. KDD 2024.',
    url: 'https://arxiv.org/abs/2311.09735',
  },
  martinez2026: {
    id: 'martinez-2026-survey',
    citation:
      'Martinez, O. (2026). Optimizing Visibility in Generative Engines: A Critical Survey of Generative Engine Optimization (2023-2026). arXiv:2607.14035.',
    url: 'https://arxiv.org/abs/2607.14035',
  },
  puerto2025: {
    id: 'puerto-2025-cseo-bench',
    citation:
      'Puerto, H., Gubri, M., Green, T., Oh, S. J., & Yun, S. (2025). C-SEO Bench: Does Conversational SEO Work? NeurIPS 2025 Datasets and Benchmarks.',
    url: 'https://arxiv.org/abs/2506.11097',
  },
  vishwakarma2026: {
    id: 'vishwakarma-2026-what-gets-cited',
    citation:
      'Vishwakarma, R., Kumar, S., & Jamidar, R. (2026). What Gets Cited: Competitive GEO in AI Answer Engines. SIGIR 2026.',
    url: 'https://arxiv.org/abs/2605.25517',
  },
  kim2026: {
    id: 'kim-2026-sageo-arena',
    citation:
      'Kim, S., Jeong, W., Kim, S., Lee, S., & Lee, D. (2026). SAGEO Arena: A Realistic Environment for Evaluating Search-Augmented Generative Engine Optimization. KDD 2026.',
    url: 'https://arxiv.org/abs/2602.12187',
  },
  zhang2026: {
    id: 'zhang-2026-citation-absorption',
    citation:
      'Zhang, K., He, X., & Yao, J. (2026). From Citation Selection to Citation Absorption: A Measurement Framework for Generative Engine Optimization Across AI Search Platforms. arXiv:2604.25707.',
    url: 'https://arxiv.org/abs/2604.25707',
  },
  wan2024: {
    id: 'wan-2024-conflictingqa',
    citation:
      'Wan, A., Wallace, E., & Klein, D. (2024). What Evidence Do Language Models Find Convincing? ACL 2024.',
    url: 'https://aclanthology.org/2024.acl-long.403/',
  },
  wu2025: {
    id: 'wu-2025-autogeo',
    citation:
      'Wu, Y., Zhong, S., Kim, Y., & Xiong, C. (2025). What Generative Search Engines Like and How to Optimize Web Content Cooperatively. arXiv:2510.11438 (preprint).',
    url: 'https://arxiv.org/abs/2510.11438',
  },
  yu2026: {
    id: 'yu-2026-geo-sfe',
    citation:
      'Yu, J., Yang, M., Ding, Y., & Sato, H. (2026). Structural Feature Engineering for Generative Engine Optimization: How Content Structure Shapes Citation Behavior. arXiv:2603.29979 (preprint).',
    url: 'https://arxiv.org/abs/2603.29979',
  },
} satisfies Record<string, Work>;

const cite = (work: Work, claim: string): SourceRef => ({ ...work, claim });

// Shared claims, worded once so every check that leans on them says the same thing.
const FORMATTING_NULL = cite(
  WORKS.vishwakarma2026,
  'In 252,000 controlled trials across six LLMs, where two otherwise matched product pages competed for the first citation, formatting-only differences (dense paragraphs versus organized sections, scattered versus grouped information) had no consistent effect.',
);
const STRUCTURE_SURVEY = cite(
  WORKS.martinez2026,
  'The survey rates document structure as "moderate and heterogeneous" support with distinct effects at each pipeline stage, rates formatting alone as generalizing poorly, and advises testing headings, tables and fields "without assuming the direction of effect".',
);

/** Evidence behind each check, keyed in CHECK_IDS order. */
export const EVIDENCE: Record<CheckId, Evidence> = {
  'standalone-paragraphs': {
    grade: 'untested',
    summary:
      'No study we opened tests whether paragraphs that make sense on their own get cited more. The check rests on how these systems work: many split a page into passages and pick passages one at a time, so a paragraph that opens with "This" or "It" can lose its meaning once lifted out.',
    sources: [
      cite(
        WORKS.kim2026,
        'Describes generative search systems as chunking documents and retrieving them at the passage level, and builds its benchmark pipeline that way. This is how the systems work, not a test of the check.',
      ),
      cite(
        WORKS.zhang2026,
        'Proposes, as a hypothesis for future testing, that pages are most useful to AI answers when they have "paragraphs that each carry a distinct claim". The study is observational and makes no causal claim.',
      ),
    ],
  },
  'question-headings': {
    grade: 'mixed',
    summary:
      'No controlled study we opened tests question-style headings, and the closest evidence does not favour them. Across three AI search platforms, cited pages in Q&A format shaped answers slightly less than other pages (about 6% lower), and a controlled study found that formatting-only changes made little difference to which page was cited.',
    sources: [
      cite(
        WORKS.zhang2026,
        'Across 602 prompts on ChatGPT, Google AI Overview/Gemini and Perplexity, cited pages in Q&A format had a mean influence score of 0.0947 versus 0.1005 for other pages (5.74% lower). Observational: it shows an association, not a cause.',
      ),
      FORMATTING_NULL,
      STRUCTURE_SURVEY,
    ],
  },
  lists: {
    grade: 'mixed',
    summary:
      'Pages that shape AI answers the most tend to have more lists, but a controlled test of formatting alone found no effect. The list link may come from those pages being better overall, so use a list when the content really is a set of items or steps.',
    sources: [
      cite(
        WORKS.zhang2026,
        'Pages in the top quarter by influence on AI answers had a list density of 0.428 versus 0.048 for the bottom quarter (and 10.59 versus 0.85 headings). Observational: the authors note it cannot show whether structure causes influence.',
      ),
      FORMATTING_NULL,
      cite(
        WORKS.yu2026,
        'Restructuring 200 articles (headings, chunking, lists, tables and emphasis together) raised citation rate from 45.0% to 52.8% across six engines. The gain is for the whole bundle; lists were not tested on their own, and the work is a preprint.',
      ),
    ],
  },
  statistics: {
    grade: 'mixed',
    summary:
      "Adding statistics raised visibility in the original GEO experiment, where the page was already one of five sources given to the model, but C-SEO Bench found that adding statistics lowered a page's citation rank in 19 of 24 settings. Pages that contain real numbers are used more in AI answers, so aim for relevant, checkable figures rather than more numbers.",
    sources: [
      cite(
        WORKS.aggarwal2024,
        "With the top five Google results given to GPT-3.5-turbo and one source rewritten by an LLM, Statistics Addition raised that source's position-adjusted word count from 19.3 to 25.2 on GEO-bench.",
      ),
      cite(
        WORKS.puerto2025,
        '"The Statistics method decreases rankings in 19 out of 24 evaluated settings." The paper does not say how the 24 settings divide across its domains and engine models. In the main experiment only 3 of 54 method and domain cases showed a significant gain for any rewrite, none in question answering.',
      ),
      cite(
        WORKS.zhang2026,
        'Cited pages that contain numbers or statistics had a 61.55% higher mean influence score on AI answers than pages without. Observational.',
      ),
      cite(
        WORKS.martinez2026,
        'Warns that a fabricated statistic may increase reuse while degrading quality: "the criterion is therefore not to \'add numbers,\' but to provide relevant, verifiable, dated, and properly attributed evidence."',
      ),
    ],
  },
  tables: {
    grade: 'untested',
    summary:
      'No study we opened tests tables on their own. Comparison content, which tables often carry, was linked to more citations and more use in answers, while formatting-only changes showed little effect, so use a table to present a real comparison rather than to raise a score.',
    sources: [
      cite(
        WORKS.vishwakarma2026,
        'Pages without comparisons to alternatives were cited first less often (significant in at least four of six models), while formatting-only differences had no consistent effect. Tables were not tested as such.',
      ),
      cite(
        WORKS.zhang2026,
        'Cited pages with comparison content had a 55.28% higher mean influence score. Observational; the paper reports no result for tables.',
      ),
      STRUCTURE_SURVEY,
    ],
  },
  'expert-quotes': {
    grade: 'mixed',
    summary:
      'Adding quotations gave the largest gain in the original GEO experiment, the source of the popular "up to 40%" figure, but C-SEO Bench found no significant gain from added quotes when it measured citation rank. That 40% is a bigger share of answer text in one fixed five-source setup, not more clicks or a better chance of being found.',
    sources: [
      cite(
        WORKS.aggarwal2024,
        'Quotation Addition was the best single rewrite: position-adjusted word count 27.2 versus 19.3 at baseline, with the top five Google results in the prompt and GPT-3.5-turbo writing the answer.',
      ),
      cite(
        WORKS.martinez2026,
        'The "up to 40%" figure is the rise from 19.3 to 27.2 for Quotation Addition (about 41% relative) for a source already in the prompt. It does not mean 40% more clicks or retrieval, and the survey rejects "GEO increases visibility by 40%" as a general claim.',
      ),
      cite(
        WORKS.puerto2025,
        'In the main experiment the Quotes rewrite produced no significant ranking gain: the only significant gains (3 of 54 method and domain cases) came from an added summary and a combined rewrite, and no rewrite helped in question answering.',
      ),
    ],
  },
  'cited-sources': {
    grade: 'mixed',
    summary:
      'Adding citations to credible sources helped in the original GEO experiment, especially for lower-ranked pages, but later tests found little or no gain from adding references alone. Claims backed by concrete evidence did win citations in a controlled study, so link sources where they support a specific claim.',
    sources: [
      cite(
        WORKS.aggarwal2024,
        'Cite Sources raised position-adjusted word count from 19.3 to 24.6. When all five sources were rewritten, the fifth-ranked source gained 115.1% while the top-ranked one lost 30.3%.',
      ),
      cite(
        WORKS.puerto2025,
        'In the main experiment the Citations rewrite (adding references) produced no significant ranking gain; only an added summary and a combined rewrite did, in 3 of 54 method and domain cases.',
      ),
      cite(
        WORKS.wan2024,
        'In counterfactual edits, adding scientific references had a neutral or negative effect on how often models sided with a page, while edits that made the page more relevant to the question helped substantially.',
      ),
      cite(
        WORKS.vishwakarma2026,
        'Claims backed by evidence such as tests or certifications beat the same claims without it for the first citation, significant in at least four of six models.',
      ),
    ],
  },
  'direct-answer-lead': {
    grade: 'mixed',
    summary:
      'Some studies found that answering the question at the top helps, but the gains were narrow: an added top-of-page summary helped in only two product domains and made no difference for question answering or for one of the engine models. All of the evidence is indirect (case studies, an added summary, rules learned from engines), so treat this check as a sensible habit rather than a proven lever.',
    sources: [
      cite(
        WORKS.kim2026,
        'In a full retrieve, rerank and generate pipeline, case studies showed that placing the direct answer in early paragraphs improved reranking position, while restructuring that pushed the answer later caused significant rank drops even when the answer stayed in the page. In its shopping domain, every rewrite the benchmark tested lowered citation.',
      ),
      cite(
        WORKS.puerto2025,
        'A short markdown summary added at the top of the page (LLM guidance) was one of only two rewrites with a significant ranking gain, in the retail and video games domains; no rewrite was significant for question answering or for the Haiku 3.5 engine model.',
      ),
      cite(
        WORKS.wan2024,
        'Starting a page with "The following text is about the question: [question]" substantially raised how often models sided with it in counterfactual tests.',
      ),
      cite(
        WORKS.wu2025,
        'Preference rules extracted for Gemini, GPT and Claude engines all included "Conclusion First": state the key conclusion at the beginning of the document. Preprint.',
      ),
    ],
  },
  'question-coverage': {
    grade: 'mixed',
    summary:
      "Relevance to the question is the most repeatable finding in the studies we opened: in controlled tests, edits that made a page address the question more directly made models use it more. This check measures a narrow stand-in for that (the question's key words in a short opening sentence), and in the largest controlled study, pages missing the question's terms lost the first citation in only four of six models. Answer the questions your readers really ask, in plain words, and do not repeat key words for their own sake.",
    sources: [
      cite(
        WORKS.wan2024,
        'Edits that made a page more relevant to the question, such as adding one sentence that makes its stance on the question obvious or prefixing it with the question, had a substantial positive effect on how often models sided with it, while stylistic edits had a neutral or negative effect.',
      ),
      cite(
        WORKS.vishwakarma2026,
        'Pages that lacked query terms present in the competing page lost the first citation, significant in four of six models (Kimi K2, GPT-5 Nano, GPT-5 Mini, GPT-5.2) but not in Gemini 2.5 Flash or Claude 3.5 Sonnet. Shopping-style product pages, two sources per trial.',
      ),
      cite(
        WORKS.kim2026,
        "Reranking case studies: adding content that directly addresses the query's informational need, and placing the answer early, raised rank. Rewrites that mention query terms without meaningfully addressing the question did well at retrieval but lost at reranking and generation.",
      ),
      cite(
        WORKS.martinez2026,
        'Rates query-document relevance "strong in controlled settings", under the condition "well-defined intent; no fabrication", and reads it as: "explicitly address genuine information needs".',
      ),
    ],
  },
  comparisons: {
    grade: 'mixed',
    summary:
      'In a controlled study, product pages with no comparison to alternatives lost the first citation more often, but the effect was significant in only four of six models. An observational study found that pages with comparison content shaped AI answers more. No study tests comparison wording on its own, so compare options where readers really choose between them, with real differences, and skip it where they do not.',
    sources: [
      cite(
        WORKS.vishwakarma2026,
        'Pages with a comparison to alternative products beat the same pages without one for the first citation, with odds ratios of 7.45 (Gemini 2.5 Flash), 4.55 (Claude 3.5 Sonnet), 4.72 (Kimi K2) and 2.14 (GPT-5 Nano), all significant; 1.78 (GPT-5 Mini) and 1.61 (GPT-5.2) were not significant.',
      ),
      cite(
        WORKS.zhang2026,
        'Cited pages with comparison content had a 55.28% higher mean influence score (0.1389 versus 0.0894), and comparison was the second most influential semantic role. Observational: the authors list "adding comparison sections will increase future absorption" as not established.',
      ),
      cite(
        WORKS.martinez2026,
        'Rates extractable evidence, "verifiable figures, definitions, and comparisons", as "moderate to strong" support, under the condition of "compatible truthfulness, attribution, and intent".',
      ),
    ],
  },
};
