import { Schema } from "effect";

import { TimestampMsSchema } from "../common";
import {
  SourceIdSchema,
  SourceCatalogIdSchema,
  SourceCatalogRevisionIdSchema,
  WorkspaceIdSchema,
} from "../ids";
import { SecretRefSchema } from "./auth-artifact";
import { JsonObjectSchema } from "./source-auth-session";

export const SourceKindSchema = Schema.String;

export const SourceStatusSchema = Schema.Literal(
  "draft",
  "probing",
  "auth_required",
  "connected",
  "error",
);

export const SourceTransportSchema = Schema.Literal(
  "auto",
  "streamable-http",
  "sse",
);

export const SourceImportAuthPolicySchema = Schema.Literal(
  "none",
  "reuse_runtime",
  "separate",
);

export const SourceAuthSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("none"),
  }),
  Schema.Struct({
    kind: Schema.Literal("bearer"),
    headerName: Schema.String,
    prefix: Schema.String,
    token: SecretRefSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth2"),
    headerName: Schema.String,
    prefix: Schema.String,
    accessToken: SecretRefSchema,
    refreshToken: Schema.NullOr(SecretRefSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth2_authorized_user"),
    headerName: Schema.String,
    prefix: Schema.String,
    tokenEndpoint: Schema.String,
    clientId: Schema.String,
    clientAuthentication: Schema.Literal("none", "client_secret_post"),
    clientSecret: Schema.NullOr(SecretRefSchema),
    refreshToken: SecretRefSchema,
    grantSet: Schema.NullOr(Schema.Array(Schema.String)),
  }),
);

export const StringMapSchema = Schema.Record({
  key: Schema.String,
  value: Schema.String,
});

export const SourceBindingVersionSchema = Schema.Number;

export const SourceBindingSchema = Schema.Struct({
  version: SourceBindingVersionSchema,
  payload: JsonObjectSchema,
});

const SourceStorageRowSchema = Schema.Struct({
  workspaceId: WorkspaceIdSchema,
  sourceId: SourceIdSchema,
  catalogId: SourceCatalogIdSchema,
  catalogRevisionId: SourceCatalogRevisionIdSchema,
  name: Schema.String,
  kind: SourceKindSchema,
  endpoint: Schema.String,
  status: SourceStatusSchema,
  enabled: Schema.Boolean,
  namespace: Schema.NullOr(Schema.String),
  importAuthPolicy: SourceImportAuthPolicySchema,
  bindingConfigJson: Schema.String,
  sourceHash: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export const StoredSourceRecordSchema = Schema.transform(
  SourceStorageRowSchema,
  Schema.Struct({
    id: SourceIdSchema,
    workspaceId: WorkspaceIdSchema,
    catalogId: SourceCatalogIdSchema,
    catalogRevisionId: SourceCatalogRevisionIdSchema,
    name: Schema.String,
    kind: SourceKindSchema,
    endpoint: Schema.String,
    status: SourceStatusSchema,
    enabled: Schema.Boolean,
    namespace: Schema.NullOr(Schema.String),
    importAuthPolicy: SourceImportAuthPolicySchema,
    bindingConfigJson: Schema.String,
    sourceHash: Schema.NullOr(Schema.String),
    lastError: Schema.NullOr(Schema.String),
    createdAt: TimestampMsSchema,
    updatedAt: TimestampMsSchema,
  }),
  {
    strict: false,
    decode: (row) => ({
      id: row.sourceId,
      workspaceId: row.workspaceId,
      catalogId: row.catalogId,
      catalogRevisionId: row.catalogRevisionId,
      name: row.name,
      kind: row.kind,
      endpoint: row.endpoint,
      status: row.status,
      enabled: row.enabled,
      namespace: row.namespace,
      importAuthPolicy: row.importAuthPolicy,
      bindingConfigJson: row.bindingConfigJson,
      sourceHash: row.sourceHash,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
    encode: (source) => ({
      workspaceId: source.workspaceId,
      sourceId: source.id,
      catalogId: source.catalogId,
      catalogRevisionId: source.catalogRevisionId,
      name: source.name,
      kind: source.kind,
      endpoint: source.endpoint,
      status: source.status,
      enabled: source.enabled,
      namespace: source.namespace,
      importAuthPolicy: source.importAuthPolicy,
      bindingConfigJson: source.bindingConfigJson,
      sourceHash: source.sourceHash,
      lastError: source.lastError,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    }),
  },
);

export const SourceSchema = Schema.Struct({
  id: SourceIdSchema,
  workspaceId: WorkspaceIdSchema,
  name: Schema.String,
  kind: SourceKindSchema,
  endpoint: Schema.String,
  status: SourceStatusSchema,
  enabled: Schema.Boolean,
  namespace: Schema.NullOr(Schema.String),
  bindingVersion: SourceBindingVersionSchema,
  binding: JsonObjectSchema,
  importAuthPolicy: SourceImportAuthPolicySchema,
  importAuth: SourceAuthSchema,
  auth: SourceAuthSchema,
  sourceHash: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export type SourceKind = typeof SourceKindSchema.Type;
export type SourceStatus = typeof SourceStatusSchema.Type;
export type SourceTransport = typeof SourceTransportSchema.Type;
export type SourceImportAuthPolicy = typeof SourceImportAuthPolicySchema.Type;
export type SourceAuth = typeof SourceAuthSchema.Type;
export type SourceBinding = typeof SourceBindingSchema.Type;
export type StoredSourceRecord = typeof StoredSourceRecordSchema.Type;
export type StringMap = typeof StringMapSchema.Type;
export type Source = typeof SourceSchema.Type;
