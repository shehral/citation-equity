import { type RankList, SITE_SIZE_TEXT, siteSize } from '@citation-equity/engine';

/**
 * A quiet chip with a cited site's size: big, mid or small by the loaded Tranco list, or a hosting
 * platform or Wikipedia without one. Nothing shows when the size is unknown. The rank, when the
 * site has one, is in the tooltip, not on the screen.
 */
export function SizeChip({ domain, list }: { domain: string; list: RankList | null }) {
  const label = siteSize(domain, list);
  if (label.size === 'unknown') return null;
  const title =
    label.rank !== undefined
      ? `Rank ${label.rank.toLocaleString('en-US')} on the Tranco list.`
      : label.size === 'small'
        ? 'Not in the top million sites on the Tranco list.'
        : label.size === 'platform'
          ? `Hosted on a ${label.platform} site, so its size says nothing about the writer.`
          : undefined;
  return (
    <span
      data-size-chip={label.size}
      title={title}
      className="ml-2 inline-block rounded-full bg-sunken px-2 py-0.5 align-middle font-sans text-muted-foreground text-xs"
    >
      {SITE_SIZE_TEXT[label.size]}
    </span>
  );
}
