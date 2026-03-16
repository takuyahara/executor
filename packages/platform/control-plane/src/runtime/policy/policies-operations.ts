import { createHash } from "node:crypto";

import type {
  CreatePolicyPayload,
  UpdatePolicyPayload,
} from "../../api/policies/api";
import {
  PolicyIdSchema,
  type LocalExecutorConfig,
  type LocalWorkspacePolicy,
  type PolicyId,
  type WorkspaceId,
} from "#schema";
import * as Effect from "effect/Effect";

import {
  requireRuntimeLocalWorkspace,
} from "../local/runtime-context";
import type {
  WorkspaceStorageServices,
  WorkspaceConfigStoreShape,
  WorkspaceStateStoreShape,
} from "../local/storage";
import {
  WorkspaceConfigStore,
  WorkspaceStateStore,
} from "../local/storage";
import type { ResolvedLocalWorkspaceContext } from "../local/config";
import {
  type LocalWorkspaceState,
} from "../local/workspace-state";
import {
  derivePolicyConfigKey,
} from "../local/workspace-sync";
import {
  type OperationErrors,
  operationErrors,
} from "./operation-errors";

const policyOps = {
  list: operationErrors("policies.list"),
  create: operationErrors("policies.create"),
  get: operationErrors("policies.get"),
  update: operationErrors("policies.update"),
  remove: operationErrors("policies.remove"),
} as const;

const cloneJson = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const localPolicyIdForKey = (input: {
  workspaceRoot: string;
  key: string;
}): PolicyId =>
  PolicyIdSchema.make(
    `pol_local_${createHash("sha256").update(`${input.workspaceRoot}:${input.key}`).digest("hex").slice(0, 16)}`,
  );

const toLocalWorkspacePolicy = (input: {
  workspaceId: WorkspaceId;
  workspaceRoot: string;
  key: string;
  policyConfig: NonNullable<LocalExecutorConfig["policies"]>[string];
  state: LocalWorkspaceState["policies"][string] | undefined;
}): LocalWorkspacePolicy => ({
  id: input.state?.id ?? localPolicyIdForKey({
    workspaceRoot: input.workspaceRoot,
    key: input.key,
  }),
  key: input.key,
  workspaceId: input.workspaceId,
  resourcePattern: input.policyConfig.match.trim(),
  effect: input.policyConfig.action,
  approvalMode: input.policyConfig.approval === "manual" ? "required" : "auto",
  priority: input.policyConfig.priority ?? 0,
  enabled: input.policyConfig.enabled ?? true,
  createdAt: input.state?.createdAt ?? Date.now(),
  updatedAt: input.state?.updatedAt ?? Date.now(),
});

export const loadRuntimeLocalWorkspacePolicies = (workspaceId: WorkspaceId) =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* requireRuntimeLocalWorkspace(workspaceId);
    const workspaceConfigStore = yield* WorkspaceConfigStore;
    const workspaceStateStore = yield* WorkspaceStateStore;
    const loadedConfig = yield* workspaceConfigStore.load(
      runtimeLocalWorkspace.context,
    );
    const workspaceState = yield* workspaceStateStore.load(
      runtimeLocalWorkspace.context,
    );

    const policies = Object.entries(loadedConfig.config?.policies ?? {}).map(([key, policyConfig]) =>
      toLocalWorkspacePolicy({
        workspaceId,
        workspaceRoot: runtimeLocalWorkspace.context.workspaceRoot,
        key,
        policyConfig,
        state: workspaceState.policies[key],
      }));

    return {
      runtimeLocalWorkspace,
      loadedConfig,
      workspaceState,
      policies,
    };
  });

const writeLocalPolicyFiles = (input: {
  operation: OperationErrors;
  context: ResolvedLocalWorkspaceContext;
  workspaceConfigStore: WorkspaceConfigStoreShape;
  workspaceStateStore: WorkspaceStateStoreShape;
  projectConfig: LocalExecutorConfig;
  workspaceState: LocalWorkspaceState;
}) =>
  Effect.all([
    input.workspaceConfigStore.writeProject({
      context: input.context,
      config: input.projectConfig,
    }),
    input.workspaceStateStore.write({
      context: input.context,
      state: input.workspaceState,
    }),
  ], { discard: true }).pipe(
    Effect.mapError((cause) =>
      input.operation.unknownStorage(
        cause,
        "Failed writing local workspace policy files",
      ),
    ),
  );

