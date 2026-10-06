/** Hints for a tool that only reads the case's own data (01 §Tools). Clients treat them as untrusted; G1 is the guarantee. */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
