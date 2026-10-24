'use client';

import type { Suggestion } from '@citation-equity/engine';
import { markdown as markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { applySuggestion, sectionAround } from '@/lib/apply';
import { STALE_MESSAGE } from '../panel/suggestion-card';
import { editorTheme } from './editor-theme';

interface MergePreviewProps {
  markdown: string;
  suggestion: Suggestion | null;
  /** A line shown above the comparison, e.g. who proposed the wording. */
  note?: string;
  onApply(s: Suggestion): void;
  onClose(): void;
}

const readOnly = [
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
  EditorView.lineWrapping,
  markdownLanguage(),
  editorTheme,
];

/** Side-by-side before/after of the section an edit suggestion changes. Applies only on click. */
export function MergePreview({ markdown, suggestion, note, onApply, onClose }: MergePreviewProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const outcome = suggestion ? applySuggestion(markdown, suggestion) : null;
  const after = outcome?.ok ? outcome.markdown : null;

  useEffect(() => {
    if (!host || !suggestion || after === null) return;
    let cancelled = false;
    let destroy = () => {};
    const delta = after.length - markdown.length;
    const section = sectionAround(markdown, suggestion.range);
    const a = markdown.slice(section.start, section.end);
    const b = after.slice(section.start, section.end + delta);
    // @codemirror/merge loads only when a preview opens.
    import('@codemirror/merge').then(({ MergeView }) => {
      if (cancelled) return;
      const view = new MergeView({
        a: { doc: a, extensions: readOnly },
        b: { doc: b, extensions: readOnly },
        parent: host,
        gutter: true,
        highlightChanges: true,
      });
      destroy = () => view.destroy();
    });
    return () => {
      cancelled = true;
      destroy();
    };
  }, [host, suggestion, markdown, after]);

  return (
    <Dialog open={suggestion !== null} onOpenChange={(open) => open || onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{suggestion?.title ?? 'Preview change'}</DialogTitle>
          <DialogDescription>
            Left: the section now. Right: the section after this change. Nothing changes until you
            click Apply.
          </DialogDescription>
        </DialogHeader>
        {note && <p className="text-muted-foreground text-sm">{note}</p>}
        {after === null ? (
          <p
            role="status"
            className="rounded-md bg-warning px-3 py-2 text-sm text-warning-foreground"
          >
            {STALE_MESSAGE}
          </p>
        ) : (
          <section
            ref={setHost}
            aria-label="Before and after"
            className="max-h-[60vh] overflow-auto rounded-md border"
          />
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {suggestion && after !== null && (
            <Button type="button" onClick={() => onApply(suggestion)}>
              <Check aria-hidden="true" />
              Apply
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
