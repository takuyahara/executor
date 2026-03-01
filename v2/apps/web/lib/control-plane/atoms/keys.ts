// ---------------------------------------------------------------------------
// Reactivity keys
//
// Queries subscribe to keys; mutations invalidate keys.
// When a mutation shares keys with a query, the query auto-refetches.
//
// Following the opencode-control pattern: each domain declares its own keys
// and spreads a shared workspace key so that switching workspace invalidates
// all workspace-scoped data.
// ---------------------------------------------------------------------------

export const workspaceKeys = { workspace: ["selected"] } as const;

export const sourcesKeys = { ...workspaceKeys, sources: ["list"] } as const;
export const toolsKeys = { ...workspaceKeys, tools: ["list"] } as const;
export const toolDetailKeys = { ...workspaceKeys, toolDetail: ["single"] } as const;
export const approvalsKeys = { ...workspaceKeys, approvals: ["list"] } as const;
export const policiesKeys = { ...workspaceKeys, policies: ["list"] } as const;
export const credentialsKeys = { ...workspaceKeys, credentials: ["list"] } as const;
export const storageKeys = { ...workspaceKeys, storage: ["list"] } as const;
export const organizationsKeys = { organizations: ["list"] } as const;
export const workspacesKeys = { workspaces: ["list"] } as const;
