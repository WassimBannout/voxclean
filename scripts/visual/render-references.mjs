// Renders each design artboard (design/artboards) to design/reference/<screen>.png,
// the images `npm run visual` scores the app against. Re-run after updating the
// artboards from the design canvas, and commit the new PNGs.
//
//   npm run visual:references [-- <screen> …]

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { launch, loadScreens, openArtboard, root } from "./lib.mjs";

const { screens } = await loadScreens(process.argv.slice(2));
const outDir = path.join(root, "design/reference");
await mkdir(outDir, { recursive: true });

const { browser, context } = await launch();
try {
  for (const screen of screens) {
    const page = await openArtboard(context, screen);
    await page.screenshot({ path: path.join(outDir, `${screen.name}.png`) });
    await page.close();
    console.log(`${screen.name}: rendered ${screen.artboard}`);
  }
} finally {
  await browser.close();
}
