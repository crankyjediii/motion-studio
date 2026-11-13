# Motion Studio contributor instructions

Motion Studio is a Claude Code plugin for short motion graphics productions. Read README.md for installation, usage and CLI commands, and CONTRIBUTING.md before changing the engine.

## Architecture

- `scripts/studio.mjs` dispatches the CLI; `scripts/lib/` owns rendering, audio, projects, brands, capture, QC, preview and timeline export.
- `runtime/stage.js` makes HTML/CSS compositions seekable. `runtime/studio.css` is the animation kit; `runtime/player.html` is the review player.
- `skills/` contains four skills and the authoring references; `agents/` contains five studio specialists.
- `templates/project/` is the project scaffold. `examples/launch-15s/` is a fictional reference composition.
- `tests/engine.test.mjs` exercises project and browser/media behavior using temporary data.

## Conventions

- Keep zero npm dependencies: use Node 22+ standard APIs, an installed Chromium browser and ffmpeg.
- CLI commands print JSON on stdout and progress on stderr. User-facing failures use `UserError` through `fail()`.
- Motion must be seekable: CSS keyframes, Web Animations created at load, or `Studio.scene` / `Studio.onFrame`. Do not drive composition motion with timers, wall-clock time or unseeded randomness.
- Formats share timing and audio. Compose each layout with `html[data-format=...]`; do not crop one master into other formats.
- Interface scenes declare provenance; illustrative interfaces carry a picture label unless the user selects report-only disclosure. Register every asset and its licence terms.
- One production uses one client's brand. Keep client assets, private projects, rendered output and test stores outside this repository.
- Never install tools, fetch production assets, publish shared components or record an approval without user authorization.
- Preserve source-revision checks for renders, QC, final approval and delivery. Never bypass a failing report to make a test pass.
- QC correction is bounded to three failing rounds. Warnings need a reasoned decision; visual review and listening remain necessary.
- Pass the resolved plugin root and project directory explicitly when delegating to studio specialists.

## Verification

```sh
node scripts/studio.mjs doctor
node --test tests/engine.test.mjs
claude plugin validate .
```

Run checks appropriate to a change. Browser/media tests require Chrome, ffmpeg and ffprobe; ProRes timeline checks require `prores_ks`. Chrome needs permission to launch outside restrictive process sandboxes. Report skipped or unavailable checks accurately.

macOS rendering and the studio/revision instructions have been exercised. Windows and native Final Cut, Resolve, After Effects and Premiere imports remain unverified. Full Claude-driven production and agent-body variable substitution also require a live session; registration of all four skills and five agents is verified. Do not describe these remaining checks as passed.
