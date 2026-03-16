import { existsSync, readFileSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

import { FileSystem } from "@effect/platform";
import { PGlite } from "@electric-sql/pglite";
import {
  buildOpenApiToolPresentation,
  compileOpenApiToolDefinitions,
  extractOpenApiManifest,
  type OpenApiRefHintTable,
  type OpenApiToolProviderData,
} from "@executor/codemode-openapi";
import {
  AuthArtifactIdSchema,
  type JsonObject,
  McpSourceAuthSessionDataJsonSchema,
  type Execution,
  type ExecutionInteraction,
  type LocalExecutorConfig,
  type SecretMaterial,
  type Source,
  type SourceAuth,
  type SourceTransport,
  type SourceAuthSession,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import postgres from "postgres";

import {
  buildGraphqlToolPresentation,
  compileGraphqlToolDefinitions,
  extractGraphqlManifest,
  type GraphqlToolProviderData,
} from "./graphql-tools";
import {
  type LocalControlPlaneState,
  writeLocalControlPlaneState,
} from "./local-control-plane-store";
import {
  type ResolvedLocalWorkspaceContext,
  writeProjectLocalExecutorConfig,
} from "./local-config";
import { deriveLocalInstallation } from "./local-installation";
import { derivePolicyConfigKey } from "./local-workspace-sync";
import {
  type LocalWorkspaceState,
  writeLocalWorkspaceState,
} from "./local-workspace-state";
import {
  buildLocalSourceArtifact,
  writeLocalSourceArtifact,
  type LocalSourceArtifact,
} from "./local-source-artifacts";
import { namespaceFromSourceName } from "./source-names";
import {
  createCatalogImportMetadata,
  createGraphqlCatalogFragment,
  createMcpCatalogFragment,
  createOpenApiCatalogFragment,
  type GraphqlCatalogOperationInput,
  type McpCatalogOperationInput,
  type OpenApiCatalogOperationInput,
} from "./source-catalog-snapshot";
import { authArtifactFromSourceAuth } from "./auth-artifacts";
import { createSourceCatalogSyncResult, contentHash } from "./source-catalog-support";
import { getSourceAdapter } from "./source-adapters";

const LOCAL_CONTROL_PLANE_STATE_BASENAME = "control-plane-state.json";
const WORKSPACE_STATE_BASENAME = "workspace-state.json";
const LEGACY_LOCAL_INSTALLATION_ID = "local_default";
const LEGACY_POSTGRES_SECRET_PROVIDER_ID = "postgres";
const LOCAL_SECRET_PROVIDER_ID = "local";
const MIGRATABLE_LEGACY_SOURCE_KINDS = ["mcp", "openapi", "graphql"] as const;

type MigratableLegacySourceKind = (typeof MIGRATABLE_LEGACY_SOURCE_KINDS)[number];
type LocalConfigSourceEntry = NonNullable<LocalExecutorConfig["sources"]>[string];
type LocalWorkspaceSourceState = LocalWorkspaceState["sources"][string];

type LegacyRow = Record<string, unknown>;

type LegacyLocalInstallationRow = {
  id: string;
  account_id: string;
  workspace_id: string;
};

type LegacyWorkspaceRow = {
  id: string;
  name: string | null;
};

type LegacySourceRow = {
  workspace_id: string;
  source_id: string;
  name: string;
  kind: string;
  endpoint: string;
  status: string;
  enabled: boolean;
  namespace: string | null;
  transport: string | null;
  query_params_json: string | null;
  headers_json: string | null;
  spec_url: string | null;
  default_headers_json: string | null;
  source_hash: string | null;
  source_document_text: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

type LegacyCredentialRow = {
  id: string;
  workspace_id: string;
  auth_kind: string;
  auth_header_name: string;
  auth_prefix: string;
  token_provider_id: string;
  token_handle: string;
  refresh_token_provider_id: string | null;
  refresh_token_handle: string | null;
  created_at: number;
  updated_at: number;
};

type LegacySourceCredentialBindingRow = {
  id: string;
  workspace_id: string;
  source_id: string;
  credential_id: string;
};

type LegacySecretMaterialRow = {
  id: string;
  name: string | null;
  purpose: SecretMaterial["purpose"];
  value: string;
  created_at: number;
  updated_at: number;
};

type LegacyPolicyRow = {
  id: string;
  scope_type: string;
  workspace_id: string | null;
  target_account_id: string | null;
  client_id: string | null;
  resource_type: string;
  resource_pattern: string;
  match_type: string;
  effect: string;
  approval_mode: string;
  priority: number;
  enabled: boolean;
  argument_conditions_json: string | null;
  created_at: number;
  updated_at: number;
};

type LegacyExecutionRow = {
  id: string;
  workspace_id: string;
  created_by_account_id: string;
  status: Execution["status"];
  code: string;
  result_json: string | null;
  error_text: string | null;
  logs_json: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
};

type LegacyExecutionInteractionRow = {
  id: string;
  execution_id: string;
  status: ExecutionInteraction["status"];
  kind: string;
  purpose: string;
  payload_json: string;
  response_json: string | null;
  created_at: number;
  updated_at: number;
};

type LegacySourceAuthSessionRow = {
  id: string;
  workspace_id: string;
  source_id: string;
  execution_id: string | null;
  interaction_id: string | null;
  strategy: string;
  status: SourceAuthSession["status"];
  endpoint: string;
  state: string;
  redirect_uri: string;
  scope: string | null;
  resource_metadata_url: string | null;
  authorization_server_url: string | null;
  resource_metadata_json: string | null;
  authorization_server_metadata_json: string | null;
  client_information_json: string | null;
  code_verifier: string | null;
  authorization_url: string | null;
  error_text: string | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
};

type LegacyToolArtifactRow = {
  workspace_id: string;
  path: string;
  tool_id: string;
  source_id: string;
  title: string | null;
  description: string | null;
  search_namespace: string;
  search_text: string;
  input_schema_json: string | null;
  output_schema_json: string | null;
  provider_kind: string;
  mcp_tool_name: string | null;
  created_at: number;
  updated_at: number;
};

type LegacyWorkspaceSnapshot = {
  installation: LegacyLocalInstallationRow;
  workspace: LegacyWorkspaceRow | null;
  sources: LegacySourceRow[];
  credentials: LegacyCredentialRow[];
  sourceCredentialBindings: LegacySourceCredentialBindingRow[];
  secretMaterials: LegacySecretMaterialRow[];
  policies: LegacyPolicyRow[];
  executions: LegacyExecutionRow[];
  executionInteractions: LegacyExecutionInteractionRow[];
  sourceAuthSessions: LegacySourceAuthSessionRow[];
  toolArtifacts: LegacyToolArtifactRow[];
};

type LegacyQueryClient = {
  label: string;
  query: (sql: string) => Promise<LegacyRow[]>;
  close: () => Promise<void>;
};

type MigratedPolicyEntry = {
  key: string;
  config: NonNullable<LocalExecutorConfig["policies"]>[string];
  state: LocalWorkspaceState["policies"][string];
};

type MigratedWorkspace = {
  projectConfig: LocalExecutorConfig;
  workspaceState: LocalWorkspaceState;
  controlPlaneState: LocalControlPlaneState;
  sourceArtifacts: Array<{
    sourceId: Source["id"];
    artifact: LocalSourceArtifact;
  }>;
  sourceCount: number;
  policyCount: number;
};

const encodeMcpSourceAuthSessionData = Schema.encodeSync(
  McpSourceAuthSessionDataJsonSchema,
);

const trimOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => {
  const trimmed = trimOrNull(value);
  return trimmed ?? "";
};

const asNullableString = (value: unknown): string | null => trimOrNull(value);

const asNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const asNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return asNumber(value);
};

const asBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "t" || normalized === "1";
  }
  return false;
};

