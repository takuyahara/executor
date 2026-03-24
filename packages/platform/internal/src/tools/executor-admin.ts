import type { ToolMap } from "@executor/codemode-core";
import type { Executor } from "@executor/platform-sdk";
import { type ScopeInternalToolContext as WorkspaceInternalToolContext } from "@executor/platform-sdk/runtime";

export const createWorkspaceExecutorAdminToolMap = (
  _input: WorkspaceInternalToolContext,
): ToolMap => ({});

export const createExecutorAdminToolMap = (_input: {
  executor: Executor;
}): ToolMap => ({});
