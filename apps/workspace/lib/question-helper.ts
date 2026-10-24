import { type EngineAdapter, fanOutQuestions, OllamaAdapter } from '@citation-equity/bench';
import { questionContext } from '@citation-equity/engine';
import { MAX_QUESTIONS, type WorkspaceQuestion } from './questions';

/**
 * Asks the local model (Ollama on localhost, only when the author clicks) for
 * questions readers might ask. Only the draft's title and first paragraph are sent.
 */
export function suggestWithLocalModel(
  markdown: string,
  model: string,
  adapter: EngineAdapter = new OllamaAdapter(),
): Promise<WorkspaceQuestion[]> {
  return fanOutQuestions(questionContext(markdown), adapter, { model, max: MAX_QUESTIONS });
}
