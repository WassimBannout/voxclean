import { describe, expect, it } from "vitest";
import {
  countWords,
  diffWords,
  groupRuns,
  newWords,
  tokenize,
  wordKey,
} from "./diff";

const removedTokens = (original: string, revised: string) => {
  const a = tokenize(original);
  const { removed } = diffWords(a, tokenize(revised));
  return a.filter((_, i) => removed[i]);
};

const addedTokens = (original: string, revised: string) => {
  const b = tokenize(revised);
  const { added } = diffWords(tokenize(original), b);
  return b.filter((_, i) => added[i]);
};

/** Classic DP longest common subsequence, as a reference for small inputs. */
function lcsLength(a: string[], b: string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = x === b[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = above;
    }
  }
  return row[b.length];
}

describe("diffWords", () => {
  it("marks filler words removed by cleanup", () => {
    expect(
      removedTokens(
        "Um, so, okay, the main thing I wanted to, uh, get down",
        "The main thing I wanted to get down",
      ),
    ).toEqual(["Um,", "so,", "okay,", "uh,"]);
  });

  it("treats case and punctuation fixes as unchanged words", () => {
    expect(
      removedTokens("so the plan is ready", "So, the plan is ready."),
    ).toEqual([]);
    expect(
      addedTokens("so the plan is ready", "So, the plan is ready."),
    ).toEqual([]);
  });

  it("removes one copy of a repeated word", () => {
    expect(removedTokens("the, the printer", "the printer")).toHaveLength(1);
  });

  it("marks words that were added", () => {
    expect(
      addedTokens("the plan is ready", "the plan is ready on Thursday"),
    ).toEqual(["on", "Thursday"]);
  });

  it("handles empty inputs", () => {
    expect(diffWords([], [])).toEqual({ removed: [], added: [] });
    expect(diffWords(["a"], [])).toEqual({ removed: [true], added: [] });
    expect(diffWords([], ["a"])).toEqual({ removed: [], added: [true] });
  });

  it("finds a minimal edit script", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const words = () =>
      Array.from(
        { length: Math.floor(random() * 12) },
        () => "abc"[Math.floor(random() * 3)],
      );

    for (let run = 0; run < 300; run++) {
      const a = words();
      const b = words();
      const { removed, added } = diffWords(a, b);
      const kept = a.filter((_, i) => !removed[i]);
      expect(kept).toEqual(b.filter((_, j) => !added[j]));
      expect(kept).toHaveLength(lcsLength(a, b));
    }
  });
});

describe("helpers", () => {
  it("tokenizes and counts words", () => {
    expect(tokenize("  Hello,  world — again ")).toEqual([
      "Hello,",
      "world",
      "—",
      "again",
    ]);
    expect(countWords("Hello, world — again")).toBe(3);
  });

  it("normalizes comparison keys", () => {
    expect(wordKey("It's,")).toBe("it's");
    expect(wordKey("—")).toBe("—");
  });

  it("groups neighbouring tokens with the same mark", () => {
    expect(
      groupRuns(
        ["Um,", "so", "the", "plan", "uh,"],
        [true, true, false, false, true],
      ),
    ).toEqual([
      { text: "Um, so", marked: true },
      { text: "the plan", marked: false },
      { text: "uh,", marked: true },
    ]);
  });

  it("lists words that never occur in the original", () => {
    expect(
      newWords(
        tokenize("the meeting moved"),
        tokenize("The meeting moved to Thursday, Thursday."),
      ),
    ).toEqual(["to", "Thursday"]);
  });
});
