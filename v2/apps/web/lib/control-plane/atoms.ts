import { Atom, Result } from "@effect-atom/atom";
import type { ResolveApprovalPayload } from "@executor-v2/management-api/approvals/api";
import type {
  RemoveCredentialBindingResult,
  UpsertCredentialBindingPayload,
} from "@executor-v2/management-api/credentials/api";
import type {
  UpsertOrganizationPayload,
} from "@executor-v2/management-api/organizations/api";
import type {
  RemovePolicyResult,
  UpsertPolicyPayload,
} from "@executor-v2/management-api/policies/api";
import type {
  ListStorageDirectoryPayload,
  ListStorageDirectoryResult,
  ListStorageKvPayload,
  ListStorageKvResult,
  OpenStorageInstancePayload,
  QueryStorageSqlPayload,
  QueryStorageSqlResult,
  ReadStorageFilePayload,
  ReadStorageFileResult,
  RemoveStorageInstanceResult,
} from "@executor-v2/management-api/storage/api";
import type { UpsertSourcePayload } from "@executor-v2/management-api/sources/api";
import type { SourceToolSummary } from "@executor-v2/management-api/tools/api";
import type {
  UpsertWorkspacePayload,
} from "@executor-v2/management-api/workspaces/api";
import type {
  Approval,
  ApprovalId,
  CredentialBindingId,
  CredentialProvider,
  CredentialScopeType,
  Organization,
  Policy,
  PolicyDecision,
  PolicyId,
  Source,
  SourceCredentialBinding,
  SourceId,
  StorageDurability,
  StorageInstance,
  StorageScopeType,
  Workspace,
  WorkspaceId,
} from "@executor-v2/schema";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";

import { controlPlaneClient } from "./client";

type SourcesResult = Result.Result<ReadonlyArray<Source>, unknown>;

const emptySources: ReadonlyArray<Source> = [];

const sourceStoreKey = (source: Source): string => `${source.workspaceId}:${source.id}`;

const sortSources = (sources: ReadonlyArray<Source>): Array<Source> =>
  [...sources].sort((left, right) => {
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();

    if (leftName === rightName) {
      return sourceStoreKey(left).localeCompare(sourceStoreKey(right));
    }

    return leftName.localeCompare(rightName);
  });

export const sourcesResultByWorkspace = Atom.family(
  (workspaceId: WorkspaceId): Atom.Atom<SourcesResult> =>
    controlPlaneClient.query("sources", "list", {
      path: {
        workspaceId,
      },
    }) as Atom.Atom<SourcesResult>,
);

type OptimisticPendingAck =
  | {
      kind: "upsert";
      sourceId: SourceId;
    }
  | {
      kind: "remove";
      sourceId: SourceId;
    };

type OptimisticSources = {
  items: ReadonlyArray<Source>;
  pendingAck: OptimisticPendingAck;
};

export const optimisticSourcesByWorkspace = Atom.family((workspaceId: WorkspaceId) =>
  Atom.make<OptimisticSources | null>(null),
);

export const upsertSource = controlPlaneClient.mutation("sources", "upsert");
export const removeSource = controlPlaneClient.mutation("sources", "remove");

export type SourcesState =
  | {
      state: "loading";
      items: ReadonlyArray<Source>;
      message: null;
    }
  | {
      state: "error";
      items: ReadonlyArray<Source>;
      message: string;
    }
  | {
      state: "ready";
      items: ReadonlyArray<Source>;
      message: null;
    };

const sourceStateFromResult = (result: SourcesResult): SourcesState =>
  Result.match(result, {
    onInitial: () => ({
      state: "loading",
      items: emptySources,
      message: null,
    }),
    onFailure: (failure) => ({
      state: "error",
      items: Option.getOrElse(Result.value(result), () => emptySources),
      message: Cause.pretty(failure.cause),
    }),
    onSuccess: (success) => ({
      state: "ready",
      items: success.value,
      message: null,
    }),
  });