const asStringMap = (value: string | null): Record<string, string> | null => {
  if (value === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    const record = asRecord(parsed);
    const normalized: Record<string, string> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (typeof entry === "string") {
        normalized[key] = entry;
      }
    }
    return normalized;
  } catch {
    return null;
  }
};

const safeJsonParse = <T>(value: string | null): T | undefined => {
  if (value === null) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

const stableSourceNamespace = (row: Pick<LegacySourceRow, "name" | "namespace">): string =>
  trimOrNull(row.namespace) ?? namespaceFromSourceName(row.name);

const normalizeLegacyRows = (value: unknown): LegacyRow[] => {
  if (Array.isArray(value)) {
    return value.map(asRecord);
  }

  const record = asRecord(value);
  if (Array.isArray(record.rows)) {
    return record.rows.map(asRecord);
  }

  return [];
};

const cloneJson = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const isMigratableLegacySourceKind = (
  value: string,
): value is MigratableLegacySourceKind =>
  (MIGRATABLE_LEGACY_SOURCE_KINDS as readonly string[]).includes(value);

const decodeLegacyLocalInstallationRow = (row: LegacyRow): LegacyLocalInstallationRow => ({
  id: asString(row.id),
  account_id: asString(row.account_id),
  workspace_id: asString(row.workspace_id),
});

const decodeLegacyWorkspaceRow = (row: LegacyRow): LegacyWorkspaceRow => ({
  id: asString(row.id),
  name: asNullableString(row.name),
});

const decodeLegacySourceRow = (row: LegacyRow): LegacySourceRow => ({
  workspace_id: asString(row.workspace_id),
  source_id: asString(row.source_id),
  name: asString(row.name),
  kind: asString(row.kind),
  endpoint: asString(row.endpoint),
  status: asString(row.status),
  enabled: asBoolean(row.enabled),
  namespace: asNullableString(row.namespace),
  transport: asNullableString(row.transport),
  query_params_json: asNullableString(row.query_params_json),
  headers_json: asNullableString(row.headers_json),
  spec_url: asNullableString(row.spec_url),
  default_headers_json: asNullableString(row.default_headers_json),
  source_hash: asNullableString(row.source_hash),
  source_document_text: asNullableString(row.source_document_text),
  last_error: asNullableString(row.last_error),
  created_at: asNumber(row.created_at),
  updated_at: asNumber(row.updated_at),
});

const decodeLegacyCredentialRow = (row: LegacyRow): LegacyCredentialRow => ({
  id: asString(row.id),
  workspace_id: asString(row.workspace_id),
  auth_kind: asString(row.auth_kind),
  auth_header_name: asString(row.auth_header_name),
  auth_prefix: asString(row.auth_prefix),
  token_provider_id: asString(row.token_provider_id),
  token_handle: asString(row.token_handle),
  refresh_token_provider_id: asNullableString(row.refresh_token_provider_id),
  refresh_token_handle: asNullableString(row.refresh_token_handle),
  created_at: asNumber(row.created_at),
  updated_at: asNumber(row.updated_at),
});

const decodeLegacySourceCredentialBindingRow = (
  row: LegacyRow,
): LegacySourceCredentialBindingRow => ({
  id: asString(row.id),
  workspace_id: asString(row.workspace_id),
  source_id: asString(row.source_id),
  credential_id: asString(row.credential_id),
});

const decodeLegacySecretMaterialRow = (row: LegacyRow): LegacySecretMaterialRow => ({
  id: asString(row.id),
  name: asNullableString(row.name),
  purpose:
    asString(row.purpose) as LegacySecretMaterialRow["purpose"],
  value: asString(row.value),
  created_at: asNumber(row.created_at),
  updated_at: asNumber(row.updated_at),
});

const decodeLegacyPolicyRow = (row: LegacyRow): LegacyPolicyRow => ({
  id: asString(row.id),
  scope_type: asString(row.scope_type),
  workspace_id: asNullableString(row.workspace_id),
  target_account_id: asNullableString(row.target_account_id),
  client_id: asNullableString(row.client_id),
  resource_type: asString(row.resource_type),
  resource_pattern: asString(row.resource_pattern),
  match_type: asString(row.match_type),
  effect: asString(row.effect),
  approval_mode: asString(row.approval_mode),
  priority: asNumber(row.priority),
  enabled: row.enabled === undefined ? true : asBoolean(row.enabled),
  argument_conditions_json: asNullableString(row.argument_conditions_json),
  created_at: asNumber(row.created_at),
  updated_at: asNumber(row.updated_at),
});

const decodeLegacyExecutionRow = (row: LegacyRow): LegacyExecutionRow => ({
  id: asString(row.id),
  workspace_id: asString(row.workspace_id),
  created_by_account_id: asString(row.created_by_account_id),
  status: asString(row.status) as LegacyExecutionRow["status"],
  code: asString(row.code),
  result_json: asNullableString(row.result_json),
  error_text: asNullableString(row.error_text),
  logs_json: asNullableString(row.logs_json),
  started_at: asNullableNumber(row.started_at),
  completed_at: asNullableNumber(row.completed_at),
  created_at: asNumber(row.created_at),
  updated_at: asNumber(row.updated_at),
});

const decodeLegacyExecutionInteractionRow = (
  row: LegacyRow,
): LegacyExecutionInteractionRow => ({
  id: asString(row.id),
  execution_id: asString(row.execution_id),
  status: asString(row.status) as LegacyExecutionInteractionRow["status"],
  kind: asString(row.kind),
  purpose: asString(row.purpose),
  payload_json: asString(row.payload_json),
  response_json: asNullableString(row.response_json),
  created_at: asNumber(row.created_at),
  updated_at: asNumber(row.updated_at),
});

const decodeLegacySourceAuthSessionRow = (
  row: LegacyRow,
): LegacySourceAuthSessionRow => ({
  id: asString(row.id),
  workspace_id: asString(row.workspace_id),
  source_id: asString(row.source_id),
  execution_id: asNullableString(row.execution_id),
  interaction_id: asNullableString(row.interaction_id),
  strategy: asString(row.strategy),
  status: asString(row.status) as LegacySourceAuthSessionRow["status"],
  endpoint: asString(row.endpoint),
  state: asString(row.state),
  redirect_uri: asString(row.redirect_uri),
  scope: asNullableString(row.scope),
  resource_metadata_url: asNullableString(row.resource_metadata_url),
  authorization_server_url: asNullableString(row.authorization_server_url),
  resource_metadata_json: asNullableString(row.resource_metadata_json),
  authorization_server_metadata_json: asNullableString(row.authorization_server_metadata_json),
  client_information_json: asNullableString(row.client_information_json),
  code_verifier: asNullableString(row.code_verifier),
  authorization_url: asNullableString(row.authorization_url),
  error_text: asNullableString(row.error_text),
  completed_at: asNullableNumber(row.completed_at),
  created_at: asNumber(row.created_at),
  updated_at: asNumber(row.updated_at),
});

const decodeLegacyToolArtifactRow = (row: LegacyRow): LegacyToolArtifactRow => ({
  workspace_id: asString(row.workspace_id),
  path: asString(row.path),
  tool_id: asString(row.tool_id),
  source_id: asString(row.source_id),
  title: asNullableString(row.title),
  description: asNullableString(row.description),
  search_namespace: asString(row.search_namespace),
  search_text: asString(row.search_text),
  input_schema_json: asNullableString(row.input_schema_json),
  output_schema_json: asNullableString(row.output_schema_json),
  provider_kind: asString(row.provider_kind),
  mcp_tool_name: asNullableString(row.mcp_tool_name),
  created_at: asNumber(row.created_at),
  updated_at: asNumber(row.updated_at),
});

const isPostgresUrl = (value: string | undefined): boolean => {
  const trimmed = trimOrNull(value);
  return trimmed !== null
    && (trimmed.startsWith("postgres://") || trimmed.startsWith("postgresql://"));
};

const cleanupStalePGliteLock = async (dataDir: string): Promise<void> => {
  const lockPath = join(dataDir, "postmaster.pid");
  if (!existsSync(lockPath)) {
    return;
  }

  try {
    const firstLine = readFileSync(lockPath, "utf8").split("\n")[0]?.trim();
    const pid = Number(firstLine);
    if (!Number.isNaN(pid) && pid > 0) {
      return;
    }
  } catch {
    // Best effort only.
  }

  try {
    await unlink(lockPath);
  } catch {
    // Best effort only.
  }
};

const openLegacyPGliteClient = async (
  localDataDir: string,
): Promise<LegacyQueryClient | null> => {
  if (localDataDir.trim() === ":memory:") {
    return null;
  }

  const resolvedDataDir = resolve(localDataDir);
  if (!existsSync(resolvedDataDir)) {
    return null;
  }

  await mkdir(resolvedDataDir, { recursive: true });
  await cleanupStalePGliteLock(resolvedDataDir);
  const client = new PGlite(resolvedDataDir);

  return {
    label: `pglite:${resolvedDataDir}`,
    query: async (sql) => normalizeLegacyRows(await client.query(sql)),
    close: () => client.close(),
  };
};

const openLegacyPostgresClient = (
  databaseUrl: string,
): LegacyQueryClient => {
  const client = postgres(databaseUrl, {
    prepare: false,
    max: 1,
  });

  return {
    label: "postgres",
    query: async (sql) => normalizeLegacyRows(await client.unsafe(sql)),
    close: () => client.end({ timeout: 5 }).then(() => undefined),
  };
};

const queryLegacyTable = async (
  client: LegacyQueryClient,
  tableName: string,
): Promise<LegacyRow[]> =>
  client.query(`select * from ${tableName}`);

const hasLegacySchema = async (client: LegacyQueryClient): Promise<boolean> => {
  try {
    await client.query("select * from local_installations limit 1");
    return true;
  } catch {
    return false;
  }
};

const loadLegacyWorkspaceSnapshot = async (
  client: LegacyQueryClient,
): Promise<LegacyWorkspaceSnapshot | null> => {
  const installationRows = (await queryLegacyTable(client, "local_installations"))
    .map(decodeLegacyLocalInstallationRow);
  const installation = installationRows.find((row) => row.id === LEGACY_LOCAL_INSTALLATION_ID)
    ?? installationRows[0]
    ?? null;
  if (installation === null) {
    return null;
  }

  const [
    workspaces,
    sources,
    credentials,
    sourceCredentialBindings,
    secretMaterials,
    policies,
    executions,
    executionInteractions,
    sourceAuthSessions,
    toolArtifacts,
  ] = await Promise.all([
    queryLegacyTable(client, "workspaces"),
    queryLegacyTable(client, "sources"),
    queryLegacyTable(client, "credentials"),
    queryLegacyTable(client, "source_credential_bindings"),
    queryLegacyTable(client, "secret_materials"),
    queryLegacyTable(client, "policies"),
    queryLegacyTable(client, "executions"),
    queryLegacyTable(client, "execution_interactions"),
    queryLegacyTable(client, "source_auth_sessions"),
    queryLegacyTable(client, "tool_artifacts"),
  ]);

  const workspaceId = installation.workspace_id;
  const sourceRows = sources
    .map(decodeLegacySourceRow)
    .filter((row) => row.workspace_id === workspaceId);
  const credentialRows = credentials
    .map(decodeLegacyCredentialRow)
    .filter((row) => row.workspace_id === workspaceId);
  const bindingRows = sourceCredentialBindings
    .map(decodeLegacySourceCredentialBindingRow)
    .filter((row) => row.workspace_id === workspaceId);
  const policyRows = policies
    .map(decodeLegacyPolicyRow)
    .filter((row) => row.workspace_id === workspaceId);
  const executionRows = executions
    .map(decodeLegacyExecutionRow)
    .filter((row) => row.workspace_id === workspaceId);
  const executionIds = new Set(executionRows.map((row) => row.id));
  const sessionRows = sourceAuthSessions
    .map(decodeLegacySourceAuthSessionRow)
    .filter((row) => row.workspace_id === workspaceId);
  const toolArtifactRows = toolArtifacts
    .map(decodeLegacyToolArtifactRow)
    .filter((row) => row.workspace_id === workspaceId);
  const secretIds = new Set<string>();

  for (const credential of credentialRows) {
    if (
      credential.token_provider_id === LEGACY_POSTGRES_SECRET_PROVIDER_ID
      && credential.token_handle.length > 0
    ) {
      secretIds.add(credential.token_handle);
    }

    if (
      credential.refresh_token_provider_id === LEGACY_POSTGRES_SECRET_PROVIDER_ID
      && credential.refresh_token_handle
    ) {
      secretIds.add(credential.refresh_token_handle);
    }
  }

  const secretMaterialRows = secretMaterials
    .map(decodeLegacySecretMaterialRow)
    .filter((row) => secretIds.has(row.id));

  return {
    installation,
    workspace:
      workspaces
        .map(decodeLegacyWorkspaceRow)
        .find((row) => row.id === workspaceId)
      ?? null,
    sources: sourceRows,
    credentials: credentialRows,
    sourceCredentialBindings: bindingRows,
    secretMaterials: secretMaterialRows,
    policies: policyRows,
    executions: executionRows,
    executionInteractions: executionInteractions
      .map(decodeLegacyExecutionInteractionRow)
      .filter((row) => executionIds.has(row.execution_id)),
    sourceAuthSessions: sessionRows,
    toolArtifacts: toolArtifactRows,
  };
};

const tryLoadLegacyWorkspaceSnapshot = async (input: {
  localDataDir?: string;
  databaseUrl?: string;
}): Promise<LegacyWorkspaceSnapshot | null> => {
  const clients: LegacyQueryClient[] = [];

  try {
    if (trimOrNull(input.localDataDir) !== null) {
      const localClient = await openLegacyPGliteClient(input.localDataDir!);
      if (localClient !== null) {
        clients.push(localClient);
      }
    }

    if (clients.length === 0 && isPostgresUrl(input.databaseUrl)) {
      clients.push(openLegacyPostgresClient(input.databaseUrl!));
    }

    for (const client of clients) {
      try {
        if (!(await hasLegacySchema(client))) {
          continue;
        }

        return await loadLegacyWorkspaceSnapshot(client);
      } catch {
        continue;
      }
    }

    return null;
  } finally {
    await Promise.all(
      clients.map((client) =>
        client.close().catch(() => undefined)),
    );
  }
};

const targetControlPlaneStatePath = (context: ResolvedLocalWorkspaceContext): string =>
  join(
    context.homeStateDirectory,
    "workspaces",
    deriveLocalInstallation(context).workspaceId,
    LOCAL_CONTROL_PLANE_STATE_BASENAME,
  );

const targetWorkspaceStatePath = (context: ResolvedLocalWorkspaceContext): string =>
  join(context.stateDirectory, WORKSPACE_STATE_BASENAME);

const workspaceAlreadyInitialized = (
  context: ResolvedLocalWorkspaceContext,
): boolean =>
  existsSync(context.projectConfigPath)
  || existsSync(targetWorkspaceStatePath(context))
  || existsSync(targetControlPlaneStatePath(context));

const mapLegacySecretRef = (input: {
  providerId: string;
  handle: string;
}) => ({
  providerId:
    input.providerId === LEGACY_POSTGRES_SECRET_PROVIDER_ID
      ? LOCAL_SECRET_PROVIDER_ID
      : input.providerId,
  handle: input.handle,
});

const matchesLegacyPattern = (
  pattern: string,
  value: string,
  matchType: string,
): boolean => {
  if (matchType === "exact") {
    return pattern === value;
  }

  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
};

const namespacePatternToToolPattern = (
  pattern: string,
  matchType: string,
): string | null => {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed === "*") {
    return "*";
  }

  if (matchType === "exact" || !trimmed.includes("*")) {
    return `${trimmed}.*`;
  }

  return trimmed;
};

