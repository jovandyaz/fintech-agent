import { useRef } from 'react';

/**
 * Lets one command be in flight at a time. A mutation's `isPending` reaches
 * the button a render late, so a second click in between would send the
 * command twice; this guard is set synchronously on the first.
 */
export function useSingleFlight(): {
  start: (send: () => void) => void;
  settle: () => void;
} {
  const busy = useRef(false);
  return {
    start: (send) => {
      if (busy.current) return;
      busy.current = true;
      send();
    },
    settle: () => {
      busy.current = false;
    },
  };
}
