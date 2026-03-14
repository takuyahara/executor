import { createHash } from "node:crypto";

import type {
  CreatePolicyPayload,
  UpdatePolicyPayload,
} from "../api/policies/api";
import {
  PolicyIdSchema,
  type LocalExecutorConfig,
  type OrganizationId,
  type Policy,
  type PolicyId,
  type WorkspaceId,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  loadLocalExecutorConfig,
  writeProjectLocalExecutorConfig,
} from "./local-config";
import {
  getRuntimeLocalWorkspaceOption,
} from "./local-runtime-context";
import {
  loadLocalWorkspaceState,
  writeLocalWorkspaceState,
} from "./local-workspace-state";
import {
  derivePolicyConfigKey,
} from "./local-workspace-sync";
import {
  mapPersistenceError,
  parseJsonString,
  type Mutable,
} from "./operations-shared";
import {
  type OperationErrors,
  operationErrors,
} from "./operation-errors";
import { ControlPlaneStore, type ControlPlaneStoreShape } from "./store";

const policyOps = {
  list: operationErrors("policies.list"),
  create: operationErrors("policies.create"),
  get: operationErrors("policies.get"),
  update: operationErrors("policies.update"),
  remove: operationErrors("policies.remove"),
} as const;

type PolicyScopeContext = {
  scopeType: Policy["scopeType"];
  organizationId: Policy["organizationId"];
  workspaceId: Policy["workspaceId"];
};

const cloneJson = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const localPolicyIdForConfigKey = (input: {
  workspaceRoot: string;
  configKey: string;
}): Policy["id"] =>
  PolicyIdSchema.make(
    `pol_local_${createHash("sha256").update(`${input.workspaceRoot}:${input.configKey}`).digest("hex").slice(0, 16)}`,
  );

const ensureLocalWorkspacePolicyCompatible = (
  operation: OperationErrors,
  payload: CreatePolicyPayload | UpdatePolicyPayload,
) =>
  Effect.gen(function* () {
    if (payload.targetAccountId !== undefined && payload.targetAccountId !== null) {
      return yield* Effect.fail(
        operation.badRequest(
          "Unsupported local workspace policy field",
          "targetAccountId is not supported in .executor/executor.jsonc policies",
        ),
      );
    }
    if (payload.clientId !== undefined && payload.clientId !== null) {
      return yield* Effect.fail(
        operation.badRequest(
          "Unsupported local workspace policy field",
          "clientId is not supported in .executor/executor.jsonc policies",
        ),
      );
    }
    if (payload.argumentConditionsJson !== undefined && payload.argumentConditionsJson !== null) {
      return yield* Effect.fail(
        operation.badRequest(
          "Unsupported local workspace policy field",
          "argumentConditionsJson is not supported in .executor/executor.jsonc policies",
        ),
      );
    }
    if (payload.resourceType !== undefined && payload.resourceType !== "tool_path") {
      return yield* Effect.fail(
        operation.badRequest(
          "Unsupported local workspace policy field",
          "Only tool_path workspace policies are supported in local config",
        ),
      );
    }
    if (payload.matchType !== undefined && payload.matchType !== "glob") {
      return yield* Effect.fail(
        operation.badRequest(
          "Unsupported local workspace policy field",
          "Only glob workspace policies are supported in local config",
        ),
      );
    }
  });