const buildSourceAuth = (
  credential: LegacyCredentialRow | null,
): SourceAuth => {
  if (credential === null) {
    return { kind: "none" };
  }

  if (credential.auth_kind === "oauth2") {
    return {
      kind: "oauth2",
      headerName: credential.auth_header_name,
      prefix: credential.auth_prefix,
      accessToken: mapLegacySecretRef({
        providerId: credential.token_provider_id,
        handle: credential.token_handle,
      }),
      refreshToken:
        credential.refresh_token_provider_id && credential.refresh_token_handle
          ? mapLegacySecretRef({
              providerId: credential.refresh_token_provider_id,
              handle: credential.refresh_token_handle,
            })
          : null,
    };
  }

  return {
    kind: "bearer",
    headerName: credential.auth_header_name,
    prefix: credential.auth_prefix,
    token: mapLegacySecretRef({
      providerId: credential.token_provider_id,
      handle: credential.token_handle,
    }),
  };
};

const validateMigratedSource = (input: {
  workspaceId: Source["workspaceId"];
  row: LegacySourceRow;
  credential: LegacyCredentialRow | null;
}): Source | null => {
  if (!isMigratableLegacySourceKind(input.row.kind)) {
    return null;
  }

  const kind = input.row.kind;
  const namespace = stableSourceNamespace(input.row);
  const binding: Source["binding"] =
    kind === "mcp"
      ? {
          transport: input.row.transport,
          queryParams: asStringMap(input.row.query_params_json) ?? null,
          headers: asStringMap(input.row.headers_json) ?? null,
        }
      : kind === "openapi"
        ? {
            specUrl: input.row.spec_url ?? input.row.endpoint,
            defaultHeaders: asStringMap(input.row.default_headers_json) ?? null,
          }
        : {
            defaultHeaders: asStringMap(input.row.default_headers_json) ?? null,
          };
  const baseSource = {
    id: input.row.source_id as Source["id"],
    workspaceId: input.workspaceId,
    name: input.row.name,
    kind,
    endpoint: input.row.endpoint,
    status: input.row.status as Source["status"],
    enabled: input.row.enabled,
    namespace,
    bindingVersion: getSourceAdapter(kind).bindingConfigVersion,
    binding,
    importAuthPolicy: "reuse_runtime" as const,
    importAuth: { kind: "none" } as const,
    auth: buildSourceAuth(input.credential),
    sourceHash: input.row.source_hash,
    lastError: input.row.last_error,
    createdAt: input.row.created_at,
    updatedAt: input.row.updated_at,
  } satisfies Source;

  return Effect.runSync(
    getSourceAdapter(kind).validateSource(baseSource),
  );
};

