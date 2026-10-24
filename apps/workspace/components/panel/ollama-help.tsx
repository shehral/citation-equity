'use client';

import { DEFAULT_OLLAMA_HOST } from '@citation-equity/bench';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** This page's origin, which OLLAMA_ORIGINS must allow. Rendered only in the browser after a click. */
function siteOrigin(): string {
  return typeof window === 'undefined' ? '<this site>' : window.location.origin;
}

export function Command({ children }: { children: ReactNode }) {
  return (
    <pre className="mt-1 overflow-x-auto whitespace-pre rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}

const linkClass =
  'rounded-sm underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

/**
 * How to get a local model this page may call. A browser TypeError can mean
 * Ollama is not running or that it refuses this site's origin (CORS); starting
 * it with OLLAMA_ORIGINS set fixes both.
 */
export function OllamaInstructions({ model, className }: { model: string; className?: string }) {
  return (
    <ol className={cn('list-decimal space-y-2 pl-5 text-sm', className)}>
      <li>
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noreferrer"
          className={linkClass}
        >
          Install Ollama
        </a>{' '}
        (free; it runs models on your own computer).
      </li>
      <li>
        Start it so this site may call it. If the Ollama app is already running, quit it first, so
        this server can use port 11434.
        <Command>{`OLLAMA_ORIGINS=${siteOrigin()} ollama serve`}</Command>
      </li>
      <li>
        In another terminal, download the model:
        <Command>{`ollama pull ${model}`}</Command>
      </li>
    </ol>
  );
}

/** Why nothing answered: Ollama is down, or it blocks this site. */
export function UnreachableNote() {
  return (
    <p className="text-sm">
      No local model answered at {DEFAULT_OLLAMA_HOST}. Either Ollama is not running, or it is
      running but blocks requests from this site (the browser's CORS rule). Starting it as below
      fixes both.
    </p>
  );
}

/** Ollama answers but does not have the model. */
export function ModelMissingNote({ model }: { model: string }) {
  return (
    <div className="text-sm">
      <p>Ollama is running, but the model {model} is not installed. Download it with:</p>
      <Command>{`ollama pull ${model}`}</Command>
    </div>
  );
}
