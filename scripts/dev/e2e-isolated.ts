import {
  FIRST_ALTERNATE_OCTET,
  freeSubnetPlan,
  runningServices,
} from './checks.ts';
import {
  E2E_PROJECT,
  EXIT,
  e2eExit,
  isolatedEnv,
  parseHelpArgs,
} from './config.ts';
import {
  compose,
  composePs,
  dockerNetworks,
  explainFailedStart,
} from './docker.ts';
import { stackChecks, toolChecks } from './preflight.ts';
import { reasonOf, run } from './system.ts';
import { heading, printChecks, runCommand, warn } from './terminal.ts';

const HELP = `Usage: pnpm e2e:isolated

Runs the Playwright end-to-end tests (pnpm e2e) on a throwaway compose project,
${E2E_PROJECT}, so your stack's data survives:

  1. installs Playwright's Chromium if it is missing;
  2. stops your stack if it is running (its data stays);
  3. starts ${E2E_PROJECT} from empty volumes with the kill switch on, no key
     and no .env, on a free subnet;
  4. runs pnpm e2e against it;
  5. deletes ${E2E_PROJECT} with its volumes and images, and starts your
     stack's services again, also when a test fails or you press Ctrl+C.

It uses the same host ports as your stack, which is why yours stops meanwhile.`;

async function step(
  title: string,
  command: () => Promise<number>,
): Promise<void> {
  heading(title);
  const exit = await command();
  if (exit !== EXIT.ok) throw new Error(`${title} failed (exit ${exit})`);
}

async function main(): Promise<number> {
  if (parseHelpArgs(process.argv.slice(2), 'pnpm e2e:isolated').help) {
    console.log(HELP);
    return EXIT.ok;
  }
  heading('Preflight');
  if (!printChecks(toolChecks())) return EXIT.failed;
  heading('Installing Playwright Chromium (skipped when present)');
  const chromiumExit = await run('pnpm', [
    '--filter',
    '@fintech-agent/e2e',
    'exec',
    'playwright',
    'install',
    'chromium',
  ]);
  if (chromiumExit !== EXIT.ok) {
    warn(
      `Installing Chromium failed (exit ${chromiumExit}); nothing was stopped.`,
    );
    return EXIT.failed;
  }

  const yours = runningServices(composePs(process.env));
  const throwaway = isolatedEnv(process.env, undefined);
  let interrupted = false;
  // Ctrl+C reaches the children too; staying alive lets the cleanup below run.
  const onInterrupt = (): void => {
    interrupted = true;
  };
  process.on('SIGINT', onInterrupt);
  let testsExit: number = EXIT.failed;
  let cleanupFailed = false;
  try {
    if (yours.length > 0) {
      await step('Stopping your stack (its data stays)', () =>
        compose(['stop'], process.env),
      );
    }
    await step(`Clearing any leftover ${E2E_PROJECT}`, () =>
      compose(['down', '--volumes'], throwaway),
    );
    const plan = freeSubnetPlan(
      dockerNetworks(),
      E2E_PROJECT,
      FIRST_ALTERNATE_OCTET,
    );
    if (!plan) throw new Error('No free 10.N.0.0/24 subnet for the e2e stack');
    const env = isolatedEnv(process.env, plan);
    heading(`Preflight for ${E2E_PROJECT} on ${plan.subnet}`);
    const { checks } = await stackChecks(env);
    if (!printChecks(checks)) throw new Error('The e2e stack cannot start');
    heading(`Starting ${E2E_PROJECT}`);
    const upExit = await compose(['up', '--detach', '--build', '--wait'], env);
    if (upExit !== EXIT.ok) {
      await explainFailedStart(env);
      throw new Error(`Starting ${E2E_PROJECT} failed (exit ${upExit})`);
    }
    heading('Running pnpm e2e');
    testsExit = await run('pnpm', ['e2e'], env);
  } catch (error) {
    warn(reasonOf(error));
  } finally {
    heading(`Deleting ${E2E_PROJECT}`);
    if (
      (await compose(['down', '--volumes', '--rmi', 'local'], throwaway)) !==
      EXIT.ok
    ) {
      cleanupFailed = true;
      warn(
        `Delete it by hand: docker compose --project-name ${E2E_PROJECT} down --volumes --rmi local`,
      );
    }
    if (yours.length > 0) {
      heading('Starting your stack again');
      if ((await compose(['start', ...yours], process.env)) !== EXIT.ok) {
        cleanupFailed = true;
        warn('Start it by hand: docker compose start');
      }
    }
    process.off('SIGINT', onInterrupt);
  }
  return e2eExit({ testsExit, interrupted, cleanupFailed });
}

await runCommand(main);
