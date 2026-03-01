import {
  listApprovals as listApprovalsImpl,
  resolveApproval as resolveApprovalImpl,
} from "./control_plane/approvals";
import {
  listCredentialBindings as listCredentialBindingsImpl,
  removeCredentialBinding as removeCredentialBindingImpl,
  upsertCredentialBinding as upsertCredentialBindingImpl,
} from "./control_plane/credentials";
import { controlPlaneHttpHandler as controlPlaneHttpHandlerImpl } from "./control_plane/http";
import {
  listOrganizations as listOrganizationsImpl,
  upsertOrganization as upsertOrganizationImpl,
} from "./control_plane/organizations";
import {
  listPolicies as listPoliciesImpl,
  removePolicy as removePolicyImpl,
  upsertPolicy as upsertPolicyImpl,
} from "./control_plane/policies";
import {
  listSources as listSourcesImpl,
  removeSource as removeSourceImpl,
  upsertSource as upsertSourceImpl,
} from "./control_plane/sources";
import {
  closeStorageInstance as closeStorageInstanceImpl,
  listStorageDirectory as listStorageDirectoryImpl,
  listStorageInstances as listStorageInstancesImpl,
  listStorageKv as listStorageKvImpl,
  openStorageInstance as openStorageInstanceImpl,
  queryStorageSql as queryStorageSqlImpl,
  readStorageFile as readStorageFileImpl,
  removeStorageInstance as removeStorageInstanceImpl,
} from "./control_plane/storage";
import {
  getToolDetail as getToolDetailImpl,
  listSourceTools as listSourceToolsImpl,
  listWorkspaceTools as listWorkspaceToolsImpl,
} from "./control_plane/tools";
import {
  listWorkspaces as listWorkspacesImpl,
  upsertWorkspace as upsertWorkspaceImpl,
} from "./control_plane/workspaces";

export const listSources = listSourcesImpl;
export const upsertSource = upsertSourceImpl;
export const removeSource = removeSourceImpl;
export const listCredentialBindings = listCredentialBindingsImpl;
export const upsertCredentialBinding = upsertCredentialBindingImpl;
export const removeCredentialBinding = removeCredentialBindingImpl;
export const listPolicies = listPoliciesImpl;
export const upsertPolicy = upsertPolicyImpl;
export const removePolicy = removePolicyImpl;
export const listOrganizations = listOrganizationsImpl;
export const upsertOrganization = upsertOrganizationImpl;
export const listWorkspaces = listWorkspacesImpl;
export const upsertWorkspace = upsertWorkspaceImpl;
export const listWorkspaceTools = listWorkspaceToolsImpl;
export const listSourceTools = listSourceToolsImpl;
export const getToolDetail = getToolDetailImpl;
export const listStorageInstances = listStorageInstancesImpl;
export const openStorageInstance = openStorageInstanceImpl;
export const closeStorageInstance = closeStorageInstanceImpl;
export const removeStorageInstance = removeStorageInstanceImpl;
export const listStorageDirectory = listStorageDirectoryImpl;
export const readStorageFile = readStorageFileImpl;
export const listStorageKv = listStorageKvImpl;
export const queryStorageSql = queryStorageSqlImpl;
export const listApprovals = listApprovalsImpl;
export const resolveApproval = resolveApprovalImpl;

export const controlPlaneHttpHandler = controlPlaneHttpHandlerImpl;
