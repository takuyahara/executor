import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createControlPlaneRuntime } from "./index";
import {
  loadLocalExecutorConfig,
  resolveLocalWorkspaceContext,
} from "./local-config";
import {
  loadLocalControlPlaneState,
  localControlPlaneStatePath,
} from "./local-control-plane-store";
import { readLocalSourceArtifact } from "./local-source-artifacts";
import {
  loadLocalWorkspaceState,
  localWorkspaceStatePath,
} from "./local-workspace-state";

const LEGACY_INSTALLATION_ID = "local_default";
const LEGACY_WORKSPACE_ID = "ws_legacy_default";
const LEGACY_ACCOUNT_ID = "acc_legacy_default";
const LEGACY_SOURCE_ID = "src_legacy_mcp";
const LEGACY_SECRET_ID = "sec_legacy_token";
const LEGACY_POLICY_ID = "pol_legacy_allow";
const LEGACY_EXECUTION_ID = "exec_legacy_run";
const LEGACY_INTERACTION_ID = "int_legacy_prompt";
const LEGACY_SESSION_ID = "sas_legacy_oauth";
const SECOND_LEGACY_SOURCE_ID = "src_should_not_migrate";

const CREATED_AT = 1_700_000_000_000;
const UPDATED_AT = 1_700_000_000_500;

const makeTempDir = (prefix: string) =>
  mkdtempSync(join(tmpdir(), prefix));

const createLegacySchema = async (db: PGlite) => {
  await db.exec(`
    create table local_installations (
      id text primary key,
      account_id text not null,
      workspace_id text not null
    );
    create table workspaces (
      id text primary key,
      name text
    );
    create table sources (
      workspace_id text not null,
      source_id text primary key,
      name text not null,
      kind text not null,
      endpoint text not null,
      status text not null,
      enabled boolean not null,
      namespace text,
      transport text,
      query_params_json text,
      headers_json text,
      spec_url text,
      default_headers_json text,
      source_hash text,
      source_document_text text,
      last_error text,
      created_at bigint not null,
      updated_at bigint not null
    );
    create table credentials (
      id text primary key,
      workspace_id text not null,
      auth_kind text not null,
      auth_header_name text not null,
      auth_prefix text not null,
      token_provider_id text not null,
      token_handle text not null,
      refresh_token_provider_id text,
      refresh_token_handle text,
      created_at bigint not null,
      updated_at bigint not null
    );
    create table source_credential_bindings (
      id text primary key,
      workspace_id text not null,
      source_id text not null,
      credential_id text not null
    );
    create table secret_materials (
      id text primary key,
      name text,
      purpose text not null,
      value text not null,
      created_at bigint not null,
      updated_at bigint not null
    );
    create table policies (
      id text primary key,
      scope_type text not null,
      workspace_id text,
      target_account_id text,
      client_id text,
      resource_type text not null,
      resource_pattern text not null,
      match_type text not null,
      effect text not null,
      approval_mode text not null,
      priority integer not null,
      enabled boolean not null,
      argument_conditions_json text,
      created_at bigint not null,
      updated_at bigint not null
    );
    create table executions (
      id text primary key,
      workspace_id text not null,
      created_by_account_id text not null,
      status text not null,
      code text not null,
      result_json text,
      error_text text,
      logs_json text,
      started_at bigint,
      completed_at bigint,
      created_at bigint not null,
      updated_at bigint not null
    );
    create table execution_interactions (
      id text primary key,
      execution_id text not null,
      status text not null,
      kind text not null,
      purpose text not null,
      payload_json text not null,
      response_json text,
      created_at bigint not null,
      updated_at bigint not null
    );
    create table source_auth_sessions (
      id text primary key,
      workspace_id text not null,
      source_id text not null,
      execution_id text,
      interaction_id text,
      strategy text not null,
      status text not null,
      endpoint text not null,
      state text not null,
      redirect_uri text not null,
      scope text,
      resource_metadata_url text,
      authorization_server_url text,
      resource_metadata_json text,
      authorization_server_metadata_json text,
      client_information_json text,
      code_verifier text,
      authorization_url text,
      error_text text,
      completed_at bigint,
      created_at bigint not null,
      updated_at bigint not null
    );
    create table tool_artifacts (
      workspace_id text not null,
      path text not null,
      tool_id text not null,
      source_id text not null,
      title text,
      description text,
      search_namespace text not null,
      search_text text not null,
      input_schema_json text,
      output_schema_json text,
      provider_kind text not null,
      mcp_tool_name text,
      created_at bigint not null,
      updated_at bigint not null
    );
  `);
};