const loadWorkspacePolicyContext = (
  operation: OperationErrors,
  workspaceId: WorkspaceId,
) =>
  requireRuntimeLocalWorkspace(workspaceId).pipe(
    Effect.mapError((cause) =>
      operation.notFound(
        "Workspace not found",
        cause instanceof Error ? cause.message : String(cause),
      ),
    ),
  );

export const listPolicies = (workspaceId: WorkspaceId) =>
  Effect.gen(function* () {
    yield* loadWorkspacePolicyContext(policyOps.list, workspaceId);
    const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies(workspaceId).pipe(
      Effect.mapError((cause) =>
        policyOps.list.unknownStorage(
          cause,
          "Failed loading local workspace policies",
        ),
      ),
    );
    return localWorkspace.policies;
  });

export const createPolicy = (input: {
  workspaceId: WorkspaceId;
  payload: CreatePolicyPayload;
}) =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* loadWorkspacePolicyContext(policyOps.create, input.workspaceId);
    const workspaceConfigStore = yield* WorkspaceConfigStore;
    const workspaceStateStore = yield* WorkspaceStateStore;
    const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies(input.workspaceId).pipe(
      Effect.mapError((cause) =>
        policyOps.create.unknownStorage(
          cause,
          "Failed loading local workspace policies",
        ),
      ),
    );
    const now = Date.now();
    const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
    const policies = { ...(projectConfig.policies ?? {}) };
    const key = derivePolicyConfigKey(
      {
        resourcePattern: input.payload.resourcePattern ?? "*",
        effect: input.payload.effect ?? "allow",
        approvalMode: input.payload.approvalMode ?? "auto",
      },
      new Set(Object.keys(policies)),
    );

    policies[key] = {
      match: input.payload.resourcePattern ?? "*",
      action: input.payload.effect ?? "allow",
      approval: (input.payload.approvalMode ?? "auto") === "required" ? "manual" : "auto",
      ...(input.payload.enabled === false ? { enabled: false } : {}),
      ...((input.payload.priority ?? 0) !== 0 ? { priority: input.payload.priority ?? 0 } : {}),
    };

    const existingState = localWorkspace.workspaceState.policies[key];
    const workspaceState: LocalWorkspaceState = {
      ...localWorkspace.workspaceState,
      policies: {
        ...localWorkspace.workspaceState.policies,
        [key]: {
          id: existingState?.id ?? localPolicyIdForKey({
            workspaceRoot: runtimeLocalWorkspace.context.workspaceRoot,
            key,
          }),
          createdAt: existingState?.createdAt ?? now,
          updatedAt: now,
        },
      },
    };

    yield* writeLocalPolicyFiles({
      operation: policyOps.create,
      context: runtimeLocalWorkspace.context,
      workspaceConfigStore,
      workspaceStateStore,
      projectConfig: {
        ...projectConfig,
        policies,
      },
      workspaceState,
    });

    return toLocalWorkspacePolicy({
      workspaceId: input.workspaceId,
      workspaceRoot: runtimeLocalWorkspace.context.workspaceRoot,
      key,
      policyConfig: policies[key]!,
      state: workspaceState.policies[key],
    });
  });

export const getPolicy = (input: {
  workspaceId: WorkspaceId;
  policyId: PolicyId;
}) =>
  Effect.gen(function* () {
    yield* loadWorkspacePolicyContext(policyOps.get, input.workspaceId);
    const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies(input.workspaceId).pipe(
      Effect.mapError((cause) =>
        policyOps.get.unknownStorage(
          cause,
          "Failed loading local workspace policies",
        ),
      ),
    );
    const policy = localWorkspace.policies.find((candidate) => candidate.id === input.policyId) ?? null;
    if (policy === null) {
      return yield* Effect.fail(
        policyOps.get.notFound(
          "Policy not found",
          `workspaceId=${input.workspaceId} policyId=${input.policyId}`,
        ),
      );
    }
    return policy;
  });

