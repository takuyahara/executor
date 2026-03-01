import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

export const upsertMcpArtifactMeta = internalMutation({
  args: {
    sourceHash: v.string(),
    extractorVersion: v.string(),
    toolCount: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("mcpArtifacts")
      .withIndex("by_sourceHash_extractorVersion", (q) =>
        q.eq("sourceHash", args.sourceHash).eq("extractorVersion", args.extractorVersion),
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

    const artifactId = `mcp_${args.sourceHash}_${args.extractorVersion}`;

    await ctx.db.insert("mcpArtifacts", {
      id: artifactId,
      sourceHash: args.sourceHash,
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

export const putMcpArtifactToolsBatch = internalMutation({
  args: {
    artifactId: v.string(),
    insertOnly: v.optional(v.boolean()),
    tools: v.array(
      v.object({
        toolId: v.string(),
        name: v.string(),
        description: v.union(v.string(), v.null()),
        toolName: v.string(),
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
        await ctx.db.insert("mcpArtifactTools", {
          id: `${args.artifactId}:${tool.toolId}`,
          artifactId: args.artifactId,
          toolId: tool.toolId,
          name: tool.name,
          description: tool.description,
          toolName: tool.toolName,
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
        .query("mcpArtifactTools")
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
        toolName: tool.toolName,
        operationHash: tool.operationHash,
        invocationJson: tool.invocationJson,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("mcpArtifactTools", row);
        insertedCount += 1;
      }
    }

    return { insertedCount };
  },
});

export const bindSourceToMcpArtifact = internalMutation({
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
      .query("mcpSourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
      )
      .unique();

    const row = {
      id: existing?.id ?? `msb_${args.workspaceId}_${args.sourceId}`,
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
      await ctx.db.insert("mcpSourceArtifactBindings", row);
    }

    return row;
  },
});
