import {
  PersistentToolApprovalPolicyStoreError,
  ToolProviderError,
  createPersistentToolApprovalPolicy,
  createSourceToolRegistry,
  makeOpenApiToolProvider,
  makeToolProviderRegistry,
  type PersistentToolApprovalRecord,
  type PersistentToolApprovalStore,
  type ToolApprovalPolicy,
  type ToolDiscoveryResult,
  type ToolProvider,
} from "@executor-v2/engine";

import {
  SourceStoreError,
  ToolArtifactStoreError,
  type SourceStore,
  type ToolArtifactStore,
} from "@executor-v2/persistence-ports";
import {
  ApprovalSchema,
  OpenApiInvocationPayloadSchema,
  OpenApiToolManifestSchema,
  SourceSchema,
  ToolArtifactSchema,
  type Approval,
  type CanonicalToolDescriptor,
  type Source,
  type SourceId,
  type ToolArtifact,
  type WorkspaceId,
} from "@executor-v2/schema";
import { v } from "convex/values";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";

import { api, internal } from "./_generated/api";
import { internalMutation, query, type ActionCtx } from "./_generated/server";

const runtimeApi = api as any;
const runtimeInternal = internal as any;

const decodeSource = Schema.decodeUnknownSync(SourceSchema);
const decodeToolArtifact = Schema.decodeUnknownSync(ToolArtifactSchema);
const decodeOpenApiToolManifest = Schema.decodeUnknownSync(OpenApiToolManifestSchema);
const encodeOpenApiToolManifestJson = Schema.encodeSync(
  Schema.parseJson(OpenApiToolManifestSchema),
);
const decodeApproval = Schema.decodeUnknownSync(ApprovalSchema);

const defaultPendingRetryAfterMs = 1_000;
const openApiExtractorVersion = "openapi_v2";

const readBooleanFlag = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const requireToolApprovalsByDefault = readBooleanFlag(
  process.env.CONVEX_REQUIRE_TOOL_APPROVALS,
);

const serializeInputPreview = (input: Record<string, unknown> | undefined): string => {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "{}";
  }
};

const toPersistentApprovalStoreError = (
  operation: string,
  message: string,
  details: string | null,
): PersistentToolApprovalPolicyStoreError =>
  new PersistentToolApprovalPolicyStoreError({
    operation,
    message,
    details,
  });

const toPersistentApprovalRecord = (
  approval: Approval,
): PersistentToolApprovalRecord => ({
  approvalId: approval.id,
  workspaceId: approval.workspaceId,
  runId: approval.taskRunId,
  callId: approval.callId,
  toolPath: approval.toolPath,
  status: approval.status,
  reason: approval.reason,
});

const stripConvexSystemFields = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...rest } = value;
  return rest;
};

const unsupportedSourceStoreMutation = (
  operation: "upsert" | "removeById",
): SourceStoreError =>
  new SourceStoreError({
    operation,
    backend: "convex",
    location: "source-tool-registry",
    message: `SourceStore.${operation} is not supported in source tool registry runtime`,
    reason: "unsupported_operation",
    details: null,
  });

const sourceStoreQueryError = (
  operation: string,
  cause: unknown,
): SourceStoreError =>
  new SourceStoreError({
    operation,
    backend: "convex",
    location: "source-tool-registry",
    message: "SourceStore query failed",
    reason: "convex_query_error",
    details: String(cause),
  });

const toolArtifactStoreQueryError = (
  operation: string,
  cause: unknown,
): ToolArtifactStoreError =>
  new ToolArtifactStoreError({
    operation,
    backend: "convex",
    location: "source-tool-registry",
    message: "ToolArtifactStore query failed",
    reason: "convex_query_error",
    details: String(cause),
  });

