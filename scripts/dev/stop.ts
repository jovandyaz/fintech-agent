import { EXIT, parseHelpArgs } from './config.ts';
import { runningServices } from './checks.ts';
import { compose, composePs } from './docker.ts';
import { dockerChecks } from './preflight.ts';
import { heading, printChecks, runCommand } from './terminal.ts';

const HELP = `Usage: pnpm stop

Stops every container of the stack and keeps its data (the Postgres and
core-mock volumes): pnpm start brings it back as it was. A run the agent has in
flight finishes first.`;

async function main(): Promise<number> {
  if (parseHelpArgs(process.argv.slice(2), 'pnpm stop').help) {
    console.log(HELP);
    return EXIT.ok;
  }
  heading('Stopping the stack');
  if (!printChecks(dockerChecks())) return EXIT.failed;
  if (runningServices(composePs(process.env)).length === 0) {
    console.log('\nThe stack is not running; nothing to stop.');
    return EXIT.ok;
  }
  const exit = await compose(['stop'], process.env);
  if (exit === EXIT.ok) {
    console.log(
      '\nStopped; the data is kept. pnpm start brings the stack back, pnpm reset deletes its data.',
    );
  }
  return exit;
}

await runCommand(main);