export const loadRuntimeLocalWorkspacePolicies = (input: {
  store: ControlPlaneStoreShape;
  workspaceId: WorkspaceId;
}) =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* getRuntimeLocalWorkspaceOption();
    if (
      runtimeLocalWorkspace === null
      || runtimeLocalWorkspace.installation.workspaceId !== input.workspaceId
    ) {
      return null;
    }

    const workspace = yield* input.store.workspaces.getById(input.workspaceId);
    if (Option.isNone(workspace)) {
      return null;
    }

    const loadedConfig = yield* Effect.tryPromise({
      try: () => loadLocalExecutorConfig(runtimeLocalWorkspace.context),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });
    const workspaceState = yield* Effect.tryPromise({
      try: () => loadLocalWorkspaceState(runtimeLocalWorkspace.context),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    const configEntries = Object.entries(loadedConfig.config?.policies ?? {});
    const policies = configEntries.map(([configKey, configPolicy]) => {
      const state = workspaceState.policies[configKey];
      return {
        id: state?.id ?? localPolicyIdForConfigKey({
          workspaceRoot: runtimeLocalWorkspace.context.workspaceRoot,
          configKey,
        }),
        configKey,
        scopeType: "workspace" as const,
        organizationId: workspace.value.organizationId,
        workspaceId: input.workspaceId,
        targetAccountId: null,
        clientId: null,
        resourceType: "tool_path" as const,
        resourcePattern: configPolicy.match.trim(),
        matchType: "glob" as const,
        effect: configPolicy.action,
        approvalMode: configPolicy.approval === "manual" ? "required" as const : "auto" as const,
        argumentConditionsJson: null,
        priority: configPolicy.priority ?? 0,
        enabled: configPolicy.enabled ?? true,
        createdAt: state?.createdAt ?? Date.now(),
        updatedAt: state?.updatedAt ?? Date.now(),
      } satisfies Policy;
    });

    return {
      runtimeLocalWorkspace,
      loadedConfig,
      workspaceState,
      workspace: workspace.value,
      policies,
    };
  });

const loadWorkspacePolicyContext = (
  store: ControlPlaneStoreShape,
  operation: OperationErrors,
  workspaceId: WorkspaceId,
) =>
  Effect.gen(function* () {
    const workspace = yield* operation.child("workspace").mapStorage(
      store.workspaces.getById(workspaceId),
    );
    if (Option.isNone(workspace)) {
      return yield* Effect.fail(
        operation.notFound(
          "Workspace not found",
          `workspaceId=${workspaceId}`,
        ),
      );
    }

    return {
      scopeType: "workspace",
      organizationId: workspace.value.organizationId,
      workspaceId,
    } satisfies PolicyScopeContext;
  });

const loadOrganizationPolicyContext = (
  store: ControlPlaneStoreShape,
  operation: OperationErrors,
  organizationId: OrganizationId,
) =>
  Effect.gen(function* () {
    const organization = yield* operation.child("organization").mapStorage(
      store.organizations.getById(organizationId),
    );
    if (Option.isNone(organization)) {
      return yield* Effect.fail(
        operation.notFound(
          "Organization not found",
          `organizationId=${organizationId}`,
        ),
      );
    }

    return {
      scopeType: "organization",
      organizationId,
      workspaceId: null,
    } satisfies PolicyScopeContext;
  });

const policyMatchesScope = (policy: Policy, scope: PolicyScopeContext): boolean =>
  policy.scopeType === scope.scopeType
  && policy.organizationId === scope.organizationId
  && policy.workspaceId === scope.workspaceId;

const writeLocalPolicyFiles = (input: {
  operation: OperationErrors;
  context: Parameters<typeof writeProjectLocalExecutorConfig>[0]["context"];
  projectConfig: LocalExecutorConfig;
  workspaceState: Awaited<ReturnType<typeof loadLocalWorkspaceState>>;
}) =>
  Effect.tryPromise({
    try: () =>
      Promise.all([
        writeProjectLocalExecutorConfig({
          context: input.context,
          config: input.projectConfig,
        }),
        writeLocalWorkspaceState({
          context: input.context,
          state: input.workspaceState,
        }),
      ]).then(() => undefined),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  }).pipe(
    Effect.mapError((cause) =>
      input.operation.unknownStorage(
        cause,
        "Failed writing local workspace policy files",
      ),
    ),
  );

