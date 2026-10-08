import {
  CaseAcknowledgmentSchema,
  CustomerOptionSchema,
  type NewCase as NewCaseBody,
} from '@fintech-agent/contracts/console';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';

import { useApi } from '../api/context.js';
import { API_PATH } from '../api/paths.js';
import { useSingleFlight } from '../api/single-flight.js';
import { useFocusWhenReady } from '../focus.js';
import { INBOX_KEY } from '../inbox/Inbox.js';

const CUSTOMERS_KEY = ['customers'] as const;

/**
 * The new case form (04 Step 7): pick a customer, type what they wrote. The
 * api builds and signs the event, so the case takes the webhook's real path.
 */
export function NewCase(props: {
  onOpened: (caseId: string) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [text, setText] = useState('');
  const headingId = useId();
  const headingRef = useFocusWhenReady(true);
  const flight = useSingleFlight();
  const customers = useQuery({
    queryKey: CUSTOMERS_KEY,
    queryFn: () => api.get(API_PATH.customers, CustomerOptionSchema.array()),
    refetchInterval: false,
  });
  const open = useMutation({
    mutationFn: () =>
      api.post(
        API_PATH.cases,
        { customer_id: customerId, text } satisfies NewCaseBody,
        CaseAcknowledgmentSchema,
      ),
    onSuccess: ({ case_id }) => {
      void queryClient.invalidateQueries({ queryKey: [INBOX_KEY] });
      props.onOpened(case_id);
    },
    onSettled: flight.settle,
  });
  const ready = customerId !== '' && text.trim() !== '' && !open.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) flight.start(() => open.mutate());
  };

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>
        Nuevo caso
      </h2>
      <form className="form-stack" onSubmit={submit}>
        <label>
          Cliente
          <select
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            <option value="">Elige un cliente</option>
            {customers.data?.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {`${customer.first_name} · ${customer.id}`}
              </option>
            ))}
          </select>
        </label>
        {customers.isError && (
          <div className="notice notice-alerta notice-retry">
            <p role="alert">No pudimos cargar los clientes.</p>
            <button
              type="button"
              className="button-quiet"
              onClick={() => void customers.refetch()}
            >
              Reintentar
            </button>
          </div>
        )}
        <label>
          Mensaje del cliente
          <textarea
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {open.isError && (
          <p className="notice notice-alerta" role="alert">
            No pudimos crear el caso. Revisa el cliente y el mensaje e intenta
            de nuevo.
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={!ready}>
            Crear caso
          </button>
          <button
            type="button"
            className="button-quiet"
            onClick={props.onCancel}
          >
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}
