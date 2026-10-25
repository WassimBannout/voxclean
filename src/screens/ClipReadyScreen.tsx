import { useState } from "react";
import { ErrorCard } from "../components/ErrorCard";
import {
  ArrowRightIcon,
  RotateCcwIcon,
  TrashIcon,
  UploadIcon,
} from "../components/icons";
import { BarGraph, Button, cx, fieldClass, surface } from "../components/ui";
import type { AppError } from "../lib/errors";
import { formatDuration, recordingTitle } from "../lib/format";
import type { AudioSource } from "../lib/workflow";

const LANGUAGES: Array<[code: string, name: string]> = [
  ["auto", "Detect automatically"],
  ["en", "English"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["ar", "Arabic"],
  ["zh", "Chinese"],
  ["ja", "Japanese"],
];

export function ClipReadyScreen({
  source,
  error,
  model,
  whisper,
  onTranscribe,
  onRecordAgain,
  onChooseFile,
  onRemove,
  onOpenSetup,
}: {
  source: AudioSource;
  error?: AppError;
  model: string;
  whisper: { name: string; found: boolean };
  onTranscribe: (language: string | null) => void;
  onRecordAgain: () => void;
  onChooseFile: () => void;
  onRemove: () => void;
  onOpenSetup: () => void;
}) {
  // English-only Whisper models (".en") can't transcribe anything else.
  const englishOnly = whisper.name.endsWith(".en");
  const [language, setLanguage] = useState("auto");
  const chosen = englishOnly ? "en" : language;
  const transcribe = () => onTranscribe(chosen === "auto" ? null : chosen);

  const isRecording = source.kind === "recording";
  const title = isRecording ? recordingTitle(source.recordedAt) : source.name;
  const detail = isRecording
    ? `${source.deviceName} · kept until you close the app`
    : "Audio file · the original stays untouched";

  return (
    <main className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[30px] leading-[1.15] font-semibold tracking-[-0.015em]">
          Ready to transcribe
        </h1>
        <p className="text-base text-muted">
          Check the clip and settings, then start the transcription.
        </p>
      </div>

      <section
        aria-label="Audio clip"
        className={cx(surface, "flex flex-col gap-5 rounded-2xl p-6")}
      >
        {/* As tall as the design's 48px play button, which joins this row
            once playback exists. */}
        <div className="flex min-h-12 flex-wrap items-center gap-4">
          <div className="min-w-0 flex-[1_1_200px]">
            <p className="truncate text-base font-semibold">{title}</p>
            <p className="mt-0.5 text-sm text-muted">{detail}</p>
          </div>
          <span className="font-mono text-[15px]">
            {formatDuration(source.clip.durationMs)}
          </span>
        </div>
        {source.clip.peaks.length > 0 && (
          <BarGraph
            values={source.clip.peaks}
            height={64}
            className="h-auto w-full text-line-strong"
          />
        )}
        <div className="flex flex-wrap gap-3">
          {isRecording ? (
            <Button onClick={onRecordAgain}>
              <RotateCcwIcon size={16} />
              Record again
            </Button>
          ) : (
            <Button onClick={onChooseFile}>
              <UploadIcon size={16} />
              Choose another file
            </Button>
          )}
          <Button onClick={onRemove}>
            <TrashIcon size={16} />
            Remove
          </Button>
        </div>
      </section>

      <section
        aria-labelledby="settings-title"
        className={cx(surface, "flex flex-col gap-4 rounded-2xl p-6")}
      >
        <h2 id="settings-title" className="text-base font-semibold">
          Transcription
        </h2>
        <div className="flex flex-wrap gap-x-5 gap-y-4">
          <div className="flex flex-[1_1_240px] flex-col gap-1.5">
            <label htmlFor="lang" className="text-sm font-medium">
              Spoken language
            </label>
            <select
              id="lang"
              value={chosen}
              disabled={englishOnly}
              onChange={(e) => setLanguage(e.target.value)}
              className={fieldClass}
            >
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-[1_1_240px] flex-col gap-1.5">
            <label htmlFor="model" className="text-sm font-medium">
              Speech model
            </label>
            <select id="model" className={fieldClass}>
              <option>
                Whisper {whisper.name} (
                {whisper.found ? "installed" : "not installed"})
              </option>
            </select>
          </div>
        </div>
      </section>

      {error && (
        <ErrorCard error={error} model={model}>
          {error.code === "no_speech" ? (
            <>
              <Button variant="primary" onClick={onRecordAgain}>
                Record again
              </Button>
              <Button onClick={onChooseFile}>Upload instead</Button>
            </>
          ) : (
            <Button variant="primary" onClick={transcribe}>
              Try again
            </Button>
          )}
        </ErrorCard>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button
          variant="primary"
          size="lg"
          className="gap-2.5"
          disabled={!whisper.found}
          onClick={transcribe}
        >
          Transcribe
          <ArrowRightIcon size={18} />
        </Button>
        {whisper.found ? (
          <p className="text-sm text-muted">
            Runs on this computer with Whisper. Nothing is uploaded.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Install the speech model first.{" "}
            <Button variant="link" onClick={onOpenSetup}>
              Manage models
            </Button>
          </p>
        )}
      </div>
    </main>
  );
}
