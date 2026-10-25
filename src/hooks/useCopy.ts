import { useCallback, useEffect, useRef, useState } from "react";
import { toAppError, type AppError } from "../lib/errors";
import { copyText } from "../lib/ipc";

/** Copies text to the clipboard and reports "Copied" for a moment. */
export function useCopy(resetMs = 1800) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<AppError>();
  const timer = useRef<number>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      window.clearTimeout(timer.current);
      try {
        await copyText(text);
        setError(undefined);
        setCopied(true);
        timer.current = window.setTimeout(() => setCopied(false), resetMs);
      } catch (err) {
        setCopied(false);
        setError(toAppError(err));
      }
    },
    [resetMs],
  );

  return { copied, error, copy };
}
