# Sound

All bundled sound is synthesised by the studio at the moment you ask for it. There are no samples and no third-party licences: everything generated is original to the project.

## Music

```
studio music --project <dir> --style refined|editorial|bold|energetic
        [--hit <seconds>] [--bpm <n>] [--key 0-11] [--seed <n>] [--out audio/music.wav]
```

| Style | Feel | Default tempo |
| --- | --- | --- |
| `refined` | Warm pad, bells, half-time pulse. Product reveals, premium. | 88 |
| `editorial` | Sparse keys and ticks, no kick. Typography, thoughtful. | 96 |
| `bold` | Minor key, four-on-the-floor, plucks. Studio motion design. | 112 |
| `energetic` | Bright, busy, 128 bpm. Social. | 128 |

Every bed has the same arc: sparse intro, build, drop into the full section, a riser, then one final hit that rings out to the end.

- `--hit` is the time the final hit lands. Set it to the moment the logo or payoff arrives; the tempo is nudged so the bars fit exactly.
- The command prints the **grid**: `beat`, `bar`, `build`, `drop`, `hit` and every beat time. Give it to the editor. Scene boundaries belong on beats; the biggest change belongs on `drop`.
- Change `--seed` for a different take, `--key` to shift mood (0 = C; lower keys feel heavier).

## Effects

```
studio sfx --project <dir> --type <name> [--dur <s>] [--out audio/sfx/<name>.wav]
```

| Type | Use |
| --- | --- |
| `whoosh` | Scene transitions, large moves (starts about 0.1 s before the cut) |
| `swipe` | Small fast moves, wipes |
| `rise` | Tension into a reveal (ends on the reveal) |
| `impact` | Reveals, logo landings, when the music has no hit there |
| `click`, `key` | Cursor clicks, typing |
| `tick` | Counters, small UI changes |
| `pop` | Chips, badges, things that appear with a spring |
| `chime`, `shimmer` | Success states, logo resolve, premium accents |

Fewer is better: a 30-second piece wants roughly 6-12 effects. Every effect answers something visible.

## The cue sheet: `audio/cues.json`

```json
{
  "target": -14,
  "music": { "file": "audio/music.wav", "gain": -4, "fadeOut": 0.8 },
  "cues": [
    { "file": "audio/sfx/whoosh.wav", "at": "turn-0.1", "gain": -9 },
    { "file": "audio/sfx/click.wav",  "at": "product+2.3", "gain": -6 },
    { "file": "audio/sfx/chime.wav",  "at": 11.5, "gain": -9 }
  ]
}
```

`at` is seconds, or a scene reference that follows the edit when timings change: `"hook"`, `"product+2.3"`, `"end-1.5"`, `"proof.end-0.3"`. Prefer scene references. `gain` is dB. Typical levels: music -3 to -6, transitions -8 to -12, UI sounds -6 to -10, risers -12 to -16.

```
studio mix --project <dir>
```

writes `build/mix.wav` at the target loudness (-14 LUFS, true peak under -1 dBTP) and prints the measured values. Run it again after any timing change, then render.

## Supplied and sourced audio

- The user's own music or voice-over: `studio asset --add <file> --provenance licensed --license "<terms>"`, then reference it in the cue sheet. With voice-over, drop the music 6-8 dB lower.
- Online libraries or generation services are optional and only with the user's go-ahead. Record source and licence with `studio asset --add`. Never use commercial music the user has not licensed.
