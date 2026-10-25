import { useEffect, useMemo, useReducer, useRef } from "react";
import { toAppError } from "../lib/errors";
import { fileName } from "../lib/format";
import * as ipc from "../lib/ipc";
import type { InputDevice, ProcessingMode } from "../lib/ipc";
import {
  initialState,
  isBusy,
  transcriptText,
  workflowReducer,
  type WorkflowState,
} from "../lib/workflow";

const DEFAULT_DEVICE_NAME = "System default microphone";

/**
 * The workflow state plus the actions screens call. Actions run the backend
 * call first and dispatch its outcome, so the state only moves forward once
 * the backend agrees.
 */
export function useVoxClean(startState: WorkflowState = initialState) {
  const [state, dispatch] = useReducer(workflowReducer, startState);
  const stateRef = useRef<WorkflowState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const lastDevice = useRef<InputDevice | null>(null);

  const actions = useMemo(() => {
    const audioFailed = (err: unknown) =>
      dispatch({ type: "audioFailed", error: toAppError(err) });

    // Leaving audio behind goes back to the start screen first, then drops
    // the audio the backend holds; a failure shows on the start screen.
    async function releaseAudio() {
      try {
        await ipc.discardRecording();
      } catch (err) {
        audioFailed(err);
      }
    }

    async function startRecording(device: InputDevice | null) {
      try {
        await ipc.startRecording(device?.id ?? null);
        lastDevice.current = device;
        dispatch({
          type: "recordingStarted",
          at: Date.now(),
          deviceName: device?.name ?? DEFAULT_DEVICE_NAME,
        });
      } catch (err) {
        audioFailed(err);
      }
    }

    async function openFile(path: string) {
      try {
        const clip = await ipc.loadAudioFile(path);
        dispatch({ type: "fileLoaded", path, name: fileName(path), clip });
      } catch (err) {
        audioFailed(err);
      }
    }

    async function process(mode: ProcessingMode) {
      const current = stateRef.current;
      if (current.status !== "transcript" && current.status !== "result")
        return;
      const text = transcriptText(current.transcript);
      dispatch({ type: "processingStarted", mode });
      try {
        dispatch({
          type: "processingSucceeded",
          mode,
          text: await ipc.processText(text, mode),
        });
      } catch (err) {
        dispatch({ type: "processingFailed", mode, error: toAppError(err) });
      }
    }

    return {
      startRecording,
      recordAgain: () => startRecording(lastDevice.current),

      async pauseRecording() {
        try {
          await ipc.pauseRecording();
          dispatch({ type: "recordingPaused", at: Date.now() });
        } catch (err) {
          audioFailed(err);
        }
      },

      async resumeRecording() {
        try {
          await ipc.resumeRecording();
          dispatch({ type: "recordingResumed", at: Date.now() });
        } catch (err) {
          audioFailed(err);
        }
      },

      async stopRecording() {
        try {
          dispatch({
            type: "recordingStopped",
            clip: await ipc.stopRecording(),
          });
        } catch (err) {
          audioFailed(err);
        }
      },

      async discardRecording() {
        try {
          await ipc.discardRecording();
          dispatch({ type: "recordingDiscarded" });
        } catch (err) {
          audioFailed(err);
        }
      },

      async chooseFile() {
        try {
          const path = await ipc.pickAudioFile();
          if (path) await openFile(path);
        } catch (err) {
          audioFailed(err);
        }
      },

      openFile,

      removeAudio() {
        if (stateRef.current.status !== "ready") return;
        dispatch({ type: "audioRemoved" });
        void releaseAudio();
      },

      async transcribe(language: string | null) {
        dispatch({ type: "transcriptionStarted" });
        let unlisten: (() => void) | undefined;
        try {
          unlisten = await ipc.onTranscriptionProgress((progress) =>
            dispatch({ type: "transcriptionProgressed", progress }),
          );
          dispatch({
            type: "transcriptionSucceeded",
            transcript: await ipc.transcribe(language),
          });
        } catch (err) {
          const error = toAppError(err);
          dispatch(
            error.code === "cancelled"
              ? { type: "transcriptionCancelled" }
              : { type: "transcriptionFailed", error },
          );
        } finally {
          unlisten?.();
        }
      },

      async cancelTranscription() {
        // Leave the screen right away; a late result is ignored by the reducer.
        dispatch({ type: "transcriptionCancelled" });
        try {
          await ipc.cancelTranscription();
        } catch (err) {
          audioFailed(err);
        }
      },

      process,

      /** Shows a mode's result, generating it first if there isn't one. */
      openMode(mode: ProcessingMode) {
        const current = stateRef.current;
        if (current.status !== "transcript" && current.status !== "result")
          return;
        const existing = current.results[mode];
        if (existing && existing.status !== "failed")
          dispatch({ type: "modeSelected", mode });
        else void process(mode);
      },

      editResult(mode: ProcessingMode, text: string) {
        dispatch({ type: "resultEdited", mode, text });
      },

      restoreResult(mode: ProcessingMode) {
        dispatch({ type: "resultRestored", mode });
      },

      backToTranscript() {
        dispatch({ type: "backToTranscript" });
      },

      startOver() {
        if (isBusy(stateRef.current)) return;
        dispatch({ type: "reset" });
        void releaseAudio();
      },
    };
  }, []);

  return { state, actions };
}

export type VoxCleanActions = ReturnType<typeof useVoxClean>["actions"];
