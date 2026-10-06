#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const PROTECTED = [
  {
    prefix: 'apps/api/src/executor/',
    invariant:
      'G1 + G3: the executor is the only writer; it re-validates G2 and executes at most once',
  },
  {
    prefix: 'apps/api/src/approvals/',
    invariant:
      'G3: nothing executes without a named operator; transitions are conditional and audited',
  },
  {
    prefix: 'packages/contracts/src/mask',
    invariant:
      'G6: full CLABE, PAN, RFC, CURP and auth factors never reach logs, traces or the model',
  },
  {
    prefix: 'apps/api/src/agent/validate',
    invariant:
      'G5: provenance, allow-list, PII, link and auth-factor checks always run after the model',
  },
  {
    prefix: 'apps/mcp/',
    invariant:
      "G4: tools are bound to the case token's customer; no tool accepts customer_id",
  },
];

const SPEC_FILE = /\.(?:int\.)?(?:spec|test)\.[cm]?[jt]sx?$/;
const FOCUS_OR_SKIP =
  /\b(?:it|test|describe)\.(?:skip|only|todo)\s*\(|\bx(?:it|test|describe)\s*\(|\bf(?:it|describe)\s*\(/g;
const TEST_DECLARATION = /\b(?:it|test)(?:\.each\s*\([^)]*\))?\s*\(/g;

const count = (text, pattern) => (text.match(pattern) ?? []).length;

function changedText({ toolName, toolInput, readFile }) {
  if (toolName === 'Write') {
    return {
      before: readFile(toolInput.file_path) ?? '',
      after: toolInput.content ?? '',
    };
  }
  const edits =
    toolName === 'MultiEdit'
      ? (toolInput.edits ?? [])
      : [
          {
            old_string: toolInput.old_string,
            new_string: toolInput.new_string,
          },
        ];
  return {
    before: edits.map((e) => e.old_string ?? '').join('\n'),
    after: edits.map((e) => e.new_string ?? '').join('\n'),
  };
}

/**
 * Decides what the PreToolUse hook says about one Edit, Write or MultiEdit.
 * Returns `none` (stay silent), `context` (allow, but remind the invariant) or
 * `deny` (a protected spec would lose a test or gain a skip/only/todo).
 */
export function evaluate({ toolName, toolInput, root, readFile }) {
  const filePath = toolInput?.file_path;
  if (typeof filePath !== 'string') return { decision: 'none' };

  const rel = relative(root, resolve(filePath)).split(sep).join('/');
  if (rel.startsWith('..')) return { decision: 'none' };

  const area = PROTECTED.find((p) => rel.startsWith(p.prefix));
  if (!area) return { decision: 'none' };

  const reminder = `Protected path (specs/02-security.md ${area.invariant}). Change behavior here only with a failing-then-passing test.`;
  if (!SPEC_FILE.test(rel)) return { decision: 'context', message: reminder };

  const { before, after } = changedText({ toolName, toolInput, readFile });
  if (count(after, FOCUS_OR_SKIP) > count(before, FOCUS_OR_SKIP)) {
    return {
      decision: 'deny',
      message: `${rel} guards ${area.invariant}. Adding skip, only, todo or x/f-prefixed tests here is blocked: fix the code, not the test.`,
    };
  }
  if (count(after, TEST_DECLARATION) < count(before, TEST_DECLARATION)) {
    return {
      decision: 'deny',
      message: `${rel} guards ${area.invariant}. This change removes a test; protected specs only grow. Ask the user if a test is truly obsolete.`,
    };
  }
  return { decision: 'context', message: reminder };
}

function readFileOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;

  const result = evaluate({
    toolName: input.tool_name,
    toolInput: input.tool_input,
    root: REPO_ROOT,
    readFile: readFileOrNull,
  });
  if (result.decision === 'none') return;

  const hookSpecificOutput =
    result.decision === 'deny'
      ? {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.message,
        }
      : { hookEventName: 'PreToolUse', additionalContext: result.message };
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
