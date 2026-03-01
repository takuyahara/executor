import { type SourceToolSummary } from "@executor-v2/management-api";
import {
  SourceSchema,
  type OpenApiHttpMethod,
  type Source,
} from "@executor-v2/schema";
import { v } from "convex/values";
import * as Schema from "effect/Schema";

import { query } from "../_generated/server";

const decodeSource = Schema.decodeUnknownSync(SourceSchema);

const OpenApiArtifactToolRowSchema = Schema.Struct({
  id: Schema.String,
  artifactId: Schema.String,
  toolId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  method: Schema.String,
  path: Schema.String,
  operationHash: Schema.String,
  invocationJson: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

type OpenApiArtifactToolRow = typeof OpenApiArtifactToolRowSchema.Type;

const decodeOpenApiArtifactToolRow = Schema.decodeUnknownSync(OpenApiArtifactToolRowSchema);

const stripConvexSystemFields = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...rest } = value;
  return rest;
};

const toSource = (document: Record<string, unknown>): Source =>
  decodeSource(stripConvexSystemFields(document));

const toOpenApiArtifactToolRow = (
  document: Record<string, unknown>,
): OpenApiArtifactToolRow =>
  decodeOpenApiArtifactToolRow(stripConvexSystemFields(document));

const toSourceToolSummary = (
  source: Source,
  tool: OpenApiArtifactToolRow,
): SourceToolSummary => ({
  sourceId: source.id,
  sourceName: source.name,
  sourceKind: source.kind,
  toolId: tool.toolId,
  name: tool.name,
  description: tool.description,
  method: tool.method as OpenApiHttpMethod,
  path: tool.path,
  operationHash: tool.operationHash,
});

const sortTools = (tools: ReadonlyArray<SourceToolSummary>): Array<SourceToolSummary> =>
  [...tools].sort((left, right) => {
    const leftSource = left.sourceName.toLowerCase();
    const rightSource = right.sourceName.toLowerCase();

    if (leftSource !== rightSource) {
      return leftSource.localeCompare(rightSource);
    }

    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();

    if (leftName !== rightName) {
      return leftName.localeCompare(rightName);
    }

    return left.toolId.localeCompare(right.toolId);
  });

export const listWorkspaceTools = query({
  args: {
    workspaceId: v.string(),
  },
  handler: async (ctx, args): Promise<Array<SourceToolSummary>> => {
    const sourceRows = await ctx.db
      .query("sources")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const sourcesById = new Map<string, Source>(
      sourceRows.map((row) => {
        const source = toSource(row as unknown as Record<string, unknown>);
        return [source.id as string, source] as const;
      }),
    );

    const bindingRows = await ctx.db
      .query("openApiSourceArtifactBindings")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const tools: Array<SourceToolSummary> = [];

    for (const binding of bindingRows) {
      const source = sourcesById.get(binding.sourceId);
      if (!source) {
        continue;
      }

      const toolRows = await ctx.db
        .query("openApiArtifactTools")
        .withIndex("by_artifactId", (q) => q.eq("artifactId", binding.artifactId))
        .collect();

      for (const toolRow of toolRows) {
        const tool = toOpenApiArtifactToolRow(toolRow as unknown as Record<string, unknown>);
        tools.push(toSourceToolSummary(source, tool));
      }
    }

    return sortTools(tools);
  },
});

export const listSourceTools = query({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args): Promise<Array<SourceToolSummary>> => {
    const sourceRow = await ctx.db
      .query("sources")
      .withIndex("by_domainId", (q) => q.eq("id", args.sourceId))
      .unique();

    if (!sourceRow || sourceRow.workspaceId !== args.workspaceId) {
      return [];
    }

    const source = toSource(sourceRow as unknown as Record<string, unknown>);

    const bindingRow = await ctx.db
      .query("openApiSourceArtifactBindings")
      .withIndex("by_workspaceId_sourceId", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId)
      )
      .unique();

    if (!bindingRow) {
      return [];
    }

    const toolRows = await ctx.db
      .query("openApiArtifactTools")
      .withIndex("by_artifactId", (q) => q.eq("artifactId", bindingRow.artifactId))
      .collect();

    return sortTools(
      toolRows.map((toolRow) =>
        toSourceToolSummary(
          source,
          toOpenApiArtifactToolRow(toolRow as unknown as Record<string, unknown>),
        ),
      ),
    );
  },
});
