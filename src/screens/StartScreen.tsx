import { useCallback, useEffect, useState } from "react";
import { ErrorCard } from "../components/ErrorCard";
import {
  LockIcon,
  MicIcon,
  TrashIcon,
  UploadIcon,
  WifiOffIcon,
} from "../components/icons";
import { Button, cx, fieldClass, surface } from "../components/ui";
import { useEventSubscription } from "../hooks/useEventSubscription";
import type { AppError } from "../lib/errors";
import {
  AUDIO_EXTENSIONS,
  listInputDevices,
  onFileDrop,
  type InputDevice,
} from "../lib/ipc";

function useInputDevices(): InputDevice[] {
  const [devices, setDevices] = useState<InputDevice[]>([]);
  useEffect(() => {
    let active = true;
    // Best effort: without a list, recording uses the system default device.
    listInputDevices().then(
      (list) => {
        if (active) setDevices(list);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  return devices;
}

export function StartScreen({
  error,
  model,
  onStartRecording,
  onChooseFile,
  onOpenFile,
}: {
  error?: AppError;
  model: string;
  onStartRecording: (device: InputDevice | null) => void;
  onChooseFile: () => void;
  onOpenFile: (path: string) => void;
}) {
  const devices = useInputDevices();
  const [deviceId, setDeviceId] = useState<string>();
  const device =
    devices.find((d) => d.id === deviceId) ??
    devices.find((d) => d.isDefault) ??
    devices[0] ??
    null;

  const [dragging, setDragging] = useState(false);
  const subscribe = useCallback(
    () =>
      onFileDrop({
        onHover: setDragging,
        onDrop: (paths) => {
          setDragging(false);
          if (paths[0]) onOpenFile(paths[0]);
        },
      }),
    [onOpenFile],
  );
  useEventSubscription(subscribe);

  return (
    <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
          Turn speech into clean text
        </h1>
        <p className="max-w-[620px] text-[17px] leading-[1.55] text-muted">
          Record or upload audio. VoxClean transcribes it with Whisper and
          tidies it with Ollama, all on this computer.
        </p>
      </div>

      {error && (
        <ErrorCard error={error} model={model}>
          {error.code === "unsupported_format" && (
            <Button variant="primary" onClick={onChooseFile}>
              Choose another file
            </Button>
          )}
          {error.code === "microphone_unavailable" && (
            <Button variant="primary" onClick={() => onStartRecording(device)}>
              Try again
            </Button>
          )}
        </ErrorCard>
      )}

      <div className="flex flex-wrap gap-5">
        <section
          aria-labelledby="record-title"
          className={cx(
            surface,
            "flex flex-[1_1_340px] flex-col gap-5 rounded-2xl p-7",
          )}
        >
          <div className="flex items-center gap-3.5">
            <span
              aria-hidden="true"
              className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-record-soft text-record"
            >
              <MicIcon size={22} />
            </span>
            <div>
              <h2 id="record-title" className="text-xl font-semibold">
                Record
              </h2>
              <p className="mt-0.5 text-[15px] text-muted">
                Speak naturally. Ums and restarts are fine.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mic" className="text-sm font-medium">
              Microphone
            </label>
            <select
              id="mic"
              value={device?.id ?? ""}
              onChange={(e) => setDeviceId(e.target.value)}
              className={fieldClass}
            >
              {devices.length === 0 ? (
                <option value="">System default microphone</option>
              ) : (
                devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <Button
            variant="record"
            className="mt-auto w-full gap-2.5"
            onClick={() => onStartRecording(device)}
          >
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full bg-white"
            />
            Start recording
          </Button>
        </section>

        <section
          aria-labelledby="upload-title"
          className={cx(
            surface,
            "flex flex-[1_1_340px] flex-col gap-5 rounded-2xl p-7",
          )}
        >
          <div className="flex items-center gap-3.5">
            <span
              aria-hidden="true"
              className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-canvas text-ink"
            >
              <UploadIcon size={22} />
            </span>
            <div>
              <h2 id="upload-title" className="text-xl font-semibold">
                Upload a file
              </h2>
              <p className="mt-0.5 text-[15px] text-muted">
                Use a recording you already have.
              </p>
            </div>
          </div>
          <div
            className={cx(
              // 191px: the design's 140px min-height plus padding and border.
              "flex min-h-[191px] flex-auto flex-col items-center justify-center gap-3 rounded-xl border-[1.5px] border-dashed p-6 text-center",
              dragging
                ? "border-ink bg-canvas"
                : "border-line-strong bg-sunken",
            )}
          >
            <p className="text-base font-medium">
              {dragging ? "Drop to open it" : "Drop an audio file here"}
            </p>
            <Button variant="outline" onClick={onChooseFile}>
              Choose file
            </Button>
            <p className="font-mono text-xs text-muted">
              {AUDIO_EXTENSIONS.map((ext) => ext.toUpperCase()).join(" · ")}
            </p>
          </div>
        </section>
      </div>

      <ul
        aria-label="Privacy"
        className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-muted"
      >
        <li className="flex items-center gap-2">
          <LockIcon size={16} />
          Audio and text never leave this computer
        </li>
        <li className="flex items-center gap-2">
          <TrashIcon size={16} />
          Recordings are cleared when you close VoxClean
        </li>
        <li className="flex items-center gap-2">
          <WifiOffIcon size={16} />
          Works offline once models are installed
        </li>
      </ul>
    </main>
  );
}
