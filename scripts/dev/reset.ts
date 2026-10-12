import { EXIT, parseResetArgs } from './config.ts';
import { compose, composeConfig } from './docker.ts';
import { dockerChecks } from './preflight.ts';
import {
  ask,
  heading,
  isInteractive,
  printChecks,
  runCommand,
} from './terminal.ts';

const HELP = `Usage: pnpm reset [--yes]

Deletes the stack's containers and its data: the Postgres volume (every case,
decision, trace and audit row) and the core-mock volume. pnpm start then brings
up an empty stack and seeds it again. Images and .env stay.

Options:
  -y, --yes   Do not ask for confirmation (needed without a terminal, e.g. CI).
  -h, --help  Show this help.`;

const CONFIRMATION = /^y(es)?$/i;

function projectName(): string {
  try {
    return composeConfig(process.env, false).name;
  } catch {
    return 'this stack';
  }
}

async function confirmed(yes: boolean, project: string): Promise<boolean> {
  if (yes) return true;
  if (!isInteractive()) {
    console.error(
      'pnpm reset deletes every case, decision and trace. Confirm with: pnpm reset --yes',
    );
    return false;
  }
  const answer = await ask(
    `Delete the containers and the data of ${project} (every case, decision, trace and audit row)? [y/N] `,
  );
  return CONFIRMATION.test(answer);
}

async function main(): Promise<number> {
  const args = parseResetArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return EXIT.ok;
  }
  heading('Resetting the stack');
  if (!printChecks(dockerChecks())) return EXIT.failed;
  if (!(await confirmed(args.yes, projectName()))) {
    console.log('Nothing deleted.');
    return EXIT.failed;
  }
  const exit = await compose(['down', '--volumes'], process.env);
  if (exit === EXIT.ok) {
    console.log(
      '\nDeleted. pnpm start brings up an empty stack and seeds it again.',
    );
  }
  return exit;
}

await runCommand(main);