const createScopedPolicy = (input: {
  scope: PolicyScopeContext;
  payload: CreatePolicyPayload;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      const now = Date.now();
      const operation = policyOps.create;

      if (input.scope.workspaceId !== null) {
        const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies({
          store,
          workspaceId: input.scope.workspaceId,
        }).pipe(
          Effect.mapError((cause) =>
            operation.unknownStorage(
              cause,
              "Failed loading local workspace policies",
            ),
          ),
        );
        if (localWorkspace !== null) {
          yield* ensureLocalWorkspacePolicyCompatible(operation, input.payload);

          const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
          const policies = {
            ...(projectConfig.policies ?? {}),
          };
          const configKey = derivePolicyConfigKey({
            configKey: null,
            resourcePattern: input.payload.resourcePattern ?? "*",
            effect: input.payload.effect ?? "allow",
            approvalMode: input.payload.approvalMode ?? "auto",
          }, new Set(Object.keys(policies)));
          const id = localWorkspace.workspaceState.policies[configKey]?.id
            ?? localPolicyIdForConfigKey({
              workspaceRoot: localWorkspace.runtimeLocalWorkspace.context.workspaceRoot,
              configKey,
            });
          policies[configKey] = {
            match: input.payload.resourcePattern ?? "*",
            action: input.payload.effect ?? "allow",
            approval: (input.payload.approvalMode ?? "auto") === "required" ? "manual" : "auto",
            ...(input.payload.enabled === false ? { enabled: false } : {}),
            ...((input.payload.priority ?? 0) !== 0 ? { priority: input.payload.priority ?? 0 } : {}),
          };
          const existingState = localWorkspace.workspaceState.policies[configKey];
          const workspaceState = {
            ...localWorkspace.workspaceState,
            policies: {
              ...localWorkspace.workspaceState.policies,
              [configKey]: {
                id,
                createdAt: existingState?.createdAt ?? now,
                updatedAt: now,
              },
            },
          };
          yield* writeLocalPolicyFiles({
            operation,
            context: localWorkspace.runtimeLocalWorkspace.context,
            projectConfig: {
              ...projectConfig,
              policies,
            },
            workspaceState,
          });

          return {
            id,
            configKey,
            scopeType: "workspace",
            organizationId: input.scope.organizationId,
            workspaceId: input.scope.workspaceId,
            targetAccountId: null,
            clientId: null,
            resourceType: "tool_path",
            resourcePattern: policies[configKey]!.match,
            matchType: "glob",
            effect: policies[configKey]!.action,
            approvalMode: policies[configKey]!.approval === "manual" ? "required" : "auto",
            argumentConditionsJson: null,
            priority: policies[configKey]!.priority ?? 0,
            enabled: policies[configKey]!.enabled ?? true,
            createdAt: workspaceState.policies[configKey]!.createdAt,
            updatedAt: now,
          } satisfies Policy;
        }
      }

      const policy: Policy = {
        id: PolicyIdSchema.make(`pol_${crypto.randomUUID()}`),
        configKey: null,
        scopeType: input.scope.scopeType,
        organizationId: input.scope.organizationId,
        workspaceId: input.scope.workspaceId,
        targetAccountId: input.payload.targetAccountId ?? null,
        clientId: input.payload.clientId ?? null,
        resourceType: input.payload.resourceType ?? "tool_path",
        resourcePattern: input.payload.resourcePattern ?? "*",
        matchType: input.payload.matchType ?? "glob",
        effect: input.payload.effect ?? "allow",
        approvalMode: input.payload.approvalMode ?? "auto",
        argumentConditionsJson: input.payload.argumentConditionsJson ?? null,
        priority: input.payload.priority ?? 0,
        enabled: input.payload.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };

      if (policy.argumentConditionsJson !== null) {
        yield* parseJsonString(
          operation,
          "argumentConditionsJson",
          policy.argumentConditionsJson,
        );
      }

      yield* mapPersistenceError(
        operation,
        store.policies.insert(policy),
      );

      if (policy.workspaceId === null) {
        return policy;
      }

      return policy;
    }));

