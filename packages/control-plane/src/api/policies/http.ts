import { HttpApiBuilder } from "@effect/platform";
import type { OrganizationId, WorkspaceId } from "#schema";

import { requirePermission, withPolicy } from "#domain";
import {
  createOrganizationPolicy,
  createPolicy,
  getOrganizationPolicy,
  getPolicy,
  listOrganizationPolicies,
  listPolicies,
  removeOrganizationPolicy,
  removePolicy,
  updateOrganizationPolicy,
  updatePolicy,
} from "../../runtime/policies-operations";

import { ControlPlaneApi } from "../api";
import { withRequestActor, withWorkspaceRequestActor } from "../http-auth";

const requireReadOrganizationPolicies = (organizationId: OrganizationId) =>
  requirePermission({
    permission: "policies:read",
    organizationId,
  });

const requireWriteOrganizationPolicies = (organizationId: OrganizationId) =>
  requirePermission({
    permission: "policies:write",
    organizationId,
  });

const requireReadPolicies = (workspaceId: WorkspaceId) =>
  requirePermission({
    permission: "policies:read",
    workspaceId,
  });

const requireWritePolicies = (workspaceId: WorkspaceId) =>
  requirePermission({
    permission: "policies:write",
    workspaceId,
  });

export const ControlPlanePoliciesLive = HttpApiBuilder.group(
  ControlPlaneApi,
  "policies",
  (handlers) =>
    handlers
      .handle("listOrganization", ({ path }) =>
        withRequestActor("policies.listOrganization", () =>
          withPolicy(requireReadOrganizationPolicies(path.organizationId))(
            listOrganizationPolicies(path.organizationId),
          ),
        ),
      )
      .handle("createOrganization", ({ path, payload }) =>
        withRequestActor("policies.createOrganization", () =>
          withPolicy(requireWriteOrganizationPolicies(path.organizationId))(
            createOrganizationPolicy({
              organizationId: path.organizationId,
              payload,
            }),
          ),
        ),
      )
      .handle("getOrganization", ({ path }) =>
        withRequestActor("policies.getOrganization", () =>
          withPolicy(requireReadOrganizationPolicies(path.organizationId))(
            getOrganizationPolicy({
              organizationId: path.organizationId,
              policyId: path.policyId,
            }),
          ),
        ),
      )
      .handle("updateOrganization", ({ path, payload }) =>
        withRequestActor("policies.updateOrganization", () =>
          withPolicy(requireWriteOrganizationPolicies(path.organizationId))(
            updateOrganizationPolicy({
              organizationId: path.organizationId,
              policyId: path.policyId,
              payload,
            }),
          ),
        ),
      )
      .handle("removeOrganization", ({ path }) =>
        withRequestActor("policies.removeOrganization", () =>
          withPolicy(requireWriteOrganizationPolicies(path.organizationId))(
            removeOrganizationPolicy({
              organizationId: path.organizationId,
              policyId: path.policyId,
            }),
          ),
        ),
      )
      .handle("list", ({ path }) =>
        withWorkspaceRequestActor("policies.list", path.workspaceId, () =>
          withPolicy(requireReadPolicies(path.workspaceId))(
            listPolicies(path.workspaceId),
          ),
        ),
      )
      .handle("create", ({ path, payload }) =>
        withWorkspaceRequestActor("policies.create", path.workspaceId, () =>
          withPolicy(requireWritePolicies(path.workspaceId))(
            createPolicy({ workspaceId: path.workspaceId, payload }),
          ),
        ),
      )
      .handle("get", ({ path }) =>
        withWorkspaceRequestActor("policies.get", path.workspaceId, () =>
          withPolicy(requireReadPolicies(path.workspaceId))(
            getPolicy({
              workspaceId: path.workspaceId,
              policyId: path.policyId,
            }),
          ),
        ),
      )
      .handle("update", ({ path, payload }) =>
        withWorkspaceRequestActor("policies.update", path.workspaceId, () =>
          withPolicy(requireWritePolicies(path.workspaceId))(
            updatePolicy({
              workspaceId: path.workspaceId,
              policyId: path.policyId,
              payload,
            }),
          ),
        ),
      )
      .handle("remove", ({ path }) =>
        withWorkspaceRequestActor("policies.remove", path.workspaceId, () =>
          withPolicy(requireWritePolicies(path.workspaceId))(
            removePolicy({
              workspaceId: path.workspaceId,
              policyId: path.policyId,
            }),
          ),
        ),
      ),
);