const toolArtifactStoreMutationError = (
  operation: string,
  cause: unknown,
): ToolArtifactStoreError =>
  new ToolArtifactStoreError({
    operation,
    backend: "convex",
    location: "source-tool-registry",
    message: "ToolArtifactStore mutation failed",
    reason: "convex_mutation_error",
    details: String(cause),
  });

const decodeOpenApiInvocationPayload = Schema.decodeUnknownSync(OpenApiInvocationPayloadSchema);

const GraphqlInvocationArgSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  required: Schema.Boolean,
  type: Schema.String,
  defaultValue: Schema.NullOr(Schema.String),
});

const GraphqlRawInvocationSchema = Schema.Struct({
  kind: Schema.Literal("graphql_raw"),
  endpoint: Schema.String,
});

const GraphqlFieldInvocationSchema = Schema.Struct({
  kind: Schema.Literal("graphql_field"),
  endpoint: Schema.String,
  operationType: Schema.Literal("query", "mutation"),
  fieldName: Schema.String,
  args: Schema.Array(GraphqlInvocationArgSchema),
});

const GraphqlInvocationPayloadSchema = Schema.Union(
  GraphqlRawInvocationSchema,
  GraphqlFieldInvocationSchema,
);

type GraphqlInvocationPayload = typeof GraphqlInvocationPayloadSchema.Type;

const decodeGraphqlInvocationPayload = Schema.decodeUnknownSync(GraphqlInvocationPayloadSchema);

const McpInvocationPayloadSchema = Schema.Struct({
  kind: Schema.Literal("mcp_tool"),
  endpoint: Schema.String,
  transport: Schema.Literal("streamable-http", "sse"),
  queryParams: Schema.Record({
    key: Schema.String,
    value: Schema.String,
  }),
  toolName: Schema.String,
  inputSchema: Schema.optional(Schema.Unknown),
  outputSchema: Schema.optional(Schema.Unknown),
});

type McpInvocationPayload = typeof McpInvocationPayloadSchema.Type;

const decodeMcpInvocationPayload = Schema.decodeUnknownSync(McpInvocationPayloadSchema);

const OpenApiRuntimeToolRowSchema = Schema.Struct({
  toolId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  invocationJson: Schema.String,
});

type OpenApiRuntimeToolRow = typeof OpenApiRuntimeToolRowSchema.Type;

const GraphqlRuntimeToolRowSchema = Schema.Struct({
  toolId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  invocationJson: Schema.String,
});

type GraphqlRuntimeToolRow = typeof GraphqlRuntimeToolRowSchema.Type;

const McpRuntimeToolRowSchema = Schema.Struct({
  toolId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  invocationJson: Schema.String,
});

type McpRuntimeToolRow = typeof McpRuntimeToolRowSchema.Type;

const decodeOpenApiRuntimeToolRow = Schema.decodeUnknownSync(OpenApiRuntimeToolRowSchema);
const decodeGraphqlRuntimeToolRow = Schema.decodeUnknownSync(GraphqlRuntimeToolRowSchema);
const decodeMcpRuntimeToolRow = Schema.decodeUnknownSync(McpRuntimeToolRowSchema);

const toToolProviderDetails = (cause: unknown): string =>
  ParseResult.isParseError(cause)
    ? ParseResult.TreeFormatter.formatErrorSync(cause)
    : String(cause);

const toToolProviderError = (
  providerKind: "openapi" | "graphql" | "mcp",
  operation: string,
  message: string,
  cause: unknown,
): ToolProviderError =>
  new ToolProviderError({
    providerKind,
    operation,
    message,
    details: toToolProviderDetails(cause),
  });

const jsonObjectFromUnknown = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

const safeJsonParse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const headersToRecord = (headers: Headers): Record<string, string> => {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
};

export const listSourcesForWorkspace = query({
  args: {
    workspaceId: v.string(),
  },
  handler: async (ctx, args): Promise<Array<Source>> => {
    const rows = await ctx.db
      .query("sources")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return rows.map((row) =>
      decodeSource(stripConvexSystemFields(row as unknown as Record<string, unknown>)),
    );
  },
});

