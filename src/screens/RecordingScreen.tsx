import { useCallback, useState, type ReactNode } from "react";
import { PauseIcon, PlayIcon, XIcon } from "../components/icons";
import { BarGraph, cx, surface } from "../components/ui";
import { useEventSubscription } from "../hooks/useEventSubscription";
import { useNow } from "../hooks/useNow";
import { formatClock } from "../lib/format";
import { onRecordingLevel } from "../lib/ipc";
import { recordingElapsedMs, type RecordingState } from "../lib/workflow";

const LEVEL_BARS = 36;

/** The most recent input levels, newest last. */
function useRecordingLevels(active: boolean): number[] {
  const [levels, setLevels] = useState<number[]>(() =>
    new Array<number>(LEVEL_BARS).fill(0),
  );
  const subscribe = useCallback(
    () =>
      onRecordingLevel((level) =>
        setLevels((previous) => [...previous.slice(1), level]),
      ),
    [],
  );
  useEventSubscription(active ? subscribe : null);
  return levels;
}

function RoundControl({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex cursor-pointer flex-col items-center gap-2 text-sm"
    >
      <span
        aria-hidden="true"
        className="mt-3 inline-flex size-14 items-center justify-center rounded-full border border-line-strong group-hover:bg-canvas"
      >
        {children}
      </span>
      {label}
    </button>
  );
}

export function RecordingScreen({
  recording,
  onStop,
  onPause,
  onResume,
  onDiscard,
}: {
  recording: RecordingState;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const paused = recording.resumedAt === null;
  const now = useNow(!paused);
  const clock = formatClock(recordingElapsedMs(recording, now));
  const levels = useRecordingLevels(!paused);

  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center gap-5 px-6 py-12">
      <section
        aria-labelledby="rec-title"
        className={cx(
          surface,
          "flex flex-col items-center gap-7 rounded-[20px] px-8 py-10 text-center",
        )}
      >
        <h1
          id="rec-title"
          className={cx(
            "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold",
            paused ? "bg-canvas text-ink" : "bg-record-soft text-record-ink",
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              "size-2 rounded-full",
              paused ? "bg-line-strong" : "bg-record",
            )}
          />
          {paused ? "Paused" : "Recording"}
        </h1>
        <div className="flex flex-col items-center gap-1.5">
          <p
            role="timer"
            aria-label={`Recording duration ${clock}`}
            className="font-mono text-[80px] leading-none font-medium tracking-[-0.03em]"
          >
            {clock}
          </p>
          <p className="text-sm text-muted">{recording.deviceName}</p>
        </div>
        <BarGraph
          values={levels}
          height={80}
          highlightLast={!paused}
          label="Microphone input level"
          className="h-auto w-full max-w-[520px] text-ink"
        />
        <div className="flex flex-wrap items-start justify-center gap-9">
          <RoundControl label="Discard" onClick={onDiscard}>
            <XIcon />
          </RoundControl>
          <button
            type="button"
            onClick={onStop}
            className="group flex cursor-pointer flex-col items-center gap-2 text-sm font-semibold"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-20 items-center justify-center rounded-full bg-record group-hover:bg-record-ink"
            >
              <span className="size-[26px] rounded-md bg-white" />
            </span>
            Stop
          </button>
          {paused ? (
            <RoundControl label="Resume" onClick={onResume}>
              <PlayIcon />
            </RoundControl>
          ) : (
            <RoundControl label="Pause" onClick={onPause}>
              <PauseIcon />
            </RoundControl>
          )}
        </div>
      </section>
      <p className="text-center text-sm leading-normal text-muted">
        The recording is kept in memory only and cleared when you close
        VoxClean.
      </p>
    </main>
  );
}
