import {
  StatusSchema,
  type AgentState,
} from '@fintech-agent/contracts/console';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useApi } from '../api/context.js';
import { API_PATH } from '../api/paths.js';
import { CaseView } from '../cases/CaseView.js';
import { NewCase } from '../cases/NewCase.js';
import { Inbox } from '../inbox/Inbox.js';

const AGENT_ON = 'on';
const VIEW = { inbox: 'inbox', case: 'case', newCase: 'new-case' } as const;
const STATUS_KEY = ['status'] as const;

// 01: the kill switch sends each case to review through the fallback path;
// a blank key fails the run without a proposal.
const AGENT_BANNER: Record<Exclude<AgentState, typeof AGENT_ON>, string> = {
  off: 'El agente está apagado. Cada caso nuevo llega a revisión sin investigar, con «Responder sin acción» y la respuesta en blanco.',
  no_api_key:
    'El agente no tiene clave de API. Cada caso nuevo queda como fallido, sin propuesta, hasta que alguien la configure.',
};

type View =
  | { kind: typeof VIEW.inbox }
  | { kind: typeof VIEW.case; caseId: string }
  | { kind: typeof VIEW.newCase };

type FocusReturn = (root: HTMLElement) => HTMLElement | null | undefined;

const caseRow =
  (caseId: string): FocusReturn =>
  (root) =>
    [...root.querySelectorAll<HTMLElement>('[data-case-id]')].find(
      (row) => row.dataset.caseId === caseId,
    );
const newCaseButton: FocusReturn = (root) =>
  root.querySelector<HTMLElement>('[data-new-case]');

/**
 * The signed-in console: the inbox beside the open case or the new case
 * form, and a banner whenever the agent is not investigating. Closing a pane
 * returns focus to the control that opened it.
 */
export function Workspace() {
  const api = useApi();
  const [view, setView] = useState<View>({ kind: VIEW.inbox });
  const rootRef = useRef<HTMLDivElement>(null);
  const focusReturn = useRef<FocusReturn | null>(null);
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => api.get(API_PATH.status, StatusSchema),
  });
  const agent = status.data?.agent;
  const openCase = (caseId: string) => setView({ kind: VIEW.case, caseId });
  const closeTo = (target: FocusReturn) => () => {
    focusReturn.current = target;
    setView({ kind: VIEW.inbox });
  };

  // After the inbox is shown again: on a narrow screen it was hidden, and a
  // hidden element cannot take focus.
  useEffect(() => {
    const target = focusReturn.current;
    focusReturn.current = null;
    if (target && rootRef.current) target(rootRef.current)?.focus();
  }, [view]);

  return (
    <div ref={rootRef} className={`workspace workspace-${view.kind}`}>
      {agent !== undefined && agent !== AGENT_ON && (
        <p className="notice notice-aviso" role="status">
          {AGENT_BANNER[agent]}
        </p>
      )}
      <div className="workspace-panes">
        <Inbox
          selectedCaseId={view.kind === VIEW.case ? view.caseId : undefined}
          onOpen={openCase}
          onNewCase={() => setView({ kind: VIEW.newCase })}
        />
        <div className="workspace-detail">
          {view.kind === VIEW.case && (
            <CaseView
              key={view.caseId}
              caseId={view.caseId}
              onClose={closeTo(caseRow(view.caseId))}
            />
          )}
          {view.kind === VIEW.newCase && (
            <NewCase onOpened={openCase} onCancel={closeTo(newCaseButton)} />
          )}
          {view.kind === VIEW.inbox && (
            <p className="muted">
              Elige un caso de la bandeja o crea uno nuevo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
