import { Atom } from "@effect-atom/atom";
import type { ResolveApprovalPayload } from "@executor-v2/management-api/approvals/api";
import type { Approval, ApprovalId, WorkspaceId } from "@executor-v2/schema";

import { controlPlaneClient } from "../client";
import { workspaceEntity, type EntityState } from "./entity";
import { approvalsKeys } from "./keys";

// ---------------------------------------------------------------------------
// Query atoms
// ---------------------------------------------------------------------------

export const approvalsResultByWorkspace = Atom.family(
  (workspaceId: WorkspaceId) =>
    controlPlaneClient.query("approvals", "list", {
      path: { workspaceId },
      reactivityKeys: approvalsKeys,
    }),
);

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

const sortApprovals = (a: Approval, b: Approval): number => {
  if (a.status !== b.status) {
    if (a.status === "pending") return -1;
    if (b.status === "pending") return 1;
  }
  if (a.requestedAt !== b.requestedAt) return b.requestedAt - a.requestedAt;
  return `${a.workspaceId}:${a.id}`.localeCompare(`${b.workspaceId}:${b.id}`);
};

export const approvalsByWorkspace = workspaceEntity(
  approvalsResultByWorkspace,
  sortApprovals,
);

export const approvalPendingByWorkspace = Atom.family((workspaceId: WorkspaceId) =>
  Atom.make((get): boolean => {
    const state = get(approvalsByWorkspace(workspaceId));
    return state.state === "loading";
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const resolveApproval = controlPlaneClient.mutation("approvals", "resolve");

// ---------------------------------------------------------------------------
// Optimistic helpers
// ---------------------------------------------------------------------------

export const optimisticResolveApproval = (
  currentApprovals: ReadonlyArray<Approval>,
  input: { approvalId: ApprovalId; payload: ResolveApprovalPayload },
): ReadonlyArray<Approval> =>
  [...currentApprovals.map((approval) => {
    if (approval.id !== input.approvalId) return approval;
    return {
      ...approval,
      status: input.payload.status,
      reason: input.payload.reason === undefined ? approval.reason : input.payload.reason,
      resolvedAt: Date.now(),
    };
  })].sort(sortApprovals);

export type ApprovalsState = EntityState<Approval>;
