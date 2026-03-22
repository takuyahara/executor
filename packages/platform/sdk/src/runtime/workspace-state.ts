import {
  PolicyIdSchema,
  SourceStatusSchema,
  TimestampMsSchema,
} from "#schema";
import * as Schema from "effect/Schema";

const LocalWorkspaceSourceStateSchema = Schema.Struct({
  status: SourceStatusSchema,
  lastError: Schema.NullOr(Schema.String),
  sourceHash: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

const LocalWorkspacePolicyStateSchema = Schema.Struct({
  id: PolicyIdSchema,
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export const LocalWorkspaceStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  sources: Schema.Record({
    key: Schema.String,
    value: LocalWorkspaceSourceStateSchema,
  }),
  policies: Schema.Record({
    key: Schema.String,
    value: LocalWorkspacePolicyStateSchema,
  }),
});

export type LocalWorkspaceSourceState = typeof LocalWorkspaceSourceStateSchema.Type;
export type LocalWorkspacePolicyState = typeof LocalWorkspacePolicyStateSchema.Type;
export type LocalWorkspaceState = typeof LocalWorkspaceStateSchema.Type;

export const defaultLocalWorkspaceState = (): LocalWorkspaceState => ({
  version: 1,
  sources: {},
  policies: {},
});
