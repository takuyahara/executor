import { type SqlControlPlaneRows } from "#persistence";
import {
  AccountIdSchema,
  InstallationIdSchema,
  OrganizationIdSchema,
  OrganizationMemberIdSchema,
  WorkspaceIdSchema,
  type Account,
  type LocalInstallation,
  type Organization,
  type OrganizationMembership,
  type Workspace,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  defaultWorkspaceDisplayName,
  type ResolvedLocalWorkspaceContext,
} from "./local-config";

const LEGACY_LOCAL_INSTALLATION_ID = InstallationIdSchema.make("local_default");
const LOCAL_ACCOUNT_SUBJECT = "local:default";
const PERSONAL_ORGANIZATION_SLUG = "personal";

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildAccount = (now: number): Account => {
  const id = AccountIdSchema.make(`acc_${crypto.randomUUID()}`);

  return {
    id,
    provider: "local",
    subject: LOCAL_ACCOUNT_SUBJECT,
    email: null,
    displayName: "Local User",
    createdAt: now,
    updatedAt: now,
  };
};

const buildOrganization = (
  accountId: Account["id"],
  now: number,
): Organization => ({
  id: OrganizationIdSchema.make(`org_${crypto.randomUUID()}`),
  slug: PERSONAL_ORGANIZATION_SLUG,
  name: "Personal",
  status: "active",
  createdByAccountId: accountId,
  createdAt: now,
  updatedAt: now,
});

const buildOwnerMembership = (
  organizationId: Organization["id"],
  accountId: Account["id"],
  now: number,
): OrganizationMembership => ({
  id: OrganizationMemberIdSchema.make(`org_mem_${crypto.randomUUID()}`),
  organizationId,
  accountId,
  role: "owner",
  status: "active",
  billable: true,
  invitedByAccountId: null,
  joinedAt: now,
  createdAt: now,
  updatedAt: now,
});

const buildWorkspace = (
  organizationId: Organization["id"],
  accountId: Account["id"],
  workspaceName: string,
  now: number,
): Workspace => ({
  id: WorkspaceIdSchema.make(`ws_${crypto.randomUUID()}`),
  organizationId,
  name: workspaceName,
  createdByAccountId: accountId,
  createdAt: now,
  updatedAt: now,
});

const chooseWorkspaceName = (
  desiredName: string,
  existing: ReadonlyArray<Workspace>,
): string => {
  const trimmed = trimOrNull(desiredName) ?? "Workspace";
  const matching = existing.find((workspace) => workspace.name === trimmed);
  if (!matching) {
    return trimmed;
  }
  return `${trimmed}-${matching.id.slice(-6)}`;
};

const ensureLocalAccount = (
  rows: SqlControlPlaneRows,
  now: number,
): Effect.Effect<Account, unknown> =>
  Effect.gen(function* () {
    const existing = yield* rows.accounts.getByProviderAndSubject("local", LOCAL_ACCOUNT_SUBJECT);
    if (Option.isSome(existing)) {
      return existing.value;
    }

    const account = buildAccount(now);
    yield* rows.accounts.upsert(account);
    return account;
  });

const ensurePersonalOrganization = (
  rows: SqlControlPlaneRows,
  accountId: Account["id"],
  now: number,
): Effect.Effect<Organization, unknown> =>
  Effect.gen(function* () {
    const existing = yield* rows.organizations.getBySlug(PERSONAL_ORGANIZATION_SLUG);
    if (Option.isSome(existing)) {
      return existing.value;
    }

    const organization = buildOrganization(accountId, now);
    const membership = buildOwnerMembership(organization.id, accountId, now);
    yield* rows.organizations.insertWithOwnerMembership(organization, membership);
    return organization;
  });

const ensureOwnerMembership = (
  rows: SqlControlPlaneRows,
  organizationId: Organization["id"],
  accountId: Account["id"],
  now: number,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const existing = yield* rows.organizationMemberships.getByOrganizationAndAccount(
      organizationId,
      accountId,
    );
    if (Option.isSome(existing)) {
      return;
    }

    yield* rows.organizationMemberships.upsert(
      buildOwnerMembership(organizationId, accountId, now),
    );
  });

