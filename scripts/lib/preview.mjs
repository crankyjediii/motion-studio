import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { addFeedback, readFeedback, recordDecision, setFeedbackStatus } from './project.mjs';
import { readBody, sendJson, serve } from './server.mjs';
import { FORMATS, loadProject, log, projectDir } from './util.mjs';
import { currentApprovals } from './revision.mjs';

const mtime = async (file) => (await stat(file).catch(() => null))?.mtimeMs || 0;

/** Newest change across the composition and the mix: the player reloads when this moves. */
async function sourceVersion(dir) {
  const v = createHash('sha256');
  v.update(String(await mtime(join(dir, 'build', 'mix.wav'))));
  v.update(String(await mtime(join(dir, 'project.json'))));
  for (const sub of ['composition', 'assets']) {
    const root = join(dir, sub);
    if (!existsSync(root)) continue;
    for (const e of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (e.isFile()) v.update(e.name + ':' + await mtime(join(e.parentPath, e.name)));
    }
  }
  return v.digest('hex');
}

/** preview --project <dir> [--port 4747]: browser player with timestamped notes. Runs until stopped. */
export async function preview(args) {
  const dir = projectDir(args);
  const api = async (req, res, url) => {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const project = await loadProject(dir);
      project.approved = await currentApprovals(dir, project);
      const renders = {};
      for (const tier of ['draft', 'final']) {
        renders[tier] = {};
        for (const f of project.formats) {
          const m = await mtime(join(dir, 'renders', tier, `${f}.mp4`));
          if (m) renders[tier][f] = Math.round(m);
        }
      }
      return sendJson(res, {
        project, formats: FORMATS, renders, feedback: await readFeedback(dir),
        hasMix: existsSync(join(dir, 'build', 'mix.wav')), version: await sourceVersion(dir),
      });
    }
    if (req.method !== 'POST') return sendJson(res, { error: 'Not found' }, 404);
    // Same-origin only: the player is the only client that should write.
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return sendJson(res, { error: 'Forbidden' }, 403);
    try {
      const body = await readBody(req);
      if (url.pathname === '/api/feedback') return sendJson(res, await addFeedback(dir, body));
      if (url.pathname === '/api/feedback/status') return sendJson(res, await setFeedbackStatus(dir, body.id, body.status));
      if (url.pathname === '/api/decision') return sendJson(res, await recordDecision(dir, 'final', body.approved === true));
    } catch (e) {
      return sendJson(res, { error: e.message }, 400);
    }
    sendJson(res, { error: 'Not found' }, 404);
  };

  const first = parseInt(args.port, 10) || 4747;
  let server;
  for (let port = first; port < first + 20 && !server; port++) {
    server = await serve(dir, { port, api, index: 'player.html' }).catch((e) => {
      if (e.code !== 'EADDRINUSE') throw e;
      return null;
    });
  }
  if (!server) throw new Error(`No free port between ${first} and ${first + 19}.`);
  console.log(JSON.stringify({ preview: server.url, project: dir }));
  log('Preview running. Stop this process to close it.');
  await new Promise(() => {}); // keep serving
}
