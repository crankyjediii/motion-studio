import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { PLUGIN_ROOT } from './util.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.glb': 'model/gltf-binary',
};
const RUNTIME = join(PLUGIN_ROOT, 'runtime');

/**
 * Local-only static server. Serves the project at `/` and the plugin runtime at `/__studio/`.
 * `api(req, res, url)` handles `/api/*`; `index` is the runtime file served at `/`.
 */
export async function serve(projectDir, { port = 0, api, index } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      if (api && url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      let path = decodeURIComponent(url.pathname);
      let root = resolve(projectDir);
      if (path === '/' && index) { root = RUNTIME; path = '/' + index; }
      else if (path.startsWith('/__studio/')) { root = RUNTIME; path = path.slice('/__studio'.length); }
      const file = resolve(root, '.' + path);
      if (file !== root && !file.startsWith(root + sep)) return end(res, 403, 'Forbidden');
      const st = await stat(file).catch(() => null);
      if (!st?.isFile()) return end(res, 404, 'Not found: ' + path);
      const physicalRoot = await realpath(root);
      const physicalFile = await realpath(file);
      if (!physicalFile.startsWith(physicalRoot + sep)) return end(res, 403, 'Forbidden');
      const headers = {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes',
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range) { // <video> seeking needs byte ranges
        const start = range[1] ? +range[1] : Math.max(0, st.size - +range[2]);
        const last = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
        if (start > last) return end(res, 416, 'Bad range');
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${last}/${st.size}`, 'Content-Length': last - start + 1 });
        return createReadStream(file, { start, end: last }).pipe(res);
      }
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).pipe(res);
    } catch (e) {
      end(res, 500, String(e.message || e));
    }
  });
  await new Promise((ok, no) => server.once('error', no).listen(port, '127.0.0.1', ok));
  const actual = server.address().port;
  return {
    port: actual,
    url: `http://127.0.0.1:${actual}`,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}

function end(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}

export async function readBody(req, limit = 1e6) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('Body too large');
  }
  return body ? JSON.parse(body) : {};
}

export function sendJson(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
