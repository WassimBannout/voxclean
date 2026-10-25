import { useEffect } from "react";

/**
 * Keeps a Tauri event subscription alive while mounted. Pass a memoized
 * `subscribe`, or `null` to unsubscribe. Subscriptions are progressive
 * enhancements (live levels, drag and drop), so a failure to subscribe
 * leaves the feature off rather than breaking the screen.
 */
export function useEventSubscription(
  subscribe: (() => Promise<() => void>) | null,
) {
  useEffect(() => {
    if (!subscribe) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    Promise.resolve()
      .then(subscribe)
      .then(
        (fn) => {
          if (active) unlisten = fn;
          else fn();
        },
        () => undefined,
      );
    return () => {
      active = false;
      unlisten?.();
    };
  }, [subscribe]);
}
