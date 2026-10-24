import {
  type CheckId,
  E1_MODELS,
  EVIDENCE,
  type EvidenceGrade,
  formatE1,
  UNSCORED_CHECKS,
} from '@citation-equity/engine';
import Link from 'next/link';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  CHECK_GRADE_MEANING,
  E1_WORDS,
  GRADE_MEANING,
  GRADE_WORDS,
  UNSCORED_NOTES,
} from '@/lib/glossary';
import { cn } from '@/lib/utils';
import { RESEARCH_HREF } from '@/lib/views';

/** Filled pips per grade: strong 4, moderate 3, mixed 2, untested 0. */
const FILLED: Record<EvidenceGrade, number> = { strong: 4, moderate: 3, mixed: 2, untested: 0 };

const PIP_COLOR: Record<EvidenceGrade, string> = {
  strong: 'bg-grade-strong border-grade-strong',
  moderate: 'bg-grade-moderate border-grade-moderate',
  mixed: 'bg-grade-mixed border-grade-mixed',
  untested: 'border-grade-untested',
};

const quiet = 'inline-flex shrink-0 items-center gap-1.5 text-ink-soft text-xs';

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

/** What our own test found for the check: plain words, with the numbers for a measured check. */
function OwnTest({ checkId }: { checkId: CheckId }) {
  const { e1 } = EVIDENCE[checkId];
  return (
    <>
      <p>
        <span className="font-medium">{E1_WORDS[e1.label]}.</span>
        {e1.label === 'helps' && ` ${formatE1(e1)}; ${E1_MODELS}.`}
      </p>
      {UNSCORED_CHECKS.includes(checkId) && <p>{UNSCORED_NOTES[checkId]}</p>}
    </>
  );
}

/**
 * The one evidence grade label: four pips and the grade word. With a `checkId` it
 * is a button whose popover says what the grade means for that check and links its studies on
 * /research (the draft's check groups); without one it is quiet text (site rows, /cited and
 * /research). No hooks, so server pages render it as is.
 */
export function GradeLabel({
  grade,
  checkId,
  className,
}: {
  grade: EvidenceGrade;
  checkId?: CheckId;
  className?: string;
}) {
  const word = GRADE_WORDS[grade];
  if (checkId === undefined) {
    return (
      <span className={cn(quiet, className)}>
        <Pips grade={grade} />
        <span>{word}</span>
      </span>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            quiet,
            'rounded-full px-2 py-1 outline-none hover:bg-sunken hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring',
            className,
          )}
        >
          <Pips grade={grade} />
          {word}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="max-w-[calc(100vw-2rem)] space-y-2 rounded-lg text-sm leading-relaxed shadow-pop"
      >
        <p>
          <span className="font-medium">{word}.</span>{' '}
          {CHECK_GRADE_MEANING[checkId] ?? GRADE_MEANING[grade]}
        </p>
        <OwnTest checkId={checkId} />
        <Link
          href={`${RESEARCH_HREF}#check-${checkId}`}
          prefetch={false}
          className="inline-block rounded-sm font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          See the studies
        </Link>
      </PopoverContent>
    </Popover>
  );
}