const configSourceFromMigratedSource = (
  source: Source,
): LocalConfigSourceEntry => {
  const binding = cloneJson(source.binding) as Record<string, unknown>;
  const common = {
    ...(trimOrNull(source.name) !== trimOrNull(source.id) ? { name: source.name } : {}),
    ...(trimOrNull(source.namespace) !== trimOrNull(source.id)
      ? { namespace: source.namespace ?? undefined }
      : {}),
    ...(source.enabled === false ? { enabled: false } : {}),
    connection: {
      endpoint: source.endpoint,
    },
  };

  switch (source.kind) {
    case "mcp":
      return {
        kind: "mcp",
        ...common,
        binding: {
          transport: (binding.transport as SourceTransport | null | undefined) ?? null,
          queryParams:
            (binding.queryParams as Record<string, string> | null | undefined) ?? null,
          headers:
            (binding.headers as Record<string, string> | null | undefined) ?? null,
        },
      };
    case "openapi":
      return {
        kind: "openapi",
        ...common,
        binding: {
          specUrl: String(binding.specUrl ?? source.endpoint),
          defaultHeaders:
            (binding.defaultHeaders as Record<string, string> | null | undefined) ?? null,
        },
      };
    case "graphql":
      return {
        kind: "graphql",
        ...common,
        binding: {
          defaultHeaders:
            (binding.defaultHeaders as Record<string, string> | null | undefined) ?? null,
        },
      };
    default:
      throw new Error(`Unsupported migrated source kind: ${source.kind}`);
  }
};

