import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EvalRun } from '@fintech-agent/api/evals';
import type { ApiProvider } from 'promptfoo';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { EVAL_CASES } from './cases.js';
import { extractJudgments } from './calibration/extract.js';
import { rubricFingerprint } from './calibration/judgments.js';
import { CLEAN_DRAFT } from './judge/controls.js';
import { reportIntoEvals } from './report.cli.js';
import {
  latestRunRecord,
  rubricOf,
  writeRunRecord,
  type RunRecord,
} from './results.js';
import { rejudgeFile } from './rejudge.cli.js';
import { summarize, type RecordedResult } from './summary.js';
import { evalRunOf } from './test/eval-run.js';

const RUBRIC = 'Fail any unsupported claim.';
const ENV_EXAMPLE = [
  'JUDGE_MODEL=claude-opus-5-5',
  'EVAL_SPEND_CAP_USD=13',
].join('\n');
const INPUT = '2026-10-08-896bcef-140923Z.json';
const NOW = new Date('2026-10-10T17:45:01.000Z');
const START = '<!-- evals:summary:start -->';
const END = '<!-- evals:summary:end -->';
const REPLY_JUDGE_TOKENS = { prompt: 1000, completion: 100 };
const EMPTY_DRAFT_JUDGE_TOKENS = { prompt: 500, completion: 50 };
const INPUT_COST_PER_CALL = '$0.0060';
const INPUT_JUDGE_COST_USD = 0.009;

const FILLED = 'Hola Ana, abrimos tu aclaración con folio AC-EVAL-0001.';
const TOOL_OUTPUT = {
  tool: 'get_card_authorization',
  output: { id: 'tx_cu01a', amount: 899 },
};

const storedBeforeTheFix = (run: Partial<EvalRun>): Record<string, unknown> => {
  const stored: Record<string, unknown> = { ...evalRunOf(run) };
  Reflect.deleteProperty(stored, 'tool_outputs');
  return stored;
};

const storedResult = (
  caseId: string,
  run: Record<string, unknown>,
  verdict: { pass: boolean; reason: string },
  tokensUsed: { prompt?: number; completion?: number },
): RecordedResult => ({
  vars: { case_id: caseId },
  provider: { id: 'variant-A', label: 'variant-A' },
  response: {
    metadata: {
      run,
      repeat_index: 0,
      judge_input: run['judge_input'],
      customer_text: 'Veo 899 de un PAYPAL.',
      model: 'claude-sonnet-5-5',
      prompt_version: 'a1b2c3d4e5f6a7b8',
    },
  },
  gradingResult: {
    componentResults: [
      {
        pass: true,
        reason: 'every code check passed',
        assertion: { type: 'javascript' },
        metadata: { graderError: false },
        tokensUsed: {},
      },
      {
        ...verdict,
        assertion: { type: 'llm-rubric' },
        metadata: { graderError: false },
        tokensUsed,
      },
    ],
  },
});

const judgedOnTheFilledReply = storedBeforeTheFix({
  draft_reply: FILLED,
  judge_input: {
    draft_reply: FILLED,
    cited_chunks: CLEAN_DRAFT.cited_chunks,
    tool_outputs: [TOOL_OUTPUT],
  },
});

const fellBackJudgedOnNothing = storedBeforeTheFix({
  run_status: 'fallback',
  proposal: {
    type: 'none',
    transaction_ids: [],
    reason_code: 'insufficient_information',
  },
  draft_reply: null,
  model_outputs: [
    {
      category: 'general_inquiry',
      draft_reply: 'Hola, te reembolsaremos hoy mismo.',
      citations: [],
      proposed_action: { type: 'none', transaction_ids: [] },
    },
  ],
  judge_input: {
    draft_reply: '',
    cited_chunks: [],
    tool_outputs: [TOOL_OUTPUT],
  },
});

const storedResults = (
  tokens: {
    reply: { prompt?: number; completion?: number };
    emptyDraft: { prompt?: number; completion?: number };
  } = { reply: REPLY_JUDGE_TOKENS, emptyDraft: EMPTY_DRAFT_JUDGE_TOKENS },
): RecordedResult[] => [
  storedResult(
    'CARD-UNREC-01',
    judgedOnTheFilledReply,
    { pass: false, reason: 'the folio AC-EVAL-0001 is unsupported' },
    tokens.reply,
  ),
  storedResult(
    'GEN-01',
    fellBackJudgedOnNothing,
    { pass: true, reason: 'nothing to check' },
    tokens.emptyDraft,
  ),
];

