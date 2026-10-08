import { InboxItemSchema } from '@fintech-agent/contracts/console';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { useApi } from '../api/context.js';
import { API_PATH } from '../api/paths.js';
import { CATEGORY_LABEL, FLAG_LABEL, STATUS_LABEL } from '../labels.js';
import { FolioStamp } from './FolioStamp.js';
import { TierBadge } from './TierBadge.js';

const RECEIVED = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** The query key every view that changes a case refreshes. */
export const INBOX_KEY = 'inbox';

/**
 * The cases as the api orders them (01: high review tier first, then newest),
 * eval cases only when asked; choosing one opens it. Each row carries
 * `data-case-id` and the new case button `data-new-case`, so the workspace
 * can return focus to whichever one opened the pane it closes.
 */
export function Inbox(props: {
  selectedCaseId?: string | undefined;
  onOpen: (caseId: string) => void;
  onNewCase: () => void;
}) {
  const api = useApi();
  const [includeEval, setIncludeEval] = useState(false);
  const headingId = useId();
  const inbox = useQuery({
    queryKey: [INBOX_KEY, includeEval],
    queryFn: () =>
      api.get(
        includeEval ? API_PATH.casesWithEval : API_PATH.cases,
        InboxItemSchema.array(),
      ),
  });

  return (
    <section className="inbox" aria-labelledby={headingId}>
      <div className="inbox-head">
        <h1 id={headingId}>Bandeja</h1>
        <button
          type="button"
          className="button-primary"
          data-new-case=""
          onClick={props.onNewCase}
        >
          Nuevo caso
        </button>
      </div>
      <label className="inbox-toggle">
        <input
          type="checkbox"
          checked={includeEval}
          onChange={(event) => setIncludeEval(event.target.checked)}
        />
        Mostrar casos de evaluación
      </label>
      {inbox.isError && (
        <p className="notice notice-alerta" role="alert">
          No pudimos cargar la bandeja. Lo intentamos de nuevo en unos segundos.
        </p>
      )}
      {inbox.isPending && <p className="muted">Cargando la bandeja…</p>}
      {inbox.data?.length === 0 && (
        <p className="muted">
          No hay casos en la bandeja. Crea uno nuevo para empezar.
        </p>
      )}
      <ul className="inbox-list">
        {inbox.data?.map((item) => (
          <li key={item.case_id}>
            <button
              type="button"
              className="inbox-row"
              data-case-id={item.case_id}
              aria-current={
                item.case_id === props.selectedCaseId ? 'true' : undefined
              }
              onClick={() => props.onOpen(item.case_id)}
            >
              <span className="inbox-row-top">
                <FolioStamp folio={item.folio} />
                <span className={`status status-${item.status}`}>
                  {STATUS_LABEL[item.status]}
                </span>
                <TierBadge tier={item.review_tier} />
              </span>
              <span className="inbox-row-meta">
                {item.category && <span>{CATEGORY_LABEL[item.category]}</span>}
                <time dateTime={item.received_at}>
                  {RECEIVED.format(new Date(item.received_at))}
                </time>
              </span>
              {item.flags.length > 0 && (
                <span className="flag-chips">
                  {item.flags.map((flag) => (
                    <span key={flag} className="flag-chip">
                      {FLAG_LABEL[flag]}
                    </span>
                  ))}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
