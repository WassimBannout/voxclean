// Explains a screen's score: matches every text element, control and landmark
// between the design artboard and the app, and lists what moved, resized or
// changed style, in CSS pixels. Use it to decide what to fix.
//
//   npm run visual:inspect -- <screen> [--all]

import {
  collectBoxes,
  launch,
  loadScreens,
  openApp,
  openArtboard,
  startPreview,
} from "./lib.mjs";

const TOLERANCE = 2;
const args = process.argv.slice(2);
const showAll = args.includes("--all");
const names = args.filter((arg) => !arg.startsWith("--"));
if (names.length !== 1) {
  console.error("Usage: npm run visual:inspect -- <screen> [--all]");
  process.exit(2);
}

const { screens } = await loadScreens(names);
const [screen] = screens;
const preview = await startPreview();
const { browser, context } = await launch();
let design;
let app;
try {
  design = await collectBoxes(await openArtboard(context, screen));
  app = await collectBoxes(await openApp(context, preview.base, screen));
} finally {
  await browser.close();
  await preview.close();
}

// Match by key, in document order, so repeated labels pair up one to one.
const unmatched = new Map();
for (const item of app) {
  if (!unmatched.has(item.key)) unmatched.set(item.key, []);
  unmatched.get(item.key).push(item);
}

const short = (value) => value.replace(/^rgba?\((.*)\)$/, "$1");
const rows = [];
const onlyDesign = [];
for (const d of design) {
  const a = unmatched.get(d.key)?.shift();
  if (!a) {
    onlyDesign.push(d);
    continue;
  }
  const delta = { dx: a.x - d.x, dy: a.y - d.y, dw: a.w - d.w, dh: a.h - d.h };
  const moved = Object.values(delta).some((v) => Math.abs(v) > TOLERANCE);
  const styles = ["font", "color", "background"]
    .filter((prop) => a[prop] !== d[prop])
    .map((prop) => `${prop}: ${short(d[prop])} → ${short(a[prop])}`);
  if (showAll || moved || styles.length > 0) {
    const fmt = (v) => (v === 0 ? "0" : v > 0 ? `+${v}` : `${v}`);
    rows.push(
      `| ${d.key} | ${d.x},${d.y} ${d.w}×${d.h} | ${fmt(delta.dx)} ${fmt(delta.dy)} | ${fmt(delta.dw)} ${fmt(delta.dh)} | ${styles.join("; ")} |`,
    );
  }
}
const onlyApp = [...unmatched.values()].flat();

console.log(`# ${screen.name} vs ${screen.artboard}\n`);
console.log(
  `${rows.length} of ${design.length} design elements differ by more than ${TOLERANCE}px or in style.\n`,
);
console.log(
  "| Element | Design box | Δ position | Δ size | Style (design → app) |",
);
console.log("| --- | --- | --- | --- | --- |");
console.log(rows.join("\n"));
if (onlyDesign.length > 0) {
  console.log(`\nOnly in the design (${onlyDesign.length}):`);
  for (const d of onlyDesign) console.log(`- ${d.key} at ${d.x},${d.y}`);
}
if (onlyApp.length > 0) {
  console.log(`\nOnly in the app (${onlyApp.length}):`);
  for (const a of onlyApp) console.log(`- ${a.key} at ${a.x},${a.y}`);
}
