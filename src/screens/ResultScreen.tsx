import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { ErrorCard } from "../components/ErrorCard";
import {
  AlignLeftIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  InfoIcon,
  ListIcon,
} from "../components/icons";
import {
  Button,
  Mono,
  ProgressBar,
  SegmentList,
  cx,
  surface,
} from "../components/ui";
import { useCopy } from "../hooks/useCopy";
import {
  countWords,
  diffWords,
  groupRuns,
  isWord,
  newWords,
  tokenize,
} from "../lib/diff";
import { plural } from "../lib/format";
import type { ProcessingMode, Transcript } from "../lib/ipc";
import { transcriptText, type Results } from "../lib/workflow";

const MODE_LABEL: Record<ProcessingMode, string> = {
  clean: "Clean transcript",
  summarize: "Summary",
};

function ModeButton({
  active,
  icon,
  children,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "inline-flex h-11 cursor-pointer items-center gap-2 rounded-[9px] px-4 text-[15px] font-semibold",
        active
          ? "bg-surface text-ink shadow-[0_1px_2px_rgba(22,24,29,0.16)]"
          : "text-ink-soft hover:text-ink",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function ResultScreen({
  transcript,
  results,
  mode,
  model,
  onSelectMode,
  onEdit,
  onRestore,
  onRetry,
  onOpenSetup,
  onBack,
  onStartOver,
}: {
  transcript: Transcript;
  results: Results;
  mode: ProcessingMode;
  model: string;
  onSelectMode: (mode: ProcessingMode) => void;
  onEdit: (mode: ProcessingMode, text: string) => void;
  onRestore: (mode: ProcessingMode) => void;
  onRetry: (mode: ProcessingMode) => void;
  onOpenSetup: () => void;
  onBack: () => void;
  onStartOver: () => void;
}) {
  const [showOriginal, setShowOriginal] = useState(true);
  const { copied, error: copyError, copy } = useCopy();
  const checkId = useId();
  const pendingId = useId();

  const isClean = mode === "clean";
  const result = results[mode];
  const done = result?.status === "done" ? result : null;
  const edited = done !== null && done.text !== done.generated;

  const original = useMemo(() => transcriptText(transcript), [transcript]);
  // Each segment's tokens and where they start in the whole transcript.
  const segments = useMemo(
    () =>
      transcript.segments.reduce<Array<{ tokens: string[]; offset: number }>>(
        (acc, segment) => {
          const previous = acc[acc.length - 1];
          const offset = previous
            ? previous.offset + previous.tokens.length
            : 0;
          return [...acc, { tokens: tokenize(segment.text), offset }];
        },
        [],
      ),
    [transcript],
  );
  const originalTokens = useMemo(
    () => segments.flatMap((s) => s.tokens),
    [segments],
  );

  // Marked against the text as it is now, so edits show up too.
  const removed = useMemo(
    () =>
      isClean && done
        ? diffWords(originalTokens, tokenize(done.text)).removed
        : null,
    [isClean, done, originalTokens],
  );
  const removedCount = removed
    ? originalTokens.filter((t, i) => removed[i] && isWord(t)).length
    : 0;

  // PRD §6: cleanup must not silently change meaning, so words the model
  // introduced are called out before the text is copied.
  const introduced = useMemo(
    () =>
      isClean && done ? newWords(originalTokens, tokenize(done.generated)) : [],
    [isClean, done, originalTokens],
  );

  const renderMarked = (flags: boolean[]) => (i: number) => {
    const { tokens, offset } = segments[i];
    return groupRuns(tokens, flags.slice(offset, offset + tokens.length)).map(
      (run, j) => (
        <Fragment key={j}>
          {j > 0 && " "}
          {run.marked ? <del>{run.text}</del> : run.text}
        </Fragment>
      ),
    );
  };

  const narrow = !showOriginal && "max-w-[760px]";

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-4 px-6 pt-7 pb-8">
      <h1 className="text-[28px] font-semibold tracking-[-0.015em]">Result</h1>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Processing mode"
          className="inline-flex gap-1 rounded-xl bg-track p-1"
        >
          <ModeButton
            active={isClean}
            icon={<AlignLeftIcon size={18} />}
            onClick={() => onSelectMode("clean")}
          >
            Clean transcript
          </ModeButton>
          <ModeButton
            active={!isClean}
            icon={<ListIcon size={18} />}
            onClick={() => onSelectMode("summarize")}
          >
            Summary
          </ModeButton>
        </div>
        <div className="flex-auto" />
        {/* Grouped so the two actions wrap together in a narrow window. */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setShowOriginal((shown) => !shown)}
            className={cx(
              "inline-flex h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-line-strong px-4 text-[15px] font-medium text-ink",
              showOriginal ? "bg-track" : "bg-surface hover:bg-canvas",
            )}
          >
            <EyeIcon size={18} />
            {showOriginal ? "Hide original" : "Show original"}
          </button>
          <Button
            variant="primary"
            size="wide"
            className="min-w-32"
            disabled={!done}
            onClick={() => done && copy(done.text)}
          >
            {copied ? (
              <CheckIcon size={18} strokeWidth={2.5} />
            ) : (
              <CopyIcon size={18} />
            )}
            {copied ? "Copied" : "Copy text"}
          </Button>
        </div>
        <span aria-live="polite" className="sr-only">
          {copied ? "Copied to clipboard" : ""}
        </span>
      </div>

      {copyError && (
        <p role="alert" className="text-sm text-record-ink">
          Couldn't copy the text: {copyError.message}
        </p>
      )}

      <p className="flex items-start gap-2 text-sm leading-normal text-muted">
        <InfoIcon size={16} className="mt-0.5 shrink-0" />
        {isClean
          ? "Cleanup removes filler words and repeats and fixes punctuation. Every removal is marked in the original."
          : "Summaries leave out detail. Check names, dates and numbers against the original before you share it."}
      </p>

      {done && isClean && !edited && introduced.length > 0 && (
        <section
          aria-labelledby={checkId}
          className="flex flex-wrap items-center gap-4 rounded-2xl border border-record bg-surface p-5"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-record-soft text-record"
          >
            <EyeIcon size={20} />
          </span>
          <div className="min-w-0 flex-[1_1_320px]">
            <h2 id={checkId} className="text-base font-semibold">
              Review before copying
            </h2>
            <p className="mt-0.5 text-[15px] leading-[1.55] text-muted">
              The cleaned text includes {plural(introduced.length, "word")} that{" "}
              {introduced.length === 1 ? "wasn't" : "weren't"} in your
              recording: {introduced.map((w) => `“${w}”`).join(", ")}. Check
              they don't change what you meant.
            </p>
          </div>
          <Button onClick={() => onEdit("clean", original)}>
            Use original
          </Button>
        </section>
      )}

      <div className="flex flex-wrap items-stretch gap-5">
        {showOriginal && (
          <section
            aria-labelledby="orig-h"
            className={cx(
              surface,
              "flex min-w-0 flex-[1_1_440px] flex-col gap-4 rounded-2xl p-6",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="orig-h" className="text-base font-semibold">
                Original transcript
              </h2>
              {removed && (
                <span className="text-[13px] text-muted">
                  <del>struck</del> removed in cleanup ·{" "}
                  {plural(removedCount, "word")}
                </span>
              )}
            </div>
            <SegmentList
              compact
              segments={transcript.segments}
              renderText={removed ? renderMarked(removed) : undefined}
            />
          </section>
        )}

        {result?.status === "failed" ? (
          <ErrorCard
            error={result.error}
            model={model}
            className="min-w-0 flex-[1_1_440px]"
          >
            <Button variant="primary" onClick={() => onRetry(mode)}>
              Try again
            </Button>
            {result.error.code === "model_not_installed" && (
              <Button onClick={onOpenSetup}>Download model</Button>
            )}
          </ErrorCard>
        ) : (
          <section
            aria-labelledby="result-h"
            className={cx(
              surface,
              "flex min-w-0 flex-[1_1_440px] flex-col gap-3 rounded-2xl p-6",
            )}
          >
            <div
              className={cx(
                "mx-auto flex min-h-8 w-full flex-wrap items-center justify-between gap-2",
                narrow,
              )}
            >
              {done ? (
                <label
                  id="result-h"
                  htmlFor="result-text"
                  className="text-base font-semibold"
                >
                  {MODE_LABEL[mode]}{" "}
                  <span className="font-normal text-muted">
                    · you can edit this
                  </span>
                </label>
              ) : (
                <h2 id="result-h" className="text-base font-semibold">
                  {MODE_LABEL[mode]}
                </h2>
              )}
              {edited && (
                <span className="inline-flex items-center gap-1 text-[13px] text-muted">
                  Edited
                  <button
                    type="button"
                    onClick={() => onRestore(mode)}
                    className="min-h-8 cursor-pointer px-2 font-semibold text-ink underline"
                  >
                    Restore
                  </button>
                </span>
              )}
            </div>

            <div
              className={cx(
                "mx-auto flex w-full flex-auto flex-col gap-3",
                narrow,
              )}
            >
              {done ? (
                <>
                  <textarea
                    id="result-text"
                    value={done.text}
                    onChange={(e) => onEdit(mode, e.target.value)}
                    className="block min-h-[380px] w-full flex-auto resize-y rounded-xl border border-line-strong bg-surface p-5 text-lg leading-[1.7] text-ink"
                  />
                  <p className="font-mono text-xs text-muted">
                    {plural(countWords(done.text), "word")} · original{" "}
                    {countWords(original)} ·{" "}
                    {isClean ? "cleaned" : "summarized"} by {model} on this
                    computer
                  </p>
                </>
              ) : (
                <div className="flex min-h-[380px] flex-auto flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-line-strong p-8 text-center">
                  <p id={pendingId} className="text-base font-medium">
                    {isClean ? "Cleaning up" : "Summarizing"} with{" "}
                    <Mono>{model}</Mono>…
                  </p>
                  <div className="w-full max-w-xs">
                    <ProgressBar value={null} labelledBy={pendingId} />
                  </div>
                  <p className="text-sm text-muted">
                    Running on this computer. Long recordings can take a minute.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Button variant="link" onClick={onBack}>
          Back to transcript
        </Button>
        <Button variant="link" onClick={onStartOver}>
          Start over with new audio
        </Button>
      </div>
    </main>
  );
}
