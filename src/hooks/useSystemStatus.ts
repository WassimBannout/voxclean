import { useCallback, useEffect, useState } from "react";
import { toAppError, type AppError } from "../lib/errors";
import { getSystemStatus, type SystemStatus } from "../lib/ipc";

export function isReady(status: SystemStatus): boolean {
  return (
    status.whisper.modelFound &&
    status.ollama.reachable &&
    status.ollama.modelInstalled
  );
}

/** Whether the local models are installed and running. */
export function useSystemStatus() {
  const [status, setStatus] = useState<SystemStatus>();
  const [error, setError] = useState<AppError>();

  const apply = useCallback(
    (request: Promise<SystemStatus>) =>
      request.then(
        (next) => {
          setStatus(next);
          setError(undefined);
        },
        (err) => setError(toAppError(err)),
      ),
    [],
  );

  const refresh = useCallback(() => apply(getSystemStatus()), [apply]);

  useEffect(() => {
    void apply(getSystemStatus());
  }, [apply]);

  return { status, error, refresh };
}
