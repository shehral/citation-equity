// The Tranco list the author loaded on Who gets cited, kept in this page's memory only, like the
// pasted answers (lib/pasted.ts). A full list is a million sites, far more than browser storage
// holds, so a reload forgets it and the page asks for the file again. Nothing is downloaded by the
// app: the author picks a file they saved from tranco-list.eu, and it is read in the browser.

import {
  parseTrancoList,
  type RankList,
  TrancoListError,
  trancoIdFromFileName,
} from '@citation-equity/engine';
import { onClearAll } from './store';

export interface LoadedList {
  list: RankList;
  /** The file's name, as the author chose it. */
  fileName: string;
}

let current: LoadedList | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

/** The loaded list, or null. Stable between changes, for useSyncExternalStore. */
export const getTrancoList = (): LoadedList | null => current;

export function setTrancoList(next: LoadedList | null): void {
  current = next;
  notify();
}

export function subscribeTrancoList(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reads a list from the text of a file the author chose. The list's ID comes from the file name
 * Tranco gives ("tranco_6GWVX.csv"), when it has one. Throws an Error with a readable message
 * when the file is not a Tranco list.
 */
export function loadTrancoText(text: string, fileName: string): LoadedList {
  try {
    return { list: parseTrancoList(text, trancoIdFromFileName(fileName)), fileName };
  } catch (err) {
    if (err instanceof TrancoListError) throw new Error(err.message);
    throw err;
  }
}

/** How the page names a loaded list: "Tranco list 6GWVX, top 1,000,000 sites". */
export function listName(loaded: LoadedList): string {
  const { id, depth } = loaded.list;
  return `Tranco list ${id === '' ? loaded.fileName : id}, top ${depth.toLocaleString('en-US')} sites`;
}

onClearAll(() => setTrancoList(null));
