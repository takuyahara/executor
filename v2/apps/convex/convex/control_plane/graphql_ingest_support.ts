import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

export const upsertGraphqlArtifactMeta = internalMutation({
  args: {
    schemaHash: v.string(),
    extractorVersion: v.string(),
    toolCount: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("graphqlArtifacts")
      .withIndex("by_schemaHash_extractorVersion", (q) =>
        q.eq("schemaHash", args.schemaHash).eq("extractorVersion", args.extractorVersion),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        toolCount: args.toolCount,
        updatedAt: now,
      });

      return {
        artifactId: existing.id,
        created: false,
      };
    }

    const artifactId = `gql_${args.schemaHash}_${args.extractorVersion}`;

    await ctx.db.insert("graphqlArtifacts", {
      id: artifactId,
      schemaHash: args.schemaHash,
      extractorVersion: args.extractorVersion,
      toolCount: args.toolCount,
      createdAt: now,
      updatedAt: now,
    });

    return {
      artifactId,
      created: true,
    };
  },
});

export const putGraphqlArtifactToolsBatch = internalMutation({
  args: {
    artifactId: v.string(),
    insertOnly: v.optional(v.boolean()),
    tools: v.array(
      v.object({
        toolId: v.string(),
        name: v.string(),
        description: v.union(v.string(), v.null()),
        operationType: v.string(),
        fieldName: v.string(),
        operationHash: v.string(),
        invocationJson: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let insertedCount = 0;

    if (args.insertOnly === true) {
      for (const tool of args.tools) {
        await ctx.db.insert("graphqlArtifactTools", {
          id: `${args.artifactId}:${tool.toolId}`,
          artifactId: args.artifactId,
          toolId: tool.toolId,
          name: tool.name,
          description: tool.description,
          operationType: tool.operationType,
          fieldName: tool.fieldName,
          operationHash: tool.operationHash,
          invocationJson: tool.invocationJson,
          createdAt: now,
          updatedAt: now,
        });
        insertedCount += 1;
      }

      return { insertedCount };
    }

    for (const tool of args.tools) {
      const existing = await ctx.db
        .query("graphqlArtifactTools")
        .withIndex("by_artifactId_toolId", (q) =>
          q.eq("artifactId", args.artifactId).eq("toolId", tool.toolId),
        )
        .unique();

      const row = {
        id: `${args.artifactId}:${tool.toolId}`,
        artifactId: args.artifactId,
        toolId: tool.toolId,
        name: tool.name,
        description: tool.description,
        operationType: tool.operationType,
        fieldName: tool.fieldName,
        operationHash: tool.operationHash,
        invocationJson: tool.invocationJson,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("graphqlArtifactTools", row);
        insertedCount += 1;
      }
    }

    return { insertedCount };
  },
});

export const bindSourceToGraphqlArtifact = internalMutation({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
    artifactId: v.string(),
    schemaHash: v.string(),
    extractorVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("graphqlSourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
      )
      .unique();

    const row = {
      id: existing?.id ?? `gsb_${args.workspaceId}_${args.sourceId}`,
      workspaceId: args.workspaceId,
      sourceId: args.sourceId,
      artifactId: args.artifactId,
      schemaHash: args.schemaHash,
      extractorVersion: args.extractorVersion,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("graphqlSourceArtifactBindings", row);
    }

    return row;
  },
});
