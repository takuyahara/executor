import { defineSchema, defineTable, type TablesFromSchemaDefinition } from "@executor-v2/confect";
import {
  ApprovalSchema,
  EventEnvelopeSchema,
  OAuthTokenSchema,
  OrganizationMembershipSchema,
  OrganizationSchema,
  PolicySchema,
  ProfileSchema,
  SourceCredentialBindingSchema,
  SourceSchema,
  StorageInstanceSchema,
  SyncStateSchema,
  TaskRunSchema,
  WorkspaceSchema,
} from "@executor-v2/schema";
import * as Schema from "effect/Schema";

const StorageFileEntrySchema = Schema.Struct({
  id: Schema.String,
  storageInstanceId: Schema.String,
  path: Schema.String,
  contentBase64: Schema.String,
  sizeBytes: Schema.Number,
  updatedAt: Schema.Number,
});

const StorageKvEntrySchema = Schema.Struct({
  id: Schema.String,
  storageInstanceId: Schema.String,
  key: Schema.String,
  valueJson: Schema.String,
  updatedAt: Schema.Number,
});

const StorageSqlKvEntrySchema = Schema.Struct({
  id: Schema.String,
  storageInstanceId: Schema.String,
  key: Schema.String,
  value: Schema.String,
  updatedAt: Schema.Number,
});

const OpenApiArtifactSchema = Schema.Struct({
  id: Schema.String,
  sourceHash: Schema.String,
  extractorVersion: Schema.String,
  toolCount: Schema.Number,
  refHintTableJson: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

const OpenApiArtifactToolSchema = Schema.Struct({
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

const OpenApiSourceArtifactBindingSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  sourceId: Schema.String,
  artifactId: Schema.String,
  sourceHash: Schema.String,
  extractorVersion: Schema.String,
  updatedAt: Schema.Number,
});

const GraphqlArtifactSchema = Schema.Struct({
  id: Schema.String,
  schemaHash: Schema.String,
  extractorVersion: Schema.String,
  toolCount: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

const GraphqlArtifactToolSchema = Schema.Struct({
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

const GraphqlSourceArtifactBindingSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  sourceId: Schema.String,
  artifactId: Schema.String,
  schemaHash: Schema.String,
  extractorVersion: Schema.String,
  updatedAt: Schema.Number,
});

const McpArtifactSchema = Schema.Struct({
  id: Schema.String,
  sourceHash: Schema.String,
  extractorVersion: Schema.String,
  toolCount: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

const McpArtifactToolSchema = Schema.Struct({
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

const McpSourceArtifactBindingSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  sourceId: Schema.String,
  artifactId: Schema.String,
  sourceHash: Schema.String,
  extractorVersion: Schema.String,
  updatedAt: Schema.Number,
});

export const executorConfectSchema = defineSchema({
  profiles: defineTable(ProfileSchema).index("by_domainId", ["id"]),
  organizations: defineTable(OrganizationSchema)
    .index("by_domainId", ["id"])
    .index("by_slug", ["slug"]),
  organizationMemberships: defineTable(OrganizationMembershipSchema)
    .index("by_domainId", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_accountId", ["accountId"])
    .index("by_organizationId_accountId", ["organizationId", "accountId"]),
  workspaces: defineTable(WorkspaceSchema)
    .index("by_domainId", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_createdByAccountId", ["createdByAccountId"]),
  sources: defineTable(SourceSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"]),
  openApiArtifacts: defineTable(OpenApiArtifactSchema)
    .index("by_domainId", ["id"])
    .index("by_sourceHash_extractorVersion", ["sourceHash", "extractorVersion"]),
  openApiArtifactTools: defineTable(OpenApiArtifactToolSchema)
    .index("by_domainId", ["id"])
    .index("by_artifactId", ["artifactId"])
    .index("by_artifactId_toolId", ["artifactId", "toolId"]),
  openApiSourceArtifactBindings: defineTable(OpenApiSourceArtifactBindingSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_sourceId", ["workspaceId", "sourceId"])
    .index("by_artifactId", ["artifactId"]),
  graphqlArtifacts: defineTable(GraphqlArtifactSchema)
    .index("by_domainId", ["id"])
    .index("by_schemaHash_extractorVersion", ["schemaHash", "extractorVersion"]),
  graphqlArtifactTools: defineTable(GraphqlArtifactToolSchema)
    .index("by_domainId", ["id"])
    .index("by_artifactId", ["artifactId"])
    .index("by_artifactId_toolId", ["artifactId", "toolId"]),
  graphqlSourceArtifactBindings: defineTable(GraphqlSourceArtifactBindingSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_sourceId", ["workspaceId", "sourceId"])
    .index("by_artifactId", ["artifactId"]),
  mcpArtifacts: defineTable(McpArtifactSchema)
    .index("by_domainId", ["id"])
    .index("by_sourceHash_extractorVersion", ["sourceHash", "extractorVersion"]),
  mcpArtifactTools: defineTable(McpArtifactToolSchema)
    .index("by_domainId", ["id"])
    .index("by_artifactId", ["artifactId"])
    .index("by_artifactId_toolId", ["artifactId", "toolId"]),
  mcpSourceArtifactBindings: defineTable(McpSourceArtifactBindingSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_sourceId", ["workspaceId", "sourceId"])
    .index("by_artifactId", ["artifactId"]),
  sourceCredentialBindings: defineTable(SourceCredentialBindingSchema)
    .index("by_domainId", ["id"])
    .index("by_credentialId", ["credentialId"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_organizationId", ["organizationId"])
    .index("by_accountId", ["accountId"])
    .index("by_sourceKey", ["sourceKey"]),
  oauthTokens: defineTable(OAuthTokenSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_organizationId", ["organizationId"])
    .index("by_accountId", ["accountId"])
    .index("by_sourceId", ["sourceId"]),
  policies: defineTable(PolicySchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"]),
  storageInstances: defineTable(StorageInstanceSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_organizationId", ["organizationId"]),
  storageFileEntries: defineTable(StorageFileEntrySchema)
    .index("by_domainId", ["id"])
    .index("by_storageInstanceId", ["storageInstanceId"])
    .index("by_storageInstanceId_path", ["storageInstanceId", "path"]),
  storageKvEntries: defineTable(StorageKvEntrySchema)
    .index("by_domainId", ["id"])
    .index("by_storageInstanceId", ["storageInstanceId"])
    .index("by_storageInstanceId_key", ["storageInstanceId", "key"]),
  storageSqlKvEntries: defineTable(StorageSqlKvEntrySchema)
    .index("by_domainId", ["id"])
    .index("by_storageInstanceId", ["storageInstanceId"])
    .index("by_storageInstanceId_key", ["storageInstanceId", "key"]),
  approvals: defineTable(ApprovalSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_taskRunId", ["taskRunId"])
    .index("by_taskRunId_callId", ["taskRunId", "callId"]),
  taskRuns: defineTable(TaskRunSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_sessionId", ["sessionId"]),
  syncStates: defineTable(SyncStateSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"]),
  events: defineTable(EventEnvelopeSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_sequence", ["workspaceId", "sequence"]),
});

export type ExecutorConfectTables = TablesFromSchemaDefinition<typeof executorConfectSchema>;

export default executorConfectSchema.convexSchemaDefinition;