const isAcknowledged = (
  serverSources: ReadonlyArray<Source>,
  pendingAck: OptimisticPendingAck,
): boolean => {
  const hasSource = serverSources.some((source) => source.id === pendingAck.sourceId);
  return pendingAck.kind === "upsert" ? hasSource : !hasSource;
};

export const optimisticUpsertSources = (
  currentSources: ReadonlyArray<Source>,
  workspaceId: WorkspaceId,
  payload: UpsertSourcePayload,
): {
  sourceId: SourceId;
  items: ReadonlyArray<Source>;
} => {
  const sourceId = payload.id as SourceId;
  const existing = currentSources.find((source) => source.id === sourceId);
  const now = Date.now();

  const source: Source = {
    id: sourceId,
    workspaceId,
    name: payload.name,
    kind: payload.kind,
    endpoint: payload.endpoint,
    status: payload.status ?? "draft",
    enabled: payload.enabled ?? true,
    configJson: payload.configJson ?? "{}",
    sourceHash: payload.sourceHash ?? null,
    lastError: payload.lastError ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const nextSources = currentSources.filter((item) => item.id !== sourceId);
  return {
    sourceId,
    items: sortSources([...nextSources, source]),
  };
};

export const optimisticRemoveSources = (
  currentSources: ReadonlyArray<Source>,
  sourceId: SourceId,
): {
  sourceId: SourceId;
  items: ReadonlyArray<Source>;
} => ({
  sourceId,
  items: currentSources.filter((source) => source.id !== sourceId),
});

export const sourcesPendingByWorkspace = Atom.family((workspaceId: WorkspaceId) =>
  Atom.make((get): boolean => {
    const optimistic = get(optimisticSourcesByWorkspace(workspaceId));

    if (optimistic === null) {
      return false;
    }

    const serverResult = get(sourcesResultByWorkspace(workspaceId));

    return Result.match(serverResult, {
      onInitial: () => true,
      onFailure: () => true,
      onSuccess: (success) =>
        !isAcknowledged(success.value, optimistic.pendingAck),
    });
  }),
);

export const sourcesByWorkspace = Atom.family((workspaceId: WorkspaceId) =>
  Atom.make((get): SourcesState => {
    const serverResult = get(sourcesResultByWorkspace(workspaceId));
    const serverState = sourceStateFromResult(serverResult);
    const optimistic = get(optimisticSourcesByWorkspace(workspaceId));

    if (optimistic === null) {
      return serverState;
    }

    return Result.match(serverResult, {
      onInitial: () => ({
        state: "ready",
        items: optimistic.items,
        message: null,
      }),
      onFailure: () => ({
        state: "ready",
        items: optimistic.items,
        message: null,
      }),
      onSuccess: (success) =>
        isAcknowledged(success.value, optimistic.pendingAck)
          ? serverState
          : {
              state: "ready",
              items: optimistic.items,
              message: null,
            },
    });
  }),
);



type OrganizationsResult = Result.Result<ReadonlyArray<Organization>, unknown>;

export const organizationsResult =
  controlPlaneClient.query("organizations", "list", {}) as Atom.Atom<OrganizationsResult>;

export const upsertOrganization = controlPlaneClient.mutation(
  "organizations",
  "upsert",
);

export type OrganizationsState =
  | {
      state: "loading";
      items: ReadonlyArray<Organization>;
      message: null;
    }
  | {
      state: "error";
      items: ReadonlyArray<Organization>;
      message: string;
    }
  | {
      state: "ready";
      items: ReadonlyArray<Organization>;
      message: null;
    };

const sortOrganizations = (
  organizations: ReadonlyArray<Organization>,
): Array<Organization> =>
  [...organizations].sort((left, right) => {
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();

    if (leftName === rightName) {
      return left.id.localeCompare(right.id);
    }

    return leftName.localeCompare(rightName);
  });

const organizationsStateFromResult = (
  result: OrganizationsResult,
): OrganizationsState =>
  Result.match(result, {
    onInitial: () => ({
      state: "loading",
      items: [],
      message: null,
    }),
    onFailure: (failure) => ({
      state: "error",
      items: Option.getOrElse(Result.value(result), () => []),
      message: Cause.pretty(failure.cause),
    }),
    onSuccess: (success) => ({
      state: "ready",
      items: sortOrganizations(success.value),
      message: null,
    }),
  });

export const organizationsState = Atom.make((get): OrganizationsState =>
  organizationsStateFromResult(get(organizationsResult))
);

export const toOrganizationUpsertPayload = (input: {
  id?: Organization["id"];
  slug: string;
  name: string;
  status?: Organization["status"];
}): UpsertOrganizationPayload => ({
  ...(input.id ? { id: input.id } : {}),
  slug: input.slug,
  name: input.name,
  ...(input.status !== undefined ? { status: input.status } : {}),
});

type WorkspacesResult = Result.Result<ReadonlyArray<Workspace>, unknown>;

export const workspacesResult =
  controlPlaneClient.query("workspaces", "list", {}) as Atom.Atom<WorkspacesResult>;

export const upsertWorkspace = controlPlaneClient.mutation("workspaces", "upsert");

export type WorkspacesState =
  | {
      state: "loading";
      items: ReadonlyArray<Workspace>;
      message: null;
    }
  | {
      state: "error";
      items: ReadonlyArray<Workspace>;
      message: string;
    }
  | {
      state: "ready";
      items: ReadonlyArray<Workspace>;
      message: null;
    };

const sortWorkspaces = (workspaces: ReadonlyArray<Workspace>): Array<Workspace> =>
  [...workspaces].sort((left, right) => {
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();

    if (leftName === rightName) {
      return left.id.localeCompare(right.id);
    }

    return leftName.localeCompare(rightName);
  });

const workspacesStateFromResult = (result: WorkspacesResult): WorkspacesState =>
  Result.match(result, {
    onInitial: () => ({
      state: "loading",
      items: [],
      message: null,
    }),
    onFailure: (failure) => ({
      state: "error",
      items: Option.getOrElse(Result.value(result), () => []),
      message: Cause.pretty(failure.cause),
    }),
    onSuccess: (success) => ({
      state: "ready",
      items: sortWorkspaces(success.value),
      message: null,
    }),
  });

export const workspacesState = Atom.make((get): WorkspacesState =>
  workspacesStateFromResult(get(workspacesResult))
);

export const toWorkspaceUpsertPayload = (input: {
  id?: Workspace["id"];
  organizationId?: Workspace["organizationId"];
  name: string;
}): UpsertWorkspacePayload => ({
  ...(input.id ? { id: input.id } : {}),
  ...(input.organizationId !== undefined
    ? {
        organizationId: input.organizationId,
      }
    : {}),
  name: input.name,
});

type SourceToolsResult = Result.Result<ReadonlyArray<SourceToolSummary>, unknown>;

export const workspaceToolsResultByWorkspace = Atom.family(
  (workspaceId: WorkspaceId): Atom.Atom<SourceToolsResult> =>
    controlPlaneClient.query("tools", "listWorkspaceTools", {
      path: {
        workspaceId,
      },
    }) as Atom.Atom<SourceToolsResult>,
);

export const sourceToolsResultBySource = Atom.family(
  (input: {
    workspaceId: WorkspaceId;
    sourceId: SourceId;
  }): Atom.Atom<SourceToolsResult> =>
    controlPlaneClient.query("tools", "listSourceTools", {
      path: {
        workspaceId: input.workspaceId,
        sourceId: input.sourceId,
      },
    }) as Atom.Atom<SourceToolsResult>,
);

export type SourceToolsState =
  | {
      state: "loading";
      items: ReadonlyArray<SourceToolSummary>;
      message: null;
    }
  | {
      state: "error";
      items: ReadonlyArray<SourceToolSummary>;
      message: string;
    }
  | {
      state: "ready";
      items: ReadonlyArray<SourceToolSummary>;
      message: null;
    };

const sortSourceTools = (
  tools: ReadonlyArray<SourceToolSummary>,
): Array<SourceToolSummary> =>
  [...tools].sort((left, right) => {
    const leftSource = left.sourceName.toLowerCase();
    const rightSource = right.sourceName.toLowerCase();

    if (leftSource !== rightSource) {
      return leftSource.localeCompare(rightSource);
    }

    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();

    if (leftName !== rightName) {
      return leftName.localeCompare(rightName);
    }

    return left.toolId.localeCompare(right.toolId);
  });

const sourceToolsStateFromResult = (result: SourceToolsResult): SourceToolsState =>
  Result.match(result, {
    onInitial: () => ({
      state: "loading",
      items: [],
      message: null,
    }),
    onFailure: (failure) => ({
      state: "error",
      items: Option.getOrElse(Result.value(result), () => []),
      message: Cause.pretty(failure.cause),
    }),
    onSuccess: (success) => ({
      state: "ready",
      items: sortSourceTools(success.value),
      message: null,
    }),
  });

export const workspaceToolsByWorkspace = Atom.family((workspaceId: WorkspaceId) =>
  Atom.make((get): SourceToolsState =>
    sourceToolsStateFromResult(get(workspaceToolsResultByWorkspace(workspaceId)))
  )
);

type ApprovalsResult = Result.Result<ReadonlyArray<Approval>, unknown>;

export const approvalsResultByWorkspace = Atom.family(
  (workspaceId: WorkspaceId): Atom.Atom<ApprovalsResult> =>
    controlPlaneClient.query("approvals", "list", {
      path: {
        workspaceId,
      },
    }) as Atom.Atom<ApprovalsResult>,
);

export const resolveApproval = controlPlaneClient.mutation("approvals", "resolve");

export type ApprovalsState =
  | {
      state: "loading";
      items: ReadonlyArray<Approval>;
      message: null;
    }
  | {
      state: "error";
      items: ReadonlyArray<Approval>;
      message: string;
    }
  | {
      state: "ready";
      items: ReadonlyArray<Approval>;
      message: null;
    };

const approvalStoreKey = (approval: Approval): string =>
  `${approval.workspaceId}:${approval.id}`;

const sortApprovals = (approvals: ReadonlyArray<Approval>): Array<Approval> =>
  [...approvals].sort((left, right) => {
    if (left.status !== right.status) {
      if (left.status === "pending") return -1;
      if (right.status === "pending") return 1;
    }

    if (left.requestedAt !== right.requestedAt) {
      return right.requestedAt - left.requestedAt;
    }

    return approvalStoreKey(left).localeCompare(approvalStoreKey(right));
  });

const approvalsStateFromResult = (result: ApprovalsResult): ApprovalsState =>
  Result.match(result, {
    onInitial: () => ({
      state: "loading",
      items: [],
      message: null,
    }),
    onFailure: (failure) => ({
      state: "error",
      items: Option.getOrElse(Result.value(result), () => []),
      message: Cause.pretty(failure.cause),
    }),
    onSuccess: (success) => ({
      state: "ready",
      items: sortApprovals(success.value),
      message: null,
    }),
  });

export const approvalsByWorkspace = Atom.family((workspaceId: WorkspaceId) =>
  Atom.make((get): ApprovalsState => {
    const result = get(approvalsResultByWorkspace(workspaceId));
    return approvalsStateFromResult(result);
  }),
);

export const approvalPendingByWorkspace = Atom.family((workspaceId: WorkspaceId) =>
  Atom.make((get): boolean => {
    const state = get(approvalsByWorkspace(workspaceId));
    return state.state === "loading";
  }),
);

export const optimisticResolveApproval = (
  currentApprovals: ReadonlyArray<Approval>,
  input: {
    approvalId: ApprovalId;
    payload: ResolveApprovalPayload;
  },
): ReadonlyArray<Approval> =>
  sortApprovals(
    currentApprovals.map((approval) => {
      if (approval.id !== input.approvalId) {
        return approval;
      }

      return {
        ...approval,
        status: input.payload.status,
        reason:
          input.payload.reason === undefined
            ? approval.reason
            : input.payload.reason,
        resolvedAt: Date.now(),
      };
    }),
  );



type PoliciesResult = Result.Result<ReadonlyArray<Policy>, unknown>;

export const policiesResultByWorkspace = Atom.family(
  (workspaceId: WorkspaceId): Atom.Atom<PoliciesResult> =>
    controlPlaneClient.query("policies", "list", {
      path: {
        workspaceId,
      },
    }) as Atom.Atom<PoliciesResult>,
);

export const upsertPolicy = controlPlaneClient.mutation("policies", "upsert");
export const removePolicy = controlPlaneClient.mutation("policies", "remove");

export type PoliciesState =
  | {
      state: "loading";
      items: ReadonlyArray<Policy>;
      message: null;
    }
  | {
      state: "error";
      items: ReadonlyArray<Policy>;
      message: string;
    }
  | {
      state: "ready";
      items: ReadonlyArray<Policy>;
      message: null;
    };

const policyStoreKey = (policy: Policy): string => `${policy.workspaceId}:${policy.id}`;

const sortPolicies = (policies: ReadonlyArray<Policy>): Array<Policy> =>
  [...policies].sort((left, right) => {
    const leftPattern = left.toolPathPattern.toLowerCase();
    const rightPattern = right.toolPathPattern.toLowerCase();

    if (leftPattern === rightPattern) {
      return policyStoreKey(left).localeCompare(policyStoreKey(right));
    }

    return leftPattern.localeCompare(rightPattern);
  });

const policiesStateFromResult = (result: PoliciesResult): PoliciesState =>
  Result.match(result, {
    onInitial: () => ({
      state: "loading",
      items: [],
      message: null,
    }),
    onFailure: (failure) => ({
      state: "error",
      items: Option.getOrElse(Result.value(result), () => []),
      message: Cause.pretty(failure.cause),
    }),
    onSuccess: (success) => ({
      state: "ready",
      items: sortPolicies(success.value),
      message: null,
    }),
  });

export const policiesByWorkspace = Atom.family((workspaceId: WorkspaceId) =>
  Atom.make((get): PoliciesState => {
    const result = get(policiesResultByWorkspace(workspaceId));
    return policiesStateFromResult(result);
  }),
);

export const optimisticUpsertPolicy = (
  currentPolicies: ReadonlyArray<Policy>,
  input: {
    workspaceId: WorkspaceId;
    policyId: PolicyId;
    toolPathPattern: string;
    decision: PolicyDecision;
  },
): ReadonlyArray<Policy> => {
  const now = Date.now();
  const existing = currentPolicies.find((policy) => policy.id === input.policyId);

  const nextPolicy: Policy = {
    id: input.policyId,
    workspaceId: input.workspaceId,
    toolPathPattern: input.toolPathPattern,
    decision: input.decision,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const rest = currentPolicies.filter((policy) => policy.id !== input.policyId);
  return sortPolicies([...rest, nextPolicy]);
};

export const optimisticRemovePolicy = (
  currentPolicies: ReadonlyArray<Policy>,
  policyId: PolicyId,
): ReadonlyArray<Policy> => currentPolicies.filter((policy) => policy.id !== policyId);

export const toPolicyUpsertPayload = (input: {
  id?: PolicyId;
  toolPathPattern: string;
  decision: PolicyDecision;
}): UpsertPolicyPayload => ({
  ...(input.id ? { id: input.id } : {}),
  toolPathPattern: input.toolPathPattern,
  decision: input.decision,
});

export const toPolicyRemoveResult = (result: RemovePolicyResult): boolean =>
  result.removed;



type CredentialBindingsResult = Result.Result<
  ReadonlyArray<SourceCredentialBinding>,
  unknown
>;

export const credentialBindingsResultByWorkspace = Atom.family(
  (workspaceId: WorkspaceId): Atom.Atom<CredentialBindingsResult> =>
    controlPlaneClient.query("credentials", "list", {
      path: {
        workspaceId,
      },
    }) as Atom.Atom<CredentialBindingsResult>,
);

export const upsertCredentialBinding = controlPlaneClient.mutation(
  "credentials",
  "upsert",
);
export const removeCredentialBinding = controlPlaneClient.mutation(
  "credentials",
  "remove",
);

export type CredentialBindingsState =
  | {
      state: "loading";
      items: ReadonlyArray<SourceCredentialBinding>;
      message: null;
    }
  | {
      state: "error";
      items: ReadonlyArray<SourceCredentialBinding>;
      message: string;
    }
  | {
      state: "ready";
      items: ReadonlyArray<SourceCredentialBinding>;
      message: null;
    };

const credentialBindingStoreKey = (binding: SourceCredentialBinding): string =>
  `${binding.workspaceId}:${binding.id}`;

const sortCredentialBindings = (
  bindings: ReadonlyArray<SourceCredentialBinding>,
): Array<SourceCredentialBinding> =>
  [...bindings].sort((left, right) => {
    const leftKey = `${left.sourceKey}:${left.provider}`.toLowerCase();
    const rightKey = `${right.sourceKey}:${right.provider}`.toLowerCase();

    if (leftKey === rightKey) {
      return credentialBindingStoreKey(left).localeCompare(
        credentialBindingStoreKey(right),
      );
    }

    return leftKey.localeCompare(rightKey);
  });

const credentialBindingsStateFromResult = (
  result: CredentialBindingsResult,
): CredentialBindingsState =>
  Result.match(result, {
    onInitial: () => ({
      state: "loading",
      items: [],
      message: null,
    }),
    onFailure: (failure) => ({
      state: "error",
      items: Option.getOrElse(Result.value(result), () => []),
      message: Cause.pretty(failure.cause),
    }),
    onSuccess: (success) => ({
      state: "ready",
      items: sortCredentialBindings(success.value),
      message: null,
    }),
  });

export const credentialBindingsByWorkspace = Atom.family(
  (workspaceId: WorkspaceId) =>
    Atom.make((get): CredentialBindingsState => {
      const result = get(credentialBindingsResultByWorkspace(workspaceId));
      return credentialBindingsStateFromResult(result);
    }),
);

export const toCredentialBindingUpsertPayload = (input: {
  id?: CredentialBindingId;
  credentialId: SourceCredentialBinding["credentialId"];
  scopeType: CredentialScopeType;
  sourceKey: string;
  provider: CredentialProvider;
  secretRef: string;
  accountId?: SourceCredentialBinding["accountId"];
  additionalHeadersJson?: SourceCredentialBinding["additionalHeadersJson"];
  boundAuthFingerprint?: SourceCredentialBinding["boundAuthFingerprint"];
}): UpsertCredentialBindingPayload => ({
  ...(input.id ? { id: input.id } : {}),
  credentialId: input.credentialId,
  scopeType: input.scopeType,
  sourceKey: input.sourceKey,
  provider: input.provider,
  secretRef: input.secretRef,
  ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
  ...(input.additionalHeadersJson !== undefined
    ? { additionalHeadersJson: input.additionalHeadersJson }
    : {}),
  ...(input.boundAuthFingerprint !== undefined
    ? { boundAuthFingerprint: input.boundAuthFingerprint }
    : {}),
});

export const toCredentialBindingRemoveResult = (
  result: RemoveCredentialBindingResult,
): boolean => result.removed;


type StorageInstancesResult = Result.Result<ReadonlyArray<StorageInstance>, unknown>;

export const storageResultByWorkspace = Atom.family(
  (workspaceId: WorkspaceId): Atom.Atom<StorageInstancesResult> =>
    controlPlaneClient.query("storage", "list", {
      path: {
        workspaceId,
      },
    }) as Atom.Atom<StorageInstancesResult>,
);

export const openStorageInstance = controlPlaneClient.mutation("storage", "open");
export const closeStorageInstance = controlPlaneClient.mutation("storage", "close");
export const removeStorageInstance = controlPlaneClient.mutation("storage", "remove");

export type StorageInstancesState =
  | {
      state: "loading";
      items: ReadonlyArray<StorageInstance>;
      message: null;
    }
  | {
      state: "error";
      items: ReadonlyArray<StorageInstance>;
      message: string;
    }
  | {
      state: "ready";
      items: ReadonlyArray<StorageInstance>;
      message: null;
    };

const sortStorageInstances = (
  storageInstances: ReadonlyArray<StorageInstance>,
): Array<StorageInstance> =>
  [...storageInstances].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }

    return left.id.localeCompare(right.id);
  });