const buildMigratedPolicyEntries = (input: {
  policies: readonly LegacyPolicyRow[];
  workspaceId: Source["workspaceId"];
  sources: readonly Source[];
}): MigratedPolicyEntry[] => {
  const usedKeys = new Set<string>();
  const entries: MigratedPolicyEntry[] = [];
  const seenPatterns = new Set<string>();

  for (const policy of input.policies) {
    if (
      policy.scope_type !== "workspace"
      || policy.target_account_id !== null
      || policy.client_id !== null
      || policy.argument_conditions_json !== null
    ) {
      continue;
    }

    const patterns = (() => {
      if (policy.resource_type === "all_tools") {
        return ["*"];
      }

      if (policy.resource_type === "tool_path") {
        return policy.resource_pattern.trim().length > 0
          ? [policy.resource_pattern.trim()]
          : [];
      }

      if (policy.resource_type === "namespace") {
        const pattern = namespacePatternToToolPattern(
          policy.resource_pattern,
          policy.match_type,
        );
        return pattern ? [pattern] : [];
      }

      if (policy.resource_type === "source") {
        const matchedNamespaces = input.sources
          .filter((source) =>
            matchesLegacyPattern(policy.resource_pattern, source.id, policy.match_type)
            || matchesLegacyPattern(
              policy.resource_pattern,
              `source:${source.id}`,
              policy.match_type,
            ))
          .map((source) => `${source.namespace ?? source.id}.*`);

        return [...new Set(matchedNamespaces)];
      }

      return [];
    })();

    for (const resourcePattern of patterns) {
      const dedupeKey = [
        resourcePattern,
        policy.effect,
        policy.approval_mode,
        String(policy.priority),
        String(policy.enabled),
        String(policy.id),
      ].join("::");
      if (seenPatterns.has(dedupeKey)) {
        continue;
      }
      seenPatterns.add(dedupeKey);

      const key = derivePolicyConfigKey(
        {
          resourcePattern,
          effect: policy.effect === "deny" ? "deny" : "allow",
          approvalMode: policy.approval_mode === "required" ? "required" : "auto",
        },
        usedKeys,
      );

      entries.push({
        key,
        config: {
          match: resourcePattern,
          action: policy.effect === "deny" ? "deny" : "allow",
          approval: policy.approval_mode === "required" ? "manual" : "auto",
          ...(policy.enabled === false ? { enabled: false } : {}),
          ...(policy.priority !== 0 ? { priority: policy.priority } : {}),
        },
        state: {
          id: policy.id as LocalWorkspaceState["policies"][string]["id"],
          createdAt: policy.created_at,
          updatedAt: policy.updated_at,
        },
      });
    }
  }

  return entries;
};

