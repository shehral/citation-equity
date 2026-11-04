import { TEST_LABEL_TEXT, type TestLabel } from '@citation-equity/engine';
import { cn } from '@/lib/utils';

/** Each label's tone: done for a gain, stale for a smaller gain or a loss, quiet for the rest. */
const LABEL_TONE: Record<TestLabel, string> = {
  helped: 'bg-done-soft text-done',
  'may-help-less': 'bg-stale-soft text-stale',
  hurt: 'bg-stale-soft text-stale',
  'no-effect': 'border bg-surface text-ink-soft',
  unclear: 'border bg-surface text-ink-soft',
  'not-tested': 'border bg-surface text-ink-soft',
};

/**
 * What our own tests found for a check or a question line, as the engine words it, with an
 * optional one-sentence tooltip (`labelTooltip`). `data-label-chip` marks it: a label phrase may
 * stand on a working screen only inside this chip.
 */
export function LabelChip({
  label,
  tooltip,
  className,
}: {
  label: TestLabel;
  tooltip?: string;
  className?: string;
}) {
  return (
    <span
      data-label-chip={label}
      title={tooltip}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs',
        LABEL_TONE[label],
        className,
      )}
    >
      {TEST_LABEL_TEXT[label]}
    </span>
  );
}
