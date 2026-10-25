import type { EvidenceGrade } from '@citation-equity/engine';
import { GRADE_WORDS } from '@/lib/glossary';
import { cn } from '@/lib/utils';

/** Filled pips per grade: strong 4, moderate 3, mixed 2, untested 0. */
const FILLED: Record<EvidenceGrade, number> = { strong: 4, moderate: 3, mixed: 2, untested: 0 };

const PIP_COLOR: Record<EvidenceGrade, string> = {
  strong: 'bg-grade-strong border-grade-strong',
  moderate: 'bg-grade-moderate border-grade-moderate',
  mixed: 'bg-grade-mixed border-grade-mixed',
  untested: 'border-grade-untested',
};

/** Four pips in the grade colour, then the word in readable ink (the hues are for marks only). */
function Pips({ grade }: { grade: EvidenceGrade }) {
  return (
    <span aria-hidden="true" className="inline-flex gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            'size-1.5 rounded-full border',
            i < FILLED[grade] ? PIP_COLOR[grade] : 'border-dashed border-grade-untested',
          )}
        />
      ))}
    </span>
  );
}

/**
 * The one evidence grade label: four pips and the grade word, as quiet text. Only /research shows
 * grades; the working screens show at most a "Helps" or "Not scored" chip (CheckChip). No hooks,
 * so server pages render it as is.
 */
export function GradeLabel({ grade, className }: { grade: EvidenceGrade; className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5 text-ink-soft text-xs', className)}
    >
      <Pips grade={grade} />
      <span>{GRADE_WORDS[grade]}</span>
    </span>
  );
}
