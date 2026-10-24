// @vitest-environment node
import { type ChildProcess, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../scripts/serve-out.mjs', import.meta.url));
const dirs: string[] = [];
const children: ChildProcess[] = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'serve-out-'));
  dirs.push(dir);
  return dir;
}

function start(outDir: string, port: number, basePath?: string) {
  const child = spawn(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      OUT_DIR: outDir,
      PORT: String(port),
      ...(basePath === undefined ? {} : { BASE_PATH: basePath }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let stderr = '';
  child.stderr?.on('data', (d) => {
    stderr += String(d);
  });
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout?.on('data', (d) => {
      if (String(d).includes('Serving')) resolve();
    });
    child.on('exit', (code) => reject(new Error(`exited ${code}: ${stderr}`)));
  });
  // Awaited only by the tests that need the server up; never an unhandled rejection otherwise.
  ready.catch(() => {});
  const exited = new Promise<{ code: number | null; stderr: string }>((resolve) =>
    child.on('exit', (code) => resolve({ code, stderr })),
  );
  return { child, ready, exited };
}

afterEach(() => {
  for (const c of children.splice(0)) c.kill();
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(join(d, 'locked.html'), 0o644);
    } catch {}
    rmSync(d, { recursive: true, force: true });
  }
});

describe('serve-out', () => {
  it('exits with a message when out/index.html is missing, instead of answering Not found', async () => {
    const { exited } = start(tempDir(), 47392);
    const { code, stderr } = await exited;
    expect(code).toBe(1);
    expect(stderr).toContain('index.html is missing');
    expect(stderr).toContain('pnpm build');
  });

  it.skipIf(process.getuid?.() === 0)('answers 500 on a read error and keeps serving', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'index.html'), '<p>home</p>');
    writeFileSync(join(dir, 'locked.html'), '<p>locked</p>');
    chmodSync(join(dir, 'locked.html'), 0o000);
    const { ready } = start(dir, 47393);
    await ready;
    const locked = await fetch('http://127.0.0.1:47393/locked');
    expect(locked.status).toBe(500);
    const home = await fetch('http://127.0.0.1:47393/');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('home');
  });
  it('serves the build under BASE_PATH as GitHub Pages does, and nothing outside it', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'index.html'), '<p>home</p>');
    writeFileSync(join(dir, '404.html'), '<p>missing</p>');
    mkdirSync(join(dir, 'draft'));
    writeFileSync(join(dir, 'draft', 'index.html'), '<p>draft</p>');
    const { ready } = start(dir, 47395, '/citation-equity');
    await ready;
    const at = (path: string) => fetch(`http://127.0.0.1:47395${path}`, { redirect: 'manual' });

    const home = await at('/citation-equity/');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('home');
    const draft = await at('/citation-equity/draft/');
    expect(await draft.text()).toContain('draft');
    const bare = await at('/citation-equity');
    expect(bare.status).toBe(301);
    expect(bare.headers.get('location')).toBe('/citation-equity/');
    for (const outside of ['/', '/draft/', '/citation-equityx/']) {
      const res = await at(outside);
      expect(res.status, outside).toBe(404);
      expect(await res.text()).toContain('missing');
    }
  });

  it('names the Pages build in its message when that build is missing', async () => {
    const { exited } = start(tempDir(), 47396, '/citation-equity');
    const { code, stderr } = await exited;
    expect(code).toBe(1);
    expect(stderr).toContain('pnpm build:pages');
  });
});
