// Plain module (no 'use client'): the root layout, a Server Component, inlines
// THEME_SCRIPT, and the client-side theme toggle reads THEME_KEY. A Server
// Component that imports a value from a 'use client' file gets a client
// reference instead of the value.

export const THEME_KEY = 'ce:v1:theme';

/**
 * Runs in <head> before the first paint: the saved choice, else the system
 * setting. Kept as a string so the layout can inline it.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;
