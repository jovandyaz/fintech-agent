import {
  AWAITING_DECISION,
  CaseDetailSchema,
  OPEN_PROPOSAL,
  type ActionStatus,
  type ActionType,
  type ProposalView,
} from '@fintech-agent/contracts/console';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { useApi } from '../api/context.js';
import { API_PATH } from '../api/paths.js';
import { useFocusWhenReady } from '../focus.js';
import { FolioStamp } from '../inbox/FolioStamp.js';
import { INBOX_KEY } from '../inbox/Inbox.js';
import { TierBadge } from '../inbox/TierBadge.js';
import {
  ACTION_STATUS_LABEL,
  CATEGORY_LABEL,
  STATUS_LABEL,
} from '../labels.js';
import { DecisionPanel } from './DecisionPanel.js';
import { Proposal } from './Proposal.js';
import { Rerun } from './Rerun.js';
import { RunTrace } from './RunTrace.js';

const RECORDED = 'Decisión registrada.';
const APPROVED = 'Aprobaste la propuesta. El ejecutor aplicará la acción.';
const CANARY_TOLD =
  'Este caso era un canario: una propuesta con un defecto plantado para medir la revisión.';

// A canary is named only in the answer to the operator's decision, never
// before it (02 G3).
const DECIDED: Record<ActionStatus, string> = {
  proposed: RECORDED,
  approved: APPROVED,
  executed: APPROVED,
  rejected: 'Rechazaste la propuesta. La respuesta queda registrada.',
  failed: RECORDED,
  superseded: RECORDED,
  canary_caught: `${CANARY_TOLD} Lo detectaste; no se ejecuta nada.`,
  canary_missed: `${CANARY_TOLD} Se aprobó sin detectarlo; no se ejecuta nada.`,
};

// The executor never picks up a `none` (it has no effect to apply), so an
// approved one is final, not waiting.
const NO_ACTION: ActionType = 'none';
const APPROVED_STATUS: ActionStatus = 'approved';

interface Decided {
  status: ActionStatus;
  type: ActionType;
}

const decidedText = ({ status, type }: Decided): string =>
  status === APPROVED_STATUS && type === NO_ACTION
    ? 'Aprobaste la respuesta. No hay acción que ejecutar.'
    : DECIDED[status];

const proposalStatusText = (proposal: ProposalView): string =>
  proposal.status === APPROVED_STATUS && proposal.type === NO_ACTION
    ? 'Aprobada, sin acción que ejecutar'
    : ACTION_STATUS_LABEL[proposal.status];

const caseKey = (caseId: string): readonly ['case', string] => ['case', caseId];

/**
 * One case as the operator reviews it: the customer's text, the agent's
 * proposal, the decision, a re-run and the trace. Every text from the
 * customer, the policies or the model is rendered as text (02 G7): React
 * escapes it, and nothing here turns a string into markup.
 */
export function CaseView(props: { caseId: string; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const headingId = useId();
  const textId = useId();
  const traceId = useId();
  const [decided, setDecided] = useState<Decided | null>(null);
  const detail = useQuery({
    queryKey: caseKey(props.caseId),
    queryFn: () => api.get(API_PATH.case(props.caseId), CaseDetailSchema),
  });
  const headingRef = useFocusWhenReady(detail.data !== undefined);
  const decidedRef = useRef<HTMLParagraphElement>(null);
  // The decision panel unmounts once the case comes back resolved; focus goes
  // to what the decision did rather than to the page's start.
  useEffect(() => {
    if (decided) decidedRef.current?.focus();
  }, [decided]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: caseKey(props.caseId) });
    void queryClient.invalidateQueries({ queryKey: [INBOX_KEY] });
  };
  const back = (
    <button type="button" className="button-quiet" onClick={props.onClose}>
      Volver a la bandeja
    </button>
  );

  if (detail.isError) {
    return (
      <section className="panel">
        {back}
        <p className="notice notice-alerta" role="alert">
          No pudimos abrir este caso.
        </p>
      </section>
    );
  }
  if (!detail.data) {
    return (
      <section className="panel" aria-busy="true">
        {back}
        <p className="muted">Cargando el caso…</p>
      </section>
    );
  }
  const { case: kase, proposal, resolution } = detail.data;
  const decidable =
    proposal?.status === OPEN_PROPOSAL && kase.status === AWAITING_DECISION;
  return (
    <article className="panel" aria-labelledby={headingId}>
      <header className="case-head">
        {back}
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          Caso <FolioStamp folio={kase.folio} />
        </h2>
        <p className="case-meta">
          <span className={`status status-${kase.status}`}>
            {STATUS_LABEL[kase.status]}
          </span>
          <TierBadge tier={kase.review_tier} />
          {kase.category && <span>{CATEGORY_LABEL[kase.category]}</span>}
        </p>
      </header>
      <section className="panel-section" aria-labelledby={textId}>
        <h3 id={textId}>Mensaje del cliente</h3>
        {kase.text === null ? (
          <p className="muted">
            El texto aparece cuando el agente lee el caso.
          </p>
        ) : (
          <p className="customer-text" data-testid="customer-text">
            {kase.text}
          </p>
        )}
      </section>
      {proposal ? (
        <Proposal
          proposal={proposal}
          resolution={resolution}
          transactions={detail.data.override_options?.transactions}
        />
      ) : (
        <p className="muted">
          Este caso todavía no tiene propuesta del agente.
        </p>
      )}
      {decided && (
        <p
          ref={decidedRef}
          className="notice notice-aviso"
          role="status"
          tabIndex={-1}
        >
          {decidedText(decided)}
        </p>
      )}
      {proposal && decidable && (
        <DecisionPanel
          key={proposal.action_id}
          case={kase}
          proposal={proposal}
          options={detail.data.override_options}
          draft={resolution?.draft_reply ?? ''}
          onDecided={(status, type) => {
            setDecided({ status, type });
            refresh();
          }}
          onConflict={refresh}
        />
      )}
      {proposal && proposal.status !== OPEN_PROPOSAL && (
        <p className="decided">{`Estado de la propuesta: ${proposalStatusText(proposal)}`}</p>
      )}
      <section className="panel-section" aria-labelledby={traceId}>
        <h3 id={traceId}>Investigaciones del agente</h3>
        <Rerun
          detail={detail.data}
          onQueued={() => {
            setDecided(null);
            headingRef.current?.focus();
            refresh();
          }}
          onConflict={refresh}
        />
        <RunTrace runs={detail.data.runs} />
      </section>
    </article>
  );
}
