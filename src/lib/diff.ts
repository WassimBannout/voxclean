/** Splits text on whitespace, keeping punctuation attached to its word. */
export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function isWord(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token);
}

export function countWords(text: string): number {
  return tokenize(text).filter(isWord).length;
}

/** Comparison key: case and punctuation fixes are cleanup, not changed words. */
export function wordKey(token: string): string {
  return token.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "") || token;
}

export interface WordDiff {
  /** Per original token: missing from the revision. */
  removed: boolean[];
  /** Per revised token: not matched in the original. */
  added: boolean[];
}

/**
 * Word-level diff with Myers' O(ND) algorithm, so long transcripts with few
 * edits stay fast and memory stays proportional to the edit count.
 */
export function diffWords(original: string[], revised: string[]): WordDiff {
  const a = original.map(wordKey);
  const b = revised.map(wordKey);
  const trace = forwardPass(a, b);
  const removed = new Array<boolean>(a.length).fill(false);
  const added = new Array<boolean>(b.length).fill(false);

  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d > 0; d--) {
    // trace[d]: furthest x on each diagonal k after d - 1 edits, at index k + d.
    const v = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && v[k - 1 + d] < v[k + 1 + d]) ? k + 1 : k - 1;
    const prevX = v[prevK + d];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    if (x === prevX) added[prevY] = true;
    else removed[prevX] = true;
    x = prevX;
    y = prevY;
  }
  return { removed, added };
}

function forwardPass(a: string[], b: string[]): Int32Array[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return trace;
    }
  }
  return trace;
}

export interface Run {
  text: string;
  marked: boolean;
}

/** Joins neighbouring tokens that share a mark, so a removed phrase is one run. */
export function groupRuns(tokens: string[], marked: boolean[]): Run[] {
  const runs: Run[] = [];
  tokens.forEach((token, i) => {
    const last = runs[runs.length - 1];
    if (last && last.marked === Boolean(marked[i])) last.text += ` ${token}`;
    else runs.push({ text: token, marked: Boolean(marked[i]) });
  });
  return runs;
}

/**
 * Words in `revised` that never occur in `original`, without surrounding
 * punctuation. Used to flag cleanups that put words in the speaker's mouth.
 */
export function newWords(original: string[], revised: string[]): string[] {
  const known = new Set(original.map(wordKey));
  const found = new Map<string, string>();
  for (const token of revised) {
    const key = wordKey(token);
    if (isWord(token) && !known.has(key) && !found.has(key)) {
      found.set(key, token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
    }
  }
  return [...found.values()];
}
