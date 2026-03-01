"use node";

import { extractOpenApiManifest, fetchOpenApiDocument } from "@executor-v2/management-api";
import { v } from "convex/values";
import * as Effect from "effect/Effect";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

const runtimeInternal = internal as any;

const extractorVersion = "openapi_v2";
const writeBatchSize = 500;

const formatError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const ingestSourceArtifact = internalAction({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const source = await ctx.runQuery(runtimeInternal.control_plane.sources.getSourceForIngest, {
      sourceId: args.sourceId,
    });

    if (!source || source.workspaceId !== args.workspaceId) {
      return;
    }

    if (source.kind !== "openapi") {
      await ctx.runMutation(runtimeInternal.control_plane.sources.setSourceIngestState, {
        sourceId: source.id,
        status: "error",
        lastError: `Source ingest for kind '${source.kind}' is not implemented yet`,
      });
      return;
    }

    await ctx.runMutation(runtimeInternal.control_plane.sources.setSourceIngestState, {
      sourceId: source.id,
      status: "probing",
      lastError: null,
    });

    const manifestResult = await Effect.runPromise(
      Effect.gen(function* () {
        const openApiDocument = yield* Effect.tryPromise(() => fetchOpenApiDocument(source.endpoint));
        return yield* extractOpenApiManifest(source.name, openApiDocument);
      }).pipe(Effect.either),
    );

    if (manifestResult._tag === "Left") {
      await ctx.runMutation(runtimeInternal.control_plane.sources.setSourceIngestState, {
        sourceId: source.id,
        status: "error",
        lastError: formatError(manifestResult.left),
      });
      return;
    }

    const manifest = manifestResult.right;

    const artifactMeta = await ctx.runMutation(
      runtimeInternal.control_plane.openapi_ingest_mvp.upsertOpenApiArtifactMeta,
      {
        sourceHash: manifest.sourceHash,
        extractorVersion,
        toolCount: manifest.tools.length,
      },
    );

    if (artifactMeta.created) {
      const allTools = manifest.tools.map((tool) => ({
        toolId: tool.toolId,
        name: tool.name,
        description: tool.description,
        method: tool.method,
        path: tool.path,
        operationHash: tool.operationHash,
        invocationJson: JSON.stringify(tool.invocation),
      }));

      for (let index = 0; index < allTools.length; index += writeBatchSize) {
        const batch = allTools.slice(index, index + writeBatchSize);
        await ctx.runMutation(
          runtimeInternal.control_plane.openapi_ingest_mvp.putOpenApiArtifactToolsBatch,
          {
            artifactId: artifactMeta.artifactId,
            insertOnly: true,
            tools: batch,
          },
        );
      }
    }

    await ctx.runMutation(runtimeInternal.control_plane.openapi_ingest_mvp.bindSourceToOpenApiArtifact, {
      workspaceId: source.workspaceId,
      sourceId: source.id,
      artifactId: artifactMeta.artifactId,
      sourceHash: manifest.sourceHash,
      extractorVersion,
    });

    await ctx.runMutation(runtimeInternal.control_plane.sources.setSourceIngestState, {
      sourceId: source.id,
      status: "connected",
      sourceHash: manifest.sourceHash,
      lastError: null,
    });
  },
});