const storageStateFromResult = (
  result: StorageInstancesResult,
): StorageInstancesState =>
  Result.match(result, {
    onInitial: () => ({
      state: "loading",
      items: [],
      message: null,
    }),
    onFailure: (failure) => ({
      state: "error",
      items: Option.getOrElse(Result.value(result), () => []),
      message: Cause.pretty(failure.cause),
    }),
    onSuccess: (success) => ({
      state: "ready",
      items: sortStorageInstances(success.value),
      message: null,
    }),
  });

export const storageByWorkspace = Atom.family((workspaceId: WorkspaceId) =>
  Atom.make((get): StorageInstancesState => {
    const result = get(storageResultByWorkspace(workspaceId));
    return storageStateFromResult(result);
  }),
);

export const toOpenStoragePayload = (input: {
  scopeType: StorageScopeType;
  durability: StorageDurability;
  provider?: StorageInstance["provider"];
  purpose?: string;
  ttlHours?: number;
  accountId?: Exclude<StorageInstance["accountId"], null>;
  sessionId?: string;
}): OpenStorageInstancePayload => ({
  scopeType: input.scopeType,
  durability: input.durability,
  ...(input.provider !== undefined ? { provider: input.provider } : {}),
  ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
  ...(input.ttlHours !== undefined ? { ttlHours: input.ttlHours } : {}),
  ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
  ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
});

