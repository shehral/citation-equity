import type { EngineAdapter } from '../types';

/**
 * An engine that finds its own sources (for example a Gemini model with Google Search grounding)
 * instead of answering from the pack's fixed documents. Such an engine changes what is measured:
 * the draft can only be cited if the engine retrieves the published page, so `runBench`'s
 * retrieve-shuffle-prompt loop does not apply. Live runs use the `LiveEngine` interface and
 * `runLive` (`@citation-equity/bench/node`, `ce live`) instead, which record the returned sources.
 */
export interface LiveEngineAdapter extends EngineAdapter {
  /** Marks adapters whose answers cite sources the engine retrieved itself, not the pack's. */
  readonly retrievesOwnSources: true;
}
