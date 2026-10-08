/** The heuristic verdict: `safe` below the threshold, with the strongest reason when not. */
export interface PromptGuardResult {
  readonly safe: boolean;
  readonly score: number;
  readonly reason?: string;
}

const MAX_PATTERN_BRIDGE_CHARS = 64;
const MAX_PATTERN_GAP_CHARS = 200;
const MAX_PATTERN_WORD_CHARS = 32;
const MAX_PATTERN_WORDS = 4;
const BRIDGE = `{1,${MAX_PATTERN_BRIDGE_CHARS}}`;

const INJECTION_PATTERNS: readonly {
  pattern: RegExp;
  weight: number;
  reason: string;
}[] = [
  {
    pattern:
      /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts)/i,
    weight: 0.9,
    reason: 'Instruction override attempt',
  },
  {
    pattern: /disregard\s+(all\s+)?(previous|prior|above)/i,
    weight: 0.9,
    reason: 'Instruction override attempt',
  },
  {
    pattern:
      /forget\s+(?:everything|all)\s+(?:your\s+)?(?:previous\s+)?(?:instructions|rules|guidelines)/i,
    weight: 0.8,
    reason: 'Instruction override attempt',
  },

  {
    pattern: new RegExp(
      `you\\s+are\\s+now\\s+(?:a |an |my |the )?(?:[\\w,.]{1,${MAX_PATTERN_WORD_CHARS}}\\s+){0,${MAX_PATTERN_WORDS}}(?:ai|assistant|bot|model|agent|persona|character)`,
      'i',
    ),
    weight: 0.8,
    reason: 'Role hijacking attempt',
  },
  {
    pattern:
      /act\s+as\s+(if\s+you\s+are\s+|a\s+)?(?:an?\s+)?(?:unrestricted|unfiltered|jailbr)/i,
    weight: 0.9,
    reason: 'Role hijacking attempt',
  },
  {
    pattern: new RegExp(`\\bDAN\\b.{0,${MAX_PATTERN_GAP_CHARS}}mode`, 'i'),
    weight: 0.9,
    reason: 'Known jailbreak pattern',
  },

  {
    pattern:
      /(?:output|reveal|show|print|display|repeat)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions|rules)/i,
    weight: 0.85,
    reason: 'System prompt extraction attempt',
  },
  {
    pattern:
      /what\s+(?:are|is)\s+your\s+(?:system\s+)?(?:prompt|instructions|rules)/i,
    weight: 0.7,
    reason: 'System prompt extraction attempt',
  },

  {
    pattern: /<\/?(system|user|assistant|prompt|context)>/i,
    weight: 0.75,
    reason: 'Delimiter injection',
  },
  {
    pattern: /```system/i,
    weight: 0.7,
    reason: 'Delimiter injection',
  },

  {
    pattern:
      // One whitespace run between verb and payload: two adjacent `\s*` make a
      // long blank run cost quadratic time.
      /\b(?:decode|execute|run)\b(?:\s+(?:this|the\s+following))?\s*(?::\s*)?[A-Za-z0-9+/=]{20,}/i,
    weight: 0.8,
    reason: 'Encoded payload detected',
  },

  {
    pattern: /\[INST\]|\[\/INST\]|<<SYS>>|<\|im_start\|>/i,
    weight: 0.85,
    reason: 'Model-specific delimiter injection',
  },

  {
    pattern:
      /ignora(?:r)?\s+(?:(?:todas|todo)\s+)?(?:las\s+|los\s+)?(?:instrucciones|reglas|indicaciones|[óo]rdenes)\s+(?:anteriores|previas|de\s+arriba)/i,
    weight: 0.9,
    reason: 'Instruction override attempt (es)',
  },
  {
    pattern:
      /olv[íi]da(?:r|te\s+de)?\s+(?:(?:todas|todo)\s+)?(?:tus\s+|las\s+)?(?:instrucciones|reglas|indicaciones)/i,
    weight: 0.8,
    reason: 'Instruction override attempt (es)',
  },
  {
    pattern:
      /haz\s+caso\s+omiso\s+(?:de\s+|a\s+)?(?:las\s+)?(?:instrucciones|reglas)/i,
    weight: 0.85,
    reason: 'Instruction override attempt (es)',
  },
  {
    pattern:
      /act[úu]a\s+como\s+(?:un[ao]?\s+)?(?:ia\s+|asistente\s+|modelo\s+)?(?:sin\s+(?:restricciones|filtros|l[íi]mites)|no\s+restringid)/i,
    weight: 0.9,
    reason: 'Role hijacking attempt (es)',
  },
  {
    pattern:
      /(?:mu[ée]stra(?:me)?|revela|imprime|repite|dime)\s+(?:(?:tus?\s+(?:prompt|instrucciones|reglas))|(?:(?:el|la|las?)\s+(?:prompt|instrucciones|reglas)\s+(?:de|del)\s+sistema))/i,
    weight: 0.85,
    reason: 'System prompt extraction attempt (es)',
  },

  // Weak signals — a lone match stays under the threshold; they only
  // contribute via cumulative scoring. No '/' in the base64 class: with it
  // the run matches long URLs, repo paths, and JWT-ish blobs (benign FPs).
  {
    // Lookarounds (not \b) bound the run: '+'/'=' are non-word chars, so \b
    // would drop an edge char and let a 60-char payload fall under threshold.
    pattern: /(?<![A-Za-z0-9+/=])[A-Za-z0-9+]{60,}={0,2}(?![A-Za-z0-9+/=])/,
    weight: 0.3,
    reason: 'Long base64-like payload',
  },
  {
    pattern: /\bnew\s+(?:system\s+)?instructions?\s*:/i,
    weight: 0.4,
    reason: 'Instruction re-anchoring',
  },
  {
    pattern: new RegExp(
      `\\bi[\\s_.-]${BRIDGE}g[\\s_.-]${BRIDGE}n[\\s_.-]${BRIDGE}o[\\s_.-]${BRIDGE}r[\\s_.-]${BRIDGE}e\\b`,
      'i',
    ),
    weight: 0.4,
    reason: 'Obfuscated override keyword',
  },
  {
    pattern: new RegExp(
      `ignore[-_]${BRIDGE}(?:all[-_]${BRIDGE})?(?:previous|prior)[-_]${BRIDGE}(?:instructions|rules)`,
      'i',
    ),
    weight: 0.85,
    reason: 'Instruction override attempt (punctuated)',
  },
  {
    pattern:
      /\b(?:override|bypass|supersede)\s+(?:your|the|all)\s+(?:instructions|rules|guidelines|system\s+prompt)/i,
    weight: 0.7,
    reason: 'Instruction override attempt (synonym)',
  },
];

const INJECTION_THRESHOLD = 0.6;

// Longer input is flagged without being scanned.
const MAX_GUARD_INPUT_CHARS = 50_000;

const STRIP_CODEPOINTS: readonly number[] = [
  0x200b,
  0x200c,
  0x200d,
  0x2060,
  0xfeff, // zero-width
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e, // bidi embedding/override
  0x2066,
  0x2067,
  0x2068,
  0x2069, // bidi isolates
  0x200e,
  0x200f,
  0x061c, // bidi marks (LRM, RLM, ALM)
];
const STRIP_PATTERN = new RegExp(
  `[${STRIP_CODEPOINTS.map(
    (cp) => `\\u${cp.toString(16).padStart(4, '0')}`,
  ).join('')}]`,
  'g',
);

// Two readings: a zero-width mark inside a word is deleted, one between
// words stands for the space it replaces.
function guardReadings(text: string): string[] {
  const folded = text.normalize('NFKC');
  return [
    folded.replace(STRIP_PATTERN, ''),
    folded.replace(STRIP_PATTERN, ' '),
  ];
}

interface InjectionPatternHit {
  readonly weight: number;
  readonly reason: string;
}

function matchInjectionPatterns(
  readings: readonly string[],
): InjectionPatternHit[] {
  return INJECTION_PATTERNS.filter(({ pattern }) =>
    readings.some((reading) => pattern.test(reading)),
  ).map(({ weight, reason }) => ({ weight, reason }));
}

function scoreInjectionHits(
  hits: readonly InjectionPatternHit[],
): PromptGuardResult {
  let score = 0;
  let topWeight = 0;
  let matchedReason: string | undefined;
  for (const hit of hits) {
    score += hit.weight;
    if (hit.weight > topWeight) {
      topWeight = hit.weight;
      matchedReason = hit.reason;
    }
  }
  score = Math.min(score, 1);
  const safe = score < INJECTION_THRESHOLD;
  return !safe && matchedReason
    ? { safe, score, reason: matchedReason }
    : { safe, score };
}

/**
 * Scores text against known injection phrasings after NFKC and invisible-mark
 * folding (ported from Knowtis). A signal, never a guarantee (02 G7, G8): it
 * misses paraphrases and flags quoted attacks.
 */
export function detectPromptInjection(text: string): PromptGuardResult {
  if (!text) {
    return { safe: true, score: 0 };
  }

  if (text.length > MAX_GUARD_INPUT_CHARS) {
    return { safe: false, score: 1, reason: 'Input exceeds safety limit' };
  }

  return scoreInjectionHits(matchInjectionPatterns(guardReadings(text)));
}
