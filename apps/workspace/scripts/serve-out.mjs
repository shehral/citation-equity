// Serves the static export in out/ on 127.0.0.1, the way a static host would:
// /research/ is out/research/index.html, / is out/index.html. The Playwright
// suite (playwright.config.ts) serves both exports with it, so every spec runs
// against the built site, not `next dev`. No dependencies; local use only.
//
// BASE_PATH (say /citation-equity) serves the folder under that path, as GitHub
// Pages serves a project site: /citation-equity redirects to /citation-equity/,
// and any path outside it answers 404.
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// OUT_DIR overrides the folder (for tests); the default is the app's out/.
const ROOT = `${normalize(process.env.OUT_DIR ?? fileURLToPath(new URL('../out/', import.meta.url))).replace(/[/\\]+$/, '')}${sep}`;
// An unusual port, so a run never mistakes another local server (Vite preview's 4173, say) for this one.
const PORT = Number(process.env.PORT ?? 47391);
const HOST = '127.0.0.1';
const BASE_PATH = (process.env.BASE_PATH ?? '').replace(/\/+$/, '');
if (BASE_PATH !== '' && !/^\/[\w.-]+(\/[\w.-]+)*$/.test(BASE_PATH)) {
  console.error(`serve-out: BASE_PATH must look like /citation-equity, not "${BASE_PATH}".`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The file under out/ for a URL path, or null. Never leaves out/. */
async function resolve(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // a malformed %-escape names no file
  }
  const clean = normalize(decoded).replace(/^([/\\])+/, '');
  const base = join(ROOT, clean);
  if (!base.startsWith(ROOT) && `${base}${sep}` !== ROOT) return null;
  for (const candidate of [base, `${base}.html`, join(base, 'index.html')]) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

if (!existsSync(join(ROOT, 'index.html'))) {
  const build = BASE_PATH === '' ? 'pnpm build' : 'pnpm build:pages';
  console.error(`serve-out: ${join(ROOT, 'index.html')} is missing. Run \`${build}\` first.`);
  process.exit(1);
}

/** Streams `file`; a read error (say, a file removed during a rebuild) answers 500, never crashes. */
function send(res, status, file) {
  const stream = createReadStream(file);
  stream.on('open', () => {
    res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    stream.pipe(res);
  });
  stream.on('error', (err) => {
    console.error(`serve-out: cannot read ${file}: ${err.message}`);
    if (res.headersSent) res.destroy(err);
    else res.writeHead(500, { 'content-type': TYPES['.txt'] }).end('Read error');
  });
}

/** The path inside the export for a request path, or null when it is outside BASE_PATH. */
function insideBase(path) {
  if (BASE_PATH === '') return path;
  return path.startsWith(`${BASE_PATH}/`) ? path.slice(BASE_PATH.length) : null;
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
  if (BASE_PATH !== '' && path === BASE_PATH) {
    res.writeHead(301, { location: `${BASE_PATH}/` }).end();
    return;
  }
  const inner = insideBase(path);
  const file = inner === null ? null : await resolve(inner);
  const status = file ? 200 : 404;
  const body = file ?? (await resolve('/404'));
  if (body === null) {
    res.writeHead(404, { 'content-type': TYPES['.txt'] }).end('Not found');
    return;
  }
  send(res, status, body);
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT} at http://${HOST}:${PORT}${BASE_PATH}/`);
});
