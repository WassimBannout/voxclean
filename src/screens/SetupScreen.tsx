import { useEffect, useId, useState, type ReactNode } from "react";
import { ErrorCard } from "../components/ErrorCard";
import {
  AlertTriangleIcon,
  CheckIcon,
  DownloadIcon,
} from "../components/icons";
import {
  Badge,
  Button,
  CommandSnippet,
  Mono,
  ProgressBar,
  cx,
  surface,
} from "../components/ui";
import { useCopy } from "../hooks/useCopy";
import { isReady } from "../hooks/useSystemStatus";
import { toAppError, type AppError } from "../lib/errors";
import { fileName, whisperModelName } from "../lib/format";
import {
  onModelPullProgress,
  pullModel,
  type PullProgress,
  type SystemStatus,
} from "../lib/ipc";

type PullState =
  | { kind: "idle" }
  | { kind: "pulling"; progress: PullProgress | null }
  | { kind: "failed"; error: AppError };

type RowState = "ready" | "active" | "todo";

function SetupRow({
  state,
  title,
  titleId,
  detail,
  badge,
  children,
}: {
  state: RowState;
  title: string;
  titleId?: string;
  detail: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li
      className={cx(
        "flex flex-col gap-3.5 rounded-[14px] border bg-surface p-5",
        state === "active" ? "border-ink" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span
          aria-hidden="true"
          className={cx(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
            state === "ready" && "bg-ok-soft text-ok",
            state === "active" && "bg-ink text-white",
            state === "todo" && "bg-record-soft text-record",
          )}
        >
          {state === "ready" && <CheckIcon size={18} strokeWidth={2.5} />}
          {state === "active" && <DownloadIcon size={18} />}
          {state === "todo" && <AlertTriangleIcon size={18} />}
        </span>
        <div className="min-w-0 flex-[1_1_260px]">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{detail}</p>
        </div>
        {badge}
      </div>
      {children}
    </li>
  );
}

function FixSteps({
  command,
  onCheck,
  children,
}: {
  command: string;
  onCheck: () => void;
  children: ReactNode;
}) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm text-muted">{children}</p>
      <CommandSnippet command={command} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => copy(command)}>
          {copied ? "Copied" : "Copy command"}
        </Button>
        <Button onClick={onCheck}>Check again</Button>
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function SetupScreen({
  status,
  error,
  firstRun,
  onRefresh,
  onDone,
}: {
  status?: SystemStatus;
  error?: AppError;
  /** Shown before the app can be used; otherwise opened from settings. */
  firstRun: boolean;
  onRefresh: () => Promise<void>;
  onDone: () => void;
}) {
  const [pull, setPull] = useState<PullState>({ kind: "idle" });
  const ready = status ? isReady(status) : false;
  const pulling = pull.kind === "pulling";
  const modelTitleId = useId();
  const check = () => void onRefresh();

  // Notice `ollama serve` or a model copied in by hand without a restart.
  useEffect(() => {
    if (ready || pulling) return;
    const id = window.setInterval(() => void onRefresh(), 4000);
    return () => window.clearInterval(id);
  }, [ready, pulling, onRefresh]);

  async function download() {
    setPull({ kind: "pulling", progress: null });
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await onModelPullProgress((progress) =>
        setPull({ kind: "pulling", progress }),
      );
      await pullModel();
      setPull({ kind: "idle" });
      await onRefresh();
    } catch (err) {
      setPull({ kind: "failed", error: toAppError(err) });
    } finally {
      unlisten?.();
    }
  }

  const progress =
    pull.kind === "pulling" && pull.progress?.total
      ? (pull.progress.completed ?? 0) / pull.progress.total
      : null;

  return (
    <main className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-6 px-6 pt-10 pb-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-[32px] leading-[1.15] font-semibold tracking-[-0.02em]">
          Set up local models
        </h1>
        <p className="text-base leading-[1.55] text-muted">
          VoxClean needs a speech model and a language model on this computer.
          Once they're installed, it works without an internet connection.
        </p>
      </div>

      {error && (
        <ErrorCard error={error} model={status?.ollama.model ?? ""}>
          <Button variant="primary" onClick={check}>
            Try again
          </Button>
        </ErrorCard>
      )}

      {status && (
        <ol className="flex flex-col gap-3">
          <WhisperRow whisper={status.whisper} onCheck={check} />

          <SetupRow
            state={status.ollama.reachable ? "ready" : "todo"}
            title="Ollama"
            detail={
              <>
                {status.ollama.reachable ? "Running at" : "Not running at"}{" "}
                <Mono className="text-ink">{hostOf(status.ollama.url)}</Mono>
              </>
            }
            badge={
              <Badge tone={status.ollama.reachable ? "ok" : "warn"}>
                {status.ollama.reachable ? "Running" : "Not running"}
              </Badge>
            }
          >
            {!status.ollama.reachable && (
              <FixSteps command="ollama serve" onCheck={check}>
                Start Ollama, or open the Ollama app:
              </FixSteps>
            )}
          </SetupRow>

          <SetupRow
            state={
              status.ollama.modelInstalled
                ? "ready"
                : pulling
                  ? "active"
                  : "todo"
            }
            title="Language model for cleanup and summaries"
            titleId={modelTitleId}
            detail={
              <>
                <Mono className="text-ink">{status.ollama.model}</Mono>
                {status.ollama.modelInstalled
                  ? ", installed in Ollama"
                  : pulling
                    ? ", downloading through Ollama"
                    : status.ollama.reachable
                      ? ", not installed yet"
                      : ", needs Ollama running"}
              </>
            }
            badge={
              status.ollama.modelInstalled ? (
                <Badge tone="ok">Installed</Badge>
              ) : (
                progress !== null && (
                  <Mono className="text-sm">{Math.round(progress * 100)}%</Mono>
                )
              )
            }
          >
            {pulling && (
              <>
                <ProgressBar value={progress} labelledBy={modelTitleId} />
                <p className="text-[13px] text-muted">
                  This is the only step that needs the internet. Keep VoxClean
                  open until it finishes.
                </p>
              </>
            )}
            {!pulling &&
              status.ollama.reachable &&
              !status.ollama.modelInstalled && (
                <div className="flex flex-col gap-2.5">
                  {pull.kind === "failed" && (
                    <p role="alert" className="text-sm text-record-ink">
                      The download stopped: {pull.error.message}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Button variant="primary" onClick={download}>
                      <DownloadIcon size={16} />
                      {pull.kind === "failed" ? "Try again" : "Download"}
                    </Button>
                    <p className="text-[13px] text-muted">
                      Downloads through Ollama. This is the only step that needs
                      the internet.
                    </p>
                  </div>
                </div>
              )}
          </SetupRow>
        </ol>
      )}

      <section
        aria-labelledby="privacy-title"
        className={cx(surface, "flex flex-col gap-2 rounded-[14px] p-5")}
      >
        <h2 id="privacy-title" className="text-base font-semibold">
          Privacy
        </h2>
        <p className="text-sm leading-normal text-muted">
          Recordings and transcripts are kept in memory only. Everything is
          cleared when you close VoxClean.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {firstRun ? (
          <>
            <Button
              variant="primary"
              size="lg"
              disabled={!ready}
              onClick={onDone}
            >
              Continue
            </Button>
            {!ready && (
              <p className="text-sm text-muted">
                Available when all three are ready.
              </p>
            )}
          </>
        ) : (
          <Button variant="primary" size="lg" onClick={onDone}>
            Back to VoxClean
          </Button>
        )}
      </div>
    </main>
  );
}

function WhisperRow({
  whisper,
  onCheck,
}: {
  whisper: SystemStatus["whisper"];
  onCheck: () => void;
}) {
  const name = whisperModelName(whisper.modelPath);
  const file = fileName(whisper.modelPath);
  const folder = whisper.modelPath
    .slice(0, whisper.modelPath.length - file.length)
    .replace(/[\\/]$/, "");
  const command = `mkdir -p "${folder}" && curl -L -o "${whisper.modelPath}" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`;

  return (
    <SetupRow
      state={whisper.modelFound ? "ready" : "todo"}
      title="Speech recognition"
      detail={
        <>
          Whisper model <Mono className="text-ink">{name}</Mono>,{" "}
          {name.endsWith(".en") ? "English only" : "multilingual"}
        </>
      }
      badge={
        <Badge tone={whisper.modelFound ? "ok" : "warn"}>
          {whisper.modelFound ? "Installed" : "Not installed"}
        </Badge>
      }
    >
      {!whisper.modelFound && (
        <FixSteps command={command} onCheck={onCheck}>
          Download <Mono>{file}</Mono> into{" "}
          <Mono className="break-all">{folder}</Mono>, for example with:
        </FixSteps>
      )}
    </SetupRow>
  );
}