const rewriteLegacyScopedJson = (input: {
  value: string | null;
  oldWorkspaceId: string;
  newWorkspaceId: string;
  oldAccountId: string;
  newAccountId: string;
}): string | null => {
  if (input.value === null) {
    return null;
  }

  return input.value
    .replaceAll(input.oldWorkspaceId, input.newWorkspaceId)
    .replaceAll(input.oldAccountId, input.newAccountId);
};

const buildMigratedMcpArtifact = (input: {
  source: Source;
  row: LegacySourceRow;
  toolArtifacts: readonly LegacyToolArtifactRow[];
}): LocalSourceArtifact | null => {
  const sourceArtifacts = input.toolArtifacts.filter((artifact) => artifact.source_id === input.source.id);
  if (sourceArtifacts.length === 0) {
    return null;
  }

  const operations: McpCatalogOperationInput[] = sourceArtifacts.map((artifact) => ({
    toolId: artifact.tool_id,
    title: artifact.title ?? artifact.mcp_tool_name ?? artifact.tool_id,
    description: artifact.description,
    // Legacy MCP descriptors did not store readOnly/destructive hints. Preserve
    // allow-by-default behavior by treating them as generic reads.
    effect: "read",
    inputSchema: safeJsonParse<unknown>(artifact.input_schema_json),
    outputSchema: safeJsonParse<unknown>(artifact.output_schema_json),
    providerData: {
      toolId: artifact.tool_id,
      toolName: artifact.mcp_tool_name ?? artifact.title ?? artifact.tool_id,
      displayTitle: artifact.title ?? artifact.mcp_tool_name ?? artifact.tool_id,
      title: artifact.title,
      description: artifact.description,
      annotations: null,
      execution: null,
      icons: null,
      meta: null,
      rawTool: null,
      server: null,
    },
  }));

  const manifestLikeDocument = JSON.stringify({
    tools: sourceArtifacts.map((artifact) => ({
      toolId: artifact.tool_id,
      toolName: artifact.mcp_tool_name ?? artifact.title ?? artifact.tool_id,
      title: artifact.title,
      description: artifact.description,
      inputSchema: safeJsonParse<unknown>(artifact.input_schema_json) ?? null,
      outputSchema: safeJsonParse<unknown>(artifact.output_schema_json) ?? null,
    })),
  }, null, 2);

  const artifactSource = {
    ...input.source,
    sourceHash: input.row.source_hash ?? contentHash(manifestLikeDocument),
  };

  return buildLocalSourceArtifact({
    source: artifactSource,
    syncResult: createSourceCatalogSyncResult({
      fragment: createMcpCatalogFragment({
        source: artifactSource,
        documents: [{
          documentKind: "mcp_manifest",
          documentKey: input.source.endpoint,
          contentText: manifestLikeDocument,
          fetchedAt: input.row.updated_at,
        }],
        operations,
      }),
      importMetadata: createCatalogImportMetadata({
        source: artifactSource,
        adapterKey: "mcp",
      }),
      sourceHash: artifactSource.sourceHash,
    }),
  });
};

const buildMigratedOpenApiArtifact = async (input: {
  source: Source;
  row: LegacySourceRow;
}): Promise<LocalSourceArtifact | null> => {
  if (input.row.source_document_text === null) {
    return null;
  }

  const manifest = await Effect.runPromise(
    extractOpenApiManifest(input.source.name, input.row.source_document_text),
  );
  const refHintTable = (manifest as { refHintTable?: Readonly<OpenApiRefHintTable> }).refHintTable;
  const operations: OpenApiCatalogOperationInput[] = compileOpenApiToolDefinitions(manifest).map(
    (definition) => {
      const presentation = buildOpenApiToolPresentation({
        definition,
        refHintTable,
      });
      const method = definition.method.toUpperCase();

      return {
        toolId: definition.toolId,
        title: definition.name,
        description: definition.description,
        effect:
          method === "GET" || method === "HEAD"
            ? "read"
            : method === "DELETE"
              ? "delete"
              : "write",
        inputSchema: presentation.inputSchema,
        outputSchema: presentation.outputSchema,
        providerData: presentation.providerData as OpenApiToolProviderData,
      };
    },
  );

  const artifactSource = {
    ...input.source,
    sourceHash: manifest.sourceHash,
  };

  return buildLocalSourceArtifact({
    source: artifactSource,
    syncResult: createSourceCatalogSyncResult({
      fragment: createOpenApiCatalogFragment({
        source: artifactSource,
        documents: [{
          documentKind: "openapi",
          documentKey: input.row.spec_url ?? input.source.endpoint,
          contentText: input.row.source_document_text,
          fetchedAt: input.row.updated_at,
        }],
        operations,
      }),
      importMetadata: createCatalogImportMetadata({
        source: artifactSource,
        adapterKey: "openapi",
      }),
      sourceHash: manifest.sourceHash,
    }),
  });
};

