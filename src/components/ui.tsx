import type { ButtonHTMLAttributes, ReactNode } from "react";
import { formatClock } from "../lib/format";
import type { Segment } from "../lib/ipc";

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/** White card on the canvas; callers add radius and padding. */
export const surface = "border border-line bg-surface";

export const fieldClass =
  "h-11 rounded-[10px] border border-line-strong bg-surface px-3 text-[15px] text-ink disabled:bg-canvas disabled:text-muted";

// Variant sets color and weight; size sets the box and text, so the two never
// fight over the same CSS property.
const buttonVariants = {
  primary: "bg-ink font-semibold text-white hover:bg-black",
  secondary:
    "border border-line-strong bg-surface font-medium text-ink hover:bg-canvas",
  outline:
    "border border-ink bg-surface font-semibold text-ink hover:bg-canvas",
  record: "bg-record font-semibold text-white hover:bg-record-ink",
  link: "text-ink underline underline-offset-2 hover:text-black",
} as const;

const buttonSizes = {
  md: "h-11 rounded-[10px] px-4 text-sm",
  /** The design's 15px buttons: the Result toolbar and "Choose file". */
  wide: "h-11 rounded-[10px] px-[18px] text-[15px]",
  lg: "h-13 rounded-xl px-7 text-base",
  inline: "min-h-11 text-sm",
} as const;

const defaultSize: Record<
  keyof typeof buttonVariants,
  keyof typeof buttonSizes
> = {
  primary: "md",
  secondary: "md",
  outline: "wide",
  record: "lg",
  link: "inline",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
}

export function Button({
  variant = "secondary",
  size = defaultSize[variant],
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex cursor-pointer items-center justify-center gap-2 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-line disabled:text-muted",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
}

/** `value` is 0–1, or `null` while the amount of work is unknown. */
export function ProgressBar({
  value,
  label,
  labelledBy,
}: {
  value: number | null;
  label?: string;
  labelledBy?: string;
}) {
  const percent =
    value === null
      ? undefined
      : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-2 overflow-hidden rounded-full bg-line"
    >
      <div
        className={cx(
          "h-full rounded-full bg-ink",
          percent === undefined &&
            "w-1/3 animate-indeterminate motion-reduce:animate-none",
        )}
        style={percent === undefined ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "ok" | "warn";
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-semibold",
        tone === "ok"
          ? "bg-ok-soft text-ok-ink"
          : "bg-record-soft text-record-ink",
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx("size-2 shrink-0 rounded-full", ok ? "bg-ok" : "bg-record")}
    />
  );
}

export function Mono({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cx("font-mono", className)}>{children}</span>;
}

export function CommandSnippet({ command }: { command: string }) {
  return (
    <code className="block overflow-x-auto rounded-lg bg-canvas px-3 py-2.5 font-mono text-[13px] whitespace-pre text-ink">
      {command}
    </code>
  );
}

/**
 * Vertical bars 10 units apart, like the design's level meter and waveform.
 * Values are 0–1; the SVG takes its color from `currentColor`.
 */
export function BarGraph({
  values,
  height,
  label,
  highlightLast = false,
  className,
}: {
  values: number[];
  height: number;
  label?: string;
  highlightLast?: boolean;
  className?: string;
}) {
  const mid = height / 2;
  const bar = (value: number, i: number) => {
    const half = Math.max(1, Math.min(1, Math.max(0, value)) * (mid - 4));
    return `M${5 + i * 10} ${mid - half}V${mid + half}`;
  };
  const last = values.length - 1;
  const a11y = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true };
  return (
    <svg
      viewBox={`0 0 ${Math.max(values.length, 1) * 10} ${height}`}
      fill="none"
      strokeLinecap="round"
      strokeWidth={4}
      className={className}
      {...a11y}
    >
      <path
        className="stroke-current"
        d={values
          .map((v, i) => (highlightLast && i === last ? "" : bar(v, i)))
          .join("")}
      />
      {highlightLast && last >= 0 && (
        <path className="stroke-record" d={bar(values[last], last)} />
      )}
    </svg>
  );
}

/** Transcript segments with their start times. */
export function SegmentList({
  segments,
  compact = false,
  renderText,
}: {
  segments: Segment[];
  compact?: boolean;
  renderText?: (index: number) => ReactNode;
}) {
  return (
    <ol className={cx("flex flex-col", compact ? "gap-3" : "gap-3.5")}>
      {segments.map((segment, i) => (
        <li
          key={i}
          className={cx(
            "grid items-baseline",
            compact
              ? "grid-cols-[48px_minmax(0,1fr)] gap-3"
              : "grid-cols-[56px_minmax(0,1fr)] gap-4",
          )}
        >
          <span
            className={cx(
              "font-mono text-muted",
              compact ? "text-xs" : "text-[13px]",
            )}
          >
            {formatClock(segment.startMs)}
          </span>
          <p
            className={
              compact ? "text-base leading-[1.7]" : "text-[17px] leading-[1.65]"
            }
          >
            {renderText ? renderText(i) : segment.text.trim()}
          </p>
        </li>
      ))}
    </ol>
  );
}