const recordOf = (
  over: Partial<RunRecord['meta']> = {},
  results: RecordedResult[] = storedResults(),
): RunRecord => {
  const meta: RunRecord['meta'] = {
    timestamp: '2026-10-08T14:09:23.663Z',
    date: '2026-10-08',
    commit: '896bcef',
    judgeModel: 'claude-opus-5-5',
    rubricSha256: rubricFingerprint(RUBRIC),
    variants: ['variant-A'],
    caseIds: ['CARD-UNREC-01', 'GEN-01'],
    full: true,
    incomplete: [],
    ...over,
  };
  return {
    meta,
    summary: summarize({
      results,
      cases: EVAL_CASES.filter(({ id }) => meta.caseIds.includes(id)),
      variants: meta.variants,
      judgeModel: meta.judgeModel,
      judgeCounts: false,
      baseline: null,
      full: meta.full,
      date: meta.date,
      commit: meta.commit,
      redactor: null,
    }),
    results,
  };
};

const JUDGE_TOKENS = { prompt: 500, completion: 50, total: 550 };

const counting = (
  prompts: string[],
  tokenUsage = JUDGE_TOKENS,
): ApiProvider => ({
  id: () => 'judge-local',
  callApi: (prompt) => {
    prompts.push(prompt);
    return Promise.resolve({
      output: JSON.stringify({ pass: true, score: 1, reason: 'supported' }),
      tokenUsage,
    });
  },
});

let configDir: string;
let dir: string;
let resultsDir: string;
const configBefore = process.env['PROMPTFOO_CONFIG_DIR'];

beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'evals-rejudge-promptfoo-'));
  process.env['PROMPTFOO_CONFIG_DIR'] = configDir;
});

