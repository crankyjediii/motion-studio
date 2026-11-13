# Software demonstrations

Three kinds of interface picture can appear in a piece. The viewer, the client's legal team and the platform all care which one they are looking at, so the studio tracks it for every scene.

| Source | What it is | Provenance |
| --- | --- | --- |
| Supplied screenshots and recordings | Files the user gave you of the real product | `authentic` |
| Automatically captured footage | The real product, captured by `studio capture` | `authentic` |
| Stylised interface scenes | UI rebuilt or simplified in HTML/CSS for clarity | `illustrative` |

## Capturing the real product

```
studio capture --project <dir> --url https://app.example.com/pricing --name pricing
        [--mobile] [--viewport 1440x900] [--full] [--scroll 4] [--wait 2000]
```

Writes a screenshot (and with `--full` a full-page image, with `--scroll <seconds>` a smooth scroll recording) to `assets/captures/` and registers them as `authentic` with the source URL. It opens public or local pages only and never signs in. For anything behind a login, ask the user for screenshots or a recording, or for a local/staging URL that needs no credentials. Capture only the user's own product or pages they have the right to show.

Supplied files: `studio asset --add <file> --provenance authentic --source "supplied by client"`.

## Using authentic footage

- Frame it in `.browser` or `.phone`, or full bleed. Mark the element `data-ui` and the scene `data-provenance="authentic"`.
- You may crop, scale, push in, pan, mask, and add a cursor, callouts and highlights **around** it.
- You may not change what the product shows: no editing text, numbers or names inside the footage, no compositing in features that are not there, no speeding a slow load into an instant one without saying so. If the picture needs to differ from the real product, that scene is illustrative.
- Remove or blur personal data visible in captures (names, emails, account numbers) and tell the user you did.

## Building illustrative scenes

Use them when the real UI is too dense to read in two seconds, is not built yet, or the idea is conceptual.

- Rebuild only what the beat needs: one panel, one control, one result. Keep the product's real layout, names and colours so it is recognisable.
- Mark the element `data-ui` and the scene `data-provenance="illustrative"`. The runtime adds an “Illustrative interface” picture label automatically; set `data-disclose` to choose its wording. QC fails an interface scene with no provenance.
- Show only things the product actually does. Illustrative means simplified, not invented. Any number on screen comes from the brief or the user; if you need a placeholder, say so and get the real figure before final.
- The user may turn picture labels off with `"disclosure": "report-only"` in `project.json`. Preview, rendering and delivered browser source honor this setting; keep the provenance and disclosure attributes. The scene stays `illustrative` in the preview and in `PROVENANCE.md`.

## Mixing the two

Do not put authentic footage and illustrative UI in the same scene. Across scenes is fine: the preview badge and `PROVENANCE.md` show the viewer and the client which is which.

## What delivery records

`deliverables/PROVENANCE.md` lists every scene as authentic product footage, illustrative representation, or motion design with no product footage, plus every asset with its source and licence.
