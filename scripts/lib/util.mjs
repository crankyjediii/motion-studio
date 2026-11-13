import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Per-user store for brand profiles and the shared component collection. */
export const HOME = process.env.MOTION_STUDIO_HOME || join(homedir(), '.motion-studio');

export const FORMATS = {
  horizontal: { w: 1920, h: 1080 },
  vertical: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
};

/** Draft is half resolution with fast encoding; final is full resolution, lossless frames, slow encode. */
export const TIERS = {
  draft: { scale: 0.5, image: 'jpeg', quality: 82, crf: 25, preset: 'veryfast' },
  final: { scale: 1, image: 'png', crf: 15, preset: 'slow' },
};

export const APPROVAL_STAGES = ['concept', 'storyboard', 'final'];
export const PROVENANCE = ['authentic', 'illustrative', 'generated', 'licensed', 'brand'];
export const AUTONOMY = {
  guided: ['concept', 'storyboard', 'final'],
  'final-only': ['final'],
  autonomous: [],
};
export const QC_MAX_ROUNDS = 3;

export class UserError extends Error {}
export const fail = (msg) => { throw new UserError(msg); };

/** `--key value`, `--flag`, and positionals. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

export const readJson = async (file, fallback) => {
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    fail(`Missing file: ${file}`);
  }
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { fail(`Invalid JSON in ${file}: ${e.message}`); }
};

export const writeJson = async (file, data) => {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(data, null, 2) + '\n');
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
};

export const copyDir = (from, to) => cp(from, to, { recursive: true });

const updates = new Map();
/** Serialize read/modify/write operations in the preview server so simultaneous notes are retained. */
export async function updateJson(file, change, fallback) {
  const previous = updates.get(file) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const data = await readJson(file, fallback);
    const result = await change(data);
    await writeJson(file, data);
    return result;
  });
  updates.set(file, task);
  try { return await task; }
  finally { if (updates.get(file) === task) updates.delete(file); }
}

/** A caller-supplied relative path must remain below the directory that owns it. */
export function inside(root, path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[a-z]:/i.test(path)) fail('Use a relative path inside the destination directory.');
  const dest = resolve(root, path);
  if (!dest.startsWith(resolve(root) + sep)) fail('Path must stay inside the destination directory.');
  return dest;
}

export function namedSlug(value) {
  const name = slugify(value);
  if (!name || value === true) fail('A nonempty name is required.');
  return name;
}

/** Native stream backpressure, child-process cleanup and atomic replacement for frame encoders. */
export async function encodeFrames(args, frames, out) {
  const exe = which('ffmpeg') || fail('ffmpeg not found on PATH. Run the setup check.');
  await mkdir(dirname(out), { recursive: true });
  const temp = join(dirname(out), `.encoding-${randomUUID()}${extname(out)}`);
  const child = spawn(exe, [...args, temp], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  const closed = once(child, 'close');
  try {
    const [, [code]] = await Promise.all([pipeline(Readable.from(frames), child.stdin), closed]);
    if (code !== 0) fail(`ffmpeg exited ${code}: ${stderr}`);
    await rename(temp, out);
  } catch (e) {
    child.kill();
    await closed.catch(() => {});
    if (e instanceof UserError) throw e;
    fail(`Encoding ${out} failed: ${stderr || e.message}`);
  } finally { await rm(temp, { force: true }); }
}

export function which(cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, cmd + ext);
      if (dir && existsSync(p)) return p;
    }
  }
  return null;
}

/** Run a process to completion. Rejects on non-zero exit unless `allowFail`. */
export function run(cmd, args, { allowFail = false } = {}) {
  return new Promise((ok, no) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => no(new UserError(`Could not run ${cmd}: ${e.message}. Run the setup check.`)));
    p.on('close', (code) => {
      if (code !== 0 && !allowFail) no(new UserError(`${cmd} exited ${code}\n${stderr.slice(-1500)}`));
      else ok({ code, stdout, stderr });
    });
  });
}

export function projectDir(args) {
  const dir = resolve(String(args.project || '.'));
  if (!existsSync(join(dir, 'project.json'))) fail(`No project.json in ${dir}. Pass --project <dir> or run "init".`);
  return dir;
}

export const loadProject = (dir) => readJson(join(dir, 'project.json'));
export const saveProject = (dir, project) => writeJson(join(dir, 'project.json'), project);

export function pickFormats(project, arg) {
  const list = !arg || arg === true || arg === 'all' ? project.formats : String(arg).split(',');
  for (const f of list) if (!FORMATS[f]) fail(`Unknown format "${f}". Use horizontal, vertical, square or all.`);
  return list;
}

export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const timecode = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
export const log = (...a) => console.error(...a);
