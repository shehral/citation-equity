import { CHIP_TEXT, type CheckChip as Chip } from '@/lib/glossary';
import { cn } from '@/lib/utils';

/**
 * The one small chip a check may carry on the working screens: "Helps" or "Not scored", with a
 * one-sentence tooltip. The reasons and the numbers behind it are on /research.
 */
export function CheckChip({ chip, className }: { chip: Chip | null; className?: string }) {
  if (chip === null) return null;
  const { label, title } = CHIP_TEXT[chip];
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs',
        chip === 'helps' ? 'bg-done-soft text-done' : 'border bg-surface text-ink-soft',
        className,
      )}
    >
      {label}
    </span>
  );
}
