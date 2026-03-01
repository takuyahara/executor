import { extractOpenApiManifest, fetchOpenApiDocument } from "@executor-v2/management-api";
import { v } from "convex/values";
import * as Effect from "effect/Effect";

import { api, internal } from "../_generated/api";
import { action, internalMutation, internalQuery } from "../_generated/server";

const runtimeApi = api as any;
const runtimeInternal = internal as any;

const defaultExtractorVersion = "openapi_mvp_v1";
const defaultToolBatchSize = 100;
const maxToolBatchSize = 1000;

const maxRefHintBytes = 900_000;

const safeRefHintTableJson = (
  refHintTable: Record<string, unknown> | undefined,
): string | null => {
  if (!refHintTable) {
    return null;
  }

  const serialized = JSON.stringify(refHintTable);
  const bytes = new TextEncoder().encode(serialized).length;
  return bytes <= maxRefHintBytes ? serialized : null;
};


export const upsertOpenApiArtifactMeta = internalMutation({
  args: {
    sourceHash: v.string(),
    extractorVersion: v.string(),
    toolCount: v.number(),
    refHintTableJson: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("openApiArtifacts")
      .withIndex("by_sourceHash_extractorVersion", (q) =>
        q.eq("sourceHash", args.sourceHash).eq("extractorVersion", args.extractorVersion)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        toolCount: args.toolCount,
        updatedAt: now,
        refHintTableJson: args.refHintTableJson ?? null,
      });

      return {
        artifactId: existing.id,
        created: false,
      };
    }

    const artifactId = `oa_${args.sourceHash}_${args.extractorVersion}`;

    await ctx.db.insert("openApiArtifacts", {
      id: artifactId,
      sourceHash: args.sourceHash,
      extractorVersion: args.extractorVersion,
      toolCount: args.toolCount,
      createdAt: now,
      refHintTableJson: args.refHintTableJson ?? null,
      updatedAt: now,
    });

    return {
      artifactId,
      created: true,
    };
  },
});

