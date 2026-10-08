import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { replaceSummaryBlock, reportIntoEvals } from './report.cli.js';
import { writeRunRecord, type RunRecord } from './results.js';
import { KNOWN_DEFECTS } from './judge/controls.js';
import { evalRunOf } from './test/eval-run.js';

const START = '<!-- evals:summary:start -->';
const END = '<!-- evals:summary:end -->';

describe('replaceSummaryBlock', () => {
  it('replaces only the text between the markers', () => {
    expect(
      replaceSummaryBlock(
        `# Evals\n\n${START}\nold\n${END}\n\nNotes.\n`,
        'new',
      ),
    ).toBe(`# Evals\n\n${START}\n\nnew\n\n${END}\n\nNotes.\n`);
  });

  it('refuses a document without both markers, in order', () => {
    expect(() => replaceSummaryBlock('# Evals', 'new')).toThrow(START);
    expect(() => replaceSummaryBlock(`${END}\n${START}`, 'new')).toThrow(START);
  });
});

describe('reportIntoEvals (pnpm eval:report)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'evals-report-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const withRecord = async () => {
    const resultsDir = join(dir, 'results');
    const calibrationDir = join(dir, 'calibration');
    await mkdir(calibrationDir);
    const record: RunRecord = {
      meta: {
        timestamp: '2026-10-08T15:30:12.000Z',
        date: '2026-10-08',
        commit: 'abc1234',
        judgeModel: 'claude-opus-5-5',
        rubricSha256: 'f'.repeat(64),
        variants: ['variant-A'],
        caseIds: ['CARD-UNREC-01'],
        full: true,
        incomplete: [],
      },
      summary: {
        gate: ['variant-A: CARD-UNREC-01 failed now'],
        baselineChecked: true,
      } as RunRecord['summary'],
      results: [
        {
          vars: { case_id: 'CARD-UNREC-01' },
          provider: { id: 'eval', label: 'variant-A' },
          response: {
            metadata: {
              run: evalRunOf(),
              customer_text: 'Veo 899 de un PAYPAL.',
              repeat_index: 0,
            },
          },
          gradingResult: { componentResults: [] },
        },
      ],
    };
    await writeRunRecord(resultsDir, record);
    const evalsMd = join(dir, 'EVALS.md');
    await writeFile(evalsMd, `# Evals\n\n${START}\n${END}\n`);
    return { resultsDir, calibrationDir, evalsMd };
  };

  it("writes the latest run's summary into EVALS.md with the judge's standing", async () => {
    const paths = await withRecord();
    await reportIntoEvals(paths);
    const written = await readFile(paths.evalsMd, 'utf8');
    expect(written).toContain('Run of 2026-10-08 at commit `abc1234`');
    expect(written).toContain('| pass@1 | 1/1');
    expect(written).toContain('- variant-A: CARD-UNREC-01 failed now');
    expect(written).toContain(
      'Judge standing: no calibration yet (pnpm eval:judgments).',
    );
  });

  const calibrated = async (calibrationDir: string) => {
    const ids = Array.from(
      { length: 20 },
      (_, index) => `row-${String(index + 1).padStart(3, '0')}`,
    );
    await writeFile(
      join(calibrationDir, 'controls.json'),
      JSON.stringify({
        judge_model: 'claude-opus-5-5',
        rubric_sha256: 'f'.repeat(64),
        controls: KNOWN_DEFECTS.map((defect) => ({
          defect,
          judge_pass: false,
          reason: 'r',
        })),
      }),
    );
    await writeFile(
      join(calibrationDir, 'judgments.jsonl'),
      ids
        .map((row_id, index) =>
          JSON.stringify({
            row_id,
            judge_pass: index % 2 === 0,
            judge_reason: 'r',
          }),
        )
        .join('\n'),
    );
    await writeFile(
      join(calibrationDir, 'labels.jsonl'),
      ids
        .map((row_id, index) =>
          JSON.stringify({ row_id, human_pass: index % 2 === 0, reason: 'r' }),
        )
        .join('\n'),
    );
  };

  it('counts the judge once it is calibrated for the rubric and judge that graded the run', async () => {
    const paths = await withRecord();
    await calibrated(paths.calibrationDir);
    await reportIntoEvals(paths);
    expect(await readFile(paths.evalsMd, 'utf8')).toContain(
      '(counts toward the decision)',
    );
  });

  it('names the markers it writes between when EVALS.md is missing', async () => {
    const paths = await withRecord();
    await rm(paths.evalsMd);
    await expect(reportIntoEvals(paths)).rejects.toThrow(START);
  });
});
