---
name: visual-fidelity
description: Check VoxClean's UI against the design canvas, rate it, and iterate until it matches. Use after any change under src/ that affects how a screen looks, when asked for visual QA or design fidelity, or before calling UI work done.
---

# Visual fidelity loop

Done means: `npm run visual` passes for every screen in `design/screens.json`, and every screen you touched scores at least 4/5 on each rubric line below with no open blockers.

## 1. Score

```sh
npm run visual                    # every screen
npm run visual -- result setup    # just these
```

Read `.visual/report.md`. For each failing screen, and each screen your change touches, Read `.visual/compare/<screen>.png`: design on the left, app in the middle, differing pixels in red on the right.

- **Pixel** is the share of identical pixels. It's strict: any shift, wrap or color change costs points.
- **Layout** compares 8× downscaled images. It judges where blocks sit, how big they are and their color, not glyph rendering.

## 2. Find the cause

```sh
npm run visual:inspect -- <screen>          # what differs
npm run visual:inspect -- <screen> --all    # every matched element
```

This lists each text element, control and landmark that moved, resized, or changed font or color, in CSS pixels. Fix root causes rather than single elements. When many elements are off by the same amount, look for a shared cause first: line-height, box-sizing, or a shared component.

The artboards render with browser defaults: `line-height: normal`, and `box-sizing: content-box` on everything except form controls. Under content-box, padding and borders add to a declared width, height or min-height. The app uses border-box, so match the rendered size. For example, a 140px min-height with 24px padding and a 1.5px border becomes `min-h-[191px]`.

## 3. Look at it live

Run `npm run dev` in the background, then open `http://localhost:1420/preview.html?screen=<name>`. The screen names are start, recording, ready, transcribing, transcript, result, result-summary, setup (add `&hold=64` to freeze the download) and errors. Plain `preview.html` runs the whole flow from the start screen against the fake backend.

- **With Claude in Chrome (`/chrome`):** load the `claude-in-chrome` skill, then `tabs_context_mcp` → `tabs_create_mcp` → `navigate` → `computer` screenshot. Use `resize_window` to set 1280×800 to match the artboards. Close your tab when done.
- **If the extension isn't connected:** use the chrome-devtools MCP tools the same way: `new_page`, `emulate` with viewport `1280x800x1`, `take_screenshot`, `click`.

Check what a static diff can't:

- hover and focus states (Tab through the page)
- the flow from one screen to the next
- the 640px minimum window width
- long content

## 4. Rate

Rate each screen 1–5 on every line, citing evidence for anything under 5: the element, the design value, the app value.

| Line                | A 5 means                                                              |
| ------------------- | ---------------------------------------------------------------------- |
| Layout & spacing    | Same positions, sizes and gaps as the artboard (inspect shows ≤ 2px)   |
| Typography          | Same family, size, weight, line-height and wrapping                    |
| Color               | Theme tokens only, with the artboard's fills, borders and text colors  |
| Components & states | Every control, badge and state the artboard shows, behaving as implied |
| Copy                | Matches the artboard, apart from entries in `design/deviations.md`     |
| Interaction & a11y  | Real buttons and labels, visible focus, targets ≥ 44px, works at 640px |

Don't penalize anything listed in `design/deviations.md`. A blocker is anything that breaks the flow, hides content, or misstates what the app did.

For a second opinion that isn't grading its own work, spawn the `visual-reviewer` agent with the screen names.

## 5. Fix and repeat

Fix the largest gap first. Then re-run steps 1–4 for the affected screens, plus `npm test`. Stop when everything passes. If three rounds in a row bring no improvement, stop and report what's blocking.

Never edit `design/artboards` or `design/reference` to make a score pass, and don't lower a threshold without asking the user. If a difference should stay, add it to `design/deviations.md` with the reason, and give its threshold in `design/screens.json` a `why`.

## 6. Report

Give the scores before and after (from `.visual/history.jsonl`), the rubric table, and what's still different.

## When the design changes

1. Re-read the canvas with the Artifact tool (https://claude.ai/artifact/L74EhiX4QaP9Ysq3CPuKCb).
2. Copy its `project/*.dc.html` into `design/artboards/`.
3. Run `npm run visual:references` and commit the new PNGs.
4. For a new artboard, add an entry to `design/screens.json` and a fixture to `src/dev/fixtures.ts`.
