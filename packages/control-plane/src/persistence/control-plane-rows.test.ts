import { describe, expect, it } from "@effect/vitest";
import { assertTrue } from "@effect/vitest/utils";
import {
  AccountIdSchema,
  CredentialIdSchema,
  OrganizationIdSchema,
  OrganizationMemberIdSchema,
  PolicyIdSchema,
  SecretMaterialIdSchema,
  SourceAuthSessionIdSchema,
  SourceIdSchema,
  SourceRecipeIdSchema,
  SourceRecipeRevisionIdSchema,
  WorkspaceIdSchema,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import {
  createSqlControlPlanePersistence,
  type SqlControlPlanePersistence,
} from "./index";
import { drizzleSchema } from "./schema";

const makePersistence: Effect.Effect<SqlControlPlanePersistence, unknown, Scope.Scope> =
  Effect.acquireRelease(
  createSqlControlPlanePersistence({
    localDataDir: ":memory:",
  }),
  (persistence) =>
    Effect.tryPromise({
      try: () => persistence.close(),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(Effect.orDie),
  );

const seedWorkspaceSourceState = (input: {
  persistence: SqlControlPlanePersistence;
  accountId: ReturnType<typeof AccountIdSchema.make>;
  organizationId: ReturnType<typeof OrganizationIdSchema.make>;
  workspaceId: ReturnType<typeof WorkspaceIdSchema.make>;
  sourceId: ReturnType<typeof SourceIdSchema.make>;
}): Effect.Effect<void, unknown, never> =>
  Effect.gen(function* () {
    const now = Date.now();
    const recipeId = SourceRecipeIdSchema.make(`src_recipe_${input.sourceId}`);
    const recipeRevisionId = SourceRecipeRevisionIdSchema.make(`src_recipe_rev_${input.sourceId}`);

    yield* input.persistence.rows.organizations.insert({
      id: input.organizationId,
      slug: `org-${input.organizationId}`,
      name: `Org ${input.organizationId}`,
      status: "active",
      createdByAccountId: input.accountId,
      createdAt: now,
      updatedAt: now,
    });
    yield* input.persistence.rows.workspaces.insert({
      id: input.workspaceId,
      organizationId: input.organizationId,
      name: `Workspace ${input.workspaceId}`,
      createdByAccountId: input.accountId,
      createdAt: now,
      updatedAt: now,
    });
    yield* input.persistence.rows.sources.insert({
      id: input.sourceId,
      workspaceId: input.workspaceId,
      recipeId,
      recipeRevisionId,
      name: "Github",
      kind: "openapi",
      endpoint: "https://api.github.com",
      status: "connected",
      enabled: true,
      namespace: "github",
      transport: null,
      bindingConfigJson: null,
      queryParamsJson: null,
      headersJson: null,
      specUrl: "https://api.github.com/openapi.json",
      defaultHeadersJson: null,
      sourceHash: null,
      sourceDocumentText: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
  });

const seedWorkspaceCredentialState = (input: {
  persistence: SqlControlPlanePersistence;
  accountId: ReturnType<typeof AccountIdSchema.make>;
  organizationId: ReturnType<typeof OrganizationIdSchema.make>;
  workspaceId: ReturnType<typeof WorkspaceIdSchema.make>;
  sourceId: ReturnType<typeof SourceIdSchema.make>;
}): Effect.Effect<{
  tokenId: ReturnType<typeof SecretMaterialIdSchema.make>;
  refreshId: ReturnType<typeof SecretMaterialIdSchema.make>;
}, unknown, never> =>
  Effect.gen(function* () {
    const now = Date.now();
    const credentialId = CredentialIdSchema.make(`cred_${input.workspaceId}`);
    const tokenId = SecretMaterialIdSchema.make(`sec_${input.workspaceId}_token`);
    const refreshId = SecretMaterialIdSchema.make(`sec_${input.workspaceId}_refresh`);

    yield* seedWorkspaceSourceState(input);
    yield* input.persistence.rows.secretMaterials.upsert({
      id: tokenId,
      name: null,
      purpose: "oauth_access_token",
      value: "token",
      createdAt: now,
      updatedAt: now,
    });
    yield* input.persistence.rows.secretMaterials.upsert({
      id: refreshId,
      name: null,
      purpose: "oauth_refresh_token",
      value: "refresh",
      createdAt: now,
      updatedAt: now,
    });
    yield* input.persistence.rows.credentials.upsert({
      id: credentialId,
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      actorAccountId: input.accountId,
      authKind: "oauth2",
      authHeaderName: "Authorization",
      authPrefix: "Bearer ",
      tokenProviderId: "postgres",
      tokenHandle: tokenId,
      refreshTokenProviderId: "postgres",
      refreshTokenHandle: refreshId,
      createdAt: now,
      updatedAt: now,
    });
    yield* input.persistence.rows.sourceAuthSessions.upsert({
      id: SourceAuthSessionIdSchema.make(`src_auth_${input.workspaceId}`),
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      actorAccountId: input.accountId,
      executionId: null,
      interactionId: null,
      providerKind: "mcp_oauth",
      status: "pending",
      state: `state_${input.workspaceId}`,
      sessionDataJson: JSON.stringify({
        kind: "mcp_oauth",
        endpoint: "https://api.github.com",
        redirectUri: "http://127.0.0.1/callback",
        scope: null,
        resourceMetadataUrl: null,
        authorizationServerUrl: null,
        resourceMetadataJson: null,
        authorizationServerMetadataJson: null,
        clientInformationJson: null,
        codeVerifier: "verifier",
        authorizationUrl: "https://example.com/auth",
      }),
      errorText: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    return { tokenId, refreshId };
  });

describe("control-plane-persistence-drizzle", () => {
  it.scoped("creates and reads organization/workspace/source/policy rows", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const now = Date.now();
      const organizationId = OrganizationIdSchema.make("org_1");
      const accountId = AccountIdSchema.make("acc_1");
      const workspaceId = WorkspaceIdSchema.make("ws_1");

      yield* persistence.rows.organizations.insert({
        id: organizationId,
        slug: "acme",
        name: "Acme",
        status: "active",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });

      yield* persistence.rows.workspaces.insert({
        id: workspaceId,
        organizationId,
        name: "Main",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });

      yield* persistence.rows.sources.insert({
        id: SourceIdSchema.make("src_1"),
        workspaceId,
        recipeId: SourceRecipeIdSchema.make("src_recipe_1"),
        recipeRevisionId: SourceRecipeRevisionIdSchema.make("src_recipe_rev_1"),
        name: "Github",
        kind: "openapi",
        endpoint: "https://api.github.com",
        status: "draft",
        enabled: true,
        namespace: "github",
        transport: null,
        bindingConfigJson: null,
        queryParamsJson: null,
        headersJson: null,
        specUrl: "https://api.github.com/openapi.json",
        defaultHeadersJson: null,
        sourceHash: null,
        sourceDocumentText: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });

      yield* persistence.rows.policies.insert({
        id: PolicyIdSchema.make("pol_1"),
        scopeType: "workspace",
        organizationId,
        workspaceId,
        targetAccountId: null,
        clientId: null,
        resourceType: "tool_path",
        resourcePattern: "source.github.*",
        matchType: "glob",
        effect: "allow",
        approvalMode: "auto",
        argumentConditionsJson: null,
        priority: 10,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });

      const workspace = yield* persistence.rows.workspaces.getById(workspaceId);
      assertTrue(Option.isSome(workspace));

      const sources = yield* persistence.rows.sources.listByWorkspaceId(workspaceId);
      expect(sources).toHaveLength(1);
      expect(sources[0]?.name).toBe("Github");

      const policies = yield* persistence.rows.policies.listByWorkspaceId(workspaceId);
      expect(policies).toHaveLength(1);
      expect(policies[0]?.resourcePattern).toBe("source.github.*");
    }),
  );

  it.scoped("upserts organization memberships by org/account", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const now = Date.now();
      const organizationId = OrganizationIdSchema.make("org_1");
      const accountId = AccountIdSchema.make("acc_1");

      yield* persistence.rows.organizationMemberships.upsert({
        id: OrganizationMemberIdSchema.make("mem_1"),
        organizationId,
        accountId,
        role: "viewer",
        status: "active",
        billable: true,
        invitedByAccountId: null,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      yield* persistence.rows.organizationMemberships.upsert({
        id: OrganizationMemberIdSchema.make("mem_2"),
        organizationId,
        accountId,
        role: "admin",
        status: "active",
        billable: true,
        invitedByAccountId: null,
        joinedAt: now,
        createdAt: now,
        updatedAt: now + 1,
      });

      const membership = yield* persistence.rows.organizationMemberships.getByOrganizationAndAccount(
        organizationId,
        accountId,
      );

      assertTrue(Option.isSome(membership));
      if (Option.isSome(membership)) {
        expect(membership.value.role).toBe("admin");
      }
    }),
  );

  it.scoped("deduplicates null-actor credentials and returns actor/shared matches", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const accountId = AccountIdSchema.make("acc_credentials");
      const organizationId = OrganizationIdSchema.make("org_credentials");
      const workspaceId = WorkspaceIdSchema.make("ws_credentials");
      const sourceId = SourceIdSchema.make("src_credentials");
      const actorCredentialId = CredentialIdSchema.make("cred_actor_credentials");
      const nullCredentialA = CredentialIdSchema.make("cred_null_credentials_a");
      const nullCredentialB = CredentialIdSchema.make("cred_null_credentials_b");
      const now = Date.now();

      yield* seedWorkspaceSourceState({
        persistence,
        accountId,
        organizationId,
        workspaceId,
        sourceId,
      });

      yield* Effect.tryPromise(async () => {
        await persistence.db.insert(drizzleSchema.credentialsTable).values([
          {
            id: nullCredentialA,
            workspaceId,
            sourceId,
            actorAccountId: null,
            authKind: "bearer",
            authHeaderName: "Authorization",
            authPrefix: "Bearer ",
            tokenProviderId: "postgres",
            tokenHandle: "sec_null_a",
            refreshTokenProviderId: null,
            refreshTokenHandle: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: nullCredentialB,
            workspaceId,
            sourceId,
            actorAccountId: null,
            authKind: "bearer",
            authHeaderName: "Authorization",
            authPrefix: "Bearer ",
            tokenProviderId: "postgres",
            tokenHandle: "sec_null_b",
            refreshTokenProviderId: null,
            refreshTokenHandle: null,
            createdAt: now + 1,
            updatedAt: now + 1,
          },
        ]);
      }).pipe(Effect.orDie);

      yield* persistence.rows.credentials.upsert({
        id: CredentialIdSchema.make("cred_null_credentials_replacement"),
        workspaceId,
        sourceId,
        actorAccountId: null,
        authKind: "oauth2",
        authHeaderName: "X-Auth",
        authPrefix: "Token ",
        tokenProviderId: "postgres",
        tokenHandle: "sec_null_replacement",
        refreshTokenProviderId: "postgres",
        refreshTokenHandle: "sec_null_refresh",
        createdAt: now + 2,
        updatedAt: now + 2,
      });

      yield* persistence.rows.credentials.upsert({
        id: actorCredentialId,
        workspaceId,
        sourceId,
        actorAccountId: accountId,
        authKind: "bearer",
        authHeaderName: "Authorization",
        authPrefix: "Bearer ",
        tokenProviderId: "postgres",
        tokenHandle: "sec_actor",
        refreshTokenProviderId: null,
        refreshTokenHandle: null,
        createdAt: now + 3,
        updatedAt: now + 3,
      });

      const allCredentials = yield* persistence.rows.credentials.listByWorkspaceAndSourceId({
        workspaceId,
        sourceId,
      });
      expect(allCredentials).toHaveLength(2);
      const nullActorCredentials = allCredentials.filter((credential) => credential.actorAccountId === null);
      expect(nullActorCredentials).toHaveLength(1);
      expect(nullActorCredentials[0]?.id).toBe(nullCredentialA);
      expect(nullActorCredentials[0]?.authKind).toBe("oauth2");
      expect(nullActorCredentials[0]?.authHeaderName).toBe("X-Auth");
      expect(nullActorCredentials[0]?.tokenHandle).toBe("sec_null_replacement");
      expect(allCredentials.map((credential) => credential.id).sort()).toEqual(
        [actorCredentialId, nullCredentialA].sort(),
      );

      const forActor = yield* persistence.rows.credentials.listByWorkspaceSourceAndActor({
        workspaceId,
        sourceId,
        actorAccountId: accountId,
      });
      expect(forActor).toHaveLength(2);
      expect(new Set(forActor.map((credential) => credential.id))).toEqual(
        new Set([actorCredentialId, nullCredentialA]),
      );

      const nullActorOnly = yield* persistence.rows.credentials.getByWorkspaceSourceAndActor({
        workspaceId,
        sourceId,
        actorAccountId: null,
      });
      assertTrue(Option.isSome(nullActorOnly));
      if (Option.isSome(nullActorOnly)) {
        expect(nullActorOnly.value.id).toBe(nullCredentialA);
      }

      const missingActor = yield* persistence.rows.credentials.getByWorkspaceSourceAndActor({
        workspaceId,
        sourceId,
        actorAccountId: AccountIdSchema.make("acc_missing_credentials"),
      });
      expect(Option.isNone(missingActor)).toBe(true);
    }),
  );

  it.scoped("deleting a workspace removes source credentials, sessions, and postgres secrets", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const accountId = AccountIdSchema.make("acc_ws_cleanup");
      const organizationId = OrganizationIdSchema.make("org_ws_cleanup");
      const workspaceId = WorkspaceIdSchema.make("ws_cleanup");
      const sourceId = SourceIdSchema.make("src_ws_cleanup");

      const { tokenId, refreshId } = yield* seedWorkspaceCredentialState({
        persistence,
        accountId,
        organizationId,
        workspaceId,
        sourceId,
      });

      const removed = yield* persistence.rows.workspaces.removeById(workspaceId);
      expect(removed).toBe(true);
      expect(Option.isNone(yield* persistence.rows.workspaces.getById(workspaceId))).toBe(true);
      expect(yield* persistence.rows.credentials.listByWorkspaceId(workspaceId)).toHaveLength(0);
      expect(yield* persistence.rows.sourceAuthSessions.listByWorkspaceId(workspaceId)).toHaveLength(0);
      expect(Option.isNone(yield* persistence.rows.secretMaterials.getById(tokenId))).toBe(true);
      expect(Option.isNone(yield* persistence.rows.secretMaterials.getById(refreshId))).toBe(true);
    }),
  );

  it.scoped("deleting an organization removes workspace credential state and postgres secrets", () =>
    Effect.gen(function* () {
      const persistence = yield* makePersistence;
      const accountId = AccountIdSchema.make("acc_org_cleanup");
      const organizationId = OrganizationIdSchema.make("org_cleanup");
      const workspaceId = WorkspaceIdSchema.make("ws_org_cleanup");
      const sourceId = SourceIdSchema.make("src_org_cleanup");

      const { tokenId, refreshId } = yield* seedWorkspaceCredentialState({
        persistence,
        accountId,
        organizationId,
        workspaceId,
        sourceId,
      });

      const removed = yield* persistence.rows.organizations.removeTreeById(organizationId);
      expect(removed).toBe(true);
      expect(Option.isNone(yield* persistence.rows.workspaces.getById(workspaceId))).toBe(true);
      expect(yield* persistence.rows.credentials.listByWorkspaceId(workspaceId)).toHaveLength(0);
      expect(yield* persistence.rows.sourceAuthSessions.listByWorkspaceId(workspaceId)).toHaveLength(0);
      expect(Option.isNone(yield* persistence.rows.secretMaterials.getById(tokenId))).toBe(true);
      expect(Option.isNone(yield* persistence.rows.secretMaterials.getById(refreshId))).toBe(true);
    }),
  );
});
