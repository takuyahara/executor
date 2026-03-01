import { SourceStoreError } from "@executor-v2/persistence-ports";
import {
  type LocalStateSnapshot,
  type LocalStateStore,
  type LocalStateStoreError,
} from "@executor-v2/persistence-local";
import {
  makeControlPlanePoliciesService,
  type ControlPlanePoliciesServiceShape,
} from "@executor-v2/management-api";
import { type Policy } from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

const toSourceStoreError = (
  operation: string,
  message: string,
  details: string | null,
): SourceStoreError =>
  new SourceStoreError({
    operation,
    backend: "local-file",
    location: "snapshot.json",
    message,
    reason: null,
    details,
  });

const toSourceStoreErrorFromLocalState = (
  operation: string,
  error: LocalStateStoreError,
): SourceStoreError =>
  toSourceStoreError(operation, error.message, error.details ?? error.reason ?? null);

const sortPolicies = (policies: ReadonlyArray<Policy>): Array<Policy> =>
  [...policies].sort((left, right) => {
    const leftPattern = left.toolPathPattern.toLowerCase();
    const rightPattern = right.toolPathPattern.toLowerCase();
    if (leftPattern === rightPattern) {
      return right.updatedAt - left.updatedAt;
    }

    return leftPattern.localeCompare(rightPattern);
  });

const replacePolicyAt = (
  snapshot: LocalStateSnapshot,
  index: number,
  policy: Policy,
): LocalStateSnapshot => {
  const next = [...snapshot.policies];
  next[index] = policy;

  return {
    ...snapshot,
    generatedAt: Date.now(),
    policies: next,
  };
};

const appendPolicy = (
  snapshot: LocalStateSnapshot,
  policy: Policy,
): LocalStateSnapshot => ({
  ...snapshot,
  generatedAt: Date.now(),
  policies: [...snapshot.policies, policy],
});

const removePolicyForWorkspace = (
  snapshot: LocalStateSnapshot,
  workspaceId: Policy["workspaceId"],
  policyId: string,
): { snapshot: LocalStateSnapshot; removed: boolean } => {
  const removeIndex = snapshot.policies.findIndex(
    (policy) => policy.workspaceId === workspaceId && policy.id === policyId,
  );

  if (removeIndex < 0) {
    return {
      snapshot,
      removed: false,
    };
  }

  const next = [...snapshot.policies];
  next.splice(removeIndex, 1);

  return {
    removed: true,
    snapshot: {
      ...snapshot,
      generatedAt: Date.now(),
      policies: next,
    },
  };
};

export const createPmPoliciesService = (
  localStateStore: LocalStateStore,
): ControlPlanePoliciesServiceShape =>
  makeControlPlanePoliciesService({
    listPolicies: (workspaceId) =>
      Effect.gen(function* () {
        const snapshotOption = yield* localStateStore.getSnapshot().pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromLocalState("policies.list", error),
          ),
        );

        const snapshot = Option.getOrNull(snapshotOption);
        if (snapshot === null) {
          return [];
        }

        return sortPolicies(
          snapshot.policies.filter((policy) => policy.workspaceId === workspaceId),
        );
      }),

    upsertPolicy: (input) =>
      Effect.gen(function* () {
        const snapshotOption = yield* localStateStore.getSnapshot().pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromLocalState("policies.upsert", error),
          ),
        );

        const snapshot = Option.getOrNull(snapshotOption);
        if (snapshot === null) {
          return yield* toSourceStoreError(
            "policies.upsert",
            "Policy snapshot not found",
            `workspace=${input.workspaceId}`,
          );
        }

        const now = Date.now();
        const requestedId = input.payload.id;

        const existingIndex = requestedId
          ? snapshot.policies.findIndex(
              (policy) =>
                policy.workspaceId === input.workspaceId && policy.id === requestedId,
            )
          : -1;

        const existing = existingIndex >= 0 ? snapshot.policies[existingIndex] : null;

        const nextPolicy: Policy = {
          id: existing?.id ?? (requestedId ?? (`pol_${crypto.randomUUID()}` as Policy["id"])),
          workspaceId: input.workspaceId,
          toolPathPattern: input.payload.toolPathPattern,
          decision: input.payload.decision,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        const nextSnapshot = existingIndex >= 0
          ? replacePolicyAt(snapshot, existingIndex, nextPolicy)
          : appendPolicy(snapshot, nextPolicy);

        yield* localStateStore.writeSnapshot(nextSnapshot).pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromLocalState("policies.upsert_write", error),
          ),
        );

        return nextPolicy;
      }),

    removePolicy: (input) =>
      Effect.gen(function* () {
        const snapshotOption = yield* localStateStore.getSnapshot().pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromLocalState("policies.remove", error),
          ),
        );

        const snapshot = Option.getOrNull(snapshotOption);
        if (snapshot === null) {
          return {
            removed: false,
          };
        }

        const next = removePolicyForWorkspace(
          snapshot,
          input.workspaceId,
          input.policyId,
        );
        if (!next.removed) {
          return {
            removed: false,
          };
        }

        yield* localStateStore.writeSnapshot(next.snapshot).pipe(
          Effect.mapError((error) =>
            toSourceStoreErrorFromLocalState("policies.remove_write", error),
          ),
        );

        return {
          removed: true,
        };
      }),
  });
