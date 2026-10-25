import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import pngjs from "pngjs";
import { chromium } from "playwright";
import { createServer } from "vite";

const { PNG } = pngjs;

export const root = path.resolve(import.meta.dirname, "../..");

// Matches the artboards' sample recording (25 Oct, 14:32) and keeps timers still.
const NOW = new Date("2026-10-25T14:32:42");

// The artboards load Instrument Sans and IBM Plex Mono from Google Fonts. Serve
// the app's bundled copies instead, so both sides render identical glyphs and
// everything works offline.
const FONT_FILES = {
  "instrument-sans.woff2":
    "node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2",
  "plex-mono-400.woff2":
    "node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  "plex-mono-500.woff2":
    "node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
};
const FONT_CSS = `
@font-face { font-family: "Instrument Sans"; font-weight: 400 700; src: url(https://fonts.local/instrument-sans.woff2) format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 400; src: url(https://fonts.local/plex-mono-400.woff2) format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 500; src: url(https://fonts.local/plex-mono-500.woff2) format("woff2"); }
`;

/** Screens from design/screens.json, optionally only the named ones. */
export async function loadScreens(names = []) {
  const config = JSON.parse(
    await readFile(path.join(root, "design/screens.json"), "utf8"),
  );
  const unknown = names.filter(
    (name) => !config.screens.some((screen) => screen.name === name),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown screen(s): ${unknown.join(", ")}`);
  }
  return {
    defaults: config.defaults,
    screens:
      names.length > 0
        ? config.screens.filter((screen) => names.includes(screen.name))
        : config.screens,
  };
}

/** The installed Chrome, set up the same way for every capture. */
export async function launch() {
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    locale: "en-GB",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  });
  await context.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ contentType: "text/css", body: FONT_CSS }),
  );
  await context.route("https://fonts.local/**", async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    await route.fulfill({
      contentType: "font/woff2",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: await readFile(path.join(root, FONT_FILES[name])),
    });
  });
  return { browser, context };
}

/** A Vite dev server for the browser preview (preview.html). */
export async function startPreview() {
  const server = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
    logLevel: "error",
    server: { port: 1430, strictPort: false },
  });
  await server.listen();
  return { base: server.resolvedUrls.local[0], close: () => server.close() };
}

/** A design artboard, rendered as the design tool shows it. */
export async function openArtboard(context, screen) {
  const page = await context.newPage();
  await page.setViewportSize({ width: screen.width, height: screen.height });
  const file = path.join(root, "design/artboards", screen.artboard);
  await page.goto(pathToFileURL(file).href);
  await page.addStyleTag({
    content: "x-dc { display: block } helmet { display: none }",
  });
  await page.evaluate(resolveBindings, screen.props ?? {});
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** The app's preview, driven into the state the screen's artboard shows. */
export async function openApp(context, base, screen) {
  const page = await context.newPage();
  await page.setViewportSize({ width: screen.width, height: screen.height });
  await page.clock.setFixedTime(NOW);
  await page.goto(`${base}preview.html?${screen.query}`);
  await page.waitForLoadState("networkidle");
  for (const step of screen.steps ?? []) {
    if (step.click) {
      await page.getByRole("button", { name: step.click, exact: true }).click();
    }
    if (step.waitFor) {
      await page.getByText(step.waitFor, { exact: true }).waitFor();
    }
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(screen.settleMs ?? 600);
  return page;
}

/**
 * Fills an artboard's {{bindings}} and <sc-if> blocks from its own component
 * logic, as the design tool does on first render. Runs inside the page.
 */
function resolveBindings(overrides) {
  const script = document.querySelector("script[data-dc-script]");
  if (!script) return;
  const declared = JSON.parse(script.dataset.props || "{}");
  const props = Object.fromEntries(
    Object.entries(declared)
      .filter(([key]) => !key.startsWith("$"))
      .map(([key, spec]) => [key, spec.default]),
  );
  Object.assign(props, overrides);

  class DCLogic {
    constructor(p) {
      this.props = p;
      this.state = {};
    }
    setState() {}
  }
  const Component = new Function(
    "DCLogic",
    `${script.textContent}\nreturn Component;`,
  )(DCLogic);
  const values = new Component(props).renderVals();
  const lookup = (expr) =>
    expr
      .trim()
      .split(".")
      .reduce((value, key) => value?.[key], values);
  const fill = (text) =>
    text.replace(/\{\{(.+?)\}\}/g, (_, expr) => String(lookup(expr) ?? ""));

  const board = document.querySelector("x-dc");
  for (const block of [...board.querySelectorAll("sc-if")].reverse()) {
    const expr = block.getAttribute("value")?.match(/^\{\{(.+)\}\}$/)?.[1];
    if (expr && lookup(expr)) block.replaceWith(...block.childNodes);
    else block.remove();
  }
  for (const el of board.querySelectorAll("*")) {
    for (const { name, value } of [...el.attributes]) {
      if (!value.includes("{{")) continue;
      if (name.startsWith("on")) {
        el.removeAttribute(name);
      } else if (el instanceof HTMLTextAreaElement && name === "value") {
        el.removeAttribute(name);
        el.value = fill(value);
      } else {
        el.setAttribute(name, fill(value));
      }
    }
  }
  const walker = document.createTreeWalker(board, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue.includes("{{")) node.nodeValue = fill(node.nodeValue);
  }
}

/**
 * Every visible text element, control and landmark with its box and type
 * style, keyed by what it says, so design and app can be matched up.
 */
export function collectBoxes(page) {
  return page.evaluate(() => {
    const NAMED = new Set([
      "A",
      "BUTTON",
      "INPUT",
      "LABEL",
      "SELECT",
      "TEXTAREA",
      "SECTION",
      "ASIDE",
      "HEADER",
      "FOOTER",
      "MAIN",
      "NAV",
      "LI",
    ]);
    const clean = (text) => text.replace(/\s+/g, " ").trim();
    const items = [];
    for (const el of document.body.querySelectorAll("*")) {
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const own = clean(
        [...el.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.nodeValue)
          .join(" "),
      );
      let key;
      if (NAMED.has(el.tagName)) {
        const name =
          el.getAttribute("aria-label") || el.innerText || el.value || "";
        // The design draws many actions as links; the app uses buttons.
        const kind = ["A", "BUTTON"].includes(el.tagName)
          ? "control"
          : el.tagName.toLowerCase();
        key = `${kind} "${clean(name).slice(0, 40)}"`;
      } else if (own) {
        key = `"${own.slice(0, 50)}"`;
      } else {
        continue;
      }
      const style = getComputedStyle(el);
      items.push({
        key,
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
        font: `${style.fontWeight} ${style.fontSize}/${style.lineHeight}`,
        color: style.color,
        background: style.backgroundColor,
      });
    }
    return items;
  });
}

export async function readPng(file) {
  return PNG.sync.read(await readFile(file));
}

export async function writePng(file, png) {
  await writeFile(file, PNG.sync.write(png));
}

/** Averages factor×factor blocks: keeps layout and color, drops glyph edges. */
function downscale(png, factor) {
  const width = Math.floor(png.width / factor);
  const height = Math.floor(png.height / factor);
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * png.width + x * factor + dx) * 4;
          for (let c = 0; c < 4; c++) sum[c] += png.data[i + c];
        }
      }
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        out.data[o + c] = Math.round(sum[c] / (factor * factor));
      }
    }
  }
  return out;
}

/**
 * Scores an app screenshot against its design reference (same size), 0–1:
 * - pixel: share of matching pixels, anti-aliasing ignored. Strict; catches
 *   any shift, wrap or color change.
 * - layout: the same on 8× downscaled images, so it judges where blocks sit,
 *   how big they are and their color, not how individual glyphs render.
 */
export function score(reference, current) {
  if (
    reference.width !== current.width ||
    reference.height !== current.height
  ) {
    throw new Error(
      `Size mismatch: design ${reference.width}×${reference.height}, app ${current.width}×${current.height}`,
    );
  }
  const { width, height } = reference;
  const diff = new PNG({ width, height });
  const changed = pixelmatch(
    reference.data,
    current.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 },
  );
  const a = downscale(reference, 8);
  const b = downscale(current, 8);
  const changedBlocks = pixelmatch(a.data, b.data, null, a.width, a.height, {
    threshold: 0.1,
  });
  return {
    pixel: 1 - changed / (width * height),
    layout: 1 - changedBlocks / (a.width * a.height),
    diff,
  };
}

/** Images placed left to right on white, for reviewing at a glance. */
export function sideBySide(...images) {
  const gap = 16;
  const width =
    images.reduce((sum, image) => sum + image.width, 0) +
    gap * (images.length - 1);
  const height = Math.max(...images.map((image) => image.height));
  const out = new PNG({ width, height });
  out.data.fill(255);
  let x = 0;
  for (const image of images) {
    PNG.bitblt(image, out, 0, 0, image.width, image.height, x, 0);
    x += image.width + gap;
  }
  return out;
}