export const toStorageRemoveResult = (
  result: RemoveStorageInstanceResult,
): boolean => result.removed;

export const listStorageDirectory = controlPlaneClient.mutation(
  "storage",
  "listDirectory",
);
export const readStorageFile = controlPlaneClient.mutation("storage", "readFile");
export const listStorageKv = controlPlaneClient.mutation("storage", "listKv");
export const queryStorageSql = controlPlaneClient.mutation("storage", "querySql");

export const toListStorageDirectoryPayload = (input: {
  path: string;
}): ListStorageDirectoryPayload => ({
  path: input.path,
});

export const toReadStorageFilePayload = (input: {
  path: string;
  encoding?: "utf8" | "base64";
}): ReadStorageFilePayload => ({
  path: input.path,
  ...(input.encoding !== undefined ? { encoding: input.encoding } : {}),
});

export const toListStorageKvPayload = (input: {
  prefix?: string;
  limit?: number;
}): ListStorageKvPayload => ({
  ...(input.prefix !== undefined ? { prefix: input.prefix } : {}),
  ...(input.limit !== undefined ? { limit: input.limit } : {}),
});

export const toQueryStorageSqlPayload = (input: {
  sql: string;
  maxRows?: number;
}): QueryStorageSqlPayload => ({
  sql: input.sql,
  ...(input.maxRows !== undefined ? { maxRows: input.maxRows } : {}),
});

export const toStorageDirectoryResult = (
  result: ListStorageDirectoryResult,
): ListStorageDirectoryResult => result;

export const toStorageReadFileResult = (
  result: ReadStorageFileResult,
): ReadStorageFileResult => result;

export const toStorageKvResult = (
  result: ListStorageKvResult,
): ListStorageKvResult => result;

export const toStorageSqlResult = (
  result: QueryStorageSqlResult,
): QueryStorageSqlResult => result;

