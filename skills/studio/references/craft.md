# Craft

## One idea

A 30-second ad carries one message. Write it as a sentence a viewer could repeat. Every scene either sets it up, proves it, or lands it. Cut anything else.

## Structure for product and software ads

| Length | Shape |
| --- | --- |
| 15 s | Hook (2-3 s) -> product doing the one thing (6-7 s) -> proof or payoff (2-3 s) -> end card (3 s) |
| 30 s | Hook (3 s) -> tension or turn (3 s) -> product, three beats (12-14 s) -> proof (4 s) -> end card (4 s) |
| 45-60 s | Hook -> problem made concrete -> product, three or four beats with one hero moment -> proof -> vision line -> end card (4-5 s) |

- The first two seconds must work with the sound off and before the viewer knows who you are. Open on the viewer's problem or on something striking, never on the logo.
- Show the product by its outcome. One interaction per beat: one click, one result.
- The end card holds logo and CTA together for at least 2 seconds after motion settles.
- Social placements: assume sound off. Every claim that matters is on screen as text.

## Style lanes

Pick one and commit. Mixing lanes is what makes work look generated.

| Lane | Look | Motion | Sound |
| --- | --- | --- | --- |
| **Refined product reveal** | Dark or neutral field, one accent, generous space, product large and centred | Slow, long eases (`--ease-out`, 0.9-1.4 s), drifts, light sweeps, few cuts, dissolves and masks | `refined`: soft pad, bell, single low hit on the reveal |
| **Bold studio** | Flat saturated colour fields, huge type, hard shapes | Fast in, hard stop (`--ease-snap`, 0.3-0.5 s), wipes and pushes on the beat, full-frame colour changes | `bold`: kick-driven, whooshes on transitions |
| **Energetic social** | High contrast, stickers, chips, big numbers, vertical first | Cut every 1-2 s, pops (`--ease-spring`), scale punches, constant small motion | `energetic`: 128 bpm, pops, clicks, risers |
| **Editorial typography** | Type is the picture: one family, two weights, tight tracking, paper and ink | Line masks, word staggers, strike-throughs, slow pushes; text arrives in reading order | `editorial`: sparse keys, ticks, room to breathe |
| **Sophisticated 2D** | Shape systems, vector illustration, consistent stroke and corner language | Morphs, path draws (`a-draw`), follow-through and overlap, shapes hand off to each other across cuts | `refined` or `editorial`, with tight effect sync |
| **Dimensional / simple 3D** | Cards and devices in perspective, layered depth, soft shadows | Camera-like moves on a `.space` parent, parallax between planes, tilt entrances (`a-tilt`), slow rotation | `refined`, with low movement sounds on camera moves |

## Timing

- Reading time: about 3 words per second, plus half a second. A six-word line needs 2.5 s on screen after it has arrived.
- Entrances 0.4-0.9 s. Exits about half the entrance. Stagger 30-80 ms between items; total stagger under 0.6 s.
- Things arrive with ease-out and leave with ease-in. Linear is for continuous drifts only.
- Nothing is fully still for more than about 2 seconds: add a drift or a small secondary motion.
- Cut and land on the music grid. Put the biggest visual change on the drop and the logo on the final hit.
- One focal point per moment. If two things move, one of them is subordinate (smaller, later, slower).
- Leave a few frames of rest after a big move before the next one starts.

## Adapting formats

Recompose; do not shrink.

- **Vertical**: stack. Text block in the upper-middle, product below or behind. Type 25-40% larger relative to the short edge. Keep the middle band for the action; the top 10% and bottom 14% belong to the platform.
- **Square**: stack, tighter. Product slightly smaller, type between the other two.
- **Horizontal**: side-by-side is available: text one side, product the other.
- A scene may show less in vertical (crop into the product, drop a secondary line). It may never show something different.

## Type and colour

- Two weights of one family is enough. Display lines tight (line-height about 1, tracking -2 to -4%).
- One accent colour doing one job. Brand profile colours win when there is one.
- Text contrast at least 4.5:1 against what is actually behind it in the frame.

## Before you call it done

- Does the first frame make someone stop?
- With the sound off, is the message still complete?
- Could you remove a scene and lose nothing? Then remove it.
- Is every interface scene honest about what it is?
- Does each format look like it was designed for that frame?
