import type { DrizzleClient } from "./client";
import type { DrizzleTables } from "./schema";
import {
  createAccountsRepo,
  createExecutionInteractionsRepo,
  createExecutionsRepo,
  createLocalInstallationsRepo,
  createOrganizationMembershipsRepo,
  createOrganizationsRepo,
  createPoliciesRepo,
  createSecretMaterialsRepo,
  createSourceCredentialBindingsRepo,
  createSourceAuthSessionsRepo,
  createSourcesRepo,
  createWorkspacesRepo,
} from "./repos";

type CreateControlPlaneRowsInput = {
  client: DrizzleClient;
  tables: DrizzleTables;
};

export const createControlPlaneRows = ({
  client,
  tables,
}: CreateControlPlaneRowsInput) => ({
  accounts: createAccountsRepo(client, tables),
  organizations: createOrganizationsRepo(client, tables),
  organizationMemberships: createOrganizationMembershipsRepo(client, tables),
  workspaces: createWorkspacesRepo(client, tables),
  sources: createSourcesRepo(client, tables),
  sourceCredentialBindings: createSourceCredentialBindingsRepo(client, tables),
  secretMaterials: createSecretMaterialsRepo(client, tables),
  sourceAuthSessions: createSourceAuthSessionsRepo(client, tables),
  policies: createPoliciesRepo(client, tables),
  localInstallations: createLocalInstallationsRepo(client, tables),
  executions: createExecutionsRepo(client, tables),
  executionInteractions: createExecutionInteractionsRepo(client, tables),
});

export type SqlControlPlaneRows = ReturnType<typeof createControlPlaneRows>;
