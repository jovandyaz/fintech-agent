import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const CONSOLE_SRC = join(REPO_ROOT, 'apps/console/src');
const PLANTED = 'apps/console/src/planted.tsx';
const LINT_MS = 60_000;
const RULE_MESSAGE = /\bG7:|@fintech-agent\/contracts\/console/;
const MARKUP_SINKS =
  /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|setHTMLUnsafe|parseFromString|srcdoc|document\.write/i;

const eslint = new ESLint({
  cwd: REPO_ROOT,
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function ruleErrors(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: PLANTED });
  return (result?.messages ?? [])
    .filter((m) => m.severity === 2 && RULE_MESSAGE.test(m.message))
    .map((m) => m.message);
}

function sourcesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesOf(path);
    return /\.(?:ts|tsx|css|html)$/.test(entry.name) ? [path] : [];
  });
}

describe('console plain text (02 G7)', () => {
  it.each([
    [
      'dangerouslySetInnerHTML',
      `export const T = ({ t }: { t: string }) => <p dangerouslySetInnerHTML={{ __html: t }} />;\n`,
    ],
    [
      'innerHTML',
      `export const put = (el: HTMLElement, t: string) => { el.innerHTML = t; };\n`,
    ],
    [
      'insertAdjacentHTML',
      `export const put = (el: HTMLElement, t: string) => el.insertAdjacentHTML('beforeend', t);\n`,
    ],
    [
      'outerHTML',
      `export const put = (el: HTMLElement, t: string) => { el.outerHTML = t; };\n`,
    ],
    [
      'document.write',
      `export const put = (t: string) => document.write(t);\n`,
    ],
    [
      'a computed innerHTML',
      `export const put = (el: HTMLElement, t: string) => { el['innerHTML'] = t; };\n`,
    ],
    [
      'createContextualFragment',
      `export const put = (t: string) => document.createRange().createContextualFragment(t);\n`,
    ],
    [
      'setHTMLUnsafe',
      `export const put = (el: HTMLElement, t: string) => el.setHTMLUnsafe(t);\n`,
    ],
    [
      'DOMParser',
      `export const parse = (t: string) => new DOMParser().parseFromString(t, 'text/html');\n`,
    ],
    [
      'an iframe srcDoc',
      `export const T = ({ t }: { t: string }) => <iframe srcDoc={t} />;\n`,
    ],
    [
      'a lowercase srcdoc property',
      `export const put = (frame: HTMLIFrameElement, t: string) => { frame.srcdoc = t; };\n`,
    ],
    [
      'a Markdown renderer',
      `import Markdown from 'react-markdown';\nexport const M = Markdown;\n`,
    ],
    [
      'an HTML parser',
      `import parse from 'html-react-parser';\nexport const p = parse;\n`,
    ],
    [
      'a sink behind an eslint-disable comment',
      `// eslint-disable-next-line no-restricted-syntax\nexport const T = ({ t }: { t: string }) => <p dangerouslySetInnerHTML={{ __html: t }} />;\n`,
    ],
    [
      'a runtime import of the contracts barrel',
      `import { CASE_FLAGS } from '@fintech-agent/contracts';\nexport const flags = CASE_FLAGS;\n`,
    ],
  ])(
    'fails on %s in the console',
    async (_, code) => {
      expect(await ruleErrors(code)).not.toEqual([]);
    },
    LINT_MS,
  );

  it(
    'leaves writes that make no markup alone',
    async () => {
      expect(
        await ruleErrors(
          `export const copy = (t: string) => navigator.clipboard.writeText(t);\nexport const save = (w: WritableStreamDefaultWriter<string>, t: string) => w.write(t);\n`,
        ),
      ).toEqual([]);
    },
    LINT_MS,
  );

  it(
    'allows a type-only import of the contracts barrel',
    async () => {
      expect(
        await ruleErrors(
          `import type { CaseDetail } from '@fintech-agent/contracts';\nexport type D = CaseDetail;\n`,
        ),
      ).toEqual([]);
    },
    LINT_MS,
  );

  it('holds no markup sink anywhere in the console source', () => {
    const offenders = sourcesOf(CONSOLE_SRC).filter((file) =>
      MARKUP_SINKS.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
