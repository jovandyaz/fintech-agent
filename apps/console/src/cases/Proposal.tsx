import type {
  ProposalView,
  ResolutionView,
  TransactionRow,
} from '@fintech-agent/contracts/console';
import { useId } from 'react';

import { ACTION_LABEL, REASON_LABEL } from '../labels.js';
import { describeTransaction } from './transactions.js';

/**
 * What the agent proposes and why: the action as it would execute, its
 * transactions, the justification, the reasoning summary and the cited
 * policy passages. All of it is model or policy text, shown as text (02 G7).
 */
export function Proposal(props: {
  proposal: ProposalView;
  resolution: ResolutionView | null;
  transactions: readonly TransactionRow[] | undefined;
}) {
  const headingId = useId();
  const { proposal, resolution } = props;
  return (
    <section className="panel-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Propuesta del agente</h3>
      <dl className="facts">
        <dt>Acción</dt>
        <dd>{ACTION_LABEL[proposal.type]}</dd>
        <dt>Motivo</dt>
        <dd>{REASON_LABEL[proposal.params.reason_code]}</dd>
        {proposal.params.transaction_ids.length > 0 && (
          <>
            <dt>Transacciones</dt>
            <dd>
              <ul className="plain-list">
                {proposal.params.transaction_ids.map((id) => (
                  <li key={id} className="mono">
                    {describeTransaction(id, props.transactions)}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
      <p data-testid="justification">{proposal.justification}</p>
      {resolution && (
        <>
          <h4>Razonamiento</h4>
          <p data-testid="reasoning">{resolution.reasoning_summary}</p>
          {resolution.citations.length > 0 && (
            <>
              <h4>Políticas citadas</h4>
              <ul className="citations">
                {resolution.citations.map((citation) => (
                  <li key={citation.chunk_id}>
                    <p
                      className="citation-source"
                      data-testid="citation-source"
                    >
                      {`${citation.doc_id} · ${citation.section}`}
                    </p>
                    <blockquote data-testid="citation-quote">
                      {citation.quote}
                    </blockquote>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
