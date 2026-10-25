'use client';

import {
  type AnalysisResult,
  analyze,
  CHECK_IDS,
  type PresetId,
  scoreChecks,
  type Weights,
} from '@citation-equity/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** The workspace's preset choice: one of the engine presets, or the author's own weights. */
export type ActivePreset = PresetId | 'custom';

export const ANALYSIS_DELAY_MS = 250;

/** Weights from the sliders, made safe for the scorer: non-finite or negative becomes 0. */
export function sanitizeWeights(weights: Weights): Weights {
  return Object.fromEntries(
    CHECK_IDS.map((id) => {
      const w = weights[id];
      return [id, Number.isFinite(w) && w > 0 ? w : 0];
    }),
  ) as Weights;
}

const NO_QUESTIONS: string[] = [];

/**
 * Analyzes the draft 250 ms after the last change to it or to the target
 * questions (the first draft at once). `scores.custom` is filled only for the
 * custom preset; moving a weight rescores the last analysis without parsing
 * the draft again. `refresh()` analyzes the latest text immediately, for
 * example after a stale Apply.
 */
export function useAnalysis(
  markdown: string,
  preset: ActivePreset,
  weights: Weights,
  questions: string[] = NO_QUESTIONS,
  authorQuestions: string[] = NO_QUESTIONS,
): { result: AnalysisResult | null; pending: boolean; refresh: () => void } {
  const safeWeights = useMemo(() => sanitizeWeights(weights), [weights]);
  const weightsRef = useRef(safeWeights);
  weightsRef.current = safeWeights;
  const latest = useRef(markdown);
  latest.current = markdown;
  // Compared by content, so a new array with the same questions does not re-run the analysis.
  const questionsKey = JSON.stringify([questions, authorQuestions]);
  const latestQuestions = useRef({ questions, authorQuestions });
  latestQuestions.current = { questions, authorQuestions };

  const [analysis, setAnalysis] = useState<{
    source: string;
    questionsKey: string;
    result: AnalysisResult;
  }>(() => ({
    source: markdown,
    questionsKey,
    result: analyze(markdown, { weights: safeWeights, questions, authorQuestions }),
  }));

  const refresh = useCallback(() => {
    const source = latest.current;
    const qs = latestQuestions.current;
    setAnalysis({
      source,
      questionsKey: JSON.stringify([qs.questions, qs.authorQuestions]),
      result: analyze(source, { weights: weightsRef.current, ...qs }),
    });
  }, []);

  useEffect(() => {
    if (markdown === analysis.source && questionsKey === analysis.questionsKey) return;
    const timer = setTimeout(refresh, ANALYSIS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [markdown, questionsKey, analysis.source, analysis.questionsKey, refresh]);

  const result = useMemo(() => {
    const r = analysis.result;
    const custom = preset === 'custom' ? scoreChecks(r.checks, safeWeights) : null;
    return { ...r, scores: { ...r.scores, custom } };
  }, [analysis.result, preset, safeWeights]);

  const pending = markdown !== analysis.source || questionsKey !== analysis.questionsKey;
  return { result, pending, refresh };
}
