import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { AccountId, WorkspaceId } from "#schema";
import type {
  LoadedLocalExecutorConfig,
  ResolvedLocalWorkspaceContext,
} from "./local-config";

export type RuntimeLocalWorkspaceState = {
  context: ResolvedLocalWorkspaceContext;
  installation: {
    workspaceId: WorkspaceId;
    accountId: AccountId;
  };
  loadedConfig: LoadedLocalExecutorConfig;
};

export class RuntimeLocalWorkspaceService extends Context.Tag(
  "#runtime/RuntimeLocalWorkspaceService",
)<RuntimeLocalWorkspaceService, RuntimeLocalWorkspaceState>() {}

export const getRuntimeLocalWorkspaceOption = () =>
  Effect.contextWith((context) =>
    Context.getOption(context, RuntimeLocalWorkspaceService),
  ).pipe(
    Effect.map((option) => (Option.isSome(option) ? option.value : null)),
  ) as Effect.Effect<RuntimeLocalWorkspaceState | null, never, never>;
