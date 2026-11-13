# Optional integrations

None of this is required. `studio doctor` lists which apps are installed under `optional.apps`. Offer an integration when it would help; do not launch or script another app unless the user asks.

## Editable timeline

```
studio timeline --project <dir> [--format horizontal]
```

Writes `deliverables/timeline/<format>/`:

- `clips/` - every scene on its own as ProRes 4444 with transparency, plus a background plate (and an overlay plate if the piece has one). Stacked in order they reproduce the master, including transitions.
- `audio/` - the music and each effect as separate files.
- `<name>-<format>.fcpxml` - opens in **Final Cut Pro** (File > Import > XML) and **DaVinci Resolve** (File > Import > Timeline) with every clip and stem placed on its own lane.
- `build-in-after-effects.jsx` - in **After Effects**, File > Scripts > Run Script File builds a comp with every layer placed.
- `timeline.json` - the same placement data for anything else.

**Premiere Pro** does not read FCPXML directly: import the clips and stems and place them from `timeline.json`, or bring the FCPXML through Resolve.

Be straight with the user about what this is: the scenes are rendered clips, so an editor can retime, reorder, trim, regrade and remix, but cannot change text or animation inside a clip. For that, edit the composition and export again. The FCPXML uses absolute paths; if the folder moves, relink. One format per run; run it again for others.

## Blender

When a piece needs real 3D beyond CSS transforms (a product model, lit materials) and Blender is installed: write a Python scene script, render a PNG sequence or a transparent video with `blender -b -P <script.py>`, register the output as `generated`, and place it in a scene as `<video>` or an image sequence. Keep it to short hero moments; a 3D render multiplies production time.

## Design files

If the user's Figma or other design tool is connected in their Claude Code session, use it to read brand colours, type and screens when building a brand profile or an illustrative interface. Exported screens of a design that is not the shipped product are `illustrative`.

## Online assets and generation

Off by default. With the user's go-ahead for this project, you may source stock, fonts or music online, or use an image, video or audio generation tool that is available in their session. For each file: download it into `assets/`, and register it with `studio asset --add <file> --provenance licensed|generated --source <url or tool> --license "<terms>"`. QC fails any file in `assets/` that is not registered. Do not use anything whose licence you cannot state.

## Models and agents

The studio's agents inherit the session's model where judgement matters most (creative direction, motion engineering) and ask for a faster one for checks and bookkeeping. If the user wants a specific model for a role, pass it when you bring that agent in. Independent work (motion and sound once the grid is fixed; the three formats' reviews) can run in parallel.
