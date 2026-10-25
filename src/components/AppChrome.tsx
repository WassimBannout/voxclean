import type { ReactNode } from "react";
import { whisperModelName } from "../lib/format";
import type { SystemStatus } from "../lib/ipc";
import { CheckIcon, LockIcon, LogoMark, SlidersIcon } from "./icons";
import { Mono, StatusDot, cx } from "./ui";

const STEPS = ["Audio", "Transcript", "Result"];

export function AppHeader({
  step,
  onOpenSetup,
}: {
  step?: 1 | 2 | 3;
  onOpenSetup?: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-surface px-6 py-2.5">
      <div className="inline-flex min-h-11 items-center gap-2.5">
        <LogoMark />
        <span className="text-[17px] font-semibold tracking-[-0.01em]">
          VoxClean
        </span>
      </div>
      {step && <StepNav current={step} />}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-3 py-1.5 text-[13px] font-medium">
          <LockIcon size={14} />
          On this computer
        </span>
        {onOpenSetup && (
          <button
            type="button"
            aria-label="Models and settings"
            onClick={onOpenSetup}
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-[10px] text-ink hover:bg-canvas"
          >
            <SlidersIcon />
          </button>
        )}
      </div>
    </header>
  );
}

function StepNav({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav aria-label="Steps">
      <ol className="flex flex-wrap items-center gap-2.5 text-sm">
        {STEPS.map((label, i) => {
          const step = i + 1;
          const done = step < current;
          const active = step === current;
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className={cx(
                "flex items-center gap-2",
                active && "font-semibold",
                !done && !active && "text-muted",
              )}
            >
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={cx(
                    "h-px w-7",
                    step <= current ? "bg-ink" : "bg-rule",
                  )}
                />
              )}
              {done || active ? (
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 items-center justify-center rounded-full bg-ink text-xs text-white"
                >
                  {done ? <CheckIcon size={14} strokeWidth={3} /> : step}
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 items-center justify-center rounded-full border border-line-strong text-xs"
                >
                  {step}
                </span>
              )}
              {label}
              {done && <span className="sr-only">, done</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function AppFooter({
  status,
  transcribing = false,
  trailing,
}: {
  status?: SystemStatus;
  transcribing?: boolean;
  trailing: ReactNode;
}) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line bg-surface px-6 py-3 text-[13px] text-muted">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {status && <ModelStatus status={status} transcribing={transcribing} />}
      </div>
      {trailing}
    </footer>
  );
}

function ModelStatus({
  status: { whisper, ollama },
  transcribing,
}: {
  status: SystemStatus;
  transcribing: boolean;
}) {
  const whisperState = !whisper.modelFound
    ? "not installed"
    : transcribing
      ? "running"
      : "ready";
  return (
    <>
      <span className="inline-flex items-center gap-2">
        <StatusDot ok={whisper.modelFound} />
        Whisper{" "}
        <Mono className="text-ink">
          {whisperModelName(whisper.modelPath)}
        </Mono>{" "}
        {whisperState}
      </span>
      <span className="inline-flex items-center gap-2">
        <StatusDot ok={ollama.reachable && ollama.modelInstalled} />
        {ollama.reachable ? (
          <>
            Ollama <Mono className="text-ink">{ollama.model}</Mono>{" "}
            {ollama.modelInstalled ? "ready" : "not installed"}
          </>
        ) : (
          "Ollama not running"
        )}
      </span>
    </>
  );
}