export const getToolArtifactBySource = query({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args): Promise<ToolArtifact | null> => {
    const binding = await ctx.db
      .query("openApiSourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId)
      )
      .unique();

    if (!binding) {
      return null;
    }

    const toolRows = await ctx.db
      .query("openApiArtifactTools")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", binding.artifactId))
      .collect();

    const manifest = {
      version: 1 as const,
      sourceHash: binding.sourceHash,
      tools: toolRows
        .map((toolRow) => ({
          toolId: toolRow.toolId,
          name: toolRow.name,
          description: toolRow.description,
          method: toolRow.method,
          path: toolRow.path,
          invocation: JSON.parse(toolRow.invocationJson) as unknown,
          operationHash: toolRow.operationHash,
        }))
        .sort((left, right) => left.toolId.localeCompare(right.toolId)),
    };

    const normalizedManifest = decodeOpenApiToolManifest(manifest);

    return decodeToolArtifact({
      id: `tool_artifact_${args.sourceId}`,
      workspaceId: args.workspaceId,
      sourceId: args.sourceId,
      sourceHash: binding.sourceHash,
      toolCount: normalizedManifest.tools.length,
      manifestJson: encodeOpenApiToolManifestJson(normalizedManifest),
      createdAt: binding.updatedAt,
      updatedAt: binding.updatedAt,
    });
  },
});

export const listOpenApiToolsForSourceRuntime = query({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args): Promise<Array<OpenApiRuntimeToolRow>> => {
    const binding = await ctx.db
      .query("openApiSourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId)
      )
      .unique();

    if (!binding) {
      return [];
    }

    const rows = await ctx.db
      .query("openApiArtifactTools")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", binding.artifactId))
      .collect();

    return rows
      .map((row) => decodeOpenApiRuntimeToolRow(stripConvexSystemFields(row as Record<string, unknown>)))
      .sort((left, right) => left.toolId.localeCompare(right.toolId));
  },
});

export const listGraphqlToolsForSourceRuntime = query({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args): Promise<Array<GraphqlRuntimeToolRow>> => {
    const binding = await ctx.db
      .query("graphqlSourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId)
      )
      .unique();

    if (!binding) {
      return [];
    }

    const rows = await ctx.db
      .query("graphqlArtifactTools")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", binding.artifactId))
      .collect();

    return rows
      .map((row) => decodeGraphqlRuntimeToolRow(stripConvexSystemFields(row as Record<string, unknown>)))
      .sort((left, right) => left.toolId.localeCompare(right.toolId));
  },
});

export const listMcpToolsForSourceRuntime = query({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args): Promise<Array<McpRuntimeToolRow>> => {
    const binding = await ctx.db
      .query("mcpSourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId)
      )
      .unique();

    if (!binding) {
      return [];
    }

    const rows = await ctx.db
      .query("mcpArtifactTools")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", binding.artifactId))
      .collect();

    return rows
      .map((row) => decodeMcpRuntimeToolRow(stripConvexSystemFields(row as Record<string, unknown>)))
      .sort((left, right) => left.toolId.localeCompare(right.toolId));
  },
});

