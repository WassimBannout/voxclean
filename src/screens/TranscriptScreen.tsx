import type { ReactNode } from "react";
import { AlignLeftIcon, ArrowRightIcon, ListIcon } from "../components/icons";
import { Button, Mono, SegmentList, cx, surface } from "../components/ui";
import { countWords } from "../lib/diff";
import { formatDuration, languageLabel, plural } from "../lib/format";
import type { ProcessingMode, Transcript } from "../lib/ipc";
import { transcriptText } from "../lib/workflow";

function ChoiceButton({
  icon,
  title,
  description,
  primary = false,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-start gap-3.5 rounded-[14px] border border-line-strong bg-surface p-5 text-left text-ink hover:border-ink"
    >
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-[10px]",
          primary ? "bg-ink text-white" : "bg-canvas text-ink",
        )}
      >
        {icon}
      </span>
      <span className="flex flex-auto flex-col gap-1">
        <span className="text-[17px] font-semibold">{title}</span>
        <span className="text-sm leading-normal text-muted">{description}</span>
      </span>
      <ArrowRightIcon size={18} className="mt-[11px] shrink-0" />
    </button>
  );
}

export function TranscriptScreen({
  transcript,
  durationMs,
  model,
  onChoose,
  onStartOver,
}: {
  transcript: Transcript;
  durationMs: number;
  model: string;
  onChoose: (mode: ProcessingMode) => void;
  onStartOver: () => void;
}) {
  const words = countWords(transcriptText(transcript));

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 pt-8 pb-10">
      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-labelledby="orig-title"
          className={cx(
            surface,
            "flex min-w-0 flex-[999_1_560px] flex-col gap-5 rounded-2xl p-7",
          )}
        >
          <div className="flex flex-col gap-1">
            <h1
              id="orig-title"
              className="text-[28px] font-semibold tracking-[-0.015em]"
            >
              Original transcript
            </h1>
            <p className="text-sm text-muted">
              <Mono>{formatDuration(durationMs)}</Mono> ·{" "}
              {plural(words, "word")} ·{" "}
              {languageLabel(transcript.language, transcript.languageDetected)}
            </p>
          </div>
          <SegmentList segments={transcript.segments} />
        </section>

        <aside
          aria-labelledby="next-title"
          className="flex flex-[1_1_300px] flex-col gap-3.5"
        >
          <h2 id="next-title" className="text-lg font-semibold">
            What should VoxClean do with it?
          </h2>
          <ChoiceButton
            primary
            icon={<AlignLeftIcon />}
            title="Clean transcript"
            description="Removes ums, uhs and repeated words and fixes punctuation. Keeps your wording."
            onClick={() => onChoose("clean")}
          />
          <ChoiceButton
            icon={<ListIcon />}
            title="Summarize"
            description="Condenses it into the main points."
            onClick={() => onChoose("summarize")}
          />
          <p className="mt-1 text-sm leading-normal text-muted">
            Both run with Ollama (<Mono className="text-ink">{model}</Mono>) on
            this computer. The original stays available to compare.
          </p>
          <Button variant="link" className="self-start" onClick={onStartOver}>
            Start over with new audio
          </Button>
        </aside>
      </div>
    </main>
  );
}