const getScopedPolicy = (input: {
  scope: PolicyScopeContext;
  policyId: PolicyId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      if (input.scope.workspaceId !== null) {
        const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies({
          store,
          workspaceId: input.scope.workspaceId,
        }).pipe(
          Effect.mapError((cause) =>
            policyOps.get.unknownStorage(
              cause,
              "Failed loading local workspace policies",
            ),
          ),
        );
        if (localWorkspace !== null) {
          const policy = localWorkspace.policies.find((candidate) => candidate.id === input.policyId) ?? null;
          if (policy === null) {
            return yield* Effect.fail(
              policyOps.get.notFound(
                "Policy not found",
                `scopeType=${input.scope.scopeType} organizationId=${input.scope.organizationId} workspaceId=${input.scope.workspaceId} policyId=${input.policyId}`,
              ),
            );
          }

          return policy;
        }
      }

      const existing = yield* policyOps.get.mapStorage(
        store.policies.getById(input.policyId),
      );

      if (Option.isNone(existing) || !policyMatchesScope(existing.value, input.scope)) {
        return yield* Effect.fail(
          policyOps.get.notFound(
            "Policy not found",
            `scopeType=${input.scope.scopeType} organizationId=${input.scope.organizationId} workspaceId=${input.scope.workspaceId} policyId=${input.policyId}`,
          ),
        );
      }

      return existing.value;
    }));