export const upsertToolArtifactForSource = internalMutation({
  args: {
    artifact: v.object({
      id: v.string(),
      workspaceId: v.string(),
      sourceId: v.string(),
      sourceHash: v.string(),
      toolCount: v.number(),
      manifestJson: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  },
  handler: async (ctx, args): Promise<ToolArtifact> => {
    const artifact = decodeToolArtifact(args.artifact as unknown as Record<string, unknown>);
    const manifest = decodeOpenApiToolManifest(JSON.parse(artifact.manifestJson) as unknown);

    const artifactId = `oa_${artifact.sourceHash}_${openApiExtractorVersion}`;
    const existingArtifact = await ctx.db
      .query("openApiArtifacts")
      .withIndex("by_sourceHash_extractorVersion", (q) =>
        q.eq("sourceHash", artifact.sourceHash).eq("extractorVersion", openApiExtractorVersion)
      )
      .unique();

    if (!existingArtifact) {
      const now = Date.now();
      await ctx.db.insert("openApiArtifacts", {
        id: artifactId,
        sourceHash: artifact.sourceHash,
        extractorVersion: openApiExtractorVersion,
        toolCount: manifest.tools.length,
        refHintTableJson: manifest.refHintTable
          ? JSON.stringify(manifest.refHintTable)
          : null,
        createdAt: now,
        updatedAt: now,
      });

      for (const tool of manifest.tools) {
        await ctx.db.insert("openApiArtifactTools", {
          id: `${artifactId}:${tool.toolId}`,
          artifactId,
          toolId: tool.toolId,
          name: tool.name,
          description: tool.description,
          method: tool.method,
          path: tool.path,
          operationHash: tool.operationHash,
          invocationJson: JSON.stringify(tool.invocation),
          inputSchemaJson: tool.typing?.inputSchemaJson ?? null,
          outputSchemaJson: tool.typing?.outputSchemaJson ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const existingBinding = await ctx.db
      .query("openApiSourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", artifact.workspaceId).eq("sourceId", artifact.sourceId)
      )
      .unique();

    const bindingRow = {
      id: existingBinding?.id ?? `oab_${artifact.workspaceId}_${artifact.sourceId}`,
      workspaceId: artifact.workspaceId,
      sourceId: artifact.sourceId,
      artifactId: existingArtifact?.id ?? artifactId,
      sourceHash: artifact.sourceHash,
      extractorVersion: openApiExtractorVersion,
      updatedAt: Date.now(),
    };

    if (existingBinding) {
      await ctx.db.patch(existingBinding._id, bindingRow);
    } else {
      await ctx.db.insert("openApiSourceArtifactBindings", bindingRow);
    }

    return artifact;
  },
});

const approvalModeValidator = v.union(v.literal("auto"), v.literal("required"));

export const evaluateToolApproval = internalMutation({
  args: {
    workspaceId: v.string(),
    runId: v.string(),
    callId: v.string(),
    toolPath: v.string(),
    inputPreviewJson: v.string(),
    defaultMode: approvalModeValidator,
    requireApprovals: v.optional(v.boolean()),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const taskRunRow = await ctx.db
      .query("taskRuns")
      .withIndex("by_domainId", (q) => q.eq("id", args.runId))
      .unique();

    if (!taskRunRow || taskRunRow.workspaceId !== args.workspaceId) {
      return {
        kind: "denied" as const,
        error: `Unknown run for approval request: ${args.runId}`,
      };
    }

    const store: PersistentToolApprovalStore = {
      findByRunAndCall: (input) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await ctx.db
              .query("approvals")
              .withIndex("by_taskRunId_callId", (q) =>
                q.eq("taskRunId", input.runId).eq("callId", input.callId),
              )
              .collect();

            const row = rows.find((candidate) => candidate.workspaceId === input.workspaceId) ?? null;
            if (!row) {
              return null;
            }

            const approval = decodeApproval(
              stripConvexSystemFields(row as unknown as Record<string, unknown>),
            );

            return toPersistentApprovalRecord(approval);
          },
          catch: (cause) =>
            toPersistentApprovalStoreError(
              "approvals.find",
              "Failed to query approval",
              String(cause),
            ),
        }),

      createPending: (input) =>
        Effect.tryPromise({
          try: async () => {
            const existingRows = await ctx.db
              .query("approvals")
              .withIndex("by_taskRunId_callId", (q) =>
                q.eq("taskRunId", input.runId).eq("callId", input.callId),
              )
              .collect();

            const existingRow =
              existingRows.find((candidate) => candidate.workspaceId === input.workspaceId) ?? null;
            if (existingRow) {
              return toPersistentApprovalRecord(
                decodeApproval(
                  stripConvexSystemFields(existingRow as unknown as Record<string, unknown>),
                ),
              );
            }

            const approval = {
              id: `apr_${crypto.randomUUID()}`,
              workspaceId: input.workspaceId,
              taskRunId: input.runId,
              callId: input.callId,
              toolPath: input.toolPath,
              status: "pending",
              inputPreviewJson: input.inputPreviewJson,
              reason: null,
              requestedAt: Date.now(),
              resolvedAt: null,
            } as Approval;

            await ctx.db.insert("approvals", approval);
            return toPersistentApprovalRecord(approval);
          },
          catch: (cause) =>
            toPersistentApprovalStoreError(
              "approvals.create",
              "Failed to create pending approval",
              String(cause),
            ),
        }),
    };

    const policy = createPersistentToolApprovalPolicy({
      store,
      requireApprovals: args.requireApprovals === true,
      retryAfterMs: args.retryAfterMs,
      serializeInputPreview: () => args.inputPreviewJson,
      onStoreError: (error) => ({
        kind: "denied",
        error:
          error.details && error.details.length > 0
            ? `${error.message}: ${error.details}`
            : error.message,
      }),
    });

    return await policy.evaluate({
      workspaceId: args.workspaceId,
      runId: args.runId,
      callId: args.callId,
      toolPath: args.toolPath,
      defaultMode: args.defaultMode,
    });
  },
});

const createOpenApiDescriptor = (
  source: Source,
  tool: OpenApiRuntimeToolRow,
): CanonicalToolDescriptor => ({
  providerKind: "openapi",
  sourceId: source.id,
  workspaceId: source.workspaceId,
  toolId: tool.toolId,
  name: tool.name,
  description: tool.description,
  invocationMode: "http",
  availability: "remote_capable",
  providerPayload: decodeOpenApiInvocationPayload(safeJsonParse(tool.invocationJson)),
});

const createGraphqlDescriptor = (
  source: Source,
  tool: GraphqlRuntimeToolRow,
): CanonicalToolDescriptor => ({
  providerKind: "graphql",
  sourceId: source.id,
  workspaceId: source.workspaceId,
  toolId: tool.toolId,
  name: tool.name,
  description: tool.description,
  invocationMode: "graphql",
  availability: "remote_capable",
  providerPayload: decodeGraphqlInvocationPayload(safeJsonParse(tool.invocationJson)),
});

const createMcpDescriptor = (
  source: Source,
  tool: McpRuntimeToolRow,
): CanonicalToolDescriptor => ({
  providerKind: "mcp",
  sourceId: source.id,
  workspaceId: source.workspaceId,
  toolId: tool.toolId,
  name: tool.name,
  description: tool.description,
  invocationMode: "mcp",
  availability: "remote_capable",
  providerPayload: decodeMcpInvocationPayload(safeJsonParse(tool.invocationJson)),
});

const createConvexOpenApiToolProvider = (ctx: ActionCtx): ToolProvider => {
  const openApiProvider = makeOpenApiToolProvider();

  return {
    kind: "openapi",

    discoverFromSource: (source) =>
      Effect.tryPromise({
        try: async (): Promise<ToolDiscoveryResult> => {
          const tools = await ctx.runQuery(runtimeApi.source_tool_registry.listOpenApiToolsForSourceRuntime, {
            workspaceId: source.workspaceId,
            sourceId: source.id,
          });

          return {
            sourceHash: source.sourceHash,
            tools: tools.map((tool: OpenApiRuntimeToolRow) => createOpenApiDescriptor(source, tool)),
          };
        },
        catch: (cause) =>
          toToolProviderError(
            "openapi",
            "discover_source_tools",
            `Failed to list OpenAPI tools for source: ${source.id}`,
            cause,
          ),
      }),

    invoke: (input) => openApiProvider.invoke(input),
  };
};

const normalizeGraphqlInvokeInput = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return input as Record<string, unknown>;
};

const asOptionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const createGraphqlOperationQuery = (
  payload: Extract<GraphqlInvocationPayload, { kind: "graphql_field" }>,
  args: Record<string, unknown>,
): {
  query: string;
  variables: Record<string, unknown>;
} => {
  const definitions: Array<string> = [];
  const callArgs: Array<string> = [];
  const variables: Record<string, unknown> = {};

  for (const arg of payload.args) {
    const value = args[arg.name];

    if (value === undefined || value === null) {
      if (arg.required) {
        throw new Error(`Missing required GraphQL argument: ${arg.name}`);
      }

      continue;
    }

    const varType = arg.type.trim().length > 0 ? arg.type : "String";
    definitions.push(`$${arg.name}: ${varType}`);
    callArgs.push(`${arg.name}: $${arg.name}`);
    variables[arg.name] = value;
  }

  const variableDefs = definitions.length > 0 ? `(${definitions.join(", ")})` : "";
  const fieldArgs = callArgs.length > 0 ? `(${callArgs.join(", ")})` : "";
  const selectionSet = asOptionalString(args.selectionSet);
  const fieldSelection =
    selectionSet && selectionSet.length > 0
      ? `${payload.fieldName}${fieldArgs} { ${selectionSet} }`
      : `${payload.fieldName}${fieldArgs}`;
  const query = `${payload.operationType}${variableDefs} { ${fieldSelection} }`;

  return { query, variables };
};

const graphqlResponseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }

  return await response.text();
};