const provisionWorkspaceForContext = (input: {
  rows: SqlControlPlaneRows;
  accountId: Account["id"];
  organizationId: Organization["id"];
  context: ResolvedLocalWorkspaceContext;
  now: number;
}): Effect.Effect<Workspace, unknown> =>
  Effect.gen(function* () {
    const workspaces = yield* input.rows.workspaces.listByOrganizationId(input.organizationId);
    const workspaceName = chooseWorkspaceName(
      defaultWorkspaceDisplayName(input.context),
      workspaces,
    );
    const workspace = buildWorkspace(
      input.organizationId,
      input.accountId,
      workspaceName,
      input.now,
    );
    yield* input.rows.workspaces.insert(workspace);
    return workspace;
  });

const createInstallationForWorkspace = (input: {
  installationId: LocalInstallation["id"];
  accountId: Account["id"];
  organizationId: Organization["id"];
  workspaceId: Workspace["id"];
  now: number;
}): LocalInstallation => ({
  id: input.installationId,
  accountId: input.accountId,
  organizationId: input.organizationId,
  workspaceId: input.workspaceId,
  createdAt: input.now,
  updatedAt: input.now,
});

export const loadLocalInstallation = (
  rows: SqlControlPlaneRows,
  context: ResolvedLocalWorkspaceContext,
): Effect.Effect<LocalInstallation | null, unknown> =>
  rows.localInstallations.getById(InstallationIdSchema.make(context.installationId)).pipe(
    Effect.map((result) => (Option.isSome(result) ? result.value : null)),
  );

const migrateLegacyLocalInstallation = (input: {
  rows: SqlControlPlaneRows;
  context: ResolvedLocalWorkspaceContext;
  now: number;
}): Effect.Effect<LocalInstallation | null, unknown> =>
  Effect.gen(function* () {
    const legacy = yield* input.rows.localInstallations.getById(LEGACY_LOCAL_INSTALLATION_ID);
    if (Option.isNone(legacy)) {
      return null;
    }

    const migrated = createInstallationForWorkspace({
      installationId: InstallationIdSchema.make(input.context.installationId),
      accountId: legacy.value.accountId,
      organizationId: legacy.value.organizationId,
      workspaceId: legacy.value.workspaceId,
      now: input.now,
    });
    yield* input.rows.localInstallations.upsert(migrated);

    yield* input.rows.workspaces.update(legacy.value.workspaceId, {
      name: defaultWorkspaceDisplayName(input.context),
      updatedAt: input.now,
    });

    return migrated;
  });

export const provisionLocalInstallation = (input: {
  rows: SqlControlPlaneRows;
  context: ResolvedLocalWorkspaceContext;
}): Effect.Effect<LocalInstallation, unknown> =>
  Effect.gen(function* () {
    const now = Date.now();
    const installationId = InstallationIdSchema.make(input.context.installationId);

    const existing = yield* input.rows.localInstallations.getById(installationId);
    if (Option.isSome(existing)) {
      return existing.value;
    }

    const migrated = yield* migrateLegacyLocalInstallation({
      rows: input.rows,
      context: input.context,
      now,
    });
    if (migrated !== null) {
      return migrated;
    }

    const account = yield* ensureLocalAccount(input.rows, now);
    const organization = yield* ensurePersonalOrganization(input.rows, account.id, now);
    yield* ensureOwnerMembership(input.rows, organization.id, account.id, now);
    const workspace = yield* provisionWorkspaceForContext({
      rows: input.rows,
      accountId: account.id,
      organizationId: organization.id,
      context: input.context,
      now,
    });
    const installation = createInstallationForWorkspace({
      installationId,
      accountId: account.id,
      organizationId: organization.id,
      workspaceId: workspace.id,
      now,
    });

    yield* input.rows.localInstallations.upsert(installation);

    return installation;
  });

export const getOrProvisionLocalInstallation = (input: {
  rows: SqlControlPlaneRows;
  context: ResolvedLocalWorkspaceContext;
}): Effect.Effect<LocalInstallation, unknown> =>
  Effect.flatMap(loadLocalInstallation(input.rows, input.context), (existing) =>
    existing
      ? Effect.succeed(existing)
      : provisionLocalInstallation(input),
  );
