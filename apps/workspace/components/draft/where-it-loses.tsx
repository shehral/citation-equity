import { losesAtText, stageFunnel } from '@citation-equity/bench';
import type { ReportView } from '@/lib/bench';

/**
 * Where a draft loses, stage by stage: was it among the sources the search step handed the model
 * (found), and when it was, did the answer cite it? One plain sentence says which step loses
 * more, so the author knows what to fix: words search can match, or a clearer answer. Counts
 * only, over answers with a valid citation; the run's details stay folded away.
 */
export function WhereItLoses({ report, who }: { report: ReportView; who: string }) {
  const f = stageFunnel(report);
  if (f.validRuns === 0) return null;
  const { found, citedWhenFound } = f;
  return (
    <div data-where-it-loses="" className="rounded-lg bg-sunken px-3 py-2">
      <p className="text-ink-soft text-xs">Where {who} loses</p>
      <p className="font-serif text-lg">{losesAtText(f.losesAt)}</p>
      <p className="text-ink-soft text-xs tabular-nums">
        Found for {found.k} of {found.n} answers.
        {citedWhenFound.n > 0 && ` Cited in ${citedWhenFound.k} of those ${citedWhenFound.n}.`}
      </p>
    </div>
  );
}
