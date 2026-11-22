// Ephemeral static server for BrailleCraft. Serves the repo root on
// 127.0.0.1 with the same CSP the page carries. Node standard library only.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, sep, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.stl': 'model/stl',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function resolvePath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  if (!/^\/(?:[a-z0-9._-]+\/?)*$/i.test(decoded)) return null;
  const clean = normalize(decoded).replace(/^([/\\])+/, '');
  const full = resolve(join(ROOT, clean));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

export function startServer({ host = '127.0.0.1', port = 0 } = {}) {
  const server = createServer(async (req, res) => {
    const headers = {
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store'
    };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, headers).end('Method not allowed'); return;
      }
      const url = new URL(req.url, `http://${host}`);
      let full = resolvePath(url.pathname);
      if (!full) { res.writeHead(400, headers).end('Bad path'); return; }
      let info = await stat(full).catch(() => null);
      if (info?.isDirectory()) {
        full = join(full, 'index.html');
        info = await stat(full).catch(() => null);
      }
      if (!info?.isFile()) { res.writeHead(404, headers).end('Not found'); return; }
      const body = await readFile(full);
      res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': body.length });
      if (req.method === 'HEAD') res.end(); else res.end(body);
    } catch (err) {
      res.writeHead(500, headers).end('Server error');
      process.stderr.write(`serve error: ${err.message}\n`);
    }
  });
  return new Promise(res => {
    server.listen(port, host, () => {
      const { port: p } = server.address();
      res({ server, url: `http://${host}:${p}/` });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer().then(({ url }) => process.stdout.write(`BrailleCraft serving ${url}\n`));
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(0));
}