export const updatePolicy = (input: {
  workspaceId: WorkspaceId;
  policyId: PolicyId;
  payload: UpdatePolicyPayload;
}) =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* loadWorkspacePolicyContext(policyOps.update, input.workspaceId);
    const workspaceConfigStore = yield* WorkspaceConfigStore;
    const workspaceStateStore = yield* WorkspaceStateStore;
    const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies(input.workspaceId).pipe(
      Effect.mapError((cause) =>
        policyOps.update.unknownStorage(
          cause,
          "Failed loading local workspace policies",
        ),
      ),
    );
    const existing = localWorkspace.policies.find((candidate) => candidate.id === input.policyId) ?? null;
    if (existing === null) {
      return yield* Effect.fail(
        policyOps.update.notFound(
          "Policy not found",
          `workspaceId=${input.workspaceId} policyId=${input.policyId}`,
        ),
      );
    }

    const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
    const policies = { ...(projectConfig.policies ?? {}) };
    const existingConfig = policies[existing.key]!;

    policies[existing.key] = {
      ...existingConfig,
      ...(input.payload.resourcePattern !== undefined ? { match: input.payload.resourcePattern } : {}),
      ...(input.payload.effect !== undefined ? { action: input.payload.effect } : {}),
      ...(input.payload.approvalMode !== undefined
        ? { approval: input.payload.approvalMode === "required" ? "manual" : "auto" }
        : {}),
      ...(input.payload.enabled !== undefined ? { enabled: input.payload.enabled } : {}),
      ...(input.payload.priority !== undefined ? { priority: input.payload.priority } : {}),
    };

    const updatedAt = Date.now();
    const existingState = localWorkspace.workspaceState.policies[existing.key];
    const workspaceState: LocalWorkspaceState = {
      ...localWorkspace.workspaceState,
      policies: {
        ...localWorkspace.workspaceState.policies,
        [existing.key]: {
          id: existing.id,
          createdAt: existingState?.createdAt ?? existing.createdAt,
          updatedAt,
        },
      },
    };

    yield* writeLocalPolicyFiles({
      operation: policyOps.update,
      context: runtimeLocalWorkspace.context,
      workspaceConfigStore,
      workspaceStateStore,
      projectConfig: {
        ...projectConfig,
        policies,
      },
      workspaceState,
    });

    return toLocalWorkspacePolicy({
      workspaceId: input.workspaceId,
      workspaceRoot: runtimeLocalWorkspace.context.workspaceRoot,
      key: existing.key,
      policyConfig: policies[existing.key]!,
      state: workspaceState.policies[existing.key],
    });
  });

export const removePolicy = (input: {
  workspaceId: WorkspaceId;
  policyId: PolicyId;
}) =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* loadWorkspacePolicyContext(policyOps.remove, input.workspaceId);
    const workspaceConfigStore = yield* WorkspaceConfigStore;
    const workspaceStateStore = yield* WorkspaceStateStore;
    const localWorkspace = yield* loadRuntimeLocalWorkspacePolicies(input.workspaceId).pipe(
      Effect.mapError((cause) =>
        policyOps.remove.unknownStorage(
          cause,
          "Failed loading local workspace policies",
        ),
      ),
    );
    const existing = localWorkspace.policies.find((candidate) => candidate.id === input.policyId) ?? null;
    if (existing === null) {
      return { removed: false };
    }

    const projectConfig = cloneJson(localWorkspace.loadedConfig.projectConfig ?? {});
    const policies = { ...(projectConfig.policies ?? {}) };
    delete policies[existing.key];

    const { [existing.key]: _removedPolicy, ...remainingPolicies } = localWorkspace.workspaceState.policies;
    yield* writeLocalPolicyFiles({
      operation: policyOps.remove,
      context: runtimeLocalWorkspace.context,
      workspaceConfigStore,
      workspaceStateStore,
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
  });
