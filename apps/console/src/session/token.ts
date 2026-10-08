const TOKEN_KEY = 'case-copilot.operator-token';

// Session storage, never local: the token dies with the tab. A browser that
// blocks storage simply asks for the token again.
const browserStorage = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

/** The operator token this tab signed in with, or null. */
export function readToken(storage = browserStorage()): string | null {
  try {
    return storage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Keeps the token for this tab; a blocked storage keeps nothing. */
export function saveToken(token: string, storage = browserStorage()): void {
  try {
    storage?.setItem(TOKEN_KEY, token);
  } catch {
    return;
  }
}

/** Forgets the token, as signing out does. */
export function clearToken(storage = browserStorage()): void {
  try {
    storage?.removeItem(TOKEN_KEY);
  } catch {
    return;
  }
}
