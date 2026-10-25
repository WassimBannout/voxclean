import { useId, type ComponentType, type ReactNode } from "react";
import { useCopy } from "../hooks/useCopy";
import { describeError, type ErrorIcon } from "../lib/errorContent";
import type { AppError } from "../lib/errors";
import {
  AlertTriangleIcon,
  DownloadIcon,
  FileXIcon,
  MicOffIcon,
  VolumeXIcon,
  type IconProps,
} from "./icons";
import { Button, CommandSnippet, cx, surface } from "./ui";

const icons: Record<ErrorIcon, ComponentType<IconProps>> = {
  alert: AlertTriangleIcon,
  download: DownloadIcon,
  file: FileXIcon,
  micOff: MicOffIcon,
  mute: VolumeXIcon,
};

/** What went wrong, how to fix it, and what to do next. */
export function ErrorCard({
  error,
  model,
  children,
  className,
}: {
  error: AppError;
  /** The configured Ollama model, named in model errors. */
  model: string;
  /** Action buttons. A "Copy command" button is added when there's a fix. */
  children?: ReactNode;
  className?: string;
}) {
  const content = describeError(error, model);
  const { command } = content;
  const titleId = useId();
  const { copied, copy } = useCopy();
  const Icon = icons[content.icon];

  return (
    <section
      role="alert"
      aria-labelledby={titleId}
      className={cx(surface, "flex flex-col gap-3 rounded-2xl p-6", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          aria-hidden="true"
          className={cx(
            "inline-flex size-10 items-center justify-center rounded-full",
            content.tone === "warn"
              ? "bg-record-soft text-record"
              : "bg-canvas text-ink",
          )}
        >
          <Icon size={20} />
        </span>
        {content.area && (
          <span className="font-mono text-xs text-muted">{content.area}</span>
        )}
      </div>
      <h2 id={titleId} className="text-lg font-semibold">
        {content.title}
      </h2>
      <p className="text-[15px] leading-[1.55] text-muted">{content.body}</p>
      {command && <CommandSnippet command={command} />}
      {(children || command) && (
        <div className="mt-auto flex flex-wrap gap-2">
          {children}
          {command && (
            <Button onClick={() => copy(command)}>
              {copied ? "Copied" : "Copy command"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
