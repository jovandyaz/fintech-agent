/** Every api path the console calls, as the client sends it (without /api). */
export const API_PATH = {
  me: '/me',
  status: '/status',
  customers: '/customers',
  cases: '/cases',
  casesWithEval: '/cases?include_eval=true',
  case: (caseId: string) => `/cases/${encodeURIComponent(caseId)}`,
  rerun: (caseId: string) => `/cases/${encodeURIComponent(caseId)}/rerun`,
  decision: (actionId: string) =>
    `/actions/${encodeURIComponent(actionId)}/decision`,
} as const;
