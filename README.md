# Motion Studio

Motion Studio is a Claude Code plugin for making short product ads and software demo videos from a text brief and supplied assets. It covers concept, storyboard, animation, sound, review and delivery. The renderer runs locally with Node, an installed Chromium browser and ffmpeg. There are no npm dependencies.

## Install in Claude Code

In a Claude Code session, run:

```text
/plugin marketplace add crankyjediii/motion-studio
/plugin install motion-studio@motion-studio
```

Restart Claude Code after installation, then run:

```text
/motion-studio:setup
```

This installs the plugin for your user account. The setup skill checks the rendering tools and asks before installing anything missing. The plugin does not need an npm install or a separate API key; use your existing Claude Code account.

### Rendering requirements

- Claude Code with plugin support, signed in to your account.
- Node 22 or newer, with its built-in `WebSocket`.
- Chrome, Edge or Chromium. Set `CHROME_PATH` for a nonstandard executable location.
- `ffmpeg` and `ffprobe` on `PATH`, with `libx264`. Editable timeline export also needs `prores_ks`.

If you already use Homebrew on macOS, the required tools can be installed with:

```sh
brew install node ffmpeg
brew install --cask google-chrome
```

Otherwise use the platform downloads for [Node](https://nodejs.org/), [Chrome](https://www.google.com/chrome/) and [ffmpeg](https://ffmpeg.org/download.html), or let `/motion-studio:setup` report the commands for your platform. `ffmpeg` and `ffprobe` must both be available in the terminal that starts Claude Code.

### Load a checkout for one session

This is useful for trying the source or developing the plugin:

```sh
git clone https://github.com/crankyjediii/motion-studio.git
cd motion-studio
claude --plugin-dir .
```

To persistently install a local checkout, use its absolute path instead of the GitHub source:

```text
/plugin marketplace add /absolute/path/to/motion-studio
/plugin install motion-studio@motion-studio
```

The plugin includes four skills and five specialist agents. If the skills do not appear, check `/plugin` to confirm Motion Studio is enabled and restart Claude Code. Validate a checkout from its root with `claude plugin validate .`.

## Making a video

Start Claude Code in a writable folder where you want the production project saved. Give the studio your product, audience, supported features, call to action, duration and paths to any assets. For example:

```text
/motion-studio:studio Make a 15-second ad for Still, a fictional focus app for freelance designers. It lets users reserve a 25-minute focus block on a daily calendar and mutes notifications during that block. The message is “Make room to focus.” End with still.example, a fictional demo URL. Use a warm paper-and-ink look, illustrative UI, system fonts and generated audio. Make horizontal, vertical and square versions. Check with me at the concept and storyboard.
```

For your own product, replace those facts and supply real screenshots, recordings, logos or guidelines as local file paths. The studio tracks which scenes use authentic footage and which are illustrative.

| Skill | What to ask for |
| --- | --- |
| `/motion-studio:setup` | Check Node, ffmpeg and a Chromium browser; report missing tools |
| `/motion-studio:studio` | Make a video from a brief and assets, through preview and delivery |
| `/motion-studio:brand` | Create or apply a client profile with logos, fonts, colors and motion rules |
| `/motion-studio:revise` | Apply feedback from chat or timestamped preview notes |

The creative director writes the concept; the motion engineer builds the pictures; the editor sets timing; the sound designer generates and mixes audio; the QC reviewer checks the result. When agent delegation is unavailable, the producer performs those roles in order.

By default, the skill asks for approval at concept, storyboard and final preview. Ask for `final-only` to review only the preview, or `autonomous` to run through delivery. Skipped checkpoints are not recorded as approvals. A supplied finished script uses faithful direction; otherwise the studio proposes copy and pacing.

The studio saves the brief, concept and storyboard in the production folder. It generates the soundtrack, builds the animation, renders drafts, checks them and starts a local browser preview for review. Keep supplied product claims factual; illustrative UI is a simplified picture of the features you described.

Default output is 30 fps H.264 MP4 with AAC audio near -14 LUFS, in horizontal (1920×1080), vertical (1080×1920) and square (1080×1080). Drafts use half resolution. Scenes share timing and a soundtrack; layouts are composed separately for each format.

The local preview has playback, frame stepping, format and source switches, timestamped notes, and approval controls. Space toggles playback; arrows step frames; N focuses the note field. `deliverables/` contains final videos, browser source, assets, audio, QC results and a provenance sheet.

### Revise a video

Leave timestamped notes in the preview, then return to the same Claude Code chat:

```text
/motion-studio:revise Notes are in. Apply the preview feedback to this project.
```

You can also describe a change directly:

```text
/motion-studio:revise Hold the end-card logo half a second longer and make the CTA larger in the vertical version.
```

The revision skill reads the affected frames, makes the change, checks every format and resolves the notes it handled. Required final approval must be renewed after changes.

### Apply a brand

```text
/motion-studio:brand Create a profile for Acme using ./brand/logo.svg, ./brand/font.woff2 and ./brand/guidelines.pdf.
```

Then ask `/motion-studio:studio` to use that profile. Each project uses one client's profile. Brand profiles and shared components stay on your machine, outside the installed plugin.

Finish picture and sound edits before the final render. Delivery requires a passing final QC report for every project format. Changes to production source invalidate existing renders, QC and final approval; changing the approval checkpoints never creates an approval. Projects with older renders need a fresh render and QC pass to establish their source revision.

## CLI

From the root of a cloned checkout, production commands can also be run directly. Keep the production directory outside the plugin checkout:

```sh
node scripts/studio.mjs doctor
node scripts/studio.mjs init --dir ../my-ad --name "My ad" --duration 15
node scripts/studio.mjs status --project ../my-ad
```

Run the dispatcher without a command for usage. Commands return JSON on stdout and progress or failures on stderr. Project commands take `--project <directory>`.

| Command | Purpose and main options |
| --- | --- |
| `doctor` | Check required tools and optional creative apps; installs nothing |
| `init` | Create a project: `--dir`, `--name`, `--duration`, `--formats horizontal,vertical,square`, `--mode`, `--autonomy` |
| `status` | Show approvals, open notes, QC rounds and available renders |
| `approve` | Record an approval the user actually gave: `--stage concept\|storyboard\|final` |
| `autonomy` | Change checkpoints: `--level guided\|final-only\|autonomous` |
| `brand` | `--list`, `--init <slug> --name`, `--show <slug>`, `--add-file <file> --to <slug> --kind logo\|font`, `--apply <slug>` |
| `asset` | List assets, or `--add <file> --provenance authentic\|illustrative\|generated\|licensed\|brand --license <terms> --source <source>` |
| `capture` | Capture an authorized public or local page: `--url`, `--name`, `--mobile`, `--viewport 1440x900`, `--full`, `--scroll <seconds>` |
| `timing` | Read the authored scene timeline |
| `stills` | Capture frames and contact sheets: `--format all`, `--at scenes` or `--at 0.3,1.2,4.6` |
| `music` | Generate a bed: `--style refined\|editorial\|bold\|energetic`, `--bpm`, `--key`, `--seed`, `--hit <seconds>` |
| `sfx` | Generate `--type whoosh\|swipe\|rise\|impact\|click\|tick\|pop\|key\|chime\|shimmer`, with optional `--dur` |
| `mix` | Mix `audio/cues.json` into `build/mix.wav` |
| `render` | Encode video: `--tier draft\|final`, `--format all`, optional `--from <seconds> --to <seconds>` |
| `qc` | Check source, browser layout and rendered files: `--tier draft\|final`, `--format all`, `--reset` for a new review cycle |
| `preview` | Serve the review player locally, with optional `--port 4747` |
| `feedback` | List notes; `--add <text> --at <seconds>`, `--resolve <id,id>`, `--all` |
| `component` | List components, `--publish <name>` to the shared collection, or `--pull <name>` |
| `timeline` | Export scene clips, stems, FCPXML and an After Effects build script: `--format horizontal` |
| `deliver` | Assemble final videos and source in `deliverables/` |

Brand profiles and shared components live in `~/.motion-studio`. Set `MOTION_STUDIO_HOME` to use a different store. Projects contain `project.json`, production notes, `composition/`, `assets/manifest.json`, `audio/cues.json`, `build/` and `renders/`.

## Update or uninstall

Inside Claude Code:

```text
/plugin marketplace update motion-studio
/plugin update motion-studio@motion-studio
```

Restart Claude Code to load the update. To uninstall, run `/plugin uninstall motion-studio@motion-studio`. Production folders and the per-user brand/component store are separate from the plugin installation.

## Troubleshooting and limits

- **A tool is missing:** run `/motion-studio:setup`. Restart the terminal after changing `PATH` or installing Node/ffmpeg.
- **The browser is not found:** set `CHROME_PATH` to the installed browser executable before starting Claude Code.
- **Chrome cannot launch in a sandbox:** allow the render command to run outside that process sandbox. Rendering needs to start a local headless browser.
- **Delivery says a render or QC result is stale:** finish source and sound changes, render every project format again, then run final QC. Get final approval again when the project requires it.
- **A production pauses for review:** the default is guided approval. Ask for `final-only` or `autonomous` if you want different checkpoints.

Open a [GitHub issue](https://github.com/crankyjediii/motion-studio/issues) with your OS, tool versions and the failing command when reporting a bug. Remove client assets and private data from reproductions.

### Authoring and verification status

A composition is an HTML page with seekable CSS or Web Animations. `Studio.scene` and `Studio.onFrame` support computed motion. Timers, CSS transitions and wall-clock animation do not produce repeatable frames. Read [the composition contract](skills/studio/references/composition.md) before building; [launch-15s](examples/launch-15s/) is a complete fictional example.

Every asset needs provenance and licence information. Interface scenes declare whether they are authentic footage or illustrative. Illustrative interfaces carry a picture label by default and remain identified in preview and delivery records. Captures use a fresh browser profile and do not sign in. Fonts, stock footage and sampled music are not bundled; the included music and effects are synthesized locally. Online sourcing and dependency installation require the user's authorization.

The studio is tuned for 15–60 seconds; the CLI accepts 5–120. CSS 3D supports cards, devices and layered scenes. Blender and Figma workflows are documented integrations, not built-in render engines. QC checks technical output and sampled layouts; visual review and listening are still part of the workflow. Automatic correction stops after three failing rounds.

Chrome needs permission to launch outside restrictive process sandboxes. macOS is the verified platform. Windows discovery and paths are implemented, but require a Windows execution pass. FCPXML and JSX export are provided for editing; actual imports in Final Cut, Resolve, Premiere and After Effects require verification in those applications. ProRes scene clips can be much larger than MP4s.

This is an early release. The engine's integration tests and a sample production/revision have run on macOS. Registration of the four skills and five agents is verified; a full production driven through the installed Claude skills remains to be verified.

## Development checks

```sh
node --test tests/engine.test.mjs
claude plugin validate .
```

The tests create temporary projects and a separate brand/component store. They exercise project and asset boundaries, capture, embedded video seeking, disclosure, preview controls and notes, partial renders, alternate resolution, timeline overlays, final QC and delivery freshness. Browser/media checks require the tools reported by `doctor`; the project checks still run without them. A local font is used only for a temporary test on macOS; none is bundled. On another platform, set `MOTION_STUDIO_TEST_FONT` to an authorized local font to test font application.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the engine. Plugin code is available under the [MIT license](LICENSE); project assets retain their own licence terms.
