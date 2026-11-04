'use client';

import { type AnalysisResult, analyze } from '@citation-equity/engine';
import { useCallback, useEffect, useRef, useState } from 'react';

export const ANALYSIS_DELAY_MS = 250;

const NO_QUESTIONS: string[] = [];

/** Both question checks measure the listed questions, so the card and the notes agree. */
const analyzeWith = (markdown: string, questions: string[]) => analyze(markdown, { questions });

/**
 * Analyzes the draft 250 ms after the last change to it or to its questions (the first draft at
 * once). The questions feed both question checks and the question report, so every line of the
 * Questions covered card and every note measure the same listed set. `refresh()` analyzes the
 * latest text immediately, for example after a stale Apply.
 */
export function useAnalysis(
  markdown: string,
  questions: string[] = NO_QUESTIONS,
): { result: AnalysisResult | null; pending: boolean; refresh: () => void } {
  const latest = useRef(markdown);
  latest.current = markdown;
  // Compared by content, so a new array with the same questions does not re-run the analysis.
  const questionsKey = JSON.stringify(questions);
  const latestQuestions = useRef(questions);
  latestQuestions.current = questions;

  const [analysis, setAnalysis] = useState<{
    source: string;
    questionsKey: string;
    result: AnalysisResult;
  }>(() => ({ source: markdown, questionsKey, result: analyzeWith(markdown, questions) }));

  const refresh = useCallback(() => {
    const source = latest.current;
    const qs = latestQuestions.current;
    setAnalysis({ source, questionsKey: JSON.stringify(qs), result: analyzeWith(source, qs) });
  }, []);

  useEffect(() => {
    if (markdown === analysis.source && questionsKey === analysis.questionsKey) return;
    const timer = setTimeout(refresh, ANALYSIS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [markdown, questionsKey, analysis.source, analysis.questionsKey, refresh]);

  const pending = markdown !== analysis.source || questionsKey !== analysis.questionsKey;
  return { result: analysis.result, pending, refresh };
}