const updateScopedPolicy = (input: {
  scope: PolicyScopeContext;
  policyId: PolicyId;
  payload: UpdatePolicyPayload;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      if (input.scope.workspaceId !== null) {
        const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies({
          store,
          workspaceId: input.scope.workspaceId,
        }).pipe(
          Effect.mapError((cause) =>
            policyOps.update.unknownStorage(
              cause,
              "Failed loading local workspace policies",
            ),
          ),
        );
        if (localWorkspace !== null) {
          yield* ensureLocalWorkspacePolicyCompatible(policyOps.update, input.payload);
          const existing = localWorkspace.policies.find((candidate) => candidate.id === input.policyId) ?? null;
          if (existing === null || existing.configKey === null) {
            return yield* Effect.fail(
              policyOps.update.notFound(
                "Policy not found",
                `scopeType=${input.scope.scopeType} organizationId=${input.scope.organizationId} workspaceId=${input.scope.workspaceId} policyId=${input.policyId}`,
              ),
            );
          }

          const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
          const policies = {
            ...(projectConfig.policies ?? {}),
          };
          const existingConfig = policies[existing.configKey] ?? {
            match: existing.resourcePattern,
            action: existing.effect,
            approval: existing.approvalMode === "required" ? "manual" : "auto",
          };
          policies[existing.configKey] = {
            ...existingConfig,
            ...(input.payload.resourcePattern !== undefined ? { match: input.payload.resourcePattern } : {}),
            ...(input.payload.effect !== undefined ? { action: input.payload.effect } : {}),
            ...(input.payload.approvalMode !== undefined
              ? { approval: input.payload.approvalMode === "required" ? "manual" : "auto" }
              : {}),
            ...(input.payload.enabled !== undefined ? { enabled: input.payload.enabled } : {}),
            ...(input.payload.priority !== undefined ? { priority: input.payload.priority } : {}),
          };
          const existingState = localWorkspace.workspaceState.policies[existing.configKey];
          const updatedAt = Date.now();
          const workspaceState = {
            ...localWorkspace.workspaceState,
            policies: {
              ...localWorkspace.workspaceState.policies,
              [existing.configKey]: {
                id: existing.id,
                createdAt: existingState?.createdAt ?? existing.createdAt,
                updatedAt,
              },
            },
          };
          yield* writeLocalPolicyFiles({
            operation: policyOps.update,
            context: localWorkspace.runtimeLocalWorkspace.context,
            projectConfig: {
              ...projectConfig,
              policies,
            },
            workspaceState,
          });

          return {
            ...existing,
            resourcePattern: policies[existing.configKey]!.match,
            effect: policies[existing.configKey]!.action,
            approvalMode: policies[existing.configKey]!.approval === "manual" ? "required" : "auto",
            priority: policies[existing.configKey]!.priority ?? 0,
            enabled: policies[existing.configKey]!.enabled ?? true,
            updatedAt,
          } satisfies Policy;
        }
      }

      const existing = yield* policyOps.update.mapStorage(
        store.policies.getById(input.policyId),
      );
      if (Option.isNone(existing) || !policyMatchesScope(existing.value, input.scope)) {
        return yield* Effect.fail(
          policyOps.update.notFound(
            "Policy not found",
            `scopeType=${input.scope.scopeType} organizationId=${input.scope.organizationId} workspaceId=${input.scope.workspaceId} policyId=${input.policyId}`,
          ),
        );
      }

      const patch: Partial<
        Omit<Mutable<Policy>, "id" | "scopeType" | "organizationId" | "workspaceId" | "createdAt">
      > = {
        updatedAt: Date.now(),
      };

      if (input.payload.targetAccountId !== undefined) {
        patch.targetAccountId = input.payload.targetAccountId;
      }
      if (input.payload.clientId !== undefined) {
        patch.clientId = input.payload.clientId;
      }
      if (input.payload.resourceType !== undefined) {
        patch.resourceType = input.payload.resourceType;
      }
      if (input.payload.resourcePattern !== undefined) {
        patch.resourcePattern = input.payload.resourcePattern;
      }
      if (input.payload.matchType !== undefined) {
        patch.matchType = input.payload.matchType;
      }
      if (input.payload.effect !== undefined) {
        patch.effect = input.payload.effect;
      }
      if (input.payload.approvalMode !== undefined) {
        patch.approvalMode = input.payload.approvalMode;
      }
      if (input.payload.argumentConditionsJson !== undefined) {
        if (input.payload.argumentConditionsJson !== null) {
          yield* parseJsonString(
            policyOps.update,
            "argumentConditionsJson",
            input.payload.argumentConditionsJson,
          );
        }
        patch.argumentConditionsJson = input.payload.argumentConditionsJson;
      }
      if (input.payload.priority !== undefined) {
        patch.priority = input.payload.priority;
      }
      if (input.payload.enabled !== undefined) {
        patch.enabled = input.payload.enabled;
      }

      const updated = yield* mapPersistenceError(
        policyOps.update,
        store.policies.update(input.policyId, patch),
      );
      if (Option.isNone(updated)) {
        return yield* Effect.fail(
          policyOps.update.notFound(
            "Policy not found",
            `scopeType=${input.scope.scopeType} organizationId=${input.scope.organizationId} workspaceId=${input.scope.workspaceId} policyId=${input.policyId}`,
          ),
        );
      }

      if (updated.value.workspaceId === null) {
        return updated.value;
      }

      return updated.value;
    }));

const removeScopedPolicy = (input: {
  scope: PolicyScopeContext;
  policyId: PolicyId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      if (input.scope.workspaceId !== null) {
        const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies({
          store,
          workspaceId: input.scope.workspaceId,
        }).pipe(
          Effect.mapError((cause) =>
            policyOps.remove.unknownStorage(
              cause,
              "Failed loading local workspace policies",
            ),
          ),
        );
        if (localWorkspace !== null) {
          const existing = localWorkspace.policies.find((candidate) => candidate.id === input.policyId) ?? null;
          if (existing === null || existing.configKey === null) {
            return { removed: false };
          }

          const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
          const policies = {
            ...(projectConfig.policies ?? {}),
          };
          delete policies[existing.configKey];
          const {
            [existing.configKey]: _removedPolicy,
            ...remainingPolicies
          } = localWorkspace.workspaceState.policies;
          yield* writeLocalPolicyFiles({
            operation: policyOps.remove,
            context: localWorkspace.runtimeLocalWorkspace.context,
            projectConfig: {
              ...projectConfig,
              policies,
            },
            workspaceState: {
              ...localWorkspace.workspaceState,
              policies: remainingPolicies,
            },
          });
          return { removed: true };
        }
      }

      const existing = yield* policyOps.remove.mapStorage(
        store.policies.getById(input.policyId),
      );
      if (Option.isNone(existing) || !policyMatchesScope(existing.value, input.scope)) {
        return { removed: false };
      }

      const removed = yield* policyOps.remove.mapStorage(
        store.policies.removeById(input.policyId),
      );

      return { removed };
    }));

