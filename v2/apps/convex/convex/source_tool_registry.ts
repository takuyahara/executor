import {
  PersistentToolApprovalPolicyStoreError,
  createPersistentToolApprovalPolicy,
  createSourceToolRegistry,
  makeOpenApiToolProvider,
  makeToolProviderRegistry,
  type PersistentToolApprovalRecord,
  type PersistentToolApprovalStore,
  type ToolApprovalPolicy,
} from "@executor-v2/engine";
import {
  SourceStoreError,
  ToolArtifactStoreError,
  type SourceStore,
  type ToolArtifactStore,
} from "@executor-v2/persistence-ports";
import {
  ApprovalSchema,
  OpenApiToolManifestSchema,
  SourceSchema,
  ToolArtifactSchema,
  type Approval,
  type Source,
  type SourceId,
  type ToolArtifact,
  type WorkspaceId,
} from "@executor-v2/schema";
import { v } from "convex/values";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
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
  const toolProviderRegistry = makeToolProviderRegistry([makeOpenApiToolProvider()]);
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
