import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hasPii } from '@fintech-agent/contracts';
import type { ApiProvider } from 'promptfoo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CLEAN_DRAFT, KNOWN_DEFECTS } from '../judge/controls.js';
import type { RecordedResult } from '../summary.js';
import {
  assertGradedAsNow,
  exportJudgments,
  rubricFingerprint,
  type ControlsRecord,
} from './judgments.js';
import { parseLabelRows, parseRowKeys, parseJudgeVerdicts } from './rows.js';
import { judgeStanding, standingLines } from './standing.js';

const RUBRIC = 'Fail any unsupported claim.';
const JUDGE = 'claude-opus-5-5';
const UNDER_RUBRIC = {
  rubricSha256: rubricFingerprint(RUBRIC),
  judgeModel: JUDGE,
};
const VARIANTS = ['variant-A', 'variant-B'];
const CASES = ['CARD-UNREC-01', 'GEN-01', 'SPEI-01'];

const firstAttempt = (caseId: string, variant: string): RecordedResult => ({
  vars: { case_id: caseId },
  provider: { id: 'eval', label: variant },
  response: {
    metadata: {
      repeat_index: 0,
      judge_input: {
        ...CLEAN_DRAFT,
        draft_reply: `${CLEAN_DRAFT.draft_reply} El 5 de octubre.`,
      },
    },
  },
  gradingResult: {
    componentResults: [
      { pass: true, reason: 'ok', assertion: { type: 'javascript' } },
      { pass: true, reason: 'supported', assertion: { type: 'llm-rubric' } },
    ],
  },
});

const RESULTS = VARIANTS.flatMap((variant) =>
  CASES.map((caseId) => firstAttempt(caseId, variant)),
);

const graderFailing = (judged: string[]): ApiProvider => ({
  id: () => 'judge-local',
  callApi: (prompt) => {
    judged.push(prompt);
    return Promise.resolve({
      output: JSON.stringify({ pass: false, score: 0, reason: 'unsupported' }),
    });
  },
});

let configDir: string;
let dir: string;
const configBefore = process.env['PROMPTFOO_CONFIG_DIR'];

beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'evals-judgments-'));
  process.env['PROMPTFOO_CONFIG_DIR'] = configDir;
});

afterAll(async () => {
  if (configBefore === undefined) {
    Reflect.deleteProperty(process.env, 'PROMPTFOO_CONFIG_DIR');
  } else process.env['PROMPTFOO_CONFIG_DIR'] = configBefore;
  await rm(configDir, { recursive: true, force: true });
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'evals-calibration-'));
});

const exportWith = (grader: ApiProvider) =>
  exportJudgments({
    results: RESULTS,
    grader,
    judgeModel: JUDGE,
    rubric: RUBRIC,
    random: () => 0.37,
    dir,
  });

