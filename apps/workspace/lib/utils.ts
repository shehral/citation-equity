// Adapted from shadcn-ui/ui (https://github.com/shadcn-ui/ui): the `cn` helper that `shadcn init` writes to lib/utils.ts
// (shadcn CLI 4.22.1, 2026-10-23). Copyright (c) 2023 shadcn, licensed MIT (see NOTICE).
// Unchanged apart from Biome formatting.

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
