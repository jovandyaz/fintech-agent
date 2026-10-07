/**
 * The process that runs the model must not hold the write key (02 G1): any
 * value, even an empty one, means the deployment is wired wrong.
 */
export function assertApiEnv(env: NodeJS.ProcessEnv): void {
  if (env.CORE_EXECUTOR_KEY !== undefined) {
    throw new Error(
      'api refuses to start with CORE_EXECUTOR_KEY set; only the executor holds it (specs/02-security.md G1)',
    );
  }
}