afterAll(async () => {
  if (configBefore === undefined) {
    Reflect.deleteProperty(process.env, 'PROMPTFOO_CONFIG_DIR');
  } else process.env['PROMPTFOO_CONFIG_DIR'] = configBefore;
  await rm(configDir, { recursive: true, force: true });
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'evals-rejudge-'));
  resultsDir = join(dir, 'results');
  await mkdir(resultsDir);
  await mkdir(join(dir, 'calibration'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const withInput = async (record: RunRecord = recordOf()): Promise<string> => {
  const path = join(resultsDir, INPUT);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
};

const rejudge = (
  path: string,
  over: {
    processEnv?: NodeJS.ProcessEnv;
    dryRun?: boolean;
    prompts?: string[];
    log?: string[];
    judgeTokens?: typeof JUDGE_TOKENS;
    rubric?: string;
  } = {},
) =>
  rejudgeFile({
    path,
    processEnv: over.processEnv ?? { ANTHROPIC_API_KEY: 'sk-test' },
    dotEnv: null,
    envExample: ENV_EXAMPLE,
    target: {},
    judgeOf: () => counting(over.prompts ?? [], over.judgeTokens),
    rubric: over.rubric ?? RUBRIC,
    calibrationDir: join(dir, 'calibration'),
    baseline: join(dir, 'baseline.json'),
    dryRun: over.dryRun ?? false,
    clock: () => NOW,
    commit: 'f76eb6c',
    log: (line) => over.log?.push(line),
  });

describe('rejudgeFile (pnpm eval:rejudge, 03 §Judge validation)', () => {
  it("judges a stored run again on the model's accepted draft, unfilled, and writes a new record beside it", async () => {
    const path = await withInput();
    const before = await readFile(path, 'utf8');
    const prompts: string[] = [];
    const written = await rejudge(path, { prompts });

    expect(written).toBe(
      join(
        resultsDir,
        '2026-10-08-896bcef-140923Z-rejudged-f76eb6c-174501Z.json',
      ),
    );
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(evalRunOf().judge_input?.draft_reply);
    expect(prompts[0]).not.toContain('AC-EVAL-0001');
    expect(prompts[0]).toMatch(/get_card_authorization:.*amount\\+": 899/);

    const record = JSON.parse(await readFile(written!, 'utf8')) as RunRecord;
    expect(record.meta).toMatchObject({
      timestamp: NOW.toISOString(),
      date: '2026-10-08',
      commit: '896bcef',
      judgeModel: 'claude-opus-5-5',
      rubricSha256: rubricFingerprint(RUBRIC),
      rejudgedFrom: { file: INPUT },
    });
    expect(record.meta.rejudgedFrom?.judgeCostUsd).toBeCloseTo(
      INPUT_JUDGE_COST_USD,
      6,
    );
    const [judged, notJudged] = record.results;
    expect(judged?.response?.metadata?.['judge_input']).toEqual({
      draft_reply: evalRunOf().judge_input?.draft_reply,
      cited_chunks: CLEAN_DRAFT.cited_chunks,
      tool_outputs: [TOOL_OUTPUT],
    });
    expect(judged?.response?.metadata?.['run']).toMatchObject({
      judge_input: { draft_reply: evalRunOf().judge_input?.draft_reply },
      tool_outputs: [TOOL_OUTPUT],
    });
    expect(rubricOf(judged!)).toMatchObject({
      pass: true,
      reason: 'supported',
    });
    expect(judged?.gradingResult?.componentResults?.[0]).toMatchObject({
      assertion: { type: 'javascript' },
      reason: 'every code check passed',
    });

    expect(notJudged?.response?.metadata?.['judge_input']).toBeNull();
    expect(notJudged?.response?.metadata?.['run']).toMatchObject({
      judge_input: null,
      tool_outputs: [TOOL_OUTPUT],
    });
    expect(rubricOf(notJudged!)).toMatchObject({
      pass: false,
      metadata: { graderError: true },
    });
    expect(rubricOf(notJudged!)?.reason).toContain('not judged');
    expect(record.summary?.costUsd.judge).toBeCloseTo(0.003, 6);
  });

  it('leaves a record that eval:report and eval:judgments read as the newest run, unchanged', async () => {
    await rejudge(await withInput());
    const latest = await latestRunRecord(resultsDir);
    expect(latest.meta.timestamp).toBe(NOW.toISOString());
    const { rows, unreplied } = extractJudgments(latest.results);
    expect(rows.map(({ row_id }) => row_id)).toEqual([
      'variant-A:CARD-UNREC-01',
    ]);
    expect(rows[0]?.judge_input.draft_reply).toContain('{{folio}}');
    expect(unreplied).toBe(1);
    const evalsMd = join(dir, 'EVALS.md');
    await writeFile(evalsMd, `# Evals\n\n${START}\n${END}\n`);
    await reportIntoEvals({
      resultsDir,
      calibrationDir: join(dir, 'calibration'),
      evalsMd,
      baseline: join(dir, 'baseline.json'),
      writeBaseline: false,
    });
    expect(await readFile(evalsMd, 'utf8')).toContain('commit `896bcef`');
  });

  it("prints the judge calls and their estimated cost, from the run's own judge spend per call, before any call", async () => {
    const log: string[] = [];
    await rejudge(await withInput(), { log });
    expect(log[0]).toContain('1 judge call');
    expect(log[0]).toContain('1 attempt with no reply');
    expect(log[0]).toContain(`estimated ${INPUT_COST_PER_CALL}`);
    expect(log.join('\n')).toContain('judge spend $0.0030');
  });

  it('refuses to start without ANTHROPIC_API_KEY, after printing the estimate and before any call', async () => {
    const path = await withInput();
    const prompts: string[] = [];
    const log: string[] = [];
    await expect(
      rejudge(path, { processEnv: {}, prompts, log }),
    ).rejects.toThrow('ANTHROPIC_API_KEY');
    expect(log[0]).toContain(`estimated ${INPUT_COST_PER_CALL}`);
    expect(prompts).toEqual([]);
    expect(await readdir(resultsDir)).toEqual([INPUT]);
  });

  it('refuses an estimate past EVAL_SPEND_CAP_USD before any call', async () => {
    const prompts: string[] = [];
    await expect(
      rejudge(await withInput(), {
        processEnv: {
          ANTHROPIC_API_KEY: 'sk-test',
          EVAL_SPEND_CAP_USD: '0.005',
        },
        prompts,
      }),
    ).rejects.toThrow('EVAL_SPEND_CAP_USD');
    expect(prompts).toEqual([]);
    expect(await readdir(resultsDir)).toEqual([INPUT]);
  });

  it('only prints the estimate on a dry run: no key needed, no call, no file', async () => {
    const prompts: string[] = [];
    const log: string[] = [];
    expect(
      await rejudge(await withInput(), {
        processEnv: {},
        dryRun: true,
        prompts,
        log,
      }),
    ).toBeNull();
    expect(log[0]).toContain(`estimated ${INPUT_COST_PER_CALL}`);
    expect(prompts).toEqual([]);
    expect(await readdir(resultsDir)).toEqual([INPUT]);
  });

  it('prices a call at what the judge calls of the input cost, not at its attempts the judge never read', async () => {
    const rejudgedOnce = await rejudge(await withInput());
    const log: string[] = [];
    await rejudge(rejudgedOnce!, { log, dryRun: true });
    expect(log[0]).toContain('estimated $0.0030 at $0.003000 per call');
  });

  it('never overwrites a record already there', async () => {
    const path = await withInput();
    const taken = join(
      resultsDir,
      '2026-10-08-896bcef-140923Z-rejudged-f76eb6c-174501Z.json',
    );
    const older = JSON.stringify(
      recordOf({ timestamp: '2026-10-01T00:00:00.000Z' }),
    );
    await writeFile(taken, older);
    await expect(rejudge(path)).rejects.toThrow('EEXIST');
    expect(await readFile(taken, 'utf8')).toBe(older);
  });

  it('refuses a JUDGE_MODEL other than the one that judged the run, before any call', async () => {
    const prompts: string[] = [];
    const record = recordOf();
    const path = await withInput({
      ...record,
      meta: { ...record.meta, judgeModel: 'claude-opus-4-1' },
    });
    await expect(rejudge(path, { prompts })).rejects.toThrow('JUDGE_MODEL');
    expect(prompts).toEqual([]);
  });

  it('refuses a rubric changed since the run: that is a new run, not a re-judge (03 rule 4)', async () => {
    const prompts: string[] = [];
    await expect(
      rejudge(await withInput(), {
        prompts,
        rubric: `${RUBRIC} Also fail any promise.`,
      }),
    ).rejects.toThrow('rubric changed');
    expect(prompts).toEqual([]);
  });

  it('refuses a record that is not the newest complete run, naming the newest', async () => {
    const path = await withInput();
    const newer = await writeRunRecord(
      resultsDir,
      recordOf({ timestamp: '2026-10-09T09:00:00.000Z', commit: 'abc1234' }),
    );
    await expect(rejudge(path)).rejects.toThrow(
      newer.slice(resultsDir.length + 1),
    );
  });

  it('warns when the judge spent past EVAL_SPEND_CAP_USD', async () => {
    const log: string[] = [];
    await rejudge(await withInput(), {
      processEnv: { ANTHROPIC_API_KEY: 'sk-test', EVAL_SPEND_CAP_USD: '0.01' },
      judgeTokens: { prompt: 5000, completion: 500, total: 5500 },
      log,
    });
    expect(log.join('\n')).toMatch(
      /warning: the judge spent \$0\.0300, past EVAL_SPEND_CAP_USD \(\$0\.01\)/,
    );
  });

  it('refuses a result that recorded no run, naming the attempt', async () => {
    const [replied, fellBack] = storedResults();
    const path = await withInput(
      recordOf({}, [
        { ...replied!, response: { metadata: { repeat_index: 0 } } },
        fellBack!,
      ]),
    );
    await expect(rejudge(path)).rejects.toThrow(
      'variant-A CARD-UNREC-01 (attempt 0) recorded no run',
    );
  });

  it('refuses a record with no judge call on a draft to price the estimate from', async () => {
    const path = await withInput(
      recordOf(
        {},
        storedResults({ reply: {}, emptyDraft: EMPTY_DRAFT_JUDGE_TOKENS }),
      ),
    );
    await expect(rejudge(path, { dryRun: true })).rejects.toThrow(
      'no judge call',
    );
  });

  it('refuses an incomplete run, which is never reported', async () => {
    const path = await withInput({
      ...recordOf({ incomplete: ['variant-A GEN-01 (1)'] }),
      summary: null,
    });
    await expect(rejudge(path)).rejects.toThrow('incomplete');
  });
});
