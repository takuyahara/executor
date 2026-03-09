import type {
  CreatePolicyPayload,
  UpdatePolicyPayload,
} from "../api/policies/api";
import {
  PolicyIdSchema,
  type OrganizationId,
  type Policy,
  type PolicyId,
  type WorkspaceId,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

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

const createScopedPolicy = (input: {
  scope: PolicyScopeContext;
  payload: CreatePolicyPayload;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
      const now = Date.now();
      const operation = policyOps.create;

      const policy: Policy = {
        id: PolicyIdSchema.make(`pol_${crypto.randomUUID()}`),
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

      return policy;
    }));

const getScopedPolicy = (input: {
  scope: PolicyScopeContext;
  policyId: PolicyId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
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

      return updated.value;
    }));

const removeScopedPolicy = (input: {
  scope: PolicyScopeContext;
  policyId: PolicyId;
}) =>
  Effect.flatMap(ControlPlaneStore, (store) =>
    Effect.gen(function* () {
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