const createConvexGraphqlToolProvider = (ctx: ActionCtx): ToolProvider => ({
  kind: "graphql",

  discoverFromSource: (source) =>
    Effect.tryPromise({
      try: async (): Promise<ToolDiscoveryResult> => {
        const tools = await ctx.runQuery(runtimeApi.source_tool_registry.listGraphqlToolsForSourceRuntime, {
          workspaceId: source.workspaceId,
          sourceId: source.id,
        });

        return {
          sourceHash: source.sourceHash,
          tools: tools.map((tool: GraphqlRuntimeToolRow) => createGraphqlDescriptor(source, tool)),
        };
      },
      catch: (cause) =>
        toToolProviderError(
          "graphql",
          "discover_source_tools",
          `Failed to list GraphQL tools for source: ${source.id}`,
          cause,
        ),
    }),

  invoke: (input) =>
    Effect.tryPromise({
      try: async () => {
        if (!input.source) {
          throw new Error("GraphQL provider requires a source");
        }

        const payload = decodeGraphqlInvocationPayload(input.tool.providerPayload);
        const args = normalizeGraphqlInvokeInput(input.args);

        let query: string;
        let variables: Record<string, unknown> | undefined;
        let operationName: string | undefined;

        if (payload.kind === "graphql_raw") {
          const rawQuery = asOptionalString(args.query);
          if (!rawQuery) {
            throw new Error("Missing required GraphQL query string at args.query");
          }

          query = rawQuery;
          variables = jsonObjectFromUnknown(args.variables);
          operationName = asOptionalString(args.operationName) ?? undefined;
        } else {
          const built = createGraphqlOperationQuery(payload, args);
          query = built.query;
          variables = built.variables;
          operationName = payload.fieldName;
        }

        const response = await fetch(payload.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            query,
            variables,
            operationName,
          }),
        });

        const body = await graphqlResponseBody(response);
        const bodyRecord = jsonObjectFromUnknown(body);
        const hasErrors = Array.isArray(bodyRecord.errors);

        return {
          output: {
            status: response.status,
            headers: headersToRecord(response.headers),
            body,
          },
          isError: response.status >= 400 || hasErrors,
        };
      },
      catch: (cause) =>
        toToolProviderError(
          "graphql",
          "invoke_tool",
          `GraphQL invocation failed for tool: ${input.tool.toolId}`,
          cause,
        ),
    }),
});

