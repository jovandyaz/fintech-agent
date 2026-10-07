import type { Resolution, ValidationCode } from '@fintech-agent/contracts';

import type { RunEvidence } from './evidence.js';

const WHITESPACE = /\s+/g;

const normalizeQuote = (text: string): string =>
  text.normalize('NFKC').replace(WHITESPACE, ' ').trim();

/**
 * The 02 G5 provenance codes: every citation names a chunk the run retrieved,
 * under that chunk's own document and section, and quotes it verbatim; every
 * evidence and action id is a transaction the run saw; a resolution that
 * does not abstain cites something.
 */
export function provenanceCodes(
  resolution: Resolution,
  evidence: RunEvidence,
): ValidationCode[] {
  const codes = new Set<ValidationCode>();
  for (const citation of resolution.citations) {
    const chunk = evidence.chunks.get(citation.chunk_id);
    if (
      !chunk ||
      chunk.doc_id !== citation.doc_id ||
      chunk.section !== citation.section
    ) {
      codes.add('CITATION_UNSEEN');
      continue;
    }
    const quote = normalizeQuote(citation.quote);
    if (quote === '' || !normalizeQuote(chunk.content).includes(quote)) {
      codes.add('CITATION_QUOTE_MISMATCH');
    }
  }
  const ids = [
    ...resolution.evidence.map(({ id }) => id),
    ...resolution.proposed_action.transaction_ids,
  ];
  if (ids.some((id) => !evidence.transactions.has(id))) {
    codes.add('EVIDENCE_UNSEEN');
  }
  if (resolution.citations.length === 0 && !resolution.abstained) {
    codes.add('NO_SUPPORT');
  }
  return [...codes];
}
