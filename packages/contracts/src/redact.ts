const REDACTED = '[redacted]';
const MIN_SCHEME_CREDENTIAL_CHARS = 8;
const MIN_TOKEN_CREDENTIAL_CHARS = 12;

const SCHEME_CREDENTIAL = new RegExp(
  String.raw`\b(Bearer|Basic)\s+[^\s"',;]{${MIN_SCHEME_CREDENTIAL_CHARS},}`,
  'gi',
);
// "Token" is also an English word, so only a credential-shaped value counts.
const TOKEN_SCHEME_CREDENTIAL = new RegExp(
  String.raw`\b(Token)\s+(?=[^\s"',;]*[\d._-])[A-Za-z0-9._~+/=-]{${MIN_TOKEN_CREDENTIAL_CHARS},}`,
  'g',
);
const CREDENTIAL_ASSIGNMENT =
  /\b([a-z_]*(?:token|password|passwd|secret|jwt|api_?key)|auth)(\s*[:=]\s*)[^\s&#,;"']+/gi;

/**
 * Replaces credentials written in text (an `Authorization` scheme, a
 * `token=`/`password:` assignment, a query or fragment parameter) with
 * `[redacted]`. Run it before `maskPii`, which could split a token apart and
 * show its tail.
 */
export const redactCredentials = (text: string): string =>
  text
    .replace(SCHEME_CREDENTIAL, `$1 ${REDACTED}`)
    .replace(TOKEN_SCHEME_CREDENTIAL, `$1 ${REDACTED}`)
    .replace(CREDENTIAL_ASSIGNMENT, `$1$2${REDACTED}`);
