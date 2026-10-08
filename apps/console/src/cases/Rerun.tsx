import {
  MAX_MANUAL_RERUNS,
  OPEN_PROPOSAL,
  RERUN_FAILURE,
  RERUNNABLE_STATUSES,
  RerunAnswerSchema,
  type CaseDetail,
} from '@fintech-agent/contracts/console';
import { useMutation } from '@tanstack/react-query';

import { ApiError } from '../api/client.js';
import { useApi } from '../api/context.js';
import { API_PATH } from '../api/paths.js';
import { useSingleFlight } from '../api/single-flight.js';

const isConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.reason === RERUN_FAILURE.conflict;

const isRerunnable = (status: CaseDetail['case']['status']): boolean =>
  RERUNNABLE_STATUSES.some((rerunnable) => rerunnable === status);

/**
 * Sends the case back to the agent (02 G3): offered while the case waits for
 * review, failed or resolved, at most three times; an open proposal is
 * discarded by it, and the operator is told so before choosing it.
 */
export function Rerun(props: {
  detail: CaseDetail;
  onQueued: () => void;
  onConflict: () => void;
}) {
  const api = useApi();
  const flight = useSingleFlight();
  const { case: kase, proposal } = props.detail;
  const rerun = useMutation({
    mutationFn: () =>
      api.post(API_PATH.rerun(kase.case_id), undefined, RerunAnswerSchema),
    onSuccess: props.onQueued,
    onError: (error) => {
      if (isConflict(error)) props.onConflict();
    },
    onSettled: flight.settle,
  });

  if (!isRerunnable(kase.status)) return null;
  const left = MAX_MANUAL_RERUNS - kase.manual_reruns;
  if (left <= 0) {
    return (
      <p className="muted">
        {`Este caso ya usó sus ${MAX_MANUAL_RERUNS} nuevas investigaciones.`}
      </p>
    );
  }
  const discards =
    proposal?.status === OPEN_PROPOSAL
      ? ' La propuesta abierta se descarta.'
      : '';
  return (
    <div className="rerun">
      <button
        type="button"
        className="button-quiet"
        disabled={rerun.isPending}
        onClick={() => flight.start(() => rerun.mutate())}
      >
        Volver a investigar
      </button>
      <p className="muted">{`Quedan ${left} de ${MAX_MANUAL_RERUNS}.${discards}`}</p>
      {rerun.isError && (
        <p className="notice notice-alerta" role="alert">
          {isConflict(rerun.error)
            ? 'No se pudo volver a investigar: el caso ya no lo admite o cambió de estado.'
            : 'No pudimos volver a investigar el caso. Intenta de nuevo en unos segundos.'}
        </p>
      )}
    </div>
  );
}
