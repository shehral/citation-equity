# Roadmap

What comes next, roughly in order. Nothing here is promised by a date.

## Next

- **Content or name? in the app.** A panel that runs the author's page against a competitor's on the local model with the site shown, hidden and swapped, and says how much of the gap is the name and how much the text. The bench's name test building blocks (`name-test.ts`) are in place; the panel, its test packs with real URLs and its copy are not.
- **A calibrated "local model" preset.** A third weight preset fitted to what the bench measures (experiment E2b): which checks, if any, predict whether a local model cites a draft across the C-SEO Bench questions, with held-out validation. It stays labeled as fitted to a local model, never as a prediction for live engines, and the sensitivity test with larger open models ([experiments/RESULTS_sensitivity.md](../experiments/RESULTS_sensitivity.md)) found only small shifts, so fitting one needs a new pre-registered design first.
- **A local-versus-live agreement report.** For the same draft and questions, set what the bench says (cited or not, and the draft's share, on a local model) beside what `ce live` measures on Gemini with Google Search, question by question, and report how often the two agree. It would show how far the local bench can stand in for a live engine, without ever tuning the checks to either.
- **A WYSIWYG editor.** Milkdown or MDXEditor in place of the Markdown source editor, keeping suggestion anchors exact (the reason the first build edits the source).
- **Chunk-level retrieval.** The bench retrieves whole documents today. Splitting pages into passages, as most answer engines do, would test whether a single paragraph of the draft can win on its own.
- **A user study.** Whether suggest-never-rewrite, compared with automatic rewriting, changes authors' sense of control, trust and the quality of their pages. It needs IRB approval first; the workspace logs nothing about its users until then.
- **More languages.** The checks, the sentence rules and the question templates are English only.

## Done (no longer on the roadmap)

- **Site sizes and the stage funnel:** each site AI answers cite is labelled big, mid or small by a Tranco list the author loads (in the app and with `ce sources --tranco`), and Test it says whether a draft loses mostly at the search step or at the answer.
- **Gemini grounded adapter:** `ce live --engine gemini` asks Gemini with Google Search and records whether its sources include the target page.
- **Real signals:** `ce signals logs` (AI crawler hits and AI assistant referrals in an access log) and `ce signals bing` (Bing Webmaster Tools AI Performance export); `ce questions` and the workspace import real queries from Search Console and Bing.
- **Site readiness:** `/site` and `ce site`, shown as blockers and notes.
- **Off-page report:** `/off-page` and `ce sources`.
- **Two more checks:** target questions answered and explicit comparisons.
- **Your reader's words up top:** the query-wording check our own test (E1) proposed, added as advice only, with a guard against stuffing words in.

## Open items that need a real account

- The Gemini default model id, seeding with the Google Search tool, and its redirect behaviour are tested only against recorded responses; they need a run with a real Gemini API key.
- The Bing AI Performance and Search Console readers match column names that the vendors do not publish. A real export from each would confirm them.
