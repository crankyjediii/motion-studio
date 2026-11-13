#!/usr/bin/env node
// Motion Studio CLI. Every command prints JSON on stdout and progress on stderr.
import { UserError, parseArgs } from './lib/util.mjs';

const COMMANDS = {
  doctor: ['./lib/doctor.mjs', 'doctor', 'Check dependencies and optional creative apps (installs nothing)'],
  init: ['./lib/project.mjs', 'init', 'Create a project: --dir <path> --name "X" [--client <brand>] [--duration 30] [--formats h,v,s] [--mode opinionated|faithful] [--autonomy guided|final-only|autonomous]'],
  status: ['./lib/project.mjs', 'status', 'Where the production stands'],
  approve: ['./lib/project.mjs', 'approve', 'Record a user approval: --stage concept|storyboard|final'],
  autonomy: ['./lib/project.mjs', 'autonomy', 'Change approval checkpoints: --level guided|final-only|autonomous'],
  brand: ['./lib/brand.mjs', 'brand', 'Brand profiles: --list | --init <slug> --name | --show <slug> | --add-file <path> --to <slug> --kind logo|font | --apply <slug>'],
  asset: ['./lib/project.mjs', 'asset', 'Register an asset with provenance: --add <file> --provenance authentic|illustrative|generated|licensed|brand [--license] [--source]'],
  capture: ['./lib/capture.mjs', 'capture', 'Capture real product footage: --url <url> [--name] [--mobile] [--full] [--scroll <seconds>]'],
  timing: ['./lib/render.mjs', 'timing', 'Print scene timings'],
  stills: ['./lib/render.mjs', 'stills', 'Frames and a contact sheet: [--format all] [--at scenes|1.5,4]'],
  music: ['./lib/audio.mjs', 'music', 'Generate a music bed: --style refined|editorial|bold|energetic [--bpm] [--key] [--seed] [--hit <seconds>]'],
  sfx: ['./lib/audio.mjs', 'sfx', 'Generate a sound effect: --type whoosh|swipe|rise|impact|click|tick|pop|key|chime|shimmer [--dur]'],
  mix: ['./lib/audio.mjs', 'mix', 'Mix audio/cues.json to build/mix.wav at target loudness'],
  render: ['./lib/render.mjs', 'render', 'Render MP4: [--format all] [--tier draft|final] [--from s --to s]'],
  qc: ['./lib/qc.mjs', 'qc', 'Automated quality checks: [--format all] [--tier draft|final] [--reset]'],
  preview: ['./lib/preview.mjs', 'preview', 'Browser preview with timestamped notes: [--port 4747]'],
  feedback: ['./lib/project.mjs', 'feedback', 'List open notes | --resolve <id,id> | --add "text" --at <seconds>'],
  component: ['./lib/project.mjs', 'component', 'Reusable components: [--list] | --publish <name> | --pull <name>'],
  timeline: ['./lib/timeline.mjs', 'timeline', 'Editable hand-off (ProRes scene clips, stems, FCPXML, After Effects script): [--format horizontal]'],
  deliver: ['./lib/project.mjs', 'deliver', 'Assemble deliverables/'],
};

const [name, ...rest] = process.argv.slice(2);
const cmd = COMMANDS[name];
if (!cmd) {
  console.error('Usage: studio <command> [--project <dir>] [options]\n');
  for (const [k, v] of Object.entries(COMMANDS)) console.error(`  ${k.padEnd(10)} ${v[2]}`);
  process.exit(name ? 1 : 0);
}
try {
  const mod = await import(cmd[0]);
  await mod[cmd[1]](parseArgs(rest));
} catch (e) {
  if (e instanceof UserError) console.error(`Error: ${e.message}`);
  else console.error(e.stack || String(e));
  process.exit(1);
}
