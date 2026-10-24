'use client';

import { BookOpen, Ellipsis, ExternalLink, FileText, Info, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertDialog, DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { reloadAt } from '@/lib/base-path';
import { selectDraftSlot } from '@/lib/draft-summary';
import { REPO_URL } from '@/lib/links';
import { exampleLabel, SAMPLES } from '@/lib/samples';
import { clearAll } from '@/lib/store';
import { cn } from '@/lib/utils';
import { RESEARCH_HREF, VIEW_HREF } from '@/lib/views';

const itemClass = cn(
  'flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none',
  'data-[highlighted]:bg-sunken data-[highlighted]:text-foreground',
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-soft',
);
const separatorClass = 'my-1 h-px bg-border';

/**
 * The header's More menu: Examples, Research, About, Clear my data, GitHub.
 * Non-modal, so a dialog opened from an item (About, the Clear confirmation) takes focus cleanly.
 */
export function MoreMenu({ onAbout }: { onAbout(): void }) {
  const router = useRouter();
  const [confirmClear, setConfirmClear] = useState(false);

  function openExample(slug: string) {
    selectDraftSlot(slug);
    router.push(VIEW_HREF.draft);
  }

  function clear() {
    clearAll();
    // A view still on screen can save its state again (statuses, questions) before the page
    // unloads, so clear once more when it does. Then a full load of the home, so no component
    // keeps what was cleared.
    window.addEventListener('pagehide', clearAll, { once: true });
    reloadAt(VIEW_HREF.home);
  }

  return (
    <>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="More" title="More">
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className={cn(
              'z-50 min-w-52 rounded-lg border bg-popover p-1 text-popover-foreground shadow-pop',
              'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0',
              'motion-safe:data-[state=open]:zoom-in-95',
            )}
          >
            <DropdownMenu.Group>
              <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 font-medium text-ink-soft text-xs">
                Examples
              </DropdownMenu.Label>
              {SAMPLES.map((sample) => (
                <DropdownMenu.Item
                  key={sample.slug}
                  className={itemClass}
                  onSelect={() => openExample(sample.slug)}
                >
                  <FileText aria-hidden="true" strokeWidth={1.75} />
                  {exampleLabel(sample)}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
            <DropdownMenu.Separator className={separatorClass} />
            <DropdownMenu.Item className={itemClass} asChild>
              <Link href={RESEARCH_HREF} prefetch={false}>
                <BookOpen aria-hidden="true" strokeWidth={1.75} />
                Research
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} onSelect={onAbout}>
              <Info aria-hidden="true" strokeWidth={1.75} />
              About
            </DropdownMenu.Item>
            <DropdownMenu.Item className={itemClass} onSelect={() => setConfirmClear(true)}>
              <Trash2 aria-hidden="true" strokeWidth={1.75} />
              Clear my data
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={separatorClass} />
            <DropdownMenu.Item className={itemClass} asChild>
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" strokeWidth={1.75} />
                GitHub
              </a>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <AlertDialog.Root open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
          <AlertDialog.Content
            className={cn(
              'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2',
              'gap-4 rounded-xl border bg-surface p-6 shadow-pop outline-none sm:max-w-sm',
            )}
          >
            <AlertDialog.Title className="font-semibold text-base">
              Clear my data?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-ink-soft text-sm leading-relaxed">
              Removes your draft, results and settings from this browser.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2">
              <AlertDialog.Cancel className={buttonVariants({ variant: 'outline' })}>
                Cancel
              </AlertDialog.Cancel>
              <AlertDialog.Action className={buttonVariants()} onClick={clear}>
                Clear
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
