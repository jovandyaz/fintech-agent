import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluate } from '../guard-invariants.mjs';

const SCRIPT = fileURLToPath(
  new URL('../guard-invariants.mjs', import.meta.url),
);
const REPO = dirname(dirname(dirname(SCRIPT)));
const ROOT = '/repo';
const noFile = () => null;

function edit(file, oldString, newString) {
  return {
    toolName: 'Edit',
    toolInput: {
      file_path: join(ROOT, file),
      old_string: oldString,
      new_string: newString,
    },
    root: ROOT,
    readFile: noFile,
  };
}

test('an edit outside the protected paths passes silently', () => {
  assert.deepEqual(evaluate(edit('apps/api/src/cases/cases.ts', 'a', 'b')), {
    decision: 'none',
  });
});

test('an edit to a protected source file passes with the invariant it guards', () => {
  const result = evaluate(edit('apps/api/src/approvals/decide.ts', 'a', 'b'));
  assert.equal(result.decision, 'context');
  assert.match(result.message, /G3/);
});

test('every protected area names its invariant', () => {
  const cases = [
    ['apps/api/src/executor/run.ts', /G1/],
    ['apps/api/src/approvals/decide.ts', /G3/],
    ['packages/contracts/src/mask.ts', /G6/],
    ['apps/api/src/agent/validate.ts', /G5/],
    ['apps/mcp/src/tools/list-transactions.ts', /G4/],
  ];
  for (const [file, invariant] of cases) {
    const result = evaluate(edit(file, 'a', 'b'));
    assert.equal(result.decision, 'context', file);
    assert.match(result.message, invariant, file);
  }
});

test('adding .skip to a protected spec is denied', () => {
  const result = evaluate(
    edit(
      'apps/api/src/approvals/decide.spec.ts',
      "it('rejects a double approve', () => {",
      "it.skip('rejects a double approve', () => {",
    ),
  );
  assert.equal(result.decision, 'deny');
  assert.match(result.message, /skip|only/);
});

test('adding .only or a todo to a protected spec is denied', () => {
  for (const marker of ['it.only(', 'describe.only(', 'it.todo(', 'xit(']) {
    const result = evaluate(
      edit(
        'packages/contracts/src/mask.spec.ts',
        "it('masks a CLABE', () => {",
        `${marker}'masks a CLABE', () => {`,
      ),
    );
    assert.equal(result.decision, 'deny', marker);
  }
});

test('removing a test from a protected spec is denied', () => {
  const result = evaluate(
    edit(
      'apps/api/src/executor/run.spec.ts',
      "it('runs once', () => {});\nit('never runs a rejected action', () => {});",
      "it('runs once', () => {});",
    ),
  );
  assert.equal(result.decision, 'deny');
  assert.match(result.message, /removes a test/);
});

test('adding a test to a protected spec is allowed', () => {
  const result = evaluate(
    edit(
      'apps/api/src/executor/run.spec.ts',
      "it('runs once', () => {});",
      "it('runs once', () => {});\nit('re-validates ownership', () => {});",
    ),
  );
  assert.equal(result.decision, 'context');
});

test('a Write that drops tests from an existing protected spec is denied', () => {
  const existing = "it('a', () => {});\nit('b', () => {});";
  const result = evaluate({
    toolName: 'Write',
    toolInput: {
      file_path: join(ROOT, 'apps/mcp/src/tools/binding.spec.ts'),
      content: "it('a', () => {});",
    },
    root: ROOT,
    readFile: () => existing,
  });
  assert.equal(result.decision, 'deny');
});

test('a Write that creates a new protected spec is allowed', () => {
  const result = evaluate({
    toolName: 'Write',
    toolInput: {
      file_path: join(ROOT, 'apps/mcp/src/tools/binding.spec.ts'),
      content: "it('a', () => {});",
    },
    root: ROOT,
    readFile: noFile,
  });
  assert.equal(result.decision, 'context');
});

test('a MultiEdit that skips a test in any of its edits is denied', () => {
  const result = evaluate({
    toolName: 'MultiEdit',
    toolInput: {
      file_path: join(ROOT, 'apps/api/src/agent/validate.spec.ts'),
      edits: [
        { old_string: 'const a = 1;', new_string: 'const a = 2;' },
        {
          old_string: "it('blocks a link'",
          new_string: "it.skip('blocks a link'",
        },
      ],
    },
    root: ROOT,
    readFile: noFile,
  });
  assert.equal(result.decision, 'deny');
});

test('skipping a test outside the protected paths is not this hook’s business', () => {
  const result = evaluate(
    edit('apps/console/src/inbox.spec.ts', "it('a'", "it.skip('a'"),
  );
  assert.deepEqual(result, { decision: 'none' });
});

test('a file outside the repository is ignored', () => {
  const result = evaluate({
    toolName: 'Edit',
    toolInput: {
      file_path: '/elsewhere/apps/api/src/executor/run.ts',
      old_string: 'a',
      new_string: 'b',
    },
    root: ROOT,
    readFile: noFile,
  });
  assert.deepEqual(result, { decision: 'none' });
});

function runHook(payload) {
  return spawnSync(process.execPath, [SCRIPT], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    cwd: tmpdir(),
  });
}

test('end to end: a denied edit returns a PreToolUse deny decision', () => {
  const result = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: join(REPO, 'apps/api/src/approvals/decide.spec.ts'),
      old_string: "it('a'",
      new_string: "it.skip('a'",
    },
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
});

test('end to end: an allowed protected edit adds context without deciding permission', () => {
  const result = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: join(REPO, 'apps/api/src/executor/run.ts'),
      old_string: 'a',
      new_string: 'b',
    },
  });
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined);
  assert.match(output.hookSpecificOutput.additionalContext, /G1/);
});

test('end to end: unusable input never blocks the tool', () => {
  for (const raw of ['', 'not json', '[]', '{"tool_name":"Edit"}']) {
    const result = runHook(raw);
    assert.equal(result.status, 0, raw);
    assert.equal(result.stdout, '', raw);
  }
});