const buildMigratedGraphqlArtifact = async (input: {
  source: Source;
  row: LegacySourceRow;
}): Promise<LocalSourceArtifact | null> => {
  if (input.row.source_document_text === null) {
    return null;
  }

  const manifest = await Effect.runPromise(
    extractGraphqlManifest(input.source.name, input.row.source_document_text),
  );
  const operations: GraphqlCatalogOperationInput[] = compileGraphqlToolDefinitions(manifest).map(
    (definition) => {
      const presentation = buildGraphqlToolPresentation({
        manifest,
        definition,
      });

      return {
        toolId: definition.toolId,
        title: definition.name,
        description: definition.description,
        effect: definition.operationType === "query" ? "read" : "write",
        inputSchema: presentation.inputSchema,
        outputSchema: presentation.outputSchema,
        providerData: presentation.providerData as GraphqlToolProviderData,
      };
    },
  );

  const artifactSource = {
    ...input.source,
    sourceHash: manifest.sourceHash,
  };

  return buildLocalSourceArtifact({
    source: artifactSource,
    syncResult: createSourceCatalogSyncResult({
      fragment: createGraphqlCatalogFragment({
        source: artifactSource,
        documents: [{
          documentKind: "graphql_introspection",
          documentKey: input.source.endpoint,
          contentText: input.row.source_document_text,
          fetchedAt: input.row.updated_at,
        }],
        operations,
      }),
      importMetadata: createCatalogImportMetadata({
        source: artifactSource,
        adapterKey: "graphql",
      }),
      sourceHash: manifest.sourceHash,
    }),
  });
};

const buildMigratedSourceArtifact = async (input: {
  source: Source;
  row: LegacySourceRow;
  toolArtifacts: readonly LegacyToolArtifactRow[];
}): Promise<LocalSourceArtifact | null> => {
  switch (input.source.kind) {
    case "mcp":
      return buildMigratedMcpArtifact(input);
    case "openapi":
      return buildMigratedOpenApiArtifact(input);
    case "graphql":
      return buildMigratedGraphqlArtifact(input);
    default:
      return null;
  }
};

