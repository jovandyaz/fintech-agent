import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { resolve } from 'node:path';

import type { Env } from './config.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');

export interface Captured {
  status: number | null;
  stdout: string;
  stderr: string;
  /** The program itself was not found on PATH. */
  missing: boolean;
}

const CAPTURE_TIMEOUT_MS = 60_000;
const CAPTURE_MAX_BYTES = 64 * 1024 * 1024;
const NOT_FOUND = 'ENOENT';
const ERROR_EVENT = 'error';

/** Runs a command from the repo root and captures its output; never throws. */
export function capture(
  command: string,
  args: readonly string[],
  env: Env = process.env,
): Captured {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: CAPTURE_TIMEOUT_MS,
    maxBuffer: CAPTURE_MAX_BYTES,
    windowsHide: true,
  });
  const error = result.error as NodeJS.ErrnoException | undefined;
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    missing: error?.code === NOT_FOUND,
  };
}

const FAILED = 1;
const COMMAND_NOT_FOUND = 127;

/**
 * Runs a command from the repo root on this terminal and resolves to its exit
 * code; a missing program resolves to 127.
 */
export function run(
  command: string,
  args: readonly string[],
  env: Env = process.env,
): Promise<number> {
  // On Windows pnpm is a .cmd shim, which only a shell can start; the
  // arguments here are fixed words, so joining them is safe.
  const child =
    process.platform === 'win32' && command === 'pnpm'
      ? spawn([command, ...args].join(' '), {
          cwd: REPO_ROOT,
          env,
          stdio: 'inherit',
          shell: true,
        })
      : spawn(command, args, { cwd: REPO_ROOT, env, stdio: 'inherit' });
  return new Promise((done) => {
    child.once(ERROR_EVENT, (error: NodeJS.ErrnoException) => {
      done(error.code === NOT_FOUND ? COMMAND_NOT_FOUND : FAILED);
    });
    child.once('close', (code) => done(code ?? FAILED));
  });
}

export function readRepoFile(name: string): string | undefined {
  const path = resolve(REPO_ROOT, name);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

/** The Node range package.json `engines` requires; throws when there is none. */
export function enginesNode(): string {
  const manifest = JSON.parse(readRepoFile('package.json') ?? '{}') as {
    engines?: { node?: string };
  };
  const engines = manifest.engines?.node;
  if (!engines) throw new Error('package.json has no engines.node');
  return engines;
}

export function dependenciesInstalled(): boolean {
  return existsSync(resolve(REPO_ROOT, 'node_modules', '.modules.yaml'));
}

const GIT_IGNORED = 0;
const GIT_NOT_IGNORED = 1;

/** Whether git ignores the repo file; undefined without git or outside a clone. */
export function gitIgnores(name: string): boolean | undefined {
  const result = capture('git', ['check-ignore', '--quiet', name]);
  if (result.status === GIT_IGNORED) return true;
  if (result.status === GIT_NOT_IGNORED) return false;
  return undefined;
}

const PROBE_TIMEOUT_MS = 500;
const LOOPBACK = '127.0.0.1';
const PORT_TAKEN = ['EADDRINUSE', 'EACCES'];

function accepts(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ port, host: LOOPBACK });
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once(ERROR_EVENT, () => done(false));
  });
}

function bindable(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once(ERROR_EVENT, (error: NodeJS.ErrnoException) => {
      done(!PORT_TAKEN.includes(error.code ?? ''));
    });
    server.listen({ port, exclusive: true }, () => {
      server.close(() => done(true));
    });
  });
}

/**
 * Whether another program holds a host port. Both probes run: macOS lets a
 * wildcard bind succeed over a program listening on 127.0.0.1 only, which
 * would still answer localhost in the stack's place.
 */
export async function portIsBusy(port: number): Promise<boolean> {
  return (await accepts(port)) || !(await bindable(port));
}

export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