const createMcpEndpointUrl = (payload: McpInvocationPayload): URL => {
  const url = new URL(payload.endpoint);

  for (const [key, value] of Object.entries(payload.queryParams)) {
    url.searchParams.set(key, value);
  }

  return url;
};

const postMcpJsonRpc = async (
  endpoint: URL,
  body: unknown,
  sessionId: string | null,
): Promise<Response> => {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });

  if (sessionId && sessionId.trim().length > 0) {
    headers.set("mcp-session-id", sessionId);
  }

  return await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

const decodeMcpJsonResponse = async (response: Response): Promise<Record<string, unknown>> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    return { raw: text };
  }

  return jsonObjectFromUnknown(await response.json());
};

const createConvexMcpToolProvider = (ctx: ActionCtx): ToolProvider => ({
  kind: "mcp",

  discoverFromSource: (source) =>
    Effect.tryPromise({
      try: async (): Promise<ToolDiscoveryResult> => {
        const tools = await ctx.runQuery(runtimeApi.source_tool_registry.listMcpToolsForSourceRuntime, {
          workspaceId: source.workspaceId,
          sourceId: source.id,
        });

        return {
          sourceHash: source.sourceHash,
          tools: tools.map((tool: McpRuntimeToolRow) => createMcpDescriptor(source, tool)),
        };
      },
      catch: (cause) =>
        toToolProviderError(
          "mcp",
          "discover_source_tools",
          `Failed to list MCP tools for source: ${source.id}`,
          cause,
        ),
    }),

  invoke: (input) =>
    Effect.tryPromise({
      try: async () => {
        const payload = decodeMcpInvocationPayload(input.tool.providerPayload);
        const args = normalizeGraphqlInvokeInput(input.args);

        if (payload.transport !== "streamable-http") {
          throw new Error(
            `Unsupported MCP transport for runtime invocation: ${payload.transport}`,
          );
        }

        const endpoint = createMcpEndpointUrl(payload);
        const initializeResponse = await postMcpJsonRpc(
          endpoint,
          {
            jsonrpc: "2.0",
            id: `init_${crypto.randomUUID()}`,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: {
                name: "executor-v2-runtime",
                version: "0.1.0",
              },
            },
          },
          null,
        );
        const initializeBody = await decodeMcpJsonResponse(initializeResponse);

        const sessionId = initializeResponse.headers.get("mcp-session-id");

        if (initializeResponse.status >= 400 || initializeBody.error !== undefined) {
          return {
            output: {
              status: initializeResponse.status,
              headers: headersToRecord(initializeResponse.headers),
              body: initializeBody,
            },
            isError: true,
          };
        }

        await postMcpJsonRpc(
          endpoint,
          {
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {},
          },
          sessionId,
        );

        const callResponse = await postMcpJsonRpc(
          endpoint,
          {
            jsonrpc: "2.0",
            id: `call_${crypto.randomUUID()}`,
            method: "tools/call",
            params: {
              name: payload.toolName,
              arguments: args,
            },
          },
          sessionId,
        );
        const callBody = await decodeMcpJsonResponse(callResponse);

        return {
          output: {
            status: callResponse.status,
            headers: headersToRecord(callResponse.headers),
            body: callBody,
          },
          isError: callResponse.status >= 400 || callBody.error !== undefined,
        };
      },
      catch: (cause) =>
        toToolProviderError(
          "mcp",
          "invoke_tool",
          `MCP invocation failed for tool: ${input.tool.toolId}`,
          cause,
        ),
    }),
});

