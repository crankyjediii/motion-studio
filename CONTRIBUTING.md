# Contributing to Motion Studio

Open an issue for a reproducible bug or a proposed change. For a bug, include your OS, Node and browser versions, the failing command, and its JSON output or stderr. Remove credentials, client assets and personal information before sharing a project.

For local development:

```sh
git clone https://github.com/crankyjediii/motion-studio.git
cd motion-studio
node scripts/studio.mjs doctor
node --test tests/engine.test.mjs
claude plugin validate .
```

Use `claude --plugin-dir .` to load your checkout for a session. Keep test projects outside the plugin directory and set `MOTION_STUDIO_HOME` to a separate test store when testing brand profiles or shared components.

The engine uses Node's standard library, an installed Chromium browser and ffmpeg. There are no npm dependencies. Before changing the renderer, read [the composition contract](skills/studio/references/composition.md). Motion must be a function of timeline time so preview, stills and video agree. Preserve per-format layouts, provenance records, approval gates and the three-round QC limit.

Tests use temporary projects. Browser/media checks are skipped when their dependencies are unavailable; timeline checks also require ffmpeg's `prores_ks` encoder. A passing test run with skipped cases is not proof of those cases. macOS has been exercised; Windows and native editor imports still need verification in their respective environments.

Keep pull requests focused. Describe the resulting behavior, how you checked it and any remaining limitations. Update the README or authoring reference when a command or composition convention changes. Do not commit rendered media, test brand stores or private production projects.
