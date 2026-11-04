import { analyze, quickEdit, rankNotes, TEST_LABEL_TEXT } from '@citation-equity/engine';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LabelChip } from '@/components/check-chip';
import { QuickEdit } from '@/components/draft/quick-edit';
import { fixCopy } from '@/lib/fix-copy';
import { getSample } from '@/lib/samples';

afterEach(cleanup);

// The espresso example's quick edit, as the engine picks it: the first ready edit among the notes.
const note = quickEdit(rankNotes(analyze(getSample('espresso-bitterness').before)));
if (note === null) throw new Error('the espresso example has no ready edit');
const { suggestion, label, editable } = note;
const copy = fixCopy(suggestion);

function renderQuickEdit(overrides: Partial<Parameters<typeof QuickEdit>[0]> = {}) {
  const actions = {
    onPreview: vi.fn(),
    onShow: vi.fn(),
    onDone: vi.fn(),
    onSkip: vi.fn(),
    onSuggestWording: vi.fn(),
  };
  render(
    <QuickEdit
      suggestion={suggestion}
      copy={copy}
      editable={editable}
      active={false}
      stale={false}
      canSuggest={false}
      chip={<LabelChip label={label} />}
      {...actions}
      {...overrides}
    />,
  );
  const region = screen.getByRole('region', { name: 'Quick edit' });
  return { actions, region, card: within(region) };
}

async function chooseFromMenu(region: HTMLElement, item: string) {
  const trigger = within(region).getByRole('button', { name: /^More actions/ });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const menu = await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem', { name: item }));
}

describe('QuickEdit', () => {
  it('is a section named by its heading, holding one fix card numbered 1', () => {
    const { region, card } = renderQuickEdit();
    expect(region.tagName).toBe('SECTION');
    expect(card.getByRole('heading', { level: 3, name: 'Quick edit' })).toBeTruthy();
    const fixes = card.getAllByRole('article');
    expect(fixes).toHaveLength(1);
    // The fix's own title, with ids kept apart from the same fix in its notes group.
    const title = card.getByRole('heading', { name: copy.title });
    expect(title.id).toBe(`quick-${suggestion.id}-title`);
    expect(fixes[0]?.getAttribute('aria-labelledby')).toBe(title.id);
    expect(fixes[0]?.textContent).toMatch(/^1/);
  });

  it("shows the espresso example's heading edit with its label chip after the title", () => {
    const { card } = renderQuickEdit();
    expect(copy.title).toBe('Add "?" or reword it');
    const chip = card.getByText(TEST_LABEL_TEXT[label]);
    expect(chip.getAttribute('data-label-chip')).toBe(label);
    const title = card.getByRole('heading', { name: copy.title });
    expect(title.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The chip sits beside the title, not inside it, so the title keeps its name.
    expect(title.contains(chip)).toBe(false);
  });

  it('opens the preview from Preview; Apply is not on the card', () => {
    const { actions, card } = renderQuickEdit();
    fireEvent.click(card.getByRole('button', { name: 'Preview' }));
    expect(actions.onPreview).toHaveBeenCalledWith(suggestion);
    expect(card.queryByRole('button', { name: /Apply/ })).toBeNull();
  });

  it.each([
    ['Done', 'onDone'],
    ['Skip', 'onSkip'],
    ['Show me', 'onShow'],
  ] as const)('%s from the overflow menu', async (item, handler) => {
    const { actions, region } = renderQuickEdit();
    await chooseFromMenu(region, item);
    expect(actions[handler]).toHaveBeenCalledWith(suggestion);
  });

  it('says when the edit is out of date', () => {
    const { card } = renderQuickEdit({ stale: true });
    expect(card.getByText('Out of date: the text changed.')).toBeTruthy();
  });
});
