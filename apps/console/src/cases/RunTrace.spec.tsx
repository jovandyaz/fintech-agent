import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { RunView, StepView } from '@fintech-agent/contracts/console';

import { RUN } from '../test/case-detail.js';
import { RunTrace } from './RunTrace.js';

afterEach(cleanup);

describe('run trace (04 Step 7)', () => {
  it('sums up each run: status, why it stopped, model, tokens, cost and latency', () => {
    render(<RunTrace runs={[RUN]} />);
    const run = within(screen.getByTestId('run-run_abc'));
    expect(run.getByText('Investigación 1')).toBeTruthy();
    expect(run.getByText('Completa · terminó')).toBeTruthy();
    expect(run.getByText('claude-sonnet-5-5')).toBeTruthy();
    expect(
      run.getByText('5,200 tokens de entrada · 640 de salida'),
    ).toBeTruthy();
    expect(run.getByText('US$0.0231')).toBeTruthy();
    expect(run.getByText('8.4 s')).toBeTruthy();
  });

  it('lists the steps in order by kind and name, with the validator codes', () => {
    render(<RunTrace runs={[RUN]} />);
    const steps = screen.getAllByTestId('trace-step');
    expect(steps.map((step) => step.dataset.kind)).toEqual([
      'guard',
      'tool',
      'retrieval',
      'validation',
    ]);
    expect(within(steps[1]!).getByText('Herramienta')).toBeTruthy();
    expect(within(steps[1]!).getByText('list_transactions')).toBeTruthy();
    expect(within(steps[2]!).getByText('Búsqueda de políticas')).toBeTruthy();
    expect(within(steps[3]!).getByText('UNGROUNDED_NUMBER')).toBeTruthy();
  });

  it('shows each step input and output as the masked JSON text it stored', () => {
    render(<RunTrace runs={[RUN]} />);
    const tool = screen.getAllByTestId('trace-step')[1]!;
    expect(within(tool).getByTestId('step-input').textContent).toBe(
      JSON.stringify({ limit: 25 }, null, 2),
    );
    expect(within(tool).getByTestId('step-output').textContent).toBe(
      JSON.stringify(RUN.steps[1]!.output, null, 2),
    );
  });

  describe('tokens and finish reason per step', () => {
    const llmStep = (over: Partial<StepView> = {}): RunView => ({
      ...RUN,
      steps: [
        {
          idx: 0,
          kind: 'llm',
          name: 'investigate',
          input: null,
          output: { text: 'ok' },
          latency_ms: 900,
          cost_usd: '0.0012',
          input_tokens: 1234,
          output_tokens: 56,
          cached_input_tokens: 0,
          finish_reason: 'stop',
          ...over,
        },
      ],
    });

    it('shows the tokens an llm step used', () => {
      render(<RunTrace runs={[llmStep()]} />);
      const step = screen.getByTestId('trace-step');
      expect(within(step).getByText('1,234 entrada · 56 salida')).toBeTruthy();
    });

    it('adds the cached tokens only when there are some', () => {
      render(<RunTrace runs={[llmStep({ cached_input_tokens: 800 })]} />);
      expect(
        screen.getByText('1,234 entrada · 56 salida · 800 en caché'),
      ).toBeTruthy();
      cleanup();
      render(<RunTrace runs={[llmStep({ cached_input_tokens: 0 })]} />);
      expect(screen.queryByText(/en caché/)).toBeNull();
    });

    it('shows no token text when one of the counts is missing', () => {
      render(
        <RunTrace
          runs={[llmStep({ input_tokens: 10, output_tokens: null })]}
        />,
      );
      expect(
        within(screen.getByTestId('trace-step')).queryByText(/entrada ·/),
      ).toBeNull();
    });

    it('shows no token text on a step without tokens', () => {
      render(<RunTrace runs={[RUN]} />);
      for (const step of screen.getAllByTestId('trace-step')) {
        expect(within(step).queryByText(/entrada ·/)).toBeNull();
      }
    });

    it('names the finish reason inside the details', () => {
      render(<RunTrace runs={[llmStep()]} />);
      const details = screen.getByTestId('trace-step').querySelector('details');
      expect(within(details!).getByText('Fin: stop')).toBeTruthy();
    });

    it('shows no finish reason line when there is none', () => {
      render(<RunTrace runs={[llmStep({ finish_reason: null })]} />);
      expect(screen.queryByText(/^Fin:/)).toBeNull();
    });
  });

  it('names the error a failed run ended with', () => {
    render(
      <RunTrace
        runs={[
          {
            ...RUN,
            status: 'failed',
            stop_reason: 'error',
            error_code: 'no_api_key',
            steps: [],
          },
        ]}
      />,
    );
    expect(screen.getByText('Fallida · error')).toBeTruthy();
    expect(screen.getByText('no_api_key')).toBeTruthy();
  });

  it('numbers runs oldest first and opens the latest', () => {
    const { container } = render(
      <RunTrace runs={[RUN, { ...RUN, run_id: 'run_def' }]} />,
    );
    const runs = [...container.querySelectorAll('details.run')];
    expect(runs.map((run) => run.hasAttribute('open'))).toEqual([false, true]);
    expect(
      within(screen.getByTestId('run-run_def')).getByText('Investigación 2'),
    ).toBeTruthy();
  });

  it('says when the case has no run yet', () => {
    render(<RunTrace runs={[]} />);
    expect(
      screen.getByText('Todavía no hay investigaciones de este caso.'),
    ).toBeTruthy();
  });
});
