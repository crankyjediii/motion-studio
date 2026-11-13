# Authoring a composition

A composition is a web page: `composition/index.html`, `style.css`, `brand.css` (generated). The stage runtime makes it a timeline by seeking every CSS animation to an exact time for every frame. Preview and render use the same seek, so what you see is what renders.

## Skeleton

```html
<link rel="stylesheet" href="../__studio/studio.css">
<link rel="stylesheet" href="brand.css">
<link rel="stylesheet" href="style.css">
<script src="../__studio/stage.js"></script>
...
<main id="stage">
  <div class="layer">persistent background, under every scene</div>
  <section class="scene" id="hook" data-dur="2.8" data-label="Hook">...</section>
  <section class="scene t-wipe-up" id="turn" data-dur="2.4" data-overlap="0.5" style="--t:.5s">...</section>
  <div class="layer">persistent overlay (logo bug, grain), over every scene</div>
</main>
```

Keep those four paths exactly; they also work when the delivered source is opened from disk.

## Time

- Scenes play in DOM order. `data-dur` is seconds. `data-overlap="0.5"` starts a scene 0.5 s before the previous one ends, with the new scene on top: that is how transitions work. `data-start` pins an absolute start if you need one.
- **Every animation inside a scene runs on that scene's clock.** `animation-delay: 1.2s` means 1.2 s after the scene starts. Nothing needs global timestamps.
- The piece ends when the last scene ends. `studio timing` prints the result.
- Scene ids are the vocabulary shared with sound cues and notes. Name them for their job: `hook`, `product`, `proof`, `end`.

## What is and is not seekable

| Use | Never use |
| --- | --- |
| CSS `@keyframes` animations | CSS `transition` |
| Web Animations API (`el.animate`) created at load | `setTimeout`, `setInterval`, `requestAnimationFrame` |
| `Studio.onFrame` / `Studio.scene` for anything computed | `Date.now()`, `performance.now()`, `Math.random()` without a fixed seed |
| `<video>` inside a scene (seeked for you) | autoplaying media, GIFs, CSS that depends on `:hover` |

Always give animations `both` fill (the kit does) or the element will jump before it starts.
Transforms and clip-paths do nothing on inline elements: animate `inline-block` or `block` boxes.

## Units and formats

`--u` is 1% of the short edge (10.8 px at 1080). Size type and spacing in `calc(var(--u) * n)`. `--w` and `--h` are the stage size.

`<html data-format="horizontal|vertical|square">` is set for you. Write real layout per format:

```css
.product { display: flex; gap: calc(var(--u) * 6); }
html[data-format="vertical"] .product { flex-direction: column; }
html[data-format="vertical"] .display { font-size: calc(var(--u) * 19); }
```

Helpers: `.only-vertical`, `.not-square`, and so on. Timing is shared by all formats (one soundtrack), so adapt layout, scale and framing, not durations.

Safe areas QC enforces: 5% on every edge horizontally; vertical keeps the top 10% and bottom 14% clear for platform chrome; square 6%. Minimum text: 28 px horizontal, 34 px vertical, 30 px square.

## The motion kit (`studio.css`)

`class="a a-rise" style="--d:.4s; --t:.8s"` : `--d` delay, `--t` duration, `--i` stagger index.

- Entrances: `a-fade a-rise a-drop a-left a-right a-scale a-pop a-blur a-mask-up a-mask-right a-wipe a-tilt a-draw`
- Exit on the same element: `style="--out:a-fade-out; --out-at:2.6s"` (`a-fade-out a-rise-out a-scale-out a-blur-out`)
- Staggered text: `<h1 class="split a-rise" data-split="words|chars" style="--stagger:.03s">`
- Line reveal from behind an edge: `<span class="mask"><span class="a a-mask-up">Line</span></span>`
- Scene transitions on the incoming scene: `t-fade t-wipe-up t-wipe-left t-iris t-push`, with `data-overlap` equal to `--t`
- Keep a hold alive: `class="drift" style="--t:4s; --to:1.06"`
- Easings: `--ease-out` (default), `--ease-in`, `--ease-in-out`, `--ease-snap`, `--ease-spring`; a brand profile overrides `--ease`
- Depth: `.space` (perspective parent), `.plane`, `.shadow-soft`
- Interface frames: `.browser` (with `.bar`), `.phone`, `.cursor`

The kit is a start. Write your own keyframes for anything specific; that is where a piece gets its character.

## Computed motion

```js
Studio.scene('proof', (t, progress, el) => {          // t = seconds since this scene started
  counter.textContent = Math.round(6 * Studio.ease.outExpo(Studio.range(t, 0.4, 1.5)));
});
Studio.onFrame((t, { duration, fps, format }) => { /* canvas, WebGL, SVG, anything */ });
```

Everything must be a pure function of `t`. For particles or noise, seed your own generator and derive positions from `t`. A hook may return a promise; the frame waits for it.

Simple 3D: CSS 3D transforms cover cards, devices, layered parallax and camera moves. For real meshes, vendor a WebGL library into `assets/vendor/` (register its licence), render in `Studio.onFrame`, and never load code from a CDN.

## Media

- Images: `<img src="../assets/x.png">`. Register every file (`studio asset --add`).
- Video: `<video src="../assets/captures/app-scroll.mp4" muted data-from="1.5" data-rate="1"></video>` plays from 1.5 s on the scene clock, and holds its last frame when the clip runs out. Scrubbing and rendering wait for the requested frame. Sound comes from the mix, never from the element.
- Fonts: brand fonts arrive through `brand.css`. Otherwise use a system stack. Do not link web fonts unless the user approved online sourcing; then download the files into `assets/fonts/` and register them.

## Interface scenes

Mark the interface element `data-ui` and the scene `data-provenance="authentic"` or `"illustrative"`. Illustrative interfaces get a default picture label; use `data-disclose` to choose its wording. The project's `disclosure` setting controls whether the label is visible. Details in software-demos.md. Text inside `[data-ui]` is exempt from size and safe-area checks; `data-qc-ignore` exempts anything else that is deliberately small or cropped.

## Checking your work

```
studio stills --project <dir> --at 0.3,1.2,4.6      # exact frames, all formats
studio stills --project <dir>                        # one frame per scene + contact sheets
studio qc --project <dir>                            # layout and file checks
```

Read the PNGs. Check the first frame, a mid-entrance frame and the hold of every scene, in every format.

## Reusable components

Anything worth using again goes in `components/<name>/` with `component.html`, `component.css` and `component.json` (`{ "description", "formats", "usage" }`). `studio component` lists the project and shared collections; `--publish` and `--pull` move one between them, only when the user asks.
