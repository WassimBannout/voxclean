import { useState } from "react";
import { AppFooter, AppHeader } from "./components/AppChrome";
import { ErrorCard } from "./components/ErrorCard";
import { Button } from "./components/ui";
import { isReady, useSystemStatus } from "./hooks/useSystemStatus";
import { useVoxClean, type VoxCleanActions } from "./hooks/useVoxClean";
import { whisperModelName } from "./lib/format";
import type { SystemStatus } from "./lib/ipc";
import { currentStep, type WorkflowState } from "./lib/workflow";
import { ClipReadyScreen } from "./screens/ClipReadyScreen";
import { RecordingScreen } from "./screens/RecordingScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { StartScreen } from "./screens/StartScreen";
import { TranscribingScreen } from "./screens/TranscribingScreen";
import { TranscriptScreen } from "./screens/TranscriptScreen";

type View = "loading" | "flow" | "setup";

export default function App({
  initialState,
}: {
  /** Where the flow starts; the browser preview uses it to open any screen. */
  initialState?: WorkflowState;
}) {
  const { status, error: statusError, refresh } = useSystemStatus();
  const { state, actions } = useVoxClean(initialState);
  const [view, setView] = useState<View>("loading");
  const [firstRun, setFirstRun] = useState(false);

  // The first status picks the first screen: setup while anything is missing.
  if (view === "loading" && status) {
    setFirstRun(!isReady(status));
    setView(isReady(status) ? "flow" : "setup");
  }

  const openSetup = () => setView("setup");

  if (view !== "flow") {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        {view === "setup" ? (
          <SetupScreen
            status={status}
            error={statusError}
            firstRun={firstRun}
            onRefresh={refresh}
            onDone={() => {
              setFirstRun(false);
              setView("flow");
            }}
          />
        ) : (
          <main className="mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center px-6 py-12">
            {statusError ? (
              <ErrorCard error={statusError} model="">
                <Button variant="primary" onClick={() => void refresh()}>
                  Try again
                </Button>
              </ErrorCard>
            ) : (
              <p className="text-center text-sm text-muted">
                Checking local models…
              </p>
            )}
          </main>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader step={currentStep(state)} onOpenSetup={openSetup} />
      <FlowScreen
        state={state}
        actions={actions}
        status={status}
        onOpenSetup={openSetup}
      />
      <AppFooter
        status={status}
        transcribing={state.status === "transcribing"}
        trailing={
          state.status === "result" ? (
            <span>Nothing is saved after you close VoxClean</span>
          ) : (
            <button
              type="button"
              onClick={openSetup}
              // A 40px tap target, nearly the footer's full height, without
              // making the footer taller than the design's.
              className="-my-3 cursor-pointer py-3 underline underline-offset-2 hover:text-ink"
            >
              Manage models
            </button>
          )
        }
      />
    </div>
  );
}

function FlowScreen({
  state,
  actions,
  status,
  onOpenSetup,
}: {
  state: WorkflowState;
  actions: VoxCleanActions;
  status?: SystemStatus;
  onOpenSetup: () => void;
}) {
  const model = status?.ollama.model ?? "";
  const whisper = {
    name: status ? whisperModelName(status.whisper.modelPath) : "",
    found: status?.whisper.modelFound ?? false,
  };

  switch (state.status) {
    case "idle":
      return (
        <StartScreen
          error={state.error}
          model={model}
          onStartRecording={actions.startRecording}
          onChooseFile={actions.chooseFile}
          onOpenFile={actions.openFile}
        />
      );
    case "recording":
      return (
        <RecordingScreen
          recording={state}
          onStop={actions.stopRecording}
          onPause={actions.pauseRecording}
          onResume={actions.resumeRecording}
          onDiscard={actions.discardRecording}
        />
      );
    case "ready":
      return (
        <ClipReadyScreen
          source={state.source}
          error={state.error}
          model={model}
          whisper={whisper}
          onTranscribe={actions.transcribe}
          onRecordAgain={actions.recordAgain}
          onChooseFile={actions.chooseFile}
          onRemove={actions.removeAudio}
          onOpenSetup={onOpenSetup}
        />
      );
    case "transcribing":
      return (
        <TranscribingScreen
          durationMs={state.source.clip.durationMs}
          progress={state.progress}
          whisperName={whisper.name}
          onCancel={actions.cancelTranscription}
        />
      );
    case "transcript":
      return (
        <TranscriptScreen
          transcript={state.transcript}
          durationMs={state.source.clip.durationMs}
          model={model}
          onChoose={actions.openMode}
          onStartOver={actions.startOver}
        />
      );
    case "result":
      return (
        <ResultScreen
          transcript={state.transcript}
          results={state.results}
          mode={state.mode}
          model={model}
          onSelectMode={actions.openMode}
          onEdit={actions.editResult}
          onRestore={actions.restoreResult}
          onRetry={actions.process}
          onOpenSetup={onOpenSetup}
          onBack={actions.backToTranscript}
          onStartOver={actions.startOver}
        />
      );
  }
}
