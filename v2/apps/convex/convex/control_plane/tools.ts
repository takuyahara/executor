import { type SourceToolDetail, type SourceToolSummary } from "@executor-v2/management-api";
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
  inputSchemaJson: Schema.optional(Schema.NullOr(Schema.String)),
  outputSchemaJson: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

type OpenApiArtifactToolRow = typeof OpenApiArtifactToolRowSchema.Type;

const OpenApiArtifactRowSchema = Schema.Struct({
  id: Schema.String,
  sourceHash: Schema.String,
  extractorVersion: Schema.String,
  toolCount: Schema.Number,
  refHintTableJson: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

type OpenApiArtifactRow = typeof OpenApiArtifactRowSchema.Type;


const GraphqlArtifactToolRowSchema = Schema.Struct({
  id: Schema.String,
  artifactId: Schema.String,
  toolId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  operationType: Schema.String,
  fieldName: Schema.String,
  operationHash: Schema.String,
  invocationJson: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

type GraphqlArtifactToolRow = typeof GraphqlArtifactToolRowSchema.Type;

const McpArtifactToolRowSchema = Schema.Struct({
  id: Schema.String,
  artifactId: Schema.String,
  toolId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  toolName: Schema.String,
  operationHash: Schema.String,
  invocationJson: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

type McpArtifactToolRow = typeof McpArtifactToolRowSchema.Type;

const decodeOpenApiArtifactToolRow = Schema.decodeUnknownSync(OpenApiArtifactToolRowSchema);
const decodeGraphqlArtifactToolRow = Schema.decodeUnknownSync(GraphqlArtifactToolRowSchema);
const decodeMcpArtifactToolRow = Schema.decodeUnknownSync(McpArtifactToolRowSchema);
const decodeOpenApiArtifactRow = Schema.decodeUnknownSync(OpenApiArtifactRowSchema);

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

const toOpenApiArtifactRow = (
  document: Record<string, unknown>,
): OpenApiArtifactRow =>
  decodeOpenApiArtifactRow(stripConvexSystemFields(document));

const toGraphqlArtifactToolRow = (
  document: Record<string, unknown>,
): GraphqlArtifactToolRow =>
  decodeGraphqlArtifactToolRow(stripConvexSystemFields(document));

const toMcpArtifactToolRow = (
  document: Record<string, unknown>,
): McpArtifactToolRow =>
  decodeMcpArtifactToolRow(stripConvexSystemFields(document));

const toOpenApiSourceToolSummary = (
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

const toGraphqlToolPath = (
  source: Source,
  tool: GraphqlArtifactToolRow,
): string => `${source.endpoint}#${tool.operationType}.${tool.fieldName}`;

const toGraphqlSourceToolSummary = (
  source: Source,
  tool: GraphqlArtifactToolRow,
): SourceToolSummary => ({
  sourceId: source.id,
  sourceName: source.name,
  sourceKind: source.kind,
  toolId: tool.toolId,
  name: tool.name,
  description: tool.description,
  method: "post",
  path: toGraphqlToolPath(source, tool),
  operationHash: tool.operationHash,
});

const toMcpToolPath = (source: Source, tool: McpArtifactToolRow): string =>
  `${source.endpoint}#mcp.${tool.toolName}`;

const toMcpSourceToolSummary = (
  source: Source,
  tool: McpArtifactToolRow,
): SourceToolSummary => ({
  sourceId: source.id,
  sourceName: source.name,
  sourceKind: source.kind,
  toolId: tool.toolId,
  name: tool.name,
  description: tool.description,
  method: "post",
  path: toMcpToolPath(source, tool),
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

    const tools: Array<SourceToolSummary> = [];

    const openApiBindingRows = await ctx.db
      .query("openApiSourceArtifactBindings")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    for (const binding of openApiBindingRows) {
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
        tools.push(toOpenApiSourceToolSummary(source, tool));
      }
    }

    const graphqlBindingRows = await ctx.db
      .query("graphqlSourceArtifactBindings")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    for (const binding of graphqlBindingRows) {
      const source = sourcesById.get(binding.sourceId);
      if (!source) {
        continue;
      }

      const toolRows = await ctx.db
        .query("graphqlArtifactTools")
        .withIndex("by_artifactId", (q) => q.eq("artifactId", binding.artifactId))
        .collect();

      for (const toolRow of toolRows) {
        const tool = toGraphqlArtifactToolRow(toolRow as unknown as Record<string, unknown>);
        tools.push(toGraphqlSourceToolSummary(source, tool));
      }
    }

    const mcpBindingRows = await ctx.db
      .query("mcpSourceArtifactBindings")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    for (const binding of mcpBindingRows) {
      const source = sourcesById.get(binding.sourceId);
      if (!source) {
        continue;
      }

      const toolRows = await ctx.db
        .query("mcpArtifactTools")
        .withIndex("by_artifactId", (q) => q.eq("artifactId", binding.artifactId))
        .collect();

      for (const toolRow of toolRows) {
        const tool = toMcpArtifactToolRow(toolRow as unknown as Record<string, unknown>);
        tools.push(toMcpSourceToolSummary(source, tool));
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

    if (source.kind === "openapi") {
      const bindingRow = await ctx.db
        .query("openApiSourceArtifactBindings")
        .withIndex("by_workspaceId_sourceId", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
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
          toOpenApiSourceToolSummary(
            source,
            toOpenApiArtifactToolRow(toolRow as unknown as Record<string, unknown>),
          ),
        ),
      );
    }

    if (source.kind === "graphql") {
      const bindingRow = await ctx.db
        .query("graphqlSourceArtifactBindings")
        .withIndex("by_workspaceId_sourceId", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
        )
        .unique();

      if (!bindingRow) {
        return [];
      }

      const toolRows = await ctx.db
        .query("graphqlArtifactTools")
        .withIndex("by_artifactId", (q) => q.eq("artifactId", bindingRow.artifactId))
        .collect();

      return sortTools(
        toolRows.map((toolRow) =>
          toGraphqlSourceToolSummary(
            source,
            toGraphqlArtifactToolRow(toolRow as unknown as Record<string, unknown>),
          ),
        ),
      );
    }

    if (source.kind === "mcp") {
      const bindingRow = await ctx.db
        .query("mcpSourceArtifactBindings")
        .withIndex("by_workspaceId_sourceId", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
        )
        .unique();

      if (!bindingRow) {
        return [];
      }

      const toolRows = await ctx.db
        .query("mcpArtifactTools")
        .withIndex("by_artifactId", (q) => q.eq("artifactId", bindingRow.artifactId))
        .collect();

      return sortTools(
        toolRows.map((toolRow) =>
          toMcpSourceToolSummary(
            source,
            toMcpArtifactToolRow(toolRow as unknown as Record<string, unknown>),
          ),
        ),
      );
    }

    return [];
  },
});

// ---------------------------------------------------------------------------
// Helper: extract schema JSON from invocationJson
// ---------------------------------------------------------------------------

const extractMcpSchemas = (
  invocationJson: string,
): { inputSchemaJson: string | null; outputSchemaJson: string | null } => {
  try {
    const parsed = JSON.parse(invocationJson) as Record<string, unknown>;
    const inputSchema = parsed.inputSchema;
    const outputSchema = parsed.outputSchema;
    return {
      inputSchemaJson: inputSchema ? JSON.stringify(inputSchema) : null,
      outputSchemaJson: outputSchema ? JSON.stringify(outputSchema) : null,
    };
  } catch {
    return { inputSchemaJson: null, outputSchemaJson: null };
  }
};

// ---------------------------------------------------------------------------
// getToolDetail - returns a single tool with schema data
// ---------------------------------------------------------------------------

export const getToolDetail = query({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
    operationHash: v.string(),
  },
  handler: async (ctx, args): Promise<SourceToolDetail | null> => {
    const sourceRow = await ctx.db
      .query("sources")
      .withIndex("by_domainId", (q) => q.eq("id", args.sourceId))
      .unique();

    if (!sourceRow || sourceRow.workspaceId !== args.workspaceId) {
      return null;
    }

    const source = toSource(sourceRow as unknown as Record<string, unknown>);

    if (source.kind === "openapi") {
      const bindingRow = await ctx.db
        .query("openApiSourceArtifactBindings")
        .withIndex("by_workspaceId_sourceId", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
        )
        .unique();

      if (!bindingRow) {
        return null;
      }

      const toolRows = await ctx.db
        .query("openApiArtifactTools")
        .withIndex("by_artifactId", (q) => q.eq("artifactId", bindingRow.artifactId))
        .collect();

      const artifactRow = await ctx.db
        .query("openApiArtifacts")
        .withIndex("by_domainId", (q) => q.eq("id", bindingRow.artifactId))
        .unique();

      const artifact = artifactRow
        ? toOpenApiArtifactRow(artifactRow as unknown as Record<string, unknown>)
        : null;

      const matched = toolRows
        .map((toolRow) => toOpenApiArtifactToolRow(toolRow as unknown as Record<string, unknown>))
        .find((tool) => tool.operationHash === args.operationHash);

      if (!matched) {
        return null;
      }

      return {
        ...toOpenApiSourceToolSummary(source, matched),
        inputSchemaJson: matched.inputSchemaJson ?? null,
        outputSchemaJson: matched.outputSchemaJson ?? null,
        refHintTableJson: artifact?.refHintTableJson ?? null,
      };
    }

    if (source.kind === "graphql") {
      const bindingRow = await ctx.db
        .query("graphqlSourceArtifactBindings")
        .withIndex("by_workspaceId_sourceId", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
        )
        .unique();

      if (!bindingRow) {
        return null;
      }

      const toolRows = await ctx.db
        .query("graphqlArtifactTools")
        .withIndex("by_artifactId", (q) => q.eq("artifactId", bindingRow.artifactId))
        .collect();

      const matched = toolRows
        .map((toolRow) => toGraphqlArtifactToolRow(toolRow as unknown as Record<string, unknown>))
        .find((tool) => tool.operationHash === args.operationHash);

      if (!matched) {
        return null;
      }

      return {
        ...toGraphqlSourceToolSummary(source, matched),
        // GraphQL tools don't have full JSON Schema in Convex
        inputSchemaJson: null,
        outputSchemaJson: null,
        refHintTableJson: null,
      };
    }

    if (source.kind === "mcp") {
      const bindingRow = await ctx.db
        .query("mcpSourceArtifactBindings")
        .withIndex("by_workspaceId_sourceId", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("sourceId", args.sourceId),
        )
        .unique();

      if (!bindingRow) {
        return null;
      }

      const toolRows = await ctx.db
        .query("mcpArtifactTools")
        .withIndex("by_artifactId", (q) => q.eq("artifactId", bindingRow.artifactId))
        .collect();

      const matched = toolRows
        .map((toolRow) => toMcpArtifactToolRow(toolRow as unknown as Record<string, unknown>))
        .find((tool) => tool.operationHash === args.operationHash);

      if (!matched) {
        return null;
      }

      const schemas = extractMcpSchemas(matched.invocationJson);
      return {
        ...toMcpSourceToolSummary(source, matched),
        inputSchemaJson: schemas.inputSchemaJson,
        outputSchemaJson: schemas.outputSchemaJson,
        refHintTableJson: null,
      };
    }

    return null;
  },
});

