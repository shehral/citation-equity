// @vitest-environment node
// The colour tokens in app/globals.css meet WCAG AA in both themes: 4.5:1 for text pairs, 3:1
// for focus rings and graphical marks (grade dots, the draft's underline).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');

/** The custom properties declared in the first block that starts with `selector {`. */
function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = CSS.slice(CSS.indexOf('{', start) + 1, CSS.indexOf('\n}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const LIGHT = block(':root');
const DARK = { ...LIGHT, ...block('.dark') };

/** An opaque oklch() token as linear-light relative luminance (CSS Color 4 matrices). */
function luminance(vars: Record<string, string>, name: string): number {
  let value = vars[name];
  for (let i = 0; value?.startsWith('var('); i++) {
    if (i > 5) throw new Error(`${name}: var() loop`);
    value = vars[value.slice(4, -1).trim()];
  }
  const m = value?.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (!m) throw new Error(`${name}: not an opaque oklch() value (${value})`);
  const [L, C, h] = m.slice(1).map(Number);
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const r = clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(vars: Record<string, string>, fg: string, bg: string): number {
  const [hi, lo] = [luminance(vars, fg), luminance(vars, bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['--background', '--paper', '--surface', '--sunken'];
const TEXT: [string, string][] = [
  ...SURFACES.flatMap((bg): [string, string][] => [
    ['--foreground', bg],
    ['--ink-soft', bg],
  ]),
  ['--brand-foreground', '--brand'],
  ['--brand-foreground', '--brand-hover'],
  ['--brand', '--background'],
  ['--brand', '--surface'],
  ['--brand', '--brand-soft'],
  ['--stale', '--stale-soft'],
  ['--done', '--done-soft'],
  ['--done', '--surface'],
  ['--kind-advisory', '--surface'],
  ['--destructive', '--surface'],
  ['--destructive', '--background'],
];
const GRAPHIC: [string, string][] = [
  ['--ring', '--background'],
  ['--ring', '--surface'],
  ['--mark', '--paper'],
  ['--grade-strong', '--surface'],
  ['--grade-moderate', '--surface'],
  ['--grade-mixed', '--surface'],
  ['--grade-untested', '--surface'],
  ['--score', '--score-track'],
];

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('%s theme', (_name, vars) => {
  it.each(TEXT)('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(vars, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(GRAPHIC)('mark %s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(vars, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('tokens', () => {
  it('declare every theme colour in both themes', () => {
    for (const name of ['--background', '--foreground', '--brand', '--mark-fill', '--done']) {
      expect(LIGHT[name], name).toBeDefined();
      expect(block('.dark')[name], name).toBeDefined();
    }
  });

  it('are the only place raw colours appear in the app source', () => {
    // Components use the tokens; only globals.css holds colour values.
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (['node_modules', '.next', 'out', 'generated'].includes(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) {
          const src = readFileSync(path, 'utf8');
          if (/#[0-9a-f]{3,8}\b(?![\w-])|\b(?:oklch|rgba?|hsla?)\(/i.test(src))
            offenders.push(path.slice(root.length + 1));
        }
      }
    };
    for (const dir of ['app', 'components']) walk(join(root, dir));
    expect(offenders).toEqual([]);
  });
});