const createConvexSourceStore = (ctx: ActionCtx): SourceStore => ({
  getById: (workspaceId: WorkspaceId, sourceId: SourceId) =>
    Effect.tryPromise({
      try: () =>
        ctx
          .runQuery(runtimeApi.source_tool_registry.listSourcesForWorkspace, {
            workspaceId,
          })
          .then((sources: Array<Source>) =>
            Option.fromNullable(
              sources.find((source: Source) => source.id === sourceId) ?? null,
            ),
          ),
      catch: (cause) => sourceStoreQueryError("getById", cause),
    }),

  listByWorkspace: (workspaceId: WorkspaceId) =>
    Effect.tryPromise({
      try: () =>
        ctx.runQuery(runtimeApi.source_tool_registry.listSourcesForWorkspace, {
          workspaceId,
        }),
      catch: (cause) => sourceStoreQueryError("listByWorkspace", cause),
    }),

  upsert: () => Effect.fail(unsupportedSourceStoreMutation("upsert")),

  removeById: () => Effect.fail(unsupportedSourceStoreMutation("removeById")),
});

const createConvexToolArtifactStore = (ctx: ActionCtx): ToolArtifactStore => ({
  getBySource: (workspaceId: WorkspaceId, sourceId: SourceId) =>
    Effect.tryPromise({
      try: () =>
        ctx
          .runQuery(runtimeApi.source_tool_registry.getToolArtifactBySource, {
            workspaceId,
            sourceId,
          })
          .then((artifact) => Option.fromNullable(artifact)),
      catch: (cause) => toolArtifactStoreQueryError("getBySource", cause),
    }),

  upsert: (artifact: ToolArtifact) =>
    Effect.tryPromise({
      try: () =>
        ctx.runMutation(runtimeInternal.source_tool_registry.upsertToolArtifactForSource, {
          artifact,
        }),
      catch: (cause) => toolArtifactStoreMutationError("upsert", cause),
    }).pipe(Effect.asVoid),
});

