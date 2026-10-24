// Browser-safe entry. Node-only code lives under src/node and ships as `@citation-equity/bench/node`.
export { AdapterUnavailableError, ModelMissingError } from './adapters/errors';
export type { LiveEngineAdapter } from './adapters/live';
export { DEFAULT_OLLAMA_HOST, OllamaAdapter, probeOllama } from './adapters/ollama';
export { DEFAULT_OPENAI_BASE_URL, OpenAICompatibleAdapter } from './adapters/openai-compatible';
export { RecordedAdapter, RecordingAdapter, recordingKey } from './adapters/recorded';
export { CAVEAT, caveatFor, isLocalUrl, LIVE_CAVEAT, REMOTE_CAVEAT } from './caveat';
export { AI_CRAWLERS, type CrawlerInfo, type CrawlerPurpose } from './crawlers';
export {
  chanceLevel,
  meanInterval,
  minSignFlipP,
  pawcShares,
  signFlipP,
  t975,
  wilson,
} from './metrics';
export { PackError, validatePack } from './pack';
export { competitorProfile, countStatistics, type DocProfile, profileDocument } from './profile';
export { buildPrompt, type ParsedAnswer, parseAnswer, stripReasoning } from './prompt';
export { fanOutPrompt, fanOutQuestions } from './questions-llm';
export { retrieve } from './retrieve';
export { mulberry32, shuffle } from './rng';
export { compareReports, runBench } from './run';
export * from './types';
