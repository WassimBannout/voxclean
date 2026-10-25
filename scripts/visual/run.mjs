// Visual fidelity check: opens each screen of the browser preview, screenshots
// it, and scores it against its design reference (design/screens.json).
//
//   npm run visual [-- <screen> …]
//
// Writes to .visual/: current/ (app), diff/ (red = differing pixels),
// compare/ (design | app | diff), report.md, and one line per run in
// history.jsonl. Exits with 1 if any screen scores under its threshold.

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  launch,
  loadScreens,
  openApp,
  openArtboard,
  readPng,
  root,
  score,
  sideBySide,
  startPreview,
  writePng,
} from "./lib.mjs";

const OUT = path.join(root, ".visual");

const { screens, defaults } = await loadScreens(process.argv.slice(2));
for (const dir of ["current", "diff", "compare"]) {
  await mkdir(path.join(OUT, dir), { recursive: true });
}

// How far the page runs past the frame. Compared with the design's own
// overflow, since some artboards are taller than their frame too.
const overflowOf = (page) =>
  page.evaluate(() =>
    Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
  );

const preview = await startPreview();
const { browser, context } = await launch();
const results = [];
try {
  for (const screen of screens) {
    const artboard = await openArtboard(context, screen);
    const designOverflow = await overflowOf(artboard);
    await artboard.close();

    const page = await openApp(context, preview.base, screen);
    const overflow = await overflowOf(page);
    const currentFile = path.join(OUT, "current", `${screen.name}.png`);
    await page.screenshot({ path: currentFile });
    await page.close();

    const reference = await readPng(
      path.join(root, "design/reference", `${screen.name}.png`),
    );
    const current = await readPng(currentFile);
    const { pixel, layout, diff } = score(reference, current);
    await writePng(path.join(OUT, "diff", `${screen.name}.png`), diff);
    await writePng(
      path.join(OUT, "compare", `${screen.name}.png`),
      sideBySide(reference, current, diff),
    );
    const minPixel = screen.minPixel ?? defaults.minPixel;
    const minLayout = screen.minLayout ?? defaults.minLayout;
    results.push({
      screen: screen.name,
      pixel,
      layout,
      minPixel,
      minLayout,
      overflow,
      designOverflow,
      pass: pixel >= minPixel && layout >= minLayout,
    });
  }
} finally {
  await browser.close();
  await preview.close();
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const table = [
  "| Screen | Pixel | Layout | Overflow (design / app) | Result |",
  "| --- | --- | --- | --- | --- |",
  ...results.map(
    (r) =>
      `| ${r.screen} | ${pct(r.pixel)} (min ${pct(r.minPixel)}) | ${pct(r.layout)} (min ${pct(r.minLayout)}) | ${r.designOverflow}px / ${r.overflow}px | ${r.pass ? "pass" : "FAIL"} |`,
  ),
].join("\n");

await writeFile(
  path.join(OUT, "report.md"),
  `# Visual fidelity\n\n${table}\n\nSide by side (design | app | diff): .visual/compare/<screen>.png\nElement by element: npm run visual:inspect -- <screen>\n`,
);
await appendFile(
  path.join(OUT, "history.jsonl"),
  `${JSON.stringify({ at: new Date().toISOString(), results })}\n`,
);
console.log(table);
process.exitCode = results.every((r) => r.pass) ? 0 : 1;
