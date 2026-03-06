import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Schema } from "effect";

import { sourceAuthSessionsTable } from "../../persistence/schema";
import { TimestampMsSchema } from "../common";
import {
  ExecutionIdSchema,
  ExecutionInteractionIdSchema,
  SourceAuthSessionIdSchema,
  SourceIdSchema,
  WorkspaceIdSchema,
} from "../ids";

export const SourceAuthSessionStrategySchema = Schema.Literal(
  "oauth2_authorization_code",
);

export const SourceAuthSessionStatusSchema = Schema.Literal(
  "pending",
  "completed",
  "failed",
  "cancelled",
);

const sourceAuthSessionSchemaOverrides = {
  id: SourceAuthSessionIdSchema,
  workspaceId: WorkspaceIdSchema,
  sourceId: SourceIdSchema,
  executionId: Schema.NullOr(ExecutionIdSchema),
  interactionId: Schema.NullOr(ExecutionInteractionIdSchema),
  strategy: SourceAuthSessionStrategySchema,
  status: SourceAuthSessionStatusSchema,
  completedAt: Schema.NullOr(TimestampMsSchema),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
} as const;

export const SourceAuthSessionSchema = createSelectSchema(
  sourceAuthSessionsTable,
  sourceAuthSessionSchemaOverrides,
);

export type SourceAuthSessionStrategy = typeof SourceAuthSessionStrategySchema.Type;
export type SourceAuthSessionStatus = typeof SourceAuthSessionStatusSchema.Type;
export type SourceAuthSession = typeof SourceAuthSessionSchema.Type;