describe('exportJudgments (03 §Judge validation, steps 2 and 3)', () => {
  it('writes blinded run rows plus mutation negatives, their key and verdicts, and the judged controls', async () => {
    const judged: string[] = [];
    const outcome = await exportWith(graderFailing(judged));
    const toLabel = parseLabelRows(
      await readFile(join(dir, 'to-label.jsonl'), 'utf8'),
    );
    const keys = parseRowKeys(await readFile(join(dir, 'key.jsonl'), 'utf8'));
    const verdicts = parseJudgeVerdicts(
      await readFile(join(dir, 'judgments.jsonl'), 'utf8'),
    );
    expect(outcome).toMatchObject({ ungraded: 0, controlsFailed: 7 });
    expect(toLabel).toHaveLength(outcome.rows);
    expect(keys.filter(({ source }) => source === 'run')).toHaveLength(6);
    expect(
      keys.filter(({ source }) => source === 'mutation').length,
    ).toBeGreaterThan(0);
    expect(verdicts.map(({ row_id }) => row_id).sort()).toEqual(
      toLabel.map(({ row_id }) => row_id).sort(),
    );
    expect(toLabel.every(({ row_id }) => /^row-\d{3}$/.test(row_id))).toBe(
      true,
    );
    const controls = JSON.parse(
      await readFile(join(dir, 'controls.json'), 'utf8'),
    ) as ControlsRecord;
    expect(controls).toMatchObject({
      judge_model: JUDGE,
      rubric_sha256: rubricFingerprint(RUBRIC),
    });
    expect(controls.controls.map(({ defect }) => defect)).toEqual([
      ...KNOWN_DEFECTS,
    ]);
    expect(judged).toHaveLength(
      keys.filter(({ source }) => source === 'mutation').length +
        KNOWN_DEFECTS.length,
    );
  });

  it("masks the judge's reasons before they reach a calibration file (02 G6)", async () => {
    const leaky: ApiProvider = {
      id: () => 'judge-local',
      callApi: () =>
        Promise.resolve({
          output: JSON.stringify({
            pass: false,
            score: 0,
            reason: 'the draft cites card 4111111111111111',
          }),
        }),
    };
    await exportWith(leaky);
    const verdicts = parseJudgeVerdicts(
      await readFile(join(dir, 'judgments.jsonl'), 'utf8'),
    );
    expect(verdicts.some(({ judge_reason }) => hasPii(judge_reason))).toBe(
      false,
    );
    const controls = JSON.parse(
      await readFile(join(dir, 'controls.json'), 'utf8'),
    ) as ControlsRecord;
    expect(controls.controls.some(({ reason }) => hasPii(reason))).toBe(false);
  });

  it('masks the reason of a judge it could not reach before failing with it (02 G6)', async () => {
    const unreachable: ApiProvider = {
      id: () => 'judge-local',
      callApi: () =>
        Promise.resolve({ error: 'upstream echoed card 4111111111111111' }),
    };
    const failure = await exportWith(unreachable).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('was not reached');
    expect(hasPii((failure as Error).message)).toBe(false);
  });

  it('refuses to export over labels already written, whose ids would no longer match', async () => {
    await writeFile(join(dir, 'labels.jsonl'), '');
    await expect(exportWith(graderFailing([]))).rejects.toThrow(
      'labels.jsonl exists',
    );
  });
});

describe('assertGradedAsNow', () => {
  it('lets through a run graded by the current judge under the current rubric', () => {
    expect(() => assertGradedAsNow(UNDER_RUBRIC, UNDER_RUBRIC)).not.toThrow();
  });

  it('refuses a run graded under another rubric or by another judge, before any judge call', () => {
    expect(() =>
      assertGradedAsNow(
        { ...UNDER_RUBRIC, rubricSha256: 'a'.repeat(64) },
        UNDER_RUBRIC,
      ),
    ).toThrow('run pnpm eval again');
    expect(() =>
      assertGradedAsNow(
        { ...UNDER_RUBRIC, judgeModel: 'claude-sonnet-5-5' },
        UNDER_RUBRIC,
      ),
    ).toThrow('run pnpm eval again');
  });
});

