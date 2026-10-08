import type { RunView, StepView } from '@fintech-agent/contracts/console';

import {
  RUN_STATUS_LABEL,
  STEP_KIND_LABEL,
  STOP_REASON_LABEL,
} from '../labels.js';

const MS_PER_SECOND = 1000;
const JSON_INDENT = 2;

const durationOf = (ms: number | null): string | null => {
  if (ms === null) return null;
  return ms < MS_PER_SECOND
    ? `${ms} ms`
    : `${(ms / MS_PER_SECOND).toFixed(1)} s`;
};

const asText = (value: unknown): string =>
  JSON.stringify(value, null, JSON_INDENT);

function validatorCodesOf(step: StepView): string[] {
  const { output } = step;
  if (typeof output !== 'object' || output === null || !('codes' in output)) {
    return [];
  }
  return Array.isArray(output.codes)
    ? output.codes.filter((code): code is string => typeof code === 'string')
    : [];
}

function Step(props: { step: StepView }) {
  const { step } = props;
  const codes = validatorCodesOf(step);
  const latency = durationOf(step.latency_ms);
  return (
    <li className="trace-step" data-testid="trace-step" data-kind={step.kind}>
      <p className="trace-step-head">
        <span className="trace-kind">{STEP_KIND_LABEL[step.kind]}</span>
        <span className="mono">{step.name}</span>
        {latency && <span className="muted">{latency}</span>}
        {step.cost_usd && (
          <span className="muted">{`US$${step.cost_usd}`}</span>
        )}
      </p>
      {codes.length > 0 && (
        <ul className="code-chips">
          {codes.map((code) => (
            <li key={code} className="flag-chip mono">
              {code}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>Entrada y salida</summary>
        {step.input !== null && (
          <pre data-testid="step-input">{asText(step.input)}</pre>
        )}
        <pre data-testid="step-output">{asText(step.output)}</pre>
      </details>
    </li>
  );
}

/**
 * Every agent run on the case, oldest first, the latest open: how it ended,
 * the model, tokens, cost and latency, and each step with its masked input
 * and output shown as JSON text and its validator codes (02 G5, G6, G7).
 */
export function RunTrace(props: { runs: readonly RunView[] }) {
  if (props.runs.length === 0) {
    return (
      <p className="muted">Todavía no hay investigaciones de este caso.</p>
    );
  }
  const latest = props.runs.length - 1;
  return (
    <ol className="runs">
      {props.runs.map((run, index) => {
        const latency = durationOf(run.latency_ms);
        return (
          <li key={run.run_id} data-testid={`run-${run.run_id}`}>
            <details className="run" open={index === latest}>
              <summary>
                <span className="run-title">{`Investigación ${index + 1}`}</span>
                <span>
                  {run.stop_reason
                    ? `${RUN_STATUS_LABEL[run.status]} · ${STOP_REASON_LABEL[run.stop_reason]}`
                    : RUN_STATUS_LABEL[run.status]}
                </span>
              </summary>
              <dl className="facts">
                <dt>Modelo</dt>
                <dd className="mono">{run.model}</dd>
                <dt>Tokens</dt>
                <dd>{`${run.input_tokens} tokens de entrada · ${run.output_tokens} de salida`}</dd>
                <dt>Costo</dt>
                <dd className="mono">{`US$${run.cost_usd}`}</dd>
                {latency && (
                  <>
                    <dt>Duración</dt>
                    <dd>{latency}</dd>
                  </>
                )}
                {run.error_code && (
                  <>
                    <dt>Error</dt>
                    <dd className="mono">{run.error_code}</dd>
                  </>
                )}
              </dl>
              <ol className="trace-steps">
                {run.steps.map((step) => (
                  <Step key={step.idx} step={step} />
                ))}
              </ol>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
