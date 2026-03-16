import { FileSystem } from "@effect/platform";
import * as Effect from "effect/Effect";

import {
  type LoadedLocalExecutorConfig,
  type ResolvedLocalWorkspaceContext,
} from "./config";
import {
  loadLocalWorkspaceState,
  writeLocalWorkspaceState,
  type LocalWorkspaceState,
} from "./workspace-state";

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const derivePolicyConfigKey = (
  policy: {
    resourcePattern: string;
    effect: "allow" | "deny";
    approvalMode: "auto" | "required";
  },
  used: Set<string>,
): string => {
  const base =
    trimOrNull(policy.resourcePattern)
    ?? `${policy.effect}-${policy.approvalMode}`;
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
};

const pruneLocalWorkspaceState = (input: {
  context: ResolvedLocalWorkspaceContext;
  loadedConfig: LoadedLocalExecutorConfig;
}): Effect.Effect<LocalWorkspaceState, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const currentState = yield* loadLocalWorkspaceState(input.context);

    const configuredSourceIds = new Set(
      Object.keys(input.loadedConfig.config?.sources ?? {}),
    );
    const configuredPolicyKeys = new Set(
      Object.keys(input.loadedConfig.config?.policies ?? {}),
    );

    const nextState: LocalWorkspaceState = {
      ...currentState,
      sources: Object.fromEntries(
        Object.entries(currentState.sources).filter(([sourceId]) =>
          configuredSourceIds.has(sourceId)
        ),
      ),
      policies: Object.fromEntries(
        Object.entries(currentState.policies).filter(([policyKey]) =>
          configuredPolicyKeys.has(policyKey)
        ),
      ),
    };

    if (JSON.stringify(nextState) === JSON.stringify(currentState)) {
      return currentState;
    }

    yield* writeLocalWorkspaceState({
      context: input.context,
      state: nextState,
    });

    return nextState;
  });

export const synchronizeLocalWorkspaceState = (input: {
  context: ResolvedLocalWorkspaceContext;
  loadedConfig: LoadedLocalExecutorConfig;
}): Effect.Effect<LoadedLocalExecutorConfig["config"], Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    yield* pruneLocalWorkspaceState({
      context: input.context,
      loadedConfig: input.loadedConfig,
    });

    return input.loadedConfig.config;
  });
