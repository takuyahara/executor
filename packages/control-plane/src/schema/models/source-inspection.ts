import { Schema } from "effect";

import { SourceSchema } from "./source";

export const SourceInspectionPipelineKindSchema = Schema.Literal("ir");

export const SourceInspectionToolSummarySchema = Schema.Struct({
  path: Schema.String,
  sourceKey: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  protocol: Schema.String,
  toolId: Schema.String,
  rawToolId: Schema.NullOr(Schema.String),
  operationId: Schema.NullOr(Schema.String),
  group: Schema.NullOr(Schema.String),
  leaf: Schema.NullOr(Schema.String),
  tags: Schema.Array(Schema.String),
  method: Schema.NullOr(Schema.String),
  pathTemplate: Schema.NullOr(Schema.String),
  inputType: Schema.optional(Schema.String),
  outputType: Schema.optional(Schema.String),
});

export const SourceInspectionToolListItemSchema = Schema.Struct({
  path: Schema.String,
  method: Schema.NullOr(Schema.String),
});

export const SourceInspectionSchema = Schema.Struct({
  source: SourceSchema,
  namespace: Schema.String,
  pipelineKind: SourceInspectionPipelineKindSchema,
  toolCount: Schema.Number,
  tools: Schema.Array(SourceInspectionToolListItemSchema),
});

export const SourceInspectionToolDetailSchema = Schema.Struct({
  summary: SourceInspectionToolSummarySchema,
  definitionJson: Schema.NullOr(Schema.String),
  documentationJson: Schema.NullOr(Schema.String),
  nativeJson: Schema.NullOr(Schema.String),
  callSchemaJson: Schema.NullOr(Schema.String),
  resultSchemaJson: Schema.NullOr(Schema.String),
  exampleCallJson: Schema.NullOr(Schema.String),
  exampleResultJson: Schema.NullOr(Schema.String),
});

export const SourceInspectionDiscoverPayloadSchema = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
});

export const SourceInspectionDiscoverResultItemSchema = Schema.Struct({
  path: Schema.String,
  score: Schema.Number,
  description: Schema.optional(Schema.String),
  inputType: Schema.optional(Schema.String),
  outputType: Schema.optional(Schema.String),
  reasons: Schema.Array(Schema.String),
});

export const SourceInspectionDiscoverResultSchema = Schema.Struct({
  query: Schema.String,
  queryTokens: Schema.Array(Schema.String),
  bestPath: Schema.NullOr(Schema.String),
  total: Schema.Number,
  results: Schema.Array(SourceInspectionDiscoverResultItemSchema),
});

export type SourceInspectionPipelineKind =
  typeof SourceInspectionPipelineKindSchema.Type;
export type SourceInspectionToolSummary =
  typeof SourceInspectionToolSummarySchema.Type;
export type SourceInspectionToolListItem =
  typeof SourceInspectionToolListItemSchema.Type;
export type SourceInspection = typeof SourceInspectionSchema.Type;
export type SourceInspectionToolDetail =
  typeof SourceInspectionToolDetailSchema.Type;
export type SourceInspectionDiscoverPayload =
  typeof SourceInspectionDiscoverPayloadSchema.Type;
export type SourceInspectionDiscoverResultItem =
  typeof SourceInspectionDiscoverResultItemSchema.Type;
export type SourceInspectionDiscoverResult =
  typeof SourceInspectionDiscoverResultSchema.Type;
