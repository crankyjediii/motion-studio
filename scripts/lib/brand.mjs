import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { registerAsset } from './project.mjs';
import { HOME, copyDir, fail, loadProject, projectDir, readJson, saveProject, slugify, writeJson } from './util.mjs';

/*
 * Brand profiles: one folder per client under <home>/brands/<slug>/ holding brand.json, logos/ and fonts/.
 * A project is bound to exactly one profile; applying it writes composition/brand.css and copies
 * only that client's files into the project, so brands never mix.
 */
const brandsDir = () => join(HOME, 'brands');
const brandDir = (slug) => join(brandsDir(), slugify(slug));
const FONT_FORMAT = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };

const SKELETON = (name, slug) => ({
  name, slug,
  colors: { primary: '#4f46e5', secondary: '#0f172a', accent: '#22d3ee', background: '#0b0b0f', foreground: '#f5f5f7' },
  typography: {
    display: { family: 'Inter', file: null, weight: '600', fallback: 'ui-sans-serif, system-ui, sans-serif' },
    body: { family: 'Inter', file: null, weight: '400', fallback: 'ui-sans-serif, system-ui, sans-serif' },
  },
  logos: { primary: null, mark: null, onDark: null, onLight: null, clearSpace: 0.5, minHeight: 64 },
  motion: {
    personality: 'refined',
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    durationScale: 1,
    do: ['Let the logo resolve last and hold at least one second'],
    dont: ['Never stretch, recolor or rotate the logo'],
  },
  voice: '',
  notes: '',
});

async function load(slug) {
  const file = join(brandDir(slug), 'brand.json');
  if (!existsSync(file)) fail(`No brand profile "${slugify(slug)}". Existing: ${(await list()).join(', ') || 'none'}.`);
  return readJson(file);
}

async function list() {
  if (!existsSync(brandsDir())) return [];
  return (await readdir(brandsDir(), { withFileTypes: true })).filter((e) => e.isDirectory() && existsSync(join(brandsDir(), e.name, 'brand.json'))).map((e) => e.name);
}

function validate(b) {
  const problems = [];
  for (const [k, v] of Object.entries(b.colors || {})) if (!/^#[0-9a-f]{3,8}$/i.test(v)) problems.push(`colors.${k} "${v}" is not a hex color`);
  for (const k of ['primary', 'background', 'foreground']) if (!b.colors?.[k]) problems.push(`colors.${k} is required`);
  for (const role of ['display', 'body']) if (!b.typography?.[role]?.family) problems.push(`typography.${role}.family is required`);
  if (b.motion?.easing && !/^(cubic-bezier|linear|ease|steps)/.test(b.motion.easing)) problems.push('motion.easing must be a CSS easing function');
  return problems;
}

function brandCss(b, dir) {
  const lines = [`/* Generated from brand profile "${b.slug}". Edit the profile and re-apply; do not edit by hand. */`];
  const families = {};
  for (const [role, t] of Object.entries(b.typography || {})) {
    if (t.file && existsSync(join(dir, t.file))) {
      const fmt = FONT_FORMAT[extname(t.file).toLowerCase()];
      lines.push(`@font-face { font-family: "${t.family}"; src: url("../assets/brand/${t.file}")${fmt ? ` format("${fmt}")` : ''}; font-weight: 100 900; font-display: block; }`);
    }
    families[role] = `"${t.family}"${t.fallback ? `, ${t.fallback}` : ''}`;
  }
  lines.push(':root {');
  for (const [k, v] of Object.entries(b.colors || {})) lines.push(`  --brand-${k}: ${v};`);
  for (const [role, fam] of Object.entries(families)) {
    lines.push(`  --brand-font-${role}: ${fam};`);
    if (b.typography[role].weight) lines.push(`  --brand-weight-${role}: ${b.typography[role].weight};`);
  }
  for (const [k, v] of Object.entries(b.logos || {})) if (typeof v === 'string' && existsSync(join(dir, v))) lines.push(`  --brand-logo-${k}: url("../assets/brand/${v}");`);
  if (b.motion?.easing) lines.push(`  --brand-ease: ${b.motion.easing};`);
  lines.push(`  --brand-dur-scale: ${Number(b.motion?.durationScale) || 1};`, '}');
  return lines.join('\n') + '\n';
}

/**
 * brand --list | --init <slug> --name "Acme" | --show <slug> | --check <slug>
 *       | --add-file <path> --to <slug> --kind logo|font
 *       | --apply <slug> --project <dir> [--force]
 * Edit <home>/brands/<slug>/brand.json directly to change colors, type, logos and motion rules.
 */
export async function brand(args) {
  if (args.init) {
    const slug = slugify(args.init);
    const dir = brandDir(slug);
    if (existsSync(join(dir, 'brand.json'))) fail(`Brand "${slug}" already exists at ${dir}.`);
    await mkdir(join(dir, 'logos'), { recursive: true });
    await mkdir(join(dir, 'fonts'), { recursive: true });
    await writeJson(join(dir, 'brand.json'), SKELETON(args.name && args.name !== true ? String(args.name) : slug, slug));
    return console.log(JSON.stringify({ created: dir, edit: join(dir, 'brand.json') }));
  }
  if (args['add-file']) {
    const b = await load(args.to || fail('--to <slug> is required.'));
    const kind = { logo: 'logos', font: 'fonts' }[args.kind] || fail('--kind must be logo or font.');
    const src = resolve(String(args['add-file']));
    if (!existsSync(src)) fail(`File not found: ${src}`);
    const rel = `${kind}/${basename(src)}`;
    await mkdir(join(brandDir(b.slug), kind), { recursive: true });
    await copyFile(src, join(brandDir(b.slug), rel));
    return console.log(JSON.stringify({ added: rel, next: `Reference "${rel}" from ${kind === 'logos' ? 'logos.*' : 'typography.*.file'} in brand.json.` }));
  }
  if (args.show || args.check) {
    const b = await load(args.show || args.check);
    return console.log(JSON.stringify({ path: brandDir(b.slug), problems: validate(b), brand: b }, null, 2));
  }
  if (args.apply) {
    const dir = projectDir(args);
    const b = await load(args.apply);
    const problems = validate(b);
    if (problems.length) fail(`Brand profile has problems:\n- ${problems.join('\n- ')}`);
    const project = await loadProject(dir);
    if (project.client && project.client !== b.slug && !args.force) {
      fail(`This project belongs to brand "${project.client}". One project, one client: start a new project, or pass --force to rebrand it.`);
    }
    const dest = join(dir, 'assets', 'brand');
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    for (const sub of ['logos', 'fonts']) {
      const from = join(brandDir(b.slug), sub);
      if (!existsSync(from)) continue;
      await copyDir(from, join(dest, sub));
      for (const f of await readdir(from)) await registerAsset(dir, { path: `assets/brand/${sub}/${f}`, provenance: 'brand', license: `Owned or licensed by ${b.name}`, source: `brand profile: ${b.slug}` });
    }
    await writeFile(join(dir, 'composition', 'brand.css'), brandCss(b, brandDir(b.slug)));
    project.client = b.slug;
    await saveProject(dir, project);
    return console.log(JSON.stringify({ applied: b.slug, wrote: 'composition/brand.css', motion: b.motion, logos: b.logos, voice: b.voice }, null, 2));
  }
  console.log(JSON.stringify({ home: brandsDir(), brands: await list() }, null, 2));
}