const createConvexPersistentToolApprovalPolicy = (
  ctx: ActionCtx,
  workspaceId: string,
  options: {
    requireApprovals: boolean;
    retryAfterMs: number;
  },
): ToolApprovalPolicy => ({
  evaluate: (input) =>
    ctx.runMutation(runtimeInternal.source_tool_registry.evaluateToolApproval, {
      workspaceId,
      runId: input.runId,
      callId: input.callId,
      toolPath: input.toolPath,
      inputPreviewJson: serializeInputPreview(input.input),
      defaultMode: input.defaultMode,
      requireApprovals: options.requireApprovals,
      retryAfterMs: options.retryAfterMs,
    }),
});

export type ConvexSourceToolRegistryOptions = {
  requireToolApprovals?: boolean;
  approvalRetryAfterMs?: number;
};

export const createConvexSourceToolRegistry = (
  ctx: ActionCtx,
  workspaceId: string,
  options: ConvexSourceToolRegistryOptions = {},
) => {
  const sourceStore = createConvexSourceStore(ctx);
  const toolArtifactStore = createConvexToolArtifactStore(ctx);
  const toolProviderRegistry = makeToolProviderRegistry([
    createConvexOpenApiToolProvider(ctx),
    createConvexGraphqlToolProvider(ctx),
    createConvexMcpToolProvider(ctx),
  ]);
  const requireApprovals = options.requireToolApprovals ?? requireToolApprovalsByDefault;
  const approvalRetryAfterMs =
    typeof options.approvalRetryAfterMs === "number" &&
    Number.isFinite(options.approvalRetryAfterMs) &&
    options.approvalRetryAfterMs >= 0
      ? Math.round(options.approvalRetryAfterMs)
      : defaultPendingRetryAfterMs;
  const approvalPolicy = createConvexPersistentToolApprovalPolicy(ctx, workspaceId, {
    requireApprovals,
    retryAfterMs: approvalRetryAfterMs,
  });

  return createSourceToolRegistry({
    workspaceId,
    sourceStore,
    toolArtifactStore,
    toolProviderRegistry,
    approvalPolicy,
  });
};
