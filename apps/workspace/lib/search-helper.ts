import {
  DEFAULT_SETTINGS,
  type EngineAdapter,
  keywordQuestions,
  OllamaAdapter,
  probeOllama,
  searchQueries,
} from '@citation-equity/bench';
import { hasModel } from './bench';

/** The model Your questions asks, the bench's default. */
export const LOCAL_MODEL = DEFAULT_SETTINGS.model;

export type LocalModelState = 'ready' | 'unreachable' | 'model-missing';

/**
 * "Connect local AI" on Your questions: asks the local Ollama (on localhost, only on the
 * click) which models it has.
 */
export async function connectLocalModel(model: string = LOCAL_MODEL): Promise<LocalModelState> {
  let found: { reachable: boolean; models: string[] };
  try {
    found = await probeOllama();
  } catch {
    found = { reachable: false, models: [] };
  }
  if (!found.reachable) return 'unreachable';
  return hasModel(found.models, model) ? 'ready' : 'model-missing';
}

/** More reader questions from the keywords; only the keywords (no volumes) are sent. */
export async function suggestFromKeywords(
  keywords: string[],
  model: string,
  adapter: EngineAdapter = new OllamaAdapter(),
): Promise<string[]> {
  return (await keywordQuestions(keywords, adapter, { model })).map((q) => q.text);
}

/** More searches behind one question; only the question is sent. */
export function suggestSearches(
  question: string,
  model: string,
  adapter: EngineAdapter = new OllamaAdapter(),
): Promise<string[]> {
  return searchQueries(question, adapter, { model });
}
