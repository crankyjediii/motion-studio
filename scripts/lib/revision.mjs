import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PLUGIN_ROOT, loadProject } from './util.mjs';

export async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** The picture, soundtrack and render settings that a preview approval or render actually covers. */
export async function sourceRevision(dir) {
  const project = await loadProject(dir);
  const hash = createHash('sha256');
  hash.update(JSON.stringify(Object.fromEntries(['name', 'client', 'duration', 'fps', 'resolution', 'formats', 'disclosure'].map(k => [k, project[k]]))));
  const add = async (root, path = '') => {
    for (const entry of (await readdir(join(root, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const rel = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await add(root, rel);
      else if (entry.isFile()) hash.update(JSON.stringify([rel, await fileDigest(join(root, rel))]));
    }
  };
  for (const folder of ['composition', 'assets', 'audio']) {
    hash.update(folder);
    if (existsSync(join(dir, folder))) await add(join(dir, folder));
  }
  for (const [name, file] of [['mix', join(dir, 'build/mix.wav')], ['stage', join(PLUGIN_ROOT, 'runtime/stage.js')], ['kit', join(PLUGIN_ROOT, 'runtime/studio.css')]]) {
    hash.update(name);
    if (existsSync(file)) hash.update(await fileDigest(file));
  }
  return hash.digest('hex');
}

export async function currentApprovals(dir, project) {
  const approved = { ...project.approved };
  if (approved.final && approved.final.revision !== await sourceRevision(dir)) delete approved.final;
  return approved;
}