const seedInitialLegacyWorkspace = async (legacyLocalDataDir: string) => {
  const db = new PGlite(legacyLocalDataDir);
  await db.waitReady;

  try {
    await createLegacySchema(db);

    await db.query(
      "insert into local_installations (id, account_id, workspace_id) values ($1, $2, $3)",
      [LEGACY_INSTALLATION_ID, LEGACY_ACCOUNT_ID, LEGACY_WORKSPACE_ID],
    );
    await db.query(
      "insert into workspaces (id, name) values ($1, $2)",
      [LEGACY_WORKSPACE_ID, "Legacy Workspace"],
    );
    await db.query(
      `insert into sources (
        workspace_id,
        source_id,
        name,
        kind,
        endpoint,
        status,
        enabled,
        namespace,
        transport,
        query_params_json,
        headers_json,
        spec_url,
        default_headers_json,
        source_hash,
        source_document_text,
        last_error,
        created_at,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        LEGACY_WORKSPACE_ID,
        LEGACY_SOURCE_ID,
        "Legacy MCP",
        "mcp",
        "https://legacy.example.test/mcp",
        "connected",
        true,
        "legacy",
        "streamable-http",
        null,
        JSON.stringify({ "x-legacy": "1" }),
        null,
        null,
        "hash_legacy_mcp",
        null,
        null,
        CREATED_AT,
        UPDATED_AT,
      ],
    );
    await db.query(
      `insert into credentials (
        id,
        workspace_id,
        auth_kind,
        auth_header_name,
        auth_prefix,
        token_provider_id,
        token_handle,
        refresh_token_provider_id,
        refresh_token_handle,
        created_at,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        "cred_legacy_bearer",
        LEGACY_WORKSPACE_ID,
        "bearer",
        "Authorization",
        "Bearer ",
        "postgres",
        LEGACY_SECRET_ID,
        null,
        null,
        CREATED_AT,
        UPDATED_AT,
      ],
    );
    await db.query(
      "insert into source_credential_bindings (id, workspace_id, source_id, credential_id) values ($1, $2, $3, $4)",
      ["bind_legacy_bearer", LEGACY_WORKSPACE_ID, LEGACY_SOURCE_ID, "cred_legacy_bearer"],
    );
    await db.query(
      "insert into secret_materials (id, name, purpose, value, created_at, updated_at) values ($1, $2, $3, $4, $5, $6)",
      [LEGACY_SECRET_ID, "Legacy bearer token", "auth_material", "top-secret", CREATED_AT, UPDATED_AT],
    );
    await db.query(
      `insert into policies (
        id,
        scope_type,
        workspace_id,
        target_account_id,
        client_id,
        resource_type,
        resource_pattern,
        match_type,
        effect,
        approval_mode,
        priority,
        enabled,
        argument_conditions_json,
        created_at,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        LEGACY_POLICY_ID,
        "workspace",
        LEGACY_WORKSPACE_ID,
        null,
        null,
        "namespace",
        "legacy",
        "exact",
        "allow",
        "required",
        7,
        true,
        null,
        CREATED_AT,
        UPDATED_AT,
      ],
    );
    await db.query(
      `insert into executions (
        id,
        workspace_id,
        created_by_account_id,
        status,
        code,
        result_json,
        error_text,
        logs_json,
        started_at,
        completed_at,
        created_at,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        LEGACY_EXECUTION_ID,
        LEGACY_WORKSPACE_ID,
        LEGACY_ACCOUNT_ID,
        "completed",
        "export default 'legacy';",
        JSON.stringify({
          workspaceId: LEGACY_WORKSPACE_ID,
          accountId: LEGACY_ACCOUNT_ID,
        }),
        null,
        JSON.stringify(["legacy-log"]),
        CREATED_AT,
        UPDATED_AT,
        CREATED_AT,
        UPDATED_AT,
      ],
    );
    await db.query(
      `insert into execution_interactions (
        id,
        execution_id,
        status,
        kind,
        purpose,
        payload_json,
        response_json,
        created_at,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        LEGACY_INTERACTION_ID,
        LEGACY_EXECUTION_ID,
        "resolved",
        "credential",
        "connect",
        JSON.stringify({
          workspaceId: LEGACY_WORKSPACE_ID,
          accountId: LEGACY_ACCOUNT_ID,
        }),
        JSON.stringify({ ok: true }),
        CREATED_AT,
        UPDATED_AT,
      ],
    );
    await db.query(
      `insert into source_auth_sessions (
        id,
        workspace_id,
        source_id,
        execution_id,
        interaction_id,
        strategy,
        status,
        endpoint,
        state,
        redirect_uri,
        scope,
        resource_metadata_url,
        authorization_server_url,
        resource_metadata_json,
        authorization_server_metadata_json,
        client_information_json,
        code_verifier,
        authorization_url,
        error_text,
        completed_at,
        created_at,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
      [
        LEGACY_SESSION_ID,
        LEGACY_WORKSPACE_ID,
        LEGACY_SOURCE_ID,
        LEGACY_EXECUTION_ID,
        LEGACY_INTERACTION_ID,
        "oauth2_authorization_code",
        "pending",
        "https://legacy.example.test/mcp",
        "legacy-state",
        "http://127.0.0.1/callback",
        "tools:read",
        "https://legacy.example.test/resource",
        "https://legacy.example.test/oauth",
        JSON.stringify({ resource: "metadata" }),
        JSON.stringify({ issuer: "legacy-auth" }),
        JSON.stringify({ client_id: "legacy-client" }),
        "verifier-123",
        "https://legacy.example.test/oauth/authorize",
        null,
        null,
        CREATED_AT,
        UPDATED_AT,
      ],
    );
    await db.query(
      `insert into tool_artifacts (
        workspace_id,
        path,
        tool_id,
        source_id,
        title,
        description,
        search_namespace,
        search_text,
        input_schema_json,
        output_schema_json,
        provider_kind,
        mcp_tool_name,
        created_at,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        LEGACY_WORKSPACE_ID,
        "legacy.echo",
        "legacy.echo",
        LEGACY_SOURCE_ID,
        "Legacy Echo",
        "Echo a string from the legacy MCP source",
        "legacy",
        "legacy echo mcp tool",
        JSON.stringify({
          type: "object",
          properties: {
            value: { type: "string" },
          },
        }),
        JSON.stringify({
          type: "object",
          properties: {
            echoed: { type: "string" },
          },
        }),
        "mcp",
        "echo",
        CREATED_AT,
        UPDATED_AT,
      ],
    );
  } finally {
    await db.close();
  }
};

const appendUnmigratedLegacySource = async (legacyLocalDataDir: string) => {
  const db = new PGlite(legacyLocalDataDir);
  await db.waitReady;

  try {
    await db.query(
      `insert into sources (
        workspace_id,
        source_id,
        name,
        kind,
        endpoint,
        status,
        enabled,
        namespace,
        transport,
        query_params_json,
        headers_json,
        spec_url,
        default_headers_json,
        source_hash,
        source_document_text,
        last_error,
        created_at,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        LEGACY_WORKSPACE_ID,
        SECOND_LEGACY_SOURCE_ID,
        "Should Not Migrate",
        "mcp",
        "https://legacy.example.test/should-not-migrate",
        "connected",
        true,
        "skip",
        "streamable-http",
        null,
        null,
        null,
        null,
        "hash_second_source",
        null,
        null,
        CREATED_AT,
        UPDATED_AT,
      ],
    );
  } finally {
    await db.close();
  }
};

describe("legacy-postgres-migration", () => {
  it.scoped("migrates the legacy postgres workspace into local files once on startup", () =>
    Effect.gen(function* () {
      const workspaceRoot = makeTempDir("executor-legacy-workspace-");
      const legacyLocalDataDir = makeTempDir("executor-legacy-db-");
      const homeConfigPath = join(workspaceRoot, ".executor-home.jsonc");
      const homeStateDirectory = join(workspaceRoot, ".executor-home-state");

      yield* Effect.promise(() => seedInitialLegacyWorkspace(legacyLocalDataDir));

      const firstRuntime = yield* createControlPlaneRuntime({
        workspaceRoot,
        homeConfigPath,
        homeStateDirectory,
        localDataDir: legacyLocalDataDir,
      });

      const context = yield* resolveLocalWorkspaceContext({
        workspaceRoot,
        homeConfigPath,
        homeStateDirectory,
      });
      const loadedConfig = yield* loadLocalExecutorConfig(context);
      const workspaceState = yield* loadLocalWorkspaceState(context);
      const controlPlaneState = yield* loadLocalControlPlaneState(context);
      const sourceArtifact = yield* readLocalSourceArtifact({
        context,
        sourceId: LEGACY_SOURCE_ID,
      });

      expect(existsSync(context.projectConfigPath)).toBe(true);
      expect(existsSync(localWorkspaceStatePath(context))).toBe(true);
      expect(existsSync(localControlPlaneStatePath(context))).toBe(true);

      expect(loadedConfig.projectConfig?.sources?.[LEGACY_SOURCE_ID]?.kind).toBe("mcp");
      expect(
        loadedConfig.projectConfig?.sources?.[LEGACY_SOURCE_ID]?.connection.endpoint,
      ).toBe("https://legacy.example.test/mcp");
      expect(
        Object.values(loadedConfig.projectConfig?.policies ?? {}).some((policy) =>
          policy.match === "legacy.*"
          && policy.action === "allow"
          && policy.approval === "manual"
          && policy.priority === 7),
      ).toBe(true);

      expect(workspaceState.sources[LEGACY_SOURCE_ID]?.status).toBe("connected");
      expect(Object.values(workspaceState.policies)).toHaveLength(1);

      expect(controlPlaneState.secretMaterials).toEqual([
        {
          id: LEGACY_SECRET_ID,
          name: "Legacy bearer token",
          purpose: "auth_material",
          providerId: "local",
          handle: LEGACY_SECRET_ID,
          value: "top-secret",
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
        },
      ]);
      expect(controlPlaneState.authArtifacts).toHaveLength(1);
      expect(JSON.parse(controlPlaneState.authArtifacts[0]!.configJson)).toMatchObject({
        headerName: "Authorization",
        prefix: "Bearer",
        token: {
          providerId: "local",
          handle: LEGACY_SECRET_ID,
        },
      });
      expect(controlPlaneState.sourceAuthSessions).toHaveLength(1);
      expect(controlPlaneState.executions).toHaveLength(1);
      expect(controlPlaneState.executions[0]?.workspaceId).toBe(
        firstRuntime.localInstallation.workspaceId,
      );
      expect(controlPlaneState.executions[0]?.createdByAccountId).toBe(
        firstRuntime.localInstallation.accountId,
      );
      expect(controlPlaneState.executions[0]?.resultJson).toContain(
        firstRuntime.localInstallation.workspaceId,
      );
      expect(controlPlaneState.executions[0]?.resultJson).not.toContain(
        LEGACY_WORKSPACE_ID,
      );
      expect(controlPlaneState.executionInteractions[0]?.payloadJson).not.toContain(
        LEGACY_ACCOUNT_ID,
      );

      expect(sourceArtifact).not.toBeNull();
      expect(sourceArtifact?.sourceId).toBe(LEGACY_SOURCE_ID);
      expect(Object.values(sourceArtifact?.snapshot.catalog.executables ?? {})).toHaveLength(1);

      yield* Effect.promise(() => firstRuntime.close());

      yield* Effect.promise(() => appendUnmigratedLegacySource(legacyLocalDataDir));

      const secondRuntime = yield* createControlPlaneRuntime({
        workspaceRoot,
        homeConfigPath,
        homeStateDirectory,
        localDataDir: legacyLocalDataDir,
      });
      yield* Effect.promise(() => secondRuntime.close());

      const loadedConfigAfterSecondStart = yield* loadLocalExecutorConfig(context);
      const workspaceStateAfterSecondStart = yield* loadLocalWorkspaceState(context);

      expect(loadedConfigAfterSecondStart.projectConfig?.sources?.[SECOND_LEGACY_SOURCE_ID]).toBeUndefined();
      expect(workspaceStateAfterSecondStart.sources[SECOND_LEGACY_SOURCE_ID]).toBeUndefined();
      expect(secondRuntime.localInstallation.workspaceId).toBe(
        firstRuntime.localInstallation.workspaceId,
      );
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
