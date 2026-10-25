import type { InputDevice, Transcript } from "../lib/ipc";

// The sample recording from the design canvas, shared by the fake backend
// and the `?screen=` fixtures so the preview reproduces the artboards.

export const TRANSCRIPT: Transcript = {
  segments: [
    {
      startMs: 0,
      endMs: 7_000,
      text: "Um, so, okay, the main thing I wanted to, uh, get down is that the — the launch date is moving.",
    },
    {
      startMs: 7_000,
      endMs: 12_000,
      text: "It's moving to the, um, the second week of March, not the first.",
    },
    {
      startMs: 12_000,
      endMs: 20_000,
      text: "And, uh, that's mostly because the, the printer needs an extra week for the, uh, for the proofs.",
    },
    {
      startMs: 20_000,
      endMs: 25_000,
      text: "So, like, we should probably tell the team on Monday.",
    },
    {
      startMs: 25_000,
      endMs: 37_000,
      text: "Um, and also, I think we, we need to, uh, double-check the budget with Priya before then, because, you know, the shipping costs went up a bit.",
    },
    {
      startMs: 37_000,
      endMs: 42_000,
      text: "Yeah. That's — that's basically it.",
    },
  ],
  language: "en",
  languageDetected: true,
};

export const CLEAN =
  "The main thing I wanted to get down is that the launch date is moving. It's moving to the second week of March, not the first. That's mostly because the printer needs an extra week for the proofs. So we should probably tell the team on Monday.\n\nAlso, I think we need to double-check the budget with Priya before then, because the shipping costs went up a bit. That's basically it.";

export const SUMMARY =
  "- The launch date moves to the second week of March, not the first.\n- Reason: the printer needs an extra week for the proofs.\n- The team should probably be told on Monday.\n- Before then, the budget may need a check with Priya, since shipping costs went up a bit.";

export const DEVICES: InputDevice[] = [
  { id: "builtin", name: "Built-in microphone", isDefault: true },
  { id: "usb", name: "USB headset", isDefault: false },
];

/** Bar heights from an artboard's SVG path ("M5 31V33M15 30V34…"), as 0–1 of `maxHalf`. */
function barsFromPath(path: string, maxHalf: number): number[] {
  return [...path.matchAll(/M[\d.]+ ([\d.]+)V([\d.]+)/g)].map(
    ([, top, bottom]) => (Number(bottom) - Number(top)) / 2 / maxHalf,
  );
}

/** The "Ready to transcribe" waveform: 72 bars, drawn 64 high (max half 28). */
export const CLIP_PEAKS = barsFromPath(
  "M5 31V33M15 30V34M25 27V37M35 23V41M45 26V38M55 29V35M65 24V40M75 19V45M85 13V51M95 20V44M105 25V39M115 28V36M125 22V42M135 16V48M145 9V55M155 15V49M165 21V43M175 27V37M185 30V34M195 28V36M205 24V40M215 18V46M225 12V52M235 7V57M245 14V50M255 20V44M265 25V39M275 28V36M285 26V38M295 20V44M305 13V51M315 16V48M325 23V41M335 28V36M345 22V42M355 16V48M365 19V45M375 24V40M385 28V36M395 30V34M405 27V37M415 22V42M425 15V49M435 10V54M445 17V47M455 23V41M465 27V37M475 29V35M485 25V39M495 19V45M505 12V52M515 8V56M525 14V50M535 21V43M545 26V38M555 29V35M565 30V34M575 27V37M585 23V41M595 17V47M605 11V53M615 15V49M625 22V42M635 27V37M645 29V35M655 25V39M665 20V44M675 24V40M685 28V36M695 30V34M705 31V33M715 32V32",
  28,
);

/** The "Recording" level meter: 36 bars, drawn 80 high (max half 36), newest last. */
export const RECORDING_LEVELS = barsFromPath(
  "M5 39V41M15 38V42M25 35V45M35 31V49M45 34V46M55 37V43M65 32V48M75 27V53M85 21V59M95 28V52M105 33V47M115 36V44M125 30V50M135 24V56M145 17V63M155 23V57M165 29V51M175 35V45M185 38V42M195 36V44M205 32V48M215 26V54M225 20V60M235 15V65M245 22V58M255 28V52M265 33V47M275 36V44M285 34V46M295 28V52M305 21V59M315 24V56M325 31V49M335 36V44M345 30V50M355 24V56",
  36,
);
