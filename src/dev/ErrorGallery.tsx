import { ErrorCard } from "../components/ErrorCard";
import { Button } from "../components/ui";

const MODEL = "gemma3:4b";

/**
 * The design's "Errors and edge states" board, built from the real
 * ErrorCard (`?screen=errors`). The board's sixth card, the meaning check,
 * lives on the Result screen instead.
 */
export function ErrorGallery() {
  return (
    <main className="grid min-h-screen grid-cols-3 content-start gap-6 p-12">
      <h1 className="sr-only">Errors and edge states</h1>
      <ErrorCard
        error={{ code: "ollama_unavailable", message: "" }}
        model={MODEL}
      >
        <Button variant="primary">Try again</Button>
      </ErrorCard>
      <ErrorCard
        error={{ code: "model_not_installed", message: "" }}
        model={MODEL}
      >
        <Button variant="primary">Download model</Button>
      </ErrorCard>
      <ErrorCard
        error={{
          code: "unsupported_format",
          message:
            "“voice-memo.wma” isn't a format VoxClean can read. Use a WAV, MP3, M4A, FLAC or OGG file instead.",
        }}
        model={MODEL}
      >
        <Button variant="primary">Choose another file</Button>
      </ErrorCard>
      <ErrorCard
        error={{ code: "microphone_unavailable", message: "" }}
        model={MODEL}
      >
        <Button variant="primary">Try again</Button>
      </ErrorCard>
      <ErrorCard error={{ code: "no_speech", message: "" }} model={MODEL}>
        <Button variant="primary">Record again</Button>
        <Button>Upload instead</Button>
      </ErrorCard>
    </main>
  );
}