const migrateLegacyWorkspace = async (input: {
  context: ResolvedLocalWorkspaceContext;
  snapshot: LegacyWorkspaceSnapshot;
}): Promise<MigratedWorkspace> => {
  const installation = deriveLocalInstallation(input.context);
  const targetWorkspaceId = installation.workspaceId;
  const targetAccountId = installation.accountId;
  const bindingBySourceId = new Map(
    input.snapshot.sourceCredentialBindings.map((binding) => [binding.source_id, binding] as const),
  );
  const credentialsById = new Map(
    input.snapshot.credentials.map((credential) => [credential.id, credential] as const),
  );
  const migratedSources: Source[] = [];
  const projectConfigSources: Record<string, LocalConfigSourceEntry> = {};
  const workspaceStateSources: Record<string, LocalWorkspaceSourceState> = {};

  for (const row of input.snapshot.sources) {
    const binding = bindingBySourceId.get(row.source_id) ?? null;
    const credential = binding ? credentialsById.get(binding.credential_id) ?? null : null;
    const source = validateMigratedSource({
      workspaceId: targetWorkspaceId,
      row,
      credential,
    });
    if (source === null) {
      continue;
    }

    migratedSources.push(source);
    projectConfigSources[source.id] = configSourceFromMigratedSource(source);
    workspaceStateSources[source.id] = {
      status: source.status,
      lastError: source.lastError,
      sourceHash: source.sourceHash,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    };
  }

  const migratedPolicies = buildMigratedPolicyEntries({
    policies: input.snapshot.policies,
    workspaceId: targetWorkspaceId,
    sources: migratedSources,
  });

  const projectConfig: LocalExecutorConfig = {
    ...(Object.keys(projectConfigSources).length > 0 ? { sources: projectConfigSources } : {}),
    ...(migratedPolicies.length > 0
      ? {
          policies: Object.fromEntries(
            migratedPolicies.map((policy) => [policy.key, policy.config] as const),
          ),
        }
      : {}),
  };

  const workspaceState: LocalWorkspaceState = {
    version: 1,
    sources: workspaceStateSources,
    policies: Object.fromEntries(
      migratedPolicies.map((policy) => [policy.key, policy.state] as const),
    ),
  };

  const secretMaterials: SecretMaterial[] = input.snapshot.secretMaterials.map((material) => ({
    id: material.id as SecretMaterial["id"],
    name: material.name,
    purpose: material.purpose,
    providerId: LOCAL_SECRET_PROVIDER_ID,
    handle: material.id,
    value: material.value,
    createdAt: material.created_at,
    updatedAt: material.updated_at,
  }));

  const authArtifacts = migratedSources
    .map((source) =>
      authArtifactFromSourceAuth({
        source,
        auth: source.auth,
        slot: "runtime",
        actorAccountId: null,
        existingAuthArtifactId: AuthArtifactIdSchema.make(
          `auth_art_migrated_${source.id}_runtime`,
        ),
      }))
    .filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null);

  const executionIdSet = new Set(input.snapshot.executions.map((execution) => execution.id));

  const controlPlaneState: LocalControlPlaneState = {
    version: 1,
    authArtifacts,
    authLeases: [],
    sourceOauthClients: [],
    workspaceOauthClients: [],
    providerAuthGrants: [],
    sourceAuthSessions: input.snapshot.sourceAuthSessions
      .filter((session) => session.strategy === "oauth2_authorization_code")
      .filter((session) => migratedSources.some((source) => source.id === session.source_id))
      .map((session) => ({
        id: session.id as SourceAuthSession["id"],
        workspaceId: targetWorkspaceId,
        sourceId: session.source_id as SourceAuthSession["sourceId"],
        actorAccountId: null,
        credentialSlot: "runtime",
        executionId: session.execution_id as SourceAuthSession["executionId"],
        interactionId: session.interaction_id as SourceAuthSession["interactionId"],
        providerKind: "mcp_oauth",
        status: session.status,
        state: session.state,
        sessionDataJson: encodeMcpSourceAuthSessionData({
          kind: "mcp_oauth",
          endpoint: session.endpoint,
          redirectUri: session.redirect_uri,
          scope: session.scope,
          resourceMetadataUrl: session.resource_metadata_url,
          authorizationServerUrl: session.authorization_server_url,
          resourceMetadata:
            safeJsonParse<JsonObject>(session.resource_metadata_json) ?? null,
          authorizationServerMetadata:
            safeJsonParse<JsonObject>(session.authorization_server_metadata_json) ?? null,
          clientInformation:
            safeJsonParse<JsonObject>(session.client_information_json) ?? null,
          codeVerifier: session.code_verifier,
          authorizationUrl: session.authorization_url,
        }),
        errorText: session.error_text,
        completedAt: session.completed_at,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      })),
    secretMaterials,
    executions: input.snapshot.executions.map((execution) => ({
      id: execution.id as Execution["id"],
      workspaceId: targetWorkspaceId,
      createdByAccountId: targetAccountId,
      status: execution.status,
      code: execution.code,
      resultJson: rewriteLegacyScopedJson({
        value: execution.result_json,
        oldWorkspaceId: input.snapshot.installation.workspace_id,
        newWorkspaceId: targetWorkspaceId,
        oldAccountId: input.snapshot.installation.account_id,
        newAccountId: targetAccountId,
      }),
      errorText: execution.error_text,
      logsJson: execution.logs_json,
      startedAt: execution.started_at,
      completedAt: execution.completed_at,
      createdAt: execution.created_at,
      updatedAt: execution.updated_at,
    })),
    executionInteractions: input.snapshot.executionInteractions
      .filter((interaction) => executionIdSet.has(interaction.execution_id))
      .map((interaction) => ({
        id: interaction.id as ExecutionInteraction["id"],
        executionId: interaction.execution_id as ExecutionInteraction["executionId"],
        status: interaction.status,
        kind: interaction.kind,
        purpose: interaction.purpose,
        payloadJson: rewriteLegacyScopedJson({
          value: interaction.payload_json,
          oldWorkspaceId: input.snapshot.installation.workspace_id,
          newWorkspaceId: targetWorkspaceId,
          oldAccountId: input.snapshot.installation.account_id,
          newAccountId: targetAccountId,
        }) ?? interaction.payload_json,
        responseJson: rewriteLegacyScopedJson({
          value: interaction.response_json,
          oldWorkspaceId: input.snapshot.installation.workspace_id,
          newWorkspaceId: targetWorkspaceId,
          oldAccountId: input.snapshot.installation.account_id,
          newAccountId: targetAccountId,
        }),
        responsePrivateJson: null,
        createdAt: interaction.created_at,
        updatedAt: interaction.updated_at,
      })),
    executionSteps: [],
  };

  const legacySourceById = new Map(
    input.snapshot.sources.map((row) => [row.source_id, row] as const),
  );
  const sourceArtifacts: Array<{
    sourceId: Source["id"];
    artifact: LocalSourceArtifact;
  }> = [];

  for (const source of migratedSources) {
    const legacyRow = legacySourceById.get(source.id);
    if (!legacyRow) {
      continue;
    }

    const artifact = await buildMigratedSourceArtifact({
      source,
      row: legacyRow,
      toolArtifacts: input.snapshot.toolArtifacts,
    });
    if (artifact === null) {
      continue;
    }

    sourceArtifacts.push({
      sourceId: source.id,
      artifact,
    });
  }

  return {
    projectConfig,
    workspaceState,
    controlPlaneState,
    sourceArtifacts,
    sourceCount: migratedSources.length,
    policyCount: migratedPolicies.length,
  };
};

export const migrateLegacyPostgresWorkspaceIfNeeded = (input: {
  context: ResolvedLocalWorkspaceContext;
  legacyLocalDataDir?: string;
  legacyDatabaseUrl?: string;
}): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (workspaceAlreadyInitialized(input.context)) {
      return;
    }

    const snapshot = yield* Effect.tryPromise({
      try: () =>
        tryLoadLegacyWorkspaceSnapshot({
          localDataDir: input.legacyLocalDataDir,
          databaseUrl: input.legacyDatabaseUrl,
        }),
      catch: toError,
    });
    if (snapshot === null) {
      return;
    }

    const migrated = yield* Effect.tryPromise({
      try: () =>
        migrateLegacyWorkspace({
          context: input.context,
          snapshot,
        }),
      catch: toError,
    });

    yield* writeProjectLocalExecutorConfig({
      context: input.context,
      config: migrated.projectConfig,
    });
    yield* writeLocalWorkspaceState({
      context: input.context,
      state: migrated.workspaceState,
    });
    yield* writeLocalControlPlaneState({
      context: input.context,
      state: migrated.controlPlaneState,
    });
    yield* Effect.forEach(
      migrated.sourceArtifacts,
      ({ sourceId, artifact }) =>
        writeLocalSourceArtifact({
          context: input.context,
          sourceId,
          artifact,
        }),
      { discard: true },
    );

    yield* Effect.sync(() => {
      console.warn(
        `[executor] Migrated ${String(migrated.sourceCount)} legacy source(s) and ${String(migrated.policyCount)} policy/policies into ${input.context.projectConfigPath}`,
      );
    });
  });