export const putOpenApiArtifactToolsBatch = internalMutation({
  args: {
    artifactId: v.string(),
    insertOnly: v.optional(v.boolean()),
    tools: v.array(
      v.object({
        toolId: v.string(),
        name: v.string(),
        description: v.union(v.string(), v.null()),
        method: v.string(),
        path: v.string(),
        operationHash: v.string(),
        invocationJson: v.string(),
        inputSchemaJson: v.optional(v.union(v.string(), v.null())),
        outputSchemaJson: v.optional(v.union(v.string(), v.null())),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let insertedCount = 0;

    if (args.insertOnly === true) {
      for (const tool of args.tools) {
        await ctx.db.insert("openApiArtifactTools", {
          id: `${args.artifactId}:${tool.toolId}`,
          artifactId: args.artifactId,
          toolId: tool.toolId,
          name: tool.name,
          description: tool.description,
          method: tool.method,
          path: tool.path,
          operationHash: tool.operationHash,
          invocationJson: tool.invocationJson,
          inputSchemaJson: tool.inputSchemaJson ?? null,
          outputSchemaJson: tool.outputSchemaJson ?? null,
          createdAt: now,
          updatedAt: now,
        });
        insertedCount += 1;
      }

      return { insertedCount };
    }

    for (const tool of args.tools) {
      const existing = await ctx.db
        .query("openApiArtifactTools")
        .withIndex("by_artifactId_toolId", (q) =>
          q.eq("artifactId", args.artifactId).eq("toolId", tool.toolId)
        )
        .unique();

      const row = {
        id: `${args.artifactId}:${tool.toolId}`,
        artifactId: args.artifactId,
        toolId: tool.toolId,
        name: tool.name,
        description: tool.description,
        method: tool.method,
        path: tool.path,
        operationHash: tool.operationHash,
        invocationJson: tool.invocationJson,
        inputSchemaJson: tool.inputSchemaJson ?? null,
        outputSchemaJson: tool.outputSchemaJson ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("openApiArtifactTools", row);
        insertedCount += 1;
      }
    }

    return { insertedCount };
  },
});

export const bindSourceToOpenApiArtifact = internalMutation({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
    artifactId: v.string(),
    sourceHash: v.string(),
    extractorVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("openApiSourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId)
      )
      .unique();

    const row = {
      id: existing?.id ?? `oab_${args.workspaceId}_${args.sourceId}`,
      workspaceId: args.workspaceId,
      sourceId: args.sourceId,
      artifactId: args.artifactId,
      sourceHash: args.sourceHash,
      extractorVersion: args.extractorVersion,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("openApiSourceArtifactBindings", row);
    }

    return row;
  },
});

export const listSourceOpenApiToolsMvp = internalQuery({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
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

    return rows.map((row) => ({
      toolId: row.toolId,
      name: row.name,
      method: row.method,
      path: row.path,
    }));
  },
});

export const profileOpenApiIngestMvp = action({
  args: {
    workspaceId: v.string(),
    sourceName: v.string(),
    specUrl: v.string(),
    sourceId: v.optional(v.string()),
    extractorVersion: v.optional(v.string()),
    writeMode: v.optional(v.union(v.literal("batched"), v.literal("single"))),
    toolBatchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const selectedExtractorVersion = args.extractorVersion ?? defaultExtractorVersion;
    const selectedWriteMode = args.writeMode ?? "batched";
    const selectedToolBatchSize = Math.max(
      1,
      Math.min(maxToolBatchSize, Math.floor(args.toolBatchSize ?? defaultToolBatchSize))
    );

    const source = await ctx.runMutation(runtimeApi.controlPlane.upsertSource, {
      workspaceId: args.workspaceId,
      payload: {
        ...(args.sourceId ? { id: args.sourceId } : {}),
        name: args.sourceName,
        kind: "openapi",
        endpoint: args.specUrl,
        enabled: true,
        configJson: "{}",
        sourceHash: null,
        lastError: null,
      },
    });

    const afterSourceUpsertAt = Date.now();

    const manifest = await Effect.runPromise(
      Effect.gen(function* () {
        const document = yield* Effect.tryPromise(() => fetchOpenApiDocument(args.specUrl));
        return yield* extractOpenApiManifest(args.sourceName, document);
      })
    );

    const afterManifestAt = Date.now();

    const artifactMeta = await ctx.runMutation(
      runtimeInternal.control_plane.openapi_ingest_mvp.upsertOpenApiArtifactMeta,
      {
        sourceHash: manifest.sourceHash,
        extractorVersion: selectedExtractorVersion,
        toolCount: manifest.tools.length,
        refHintTableJson: safeRefHintTableJson(manifest.refHintTable),
      }
    );

    const afterArtifactMetaAt = Date.now();

    let insertedToolCount = 0;

    if (artifactMeta.created) {
      const allTools = manifest.tools.map((tool) => ({
        toolId: tool.toolId,
        name: tool.name,
        description: tool.description,
        method: tool.method,
        path: tool.path,
        operationHash: tool.operationHash,
        invocationJson: JSON.stringify(tool.invocation),
        inputSchemaJson: tool.typing?.inputSchemaJson ?? null,
        outputSchemaJson: tool.typing?.outputSchemaJson ?? null,
      }));

      if (selectedWriteMode === "single") {
        const writeResult = await ctx.runMutation(
          runtimeInternal.control_plane.openapi_ingest_mvp.putOpenApiArtifactToolsBatch,
          {
            artifactId: artifactMeta.artifactId,
            insertOnly: true,
            tools: allTools,
          }
        );
        insertedToolCount += writeResult.insertedCount;
      } else {
        for (
          let index = 0;
          index < allTools.length;
          index += selectedToolBatchSize
        ) {
          const batch = allTools.slice(index, index + selectedToolBatchSize);
          const writeResult = await ctx.runMutation(
            runtimeInternal.control_plane.openapi_ingest_mvp.putOpenApiArtifactToolsBatch,
            {
              artifactId: artifactMeta.artifactId,
              insertOnly: true,
              tools: batch,
            }
          );

          insertedToolCount += writeResult.insertedCount;
        }
      }
    }

    const afterToolWritesAt = Date.now();

    await ctx.runMutation(runtimeInternal.control_plane.openapi_ingest_mvp.bindSourceToOpenApiArtifact, {
      workspaceId: args.workspaceId,
      sourceId: source.id,
      artifactId: artifactMeta.artifactId,
      sourceHash: manifest.sourceHash,
      extractorVersion: selectedExtractorVersion,
    });

    const afterBindingAt = Date.now();

    const mvpTools = await ctx.runQuery(
      runtimeInternal.control_plane.openapi_ingest_mvp.listSourceOpenApiToolsMvp,
      {
        workspaceId: args.workspaceId,
        sourceId: source.id,
      }
    );

    const completedAt = Date.now();

    return {
      sourceId: source.id,
      artifactId: artifactMeta.artifactId,
      createdArtifact: artifactMeta.created,
      manifestToolCount: manifest.tools.length,
      insertedToolCount,
      boundToolCount: mvpTools.length,
      extractorVersion: selectedExtractorVersion,
      writeMode: selectedWriteMode,
      toolBatchSize: selectedToolBatchSize,
      timingsMs: {
        total: completedAt - startedAt,
        sourceUpsert: afterSourceUpsertAt - startedAt,
        manifestBuild: afterManifestAt - afterSourceUpsertAt,
        artifactMeta: afterArtifactMetaAt - afterManifestAt,
        toolWrites: afterToolWritesAt - afterArtifactMetaAt,
        bindingAndRead: completedAt - afterToolWritesAt,
      },
    };
  },
});
