# BrailleCraft

**Offline UEB braille translator, ADA tactile plaque generator (STL + SVG), and 6-key Perkins chord trainer: zero dependencies, 100% client-side.**

Live demo: `https://aariv.me/braillecraft/`

BrailleCraft is a tactile engineering studio that runs entirely in the browser with no build step, no CDNs, no fonts, and no network calls. Type text, get real Unified English Braille (Grade 1 or Grade 2 contracted), lay it out on an ADA-compliant tactile plaque, export a watertight 3D-printable STL and a millimetre-true SVG blueprint, and practice embossing chords on a simulated Perkins Brailler.

## Features

### UEB engine (`src/ueb.mjs`)
- Grade 1 uncontracted and Grade 2 contracted encoding
- Alphabetic wordsigns (`but`, `can`, `do`, `every`, `from`, `go`, `have`, `just`, `knowledge`, `like`, `more`, `not`, `people`, `quite`, `rather`, `so`, `that`, `us`, `very`, `will`, `it`, `you`, `as`)
- Strong wordsigns and groupsigns (`and`, `for`, `of`, `the`, `with`, `ch`, `gh`, `sh`, `th`, `wh`, `ed`, `er`, `ou`, `ow`, `st`, `ar`, `ing`)
- Capital-letter / capital-word indicators, numeric indicator, grade-1 indicator after numbers
- UEB punctuation including two-cell bracket and dash signs
- Grade-1 decoder for round-trip verification
- Every emitted cell carries its source span and the rule that produced it, so the UI can inspect individual cells

### Tactile geometry (`src/tactile_geometry.mjs`)
- ADA / ANSI A117.1 and Marburg Medium metrology: dot base `1.5 mm`, dot height `0.6 mm`, intra-cell pitch `2.34 mm`, inter-cell pitch `6.2 mm`, line pitch `10.0 mm`
- Word-wrap plaque layout with margins and corner mounting holes
- Watertight binary STL export: shared vertex pool, every edge incident to exactly two triangles, unit outward normals, positive signed volume
- Millimetre-true SVG blueprint with dimension callouts, dashed cell guides, crosshaired mounting holes, and a high-contrast caption layer
- Presentation-attribute-only SVG so the same file renders inside strict-CSP pages and standalone

### Plaque Studio UI (`app.mjs`, `index.html`, `styles.css`)
- Live translation as you type, Grade 1 / Grade 2 toggle, cells-per-line control
- Interactive cell inspector: hover or tap any cell in the blueprint or 3D relief to see its dots, Unicode codepoint, source text span, applied UEB rule, and mm coordinates
- Toggleable 2D blueprint / shaded three-quarter relief preview drawn on a canvas with lighting and a drag-to-tilt control; the canvas sizes itself to the plate so long signs stay wide and every dome stays readable
- One-click downloads: `.stl` for PrusaSlicer / Cura / Bambu Studio, `.svg` for swell paper or laser cutting
- Five built-in signage presets (library quiet zone, science lab eyewash, accessible restroom, STEM club room, emergency exit stairwell)
- URL-hash shareable state (preset, text, grade, lesson, theme, mute)
- Light/dark theme, keyboard-first ARIA tab structure, responsive from `390 px` to desktop with zero horizontal overflow

### Community Tactile Kit (`src/kit.mjs`)
- Turns a whole hallway of signs into one volunteer print job: three starter packs (classroom hallway, science wing, community center) or your own signs, each with a copy count
- One batch `.stl` that shelf-packs every plate copy onto a 220 x 220 mm bed (disjoint watertight shells; volume equals the sum of the plates), plus one combined 1:1 `.svg` sheet and a `.json` export
- PLA estimate from the real mesh volume at 1.24 g/cm3
- Print-shop handoff sheet (copy or print) with the ADA dot spec, every sign's braille, plate size and dot count, a pre-mounting checklist, and named roles: who designs, prints, checks by touch (a braille reader) and mounts
- Study cards built from the kit's own words, drawn as tactile domes, so sighted classmates learn the braille they are putting on the wall; check an answer or reveal it with the UEB rule used, and print the deck
- The whole kit, including roles, rides in the share link through a strict decoder

### How it works dialog
- One button explains the braille cell, Grade 1 versus Grade 2 with examples computed live by the encoder, the indicators, the tactile sign specs, Perkins chords, and how the app was built

### Perkins chord trainer (`src/perkins.mjs`)
- Real Perkins key map: `F D S` = dots 1-2-3, `J K L` = dots 4-5-6, `Space` = blank cell; chords commit on full release like a real brailler
- Clickable/touchable key caps for mobile
- Four progressive lessons: Home Row Letters, Numbers and Indicators, Grade 2 Contractions, Real Classroom Signage
- Live chord grading, accuracy and streak tracking, WebAudio click/chime feedback with mute toggle

### Self-tests (`src/selftest.mjs`)
- In-page `Run Self-Tests` button re-verifies UEB vectors, ADA tolerances, STL manifold invariants and the kit batch live (35 checks)

## Testing

```bash
npm test              # 625 node --test cases: UEB, geometry, STL, SVG, presets, kit, perkins, hygiene
npm run browser:check # real Chrome audit at 1440x900, 768x1024 and 390x844 (85 checks, 0 console/page errors,
                      # 0 external requests, 0 horizontal overflow) + screenshots
```

`scripts/serve.mjs` is a tiny local static server for the browser audit; `scripts/browser-check.mjs` drives installed Chrome via Playwright (loaded from the npx cache: no repo dependency).

## File map

```
index.html                 app shell, ARIA tabs, CSP
styles.css                 light/dark responsive theme
app.mjs                    UI wiring: studio, inspector, iso preview, trainer input
src/ueb.mjs                UEB Grade 1 + Grade 2 encoder/decoder
src/tactile_geometry.mjs   ADA metrology, layout, watertight STL, mm-true SVG
src/perkins.mjs            Perkins session state machine, lessons, audio clicker
src/presets.mjs            signage presets + URL hash state codec
src/kit.mjs                community kit: batch STL, sheet SVG, handoff sheet, study cards
src/selftest.mjs           in-page invariant checks
test/                      625 node:test cases
scripts/serve.mjs          local static server
scripts/browser-check.mjs  headless Chrome audit + screenshots
screenshots/               desktop.png (1440x900), mobile.png (390x844)
```

## AI disclosure

Built by Aariv Patel with AI coding assistance (Devin SWE-2 and Claude via T3 Code). The UEB rules, ADA dimensions, test vectors, and every behavior claim were verified against the real test suite and a real headless-Chrome audit; nothing is asserted without a check that exercises it.

## License

MIT: see `LICENSE`.
