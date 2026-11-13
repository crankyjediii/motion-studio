---
name: brand
description: Create, view or update a client's brand profile for Motion Studio - logos, typography, colors and motion rules - and apply it to a project. Use when the user supplies brand guidelines or assets, names a client, asks to "use our brand", or wants to change how a brand moves.
argument-hint: "[client name, and/or paths to logos, fonts, guidelines]"
---

# Brand profiles

Each client has one profile, kept apart from every other client's. A project is bound to one profile; applying it copies only that client's files into the project.

`studio` below means `node "${CLAUDE_PLUGIN_ROOT}/scripts/studio.mjs"`.

## Commands

```
studio brand --list
studio brand --init <slug> --name "Client Name"
studio brand --show <slug>                              # prints the profile, its folder, and any problems
studio brand --add-file <path> --to <slug> --kind logo|font
studio brand --apply <slug> --project <dir>             # writes composition/brand.css, copies logos and fonts
```

## Creating a profile

1. Gather what exists: guidelines (read the PDF or page), logo files, font files, a website. If the user points at a live site and has agreed to it, read colours and type from it.
2. `studio brand --init <slug> --name "..."`, then add files with `--add-file`. Prefer SVG logos; ask for a version for dark backgrounds if only one exists.
3. Edit `brand.json` in the folder `--show` reports:

   - `colors`: `primary`, `background`, `foreground` required; add `secondary`, `accent` and any named extras. Hex values.
   - `typography.display` / `.body`: `family`, `weight`, `fallback`, and `file` (for example `fonts/Brand-Variable.woff2`) when you have the font file. Without a file the family must be installed on the machine; say so if it is not.
   - `logos`: paths such as `logos/wordmark.svg` for `primary`, `mark`, `onDark`, `onLight`; `clearSpace` (as a fraction of logo height) and `minHeight` in pixels at 1080.
   - `motion`: `personality` (refined, bold, energetic, editorial, playful...), `easing` (a CSS easing function), `durationScale` (1 = studio default; 1.2 slower, 0.8 snappier), and `do` / `dont` lists.
   - `voice`: how the brand writes on screen, in a sentence or two.

4. Fill `motion` from the guidelines if they cover it. If they do not, propose rules that suit the brand's character, mark them in `notes` as proposed, and ask the user to confirm before treating them as rules.
5. `studio brand --show <slug>` and fix any reported problems.

Only record what the user supplied or confirmed. Do not invent a brand colour or pull a logo from the internet.

## Using a profile in a project

After `--apply`, the composition has:

- `--brand-primary`, `--brand-background`, `--brand-foreground` and the other colours
- `--brand-font-display`, `--brand-font-body`, `--brand-weight-*`
- `--brand-logo-primary` and the other logos as `url(...)`, with the files in `assets/brand/logos/`
- `--brand-ease` and `--brand-dur-scale`, which the motion kit uses by default

The `do` / `dont` lists and `voice` are returned by `--apply`: pass them to whoever writes the concept and builds the scenes. They are rules, not suggestions. After editing a profile, apply it again to refresh the project.

A project that already belongs to one brand refuses another. That is deliberate: start a new project for a different client.
