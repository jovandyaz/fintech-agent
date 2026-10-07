/** The only hosts a reply may link to (02 G5 LINK_IN_REPLY); subdomains included. */
export const ALLOWED_REPLY_HOSTS = ['albo.mx'] as const;

const MAX_CODE_POINT = 0x10ffff;
const HEX = 16;
const RELATIVE_BASE = 'https://relative.invalid';

const NAMED_REFERENCES: Record<string, string> = {
  period: '.',
  sol: '/',
  colon: ':',
  commat: '@',
  amp: '&',
};

const RAW_HTML = /<[a-z!/?]/i;
const SCRIPTABLE_SCHEME = /\b(?:javascript|data|vbscript|file):/i;
const URL_CANDIDATES =
  /\]\(\s*<?([^)\s>]+)|^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?$|<([a-z][a-z0-9+.-]*:[^\s>]+)>|(?:https?:)?\/\/[^\s)\]>"']+/gim;
const WWW_HOST = /(?:^|[^\w.-])(www\.[^\s/)\]>"'?#]+)/gi;
const EMAIL_HOST = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;
// Mail and chat clients autolink a bare domain in any case ("EVIL.COM/x"),
// so a missing space after a period ("Listo.Saludos") is flagged too.
const BARE_HOST =
  /(?<![\w@./-])([a-z0-9][a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?![\w-])/gi;
// NFKC leaves these as they are, and browsers read each one as a dot in a host.
const DOT_LOOKALIKES = /[\u3002\uFF61\uFE52]/g;

function fromCodePointOr(whole: string, code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= MAX_CODE_POINT
    ? String.fromCodePoint(code)
    : whole;
}

function decodeCharacterReferences(value: string): string {
  return value
    .replace(/&#(\d+);/g, (whole, code: string) =>
      fromCodePointOr(whole, Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (whole, code: string) =>
      fromCodePointOr(whole, Number.parseInt(code, HEX)),
    )
    .replace(
      /&(\w+);/g,
      (whole, name: string) => NAMED_REFERENCES[name.toLowerCase()] ?? whole,
    );
}

const decodePercent = (value: string): string =>
  value.replace(/%([0-9a-f]{2})/gi, (_, code: string) =>
    String.fromCharCode(Number.parseInt(code, HEX)),
  );

function isAllowedHost(host: string, allowed: readonly string[]): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return allowed.some((root) => name === root || name.endsWith(`.${root}`));
}

function isAllowedDestination(
  target: string,
  allowed: readonly string[],
): boolean {
  try {
    return isAllowedHost(new URL(target, RELATIVE_BASE).hostname, allowed);
  } catch {
    return false;
  }
}

/**
 * Whether a reply contains HTML, a scriptable URL, or a link, autolink, email
 * or bare domain whose host is outside `allowed`; a destination that does not
 * parse counts as outside. Ported from the Knowtis exfiltration-link assertion
 * and inverted to an allow-list: the reply and the operator's browser are the
 * only outbound channels.
 */
export function hasLinkOutsideAllowList(
  text: string,
  allowed: readonly string[],
): boolean {
  const normalized = decodePercent(
    decodeCharacterReferences(text.normalize('NFKC')),
  ).replace(DOT_LOOKALIKES, '.');
  if (RAW_HTML.test(normalized) || SCRIPTABLE_SCHEME.test(normalized)) {
    return true;
  }
  for (const match of normalized.matchAll(URL_CANDIDATES)) {
    const target = match[1] ?? match[2] ?? match[3] ?? match[0];
    if (!isAllowedDestination(target, allowed)) return true;
  }
  const hosts = [
    ...[...normalized.matchAll(WWW_HOST)].map((match) => match[1] ?? ''),
    ...[...normalized.matchAll(EMAIL_HOST)].map((match) => match[1] ?? ''),
    ...[...normalized.matchAll(BARE_HOST)].map((match) => match[1] ?? ''),
  ];
  return hosts.some((host) => !isAllowedHost(host, allowed));
}
