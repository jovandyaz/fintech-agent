import { useEffect, useRef } from 'react';

/**
 * A ref for a view's heading, focused once `ready` turns true, so keyboard
 * and screen reader users land on the view they just opened (WCAG 2.4.3).
 * The heading needs `tabIndex={-1}`.
 */
export function useFocusWhenReady(ready: boolean) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (ready) ref.current?.focus();
  }, [ready]);
  return ref;
}
