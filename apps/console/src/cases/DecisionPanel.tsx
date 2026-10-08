import {
  ACTION_TYPES,
  DECISION_FAILURE,
  DecisionAnswerSchema,
  MAX_REJECT_REASON_CHARS,
  REASON_CODES,
  REJECT_CODES,
  type ActionStatus,
  type ActionType,
  type CaseDetail,
  type CaseFlag,
  type Decision,
  type DecisionFailure,
  type OverrideOption,
  type OverrideOptions,
  type ProposalView,
  type ReasonCode,
  type RejectCode,
  type ReplyCheckCode,
} from '@fintech-agent/contracts/console';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { ApiError } from '../api/client.js';
import { useApi } from '../api/context.js';
import { API_PATH } from '../api/paths.js';
import { useSingleFlight } from '../api/single-flight.js';
import {
  ACTION_LABEL,
  FLAG_LABEL,
  REASON_LABEL,
  REJECT_LABEL,
  REPLY_CHECK_LABEL,
} from '../labels.js';
import { ReplyEditor } from './ReplyEditor.js';
import { describeTransaction } from './transactions.js';

const STANDARD_TIER = 'standard';
const NO_REJECT_CODE = '';

const REFUSAL_MESSAGE: Record<
  Exclude<DecisionFailure, typeof DECISION_FAILURE.invalidReply>,
  string
> = {
  conflict:
    'El caso cambió mientras lo revisabas: ya se decidió o se volvió a investigar.',
  not_found: 'Esta propuesta ya no existe.',
  flags_not_acknowledged: 'Marca como enterada cada alerta del caso.',
  transactions_not_reviewed:
    'Marca como revisada cada transacción de la acción.',
  override_not_allowed: 'Esa acción no se permite con esas transacciones.',
  pii_in_reject_reason:
    'La nota interna tiene datos personales. Quítalos e intenta de nuevo.',
  core_unavailable:
    'El core no responde y no podemos verificar las transacciones. Intenta en unos minutos.',
};
const FALLBACK_MESSAGE =
  'No pudimos registrar la decisión. Intenta de nuevo en unos segundos.';

const isReplyCheckCode = (code: string): code is ReplyCheckCode =>
  code in REPLY_CHECK_LABEL;
const isKnownRefusal = (
  reason: string,
): reason is keyof typeof REFUSAL_MESSAGE => reason in REFUSAL_MESSAGE;

const oneOf = <T extends string>(
  values: readonly T[],
  value: string,
): T | undefined => values.find((candidate) => candidate === value);

function refusalMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return FALLBACK_MESSAGE;
  if (error.reason === DECISION_FAILURE.invalidReply) {
    const found = error.codes.map((code) =>
      isReplyCheckCode(code) ? REPLY_CHECK_LABEL[code] : code,
    );
    return `La respuesta no pasa estas revisiones: ${found.join('; ')}.`;
  }
  return isKnownRefusal(error.reason)
    ? REFUSAL_MESSAGE[error.reason]
    : FALLBACK_MESSAGE;
}

const choicesOf = (options: OverrideOptions | null): OverrideOption[] =>
  options?.actions.filter(
    (action) => action.transaction_ids.length >= action.min,
  ) ?? [];

const missing = (parts: (string | false)[]): string[] =>
  parts.filter((part): part is string => part !== false);

const effectOf = (type: ActionType, ids: readonly string[]): string =>
  ids.length > 0
    ? `${ACTION_LABEL[type]} sobre ${ids.join(', ')}`
    : ACTION_LABEL[type];

const toggled = <T,>(set: ReadonlySet<T>, item: T): ReadonlySet<T> => {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
};

/**
 * The operator's decision on an open proposal (02 G3): the reply as edited,
 * every flag acknowledged beside Approve, each transaction checked off on a
 * case not tiered standard, an override limited to what the case's G2 rows
 * allow, a reject code for a rejection, and an Approve button that names its
 * effect ("Abrir aclaración sobre tx_…"). It holds the reply being edited,
 * so mount it once per proposal.
 */
