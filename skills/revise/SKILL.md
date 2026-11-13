---
name: revise
description: Apply revisions to a Motion Studio project from timestamped notes left in the preview or from plain-language feedback in chat ("make the logo hold longer", "the second scene drags", "notes are in"). Use whenever the user gives feedback on a video in progress.
argument-hint: "[feedback, or nothing to pick up the notes from the preview]"
---

# Revisions

`studio` below means `node "${CLAUDE_PLUGIN_ROOT}/scripts/studio.mjs"`.

## 1. Collect

```
studio status --project <dir>
studio feedback --project <dir>          # open notes, each with time, format and scene
```

Feedback given in chat counts the same. If it points at a moment, log it so it is tracked: `studio feedback --project <dir> --add "<their words>" --at <seconds>`. Use `studio timing` to turn "the second scene" or "when the phone appears" into a scene id and time.

## 2. Understand each note before touching anything

- Look at the frame the note is about: `studio stills --project <dir> --at <t> --format <format>` and read the image.
- Decide what kind of change it is: copy, timing, layout, look, sound, or structure.
- A note left on one format usually applies to all three. Apply it everywhere unless it is clearly about that frame's layout.
- If a note is unclear, or two notes conflict, ask once, with the specific options. Do not guess at taste.
- In `faithful` mode do exactly what the note says. In `opinionated` mode you may solve the underlying problem a better way; say that you did, and what the literal reading would have been.
- A structural note (a new scene, a different idea, a different length) reopens the storyboard: update `storyboard.md` and, under `guided` autonomy, get that approved again before building.

## 3. Change

- Picture: edit `composition/`. Follow `${CLAUDE_PLUGIN_ROOT}/skills/studio/references/composition.md`.
- Timing: change `data-dur` / `data-overlap`. Sound cues written as scene references follow automatically. If the end card moved, regenerate the music with a new `--hit` so the final hit still lands on it.
- Sound: edit `audio/cues.json`, then `studio mix`.
- Keep the change as small as the note. Do not restyle things nobody mentioned.

## 4. Check

1. `studio stills` at the changed moments, in every format. Read them.
2. `studio mix` if any timing or sound changed.
3. `studio render --tier draft`, then `studio qc --tier draft --reset`. The three-round correction limit applies.

## 5. Close the loop

- Mark what you handled: `studio feedback --project <dir> --resolve <id>,<id>`. Leave a note open if you did not fully address it.
- Tell the user, note by note, what changed. One line each. Say plainly which notes you did not act on and why.
- The preview reloads by itself. A previous final approval no longer stands after changes. Check `project.json`'s current `approvalsRequired`: when final approval is required, get it again before final render and delivery. Under `autonomous` autonomy, continue through final render, final QC and delivery without recording an approval.
