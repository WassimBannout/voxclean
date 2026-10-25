import { CheckIcon } from "../components/icons";
import { Button, Mono, ProgressBar, cx, surface } from "../components/ui";
import { formatDuration } from "../lib/format";

export function TranscribingScreen({
  durationMs,
  progress,
  whisperName,
  onCancel,
}: {
  durationMs: number;
  progress: number | null;
  whisperName: string;
  onCancel: () => void;
}) {
  const percent = progress === null ? null : Math.round(progress * 100);

  return (
    <main className="mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center px-6 py-12">
      <section
        aria-labelledby="t-title"
        className={cx(surface, "flex flex-col gap-6 rounded-[20px] p-9")}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1
            id="t-title"
            className="text-[28px] font-semibold tracking-[-0.015em]"
          >
            Transcribing…
          </h1>
          {percent !== null && (
            <Mono className="text-base text-muted">{percent}%</Mono>
          )}
        </div>
        <ProgressBar value={progress} labelledBy="t-title" />
        <ol className="flex flex-col gap-4">
          <li className="flex items-start gap-3.5">
            <span
              aria-hidden="true"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok"
            >
              <CheckIcon size={16} strokeWidth={2.5} />
            </span>
            <div>
              <p className="text-base font-semibold">Audio prepared</p>
              <p className="mt-0.5 text-sm text-muted">
                {formatDuration(durationMs)} of audio, converted to 16 kHz mono
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3.5" aria-current="step">
            <span
              aria-hidden="true"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-ink"
            >
              <span className="size-2.5 rounded-full bg-ink" />
            </span>
            <div>
              <p className="text-base font-semibold">
                Transcribing with Whisper{" "}
                <Mono className="text-sm font-medium">{whisperName}</Mono>
              </p>
              {progress !== null && (
                <p className="mt-0.5 text-sm text-muted">
                  <Mono>
                    {formatDuration(progress * durationMs)} /{" "}
                    {formatDuration(durationMs)}
                  </Mono>{" "}
                  processed
                </p>
              )}
            </div>
          </li>
          <li className="flex items-start gap-3.5 text-muted">
            <span
              aria-hidden="true"
              className="size-7 shrink-0 rounded-full border border-line-strong"
            />
            <p className="text-base font-medium">
              Original transcript ready to review
            </p>
          </li>
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-line pt-5">
          <p className="flex-[1_1_300px] text-sm leading-normal text-muted">
            Running on this computer. You can switch to other apps while you
            wait.
          </p>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </section>
    </main>
  );
}
