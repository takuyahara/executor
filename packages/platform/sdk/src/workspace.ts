import type {
  AccountId,
  WorkspaceId,
} from "./schema";

export type ExecutorWorkspaceDescriptor = {
  workspaceName: string;
  workspaceRoot?: string | null;
  metadata?: Readonly<Record<string, unknown>>;
};

export type ExecutorWorkspaceContext = ExecutorWorkspaceDescriptor & {
  workspaceId: WorkspaceId;
  accountId: AccountId;
};