export function DecisionPanel(props: {
  case: CaseDetail['case'];
  proposal: ProposalView;
  options: OverrideOptions | null;
  draft: string;
  /** The answer's status, and the action type the decision named. */
  onDecided: (status: ActionStatus, type: ActionType) => void;
  onConflict: () => void;
}) {
  const api = useApi();
  const flight = useSingleFlight();
  const headingId = useId();
  const actionFieldId = useId();
  const reasonFieldId = useId();
  const rejectCodeFieldId = useId();
  const rejectNoteFieldId = useId();
  const approveHintId = useId();
  const rejectHintId = useId();
  const { proposal, options } = props;
  const choices = choicesOf(options);
  const [reply, setReply] = useState(props.draft);
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<CaseFlag>>(
    new Set(),
  );
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set());
  const [overriding, setOverriding] = useState(false);
  const [overrideType, setOverrideType] = useState<ActionType>(() =>
    choices.some((action) => action.type === proposal.type)
      ? proposal.type
      : (choices[0]?.type ?? proposal.type),
  );
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState<ReasonCode>(proposal.params.reason_code);
  const [rejectCode, setRejectCode] = useState<RejectCode | undefined>();
  const [rejectReason, setRejectReason] = useState('');

  const decide = useMutation({
    mutationFn: (decision: Decision) =>
      api.post(
        API_PATH.decision(proposal.action_id),
        decision,
        DecisionAnswerSchema,
      ),
    onSuccess: ({ status }, decision) =>
      props.onDecided(
        status,
        decision.decision === 'approve'
          ? (decision.override?.type ?? proposal.type)
          : proposal.type,
      ),
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.reason === DECISION_FAILURE.conflict
      ) {
        props.onConflict();
      }
    },
    onSettled: flight.settle,
  });

  const choice = choices.find((action) => action.type === overrideType);
  const targetType = overriding ? overrideType : proposal.type;
  const targetIds = overriding
    ? (choice?.transaction_ids.filter((id) => picked.has(id)) ?? [])
    : proposal.params.transaction_ids;
  // 02 G3: an override, or an action with transactions on a case not tiered
  // standard (an untiered one included), is checked off transaction by
  // transaction; in an override, picking each one is that check.
  const mustCheckOff =
    overriding ||
    (props.case.review_tier !== STANDARD_TIER && targetIds.length > 0);
  const flags = props.case.flags;
  const acknowledgedFlags = flags.filter((flag) => acknowledged.has(flag));
  const checkedOff =
    overriding || !mustCheckOff || targetIds.every((id) => reviewed.has(id));
  const overrideFits =
    !overriding ||
    (choice !== undefined &&
      targetIds.length >= choice.min &&
      targetIds.length <= choice.max);
  const idle = !decide.isPending;
  const noReply = reply.trim() === '' && 'escribir la respuesta';
  const toApprove = missing([
    noReply,
    acknowledgedFlags.length !== flags.length && 'confirmar cada alerta',
    !checkedOff && 'revisar cada transacción',
    !overrideFits &&
      (choice
        ? `elegir de ${choice.min} a ${choice.max} transacciones`
        : 'elegir otra acción'),
  ]);
  const toReject = missing([
    noReply,
    rejectCode === undefined && 'elegir un motivo',
  ]);
  const canApprove = idle && toApprove.length === 0;
  const canReject = idle && toReject.length === 0;

  const approve = () =>
    flight.start(() =>
      decide.mutate({
        decision: 'approve',
        final_reply: reply,
        acknowledged_flags: acknowledgedFlags,
        reviewed_transaction_ids: mustCheckOff ? targetIds : [],
        ...(overriding
          ? {
              override: {
                type: overrideType,
                transaction_ids: targetIds,
                reason_code: reason,
              },
            }
          : {}),
      }),
    );
  const reject = () => {
    if (rejectCode === undefined) return;
    flight.start(() =>
      decide.mutate({
        decision: 'reject',
        final_reply: reply,
        acknowledged_flags: acknowledgedFlags,
        reject_code: rejectCode,
        ...(rejectReason.trim() !== '' ? { reject_reason: rejectReason } : {}),
      }),
    );
  };

  return (
    <section className="panel-section decision" aria-labelledby={headingId}>
      <h3 id={headingId}>Tu decisión</h3>
      <ReplyEditor value={reply} onChange={setReply} />

      <div className="decision-approve">
        {flags.length > 0 && (
          <fieldset>
            <legend>Alertas del caso</legend>
            {flags.map((flag) => (
              <label key={flag} className="check">
                <input
                  type="checkbox"
                  checked={acknowledged.has(flag)}
                  onChange={() => setAcknowledged(toggled(acknowledged, flag))}
                />
                {`Enterado: ${FLAG_LABEL[flag]}`}
              </label>
            ))}
          </fieldset>
        )}

        {options ? (
          <label className="check">
            <input
              type="checkbox"
              checked={overriding}
              onChange={(event) => setOverriding(event.target.checked)}
            />
            Cambiar la acción propuesta
          </label>
        ) : (
          <p className="muted">
            Otra acción no está disponible mientras el core no responde.
          </p>
        )}

        {overriding && (
          <fieldset>
            <legend>Otra acción</legend>
            <div className="field">
              <label htmlFor={actionFieldId}>Acción</label>
              <select
                id={actionFieldId}
                value={overrideType}
                onChange={(event) => {
                  const type = oneOf(ACTION_TYPES, event.target.value);
                  if (!type) return;
                  setOverrideType(type);
                  setPicked(new Set());
                }}
              >
                {choices.map((action) => (
                  <option key={action.type} value={action.type}>
                    {ACTION_LABEL[action.type]}
                  </option>
                ))}
              </select>
            </div>
            {choice && choice.max > 0 && (
              <fieldset>
                <legend>
                  {`Transacciones: de ${choice.min} a ${choice.max}, cada una revisada`}
                </legend>
                {choice.transaction_ids.map((id) => (
                  <label key={id} className="check mono">
                    <input
                      type="checkbox"
                      checked={picked.has(id)}
                      disabled={!picked.has(id) && picked.size >= choice.max}
                      onChange={() => setPicked(toggled(picked, id))}
                    />
                    {describeTransaction(id, options?.transactions)}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="field">
              <label htmlFor={reasonFieldId}>Motivo</label>
              <select
                id={reasonFieldId}
                value={reason}
                onChange={(event) =>
                  setReason(oneOf(REASON_CODES, event.target.value) ?? reason)
                }
              >
                {REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {REASON_LABEL[code]}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
        )}

        {!overriding && mustCheckOff && (
          <fieldset>
            <legend>Revisa cada transacción de la acción</legend>
            {targetIds.map((id) => (
              <label key={id} className="check mono">
                <input
                  type="checkbox"
                  checked={reviewed.has(id)}
                  onChange={() => setReviewed(toggled(reviewed, id))}
                />
                {`Revisé ${describeTransaction(id, options?.transactions)}`}
              </label>
            ))}
          </fieldset>
        )}

        {toApprove.length > 0 && (
          <p id={approveHintId} className="hint">
            {`Para aprobar falta: ${toApprove.join(', ')}.`}
          </p>
        )}
        <button
          type="button"
          className="button-primary"
          disabled={!canApprove}
          aria-describedby={toApprove.length > 0 ? approveHintId : undefined}
          onClick={approve}
        >
          {effectOf(targetType, targetIds)}
        </button>
      </div>

      <fieldset className="decision-reject">
        <legend>Rechazar la propuesta</legend>
        <div className="field">
          <label htmlFor={rejectCodeFieldId}>Motivo del rechazo</label>
          <select
            id={rejectCodeFieldId}
            value={rejectCode ?? NO_REJECT_CODE}
            onChange={(event) =>
              setRejectCode(oneOf(REJECT_CODES, event.target.value))
            }
          >
            <option value={NO_REJECT_CODE}>Elige un motivo</option>
            {REJECT_CODES.map((code) => (
              <option key={code} value={code}>
                {REJECT_LABEL[code]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={rejectNoteFieldId}>
            Nota interna (no se envía al cliente)
          </label>
          <textarea
            id={rejectNoteFieldId}
            rows={3}
            maxLength={MAX_REJECT_REASON_CHARS}
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
          />
        </div>
        {toReject.length > 0 && (
          <p id={rejectHintId} className="hint">
            {`Para rechazar falta: ${toReject.join(', ')}.`}
          </p>
        )}
        <button
          type="button"
          className="button-quiet"
          disabled={!canReject}
          aria-describedby={toReject.length > 0 ? rejectHintId : undefined}
          onClick={reject}
        >
          Rechazar propuesta
        </button>
      </fieldset>

      {decide.isError && (
        <p className="notice notice-alerta" role="alert">
          {refusalMessage(decide.error)}
        </p>
      )}
    </section>
  );
}