describe('judgeStanding (03 §Judge validation, rule 4)', () => {
  const controlsWith = async (passes: number, rubric = RUBRIC) => {
    const record: ControlsRecord = {
      judge_model: JUDGE,
      rubric_sha256: rubricFingerprint(rubric),
      controls: KNOWN_DEFECTS.map((defect, index) => ({
        defect,
        judge_pass: index < passes,
        reason: 'r',
      })),
    };
    await writeFile(join(dir, 'controls.json'), JSON.stringify(record));
  };

  const agreeingRows = async (count: number) => {
    const ids = Array.from(
      { length: count },
      (_, index) => `row-${String(index + 1).padStart(3, '0')}`,
    );
    const fail = (index: number) => index % 2 === 0;
    await writeFile(
      join(dir, 'judgments.jsonl'),
      ids
        .map((row_id, index) =>
          JSON.stringify({
            row_id,
            judge_pass: !fail(index),
            judge_reason: 'r',
          }),
        )
        .join('\n'),
    );
    await writeFile(
      join(dir, 'labels.jsonl'),
      ids
        .map((row_id, index) =>
          JSON.stringify({ row_id, human_pass: !fail(index), reason: 'r' }),
        )
        .join('\n'),
    );
  };

  it('keeps the judge informational before any calibration', async () => {
    expect(await judgeStanding(dir, UNDER_RUBRIC)).toMatchObject({
      counts: false,
    });
  });

  it('keeps it informational when it passed a known-bad control', async () => {
    await controlsWith(1);
    await agreeingRows(20);
    const standing = await judgeStanding(dir, UNDER_RUBRIC);
    expect(standing.counts).toBe(false);
    expect(standing.why).toContain('passed 1 of 7');
  });

  it('keeps it informational when a known-bad control is missing from the calibration', async () => {
    await controlsWith(0);
    const record = JSON.parse(
      await readFile(join(dir, 'controls.json'), 'utf8'),
    ) as ControlsRecord;
    await writeFile(
      join(dir, 'controls.json'),
      JSON.stringify({ ...record, controls: record.controls.slice(1) }),
    );
    await agreeingRows(20);
    const standing = await judgeStanding(dir, UNDER_RUBRIC);
    expect(standing.counts).toBe(false);
    expect(standing.why).toContain('6 of the 7 known-bad controls');
  });

  it('keeps it informational when the rubric changed after calibration', async () => {
    await controlsWith(0, 'an older rubric');
    await agreeingRows(20);
    expect((await judgeStanding(dir, UNDER_RUBRIC)).why).toContain(
      'rubric changed',
    );
  });

  it('keeps it informational when another judge model graded the run', async () => {
    await controlsWith(0);
    await agreeingRows(20);
    const standing = await judgeStanding(dir, {
      ...UNDER_RUBRIC,
      judgeModel: 'claude-sonnet-5-5',
    });
    expect(standing.counts).toBe(false);
    expect(standing.why).toContain('made for claude-opus-5-5');
  });

  it('keeps it informational until the rows are labeled', async () => {
    await controlsWith(0);
    expect((await judgeStanding(dir, UNDER_RUBRIC)).why).toContain(
      'not labeled',
    );
  });

  it('keeps it informational when the judge is exported but the labels are not written yet', async () => {
    await controlsWith(0);
    await agreeingRows(20);
    await rm(join(dir, 'labels.jsonl'));
    expect((await judgeStanding(dir, UNDER_RUBRIC)).why).toContain(
      'not labeled',
    );
  });

  it('keeps it informational when its agreement with the labels misses the threshold', async () => {
    await controlsWith(0);
    await agreeingRows(20);
    const labels = (await readFile(join(dir, 'labels.jsonl'), 'utf8'))
      .split('\n')
      .map((line) => {
        const label = JSON.parse(line) as { human_pass: boolean };
        return JSON.stringify({ ...label, human_pass: !label.human_pass });
      })
      .join('\n');
    await writeFile(join(dir, 'labels.jsonl'), labels);
    const standing = await judgeStanding(dir, UNDER_RUBRIC);
    expect(standing.counts).toBe(false);
    expect(standing.why).toContain('threshold is not met');
  });

  it('states the controls it failed and its agreement for EVALS.md', async () => {
    await controlsWith(0);
    await agreeingRows(20);
    const lines = standingLines(await judgeStanding(dir, UNDER_RUBRIC));
    expect(lines).toContain('Known-bad controls failed: 7 of 7.');
    expect(lines.join('\n')).toContain('TPR');
  });

  it('counts it once every control failed and the agreement threshold is met', async () => {
    await controlsWith(0);
    await agreeingRows(20);
    const standing = await judgeStanding(dir, UNDER_RUBRIC);
    expect(standing).toMatchObject({ counts: true, controlsFailed: 7 });
    expect(standing.agreement).toMatchObject({
      labeled: 20,
      thresholdMet: true,
    });
  });
});