export const listOrganizationPolicies = (organizationId: OrganizationId) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      yield* loadOrganizationPolicyContext(store, policyOps.list, organizationId);
      return yield* policyOps.list.mapStorage(
        store.policies.listByOrganizationId(organizationId),
      );
    }));

export const listPolicies = (workspaceId: WorkspaceId) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      yield* loadWorkspacePolicyContext(store, policyOps.list, workspaceId);
      const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies({
        store,
        workspaceId,
      }).pipe(
        Effect.mapError((cause) =>
          policyOps.list.unknownStorage(
            cause,
            "Failed loading local workspace policies",
          ),
        ),
      );
      if (localWorkspace !== null) {
        return localWorkspace.policies;
      }
      return yield* policyOps.list.mapStorage(
        store.policies.listByWorkspaceId(workspaceId),
      );
    }));

export const createOrganizationPolicy = (input: {
  organizationId: OrganizationId;
  payload: CreatePolicyPayload;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.flatMap(
      loadOrganizationPolicyContext(store, policyOps.create, input.organizationId),
      (scope) => createScopedPolicy({ scope, payload: input.payload }),
    ));

export const createPolicy = (input: {
  workspaceId: WorkspaceId;
  payload: CreatePolicyPayload;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.flatMap(
      loadWorkspacePolicyContext(store, policyOps.create, input.workspaceId),
      (scope) => createScopedPolicy({ scope, payload: input.payload }),
    ));

export const getOrganizationPolicy = (input: {
  organizationId: OrganizationId;
  policyId: PolicyId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.flatMap(
      loadOrganizationPolicyContext(store, policyOps.get, input.organizationId),
      (scope) => getScopedPolicy({ scope, policyId: input.policyId }),
    ));

export const getPolicy = (input: {
  workspaceId: WorkspaceId;
  policyId: PolicyId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.flatMap(
      loadWorkspacePolicyContext(store, policyOps.get, input.workspaceId),
      (scope) => getScopedPolicy({ scope, policyId: input.policyId }),
    ));

export const updateOrganizationPolicy = (input: {
  organizationId: OrganizationId;
  policyId: PolicyId;
  payload: UpdatePolicyPayload;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.flatMap(
      loadOrganizationPolicyContext(store, policyOps.update, input.organizationId),
      (scope) => updateScopedPolicy({
        scope,
        policyId: input.policyId,
        payload: input.payload,
      }),
    ));

export const updatePolicy = (input: {
  workspaceId: WorkspaceId;
  policyId: PolicyId;
  payload: UpdatePolicyPayload;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.flatMap(
      loadWorkspacePolicyContext(store, policyOps.update, input.workspaceId),
      (scope) => updateScopedPolicy({
        scope,
        policyId: input.policyId,
        payload: input.payload,
      }),
    ));

export const removeOrganizationPolicy = (input: {
  organizationId: OrganizationId;
  policyId: PolicyId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.flatMap(
      loadOrganizationPolicyContext(store, policyOps.remove, input.organizationId),
      (scope) => removeScopedPolicy({ scope, policyId: input.policyId }),
    ));

export const removePolicy = (input: {
  workspaceId: WorkspaceId;
  policyId: PolicyId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.flatMap(
      loadWorkspacePolicyContext(store, policyOps.remove, input.workspaceId),
      (scope) => removeScopedPolicy({ scope, policyId: input.policyId }),
    ));
