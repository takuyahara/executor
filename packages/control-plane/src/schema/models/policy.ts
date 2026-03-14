import {
  createSelectSchema,
} from "drizzle-orm/effect-schema";
import { Schema } from "effect";

import { policiesTable } from "../../persistence/schema";
import { TimestampMsSchema } from "../common";
import {
  AccountIdSchema,
  OrganizationIdSchema,
  PolicyIdSchema,
  WorkspaceIdSchema,
} from "../ids";

export const PolicyScopeTypeSchema = Schema.Literal("organization", "workspace");

export const PolicyResourceTypeSchema = Schema.Literal(
  "all_tools",
  "source",
  "namespace",
  "tool_path",
);

export const PolicyMatchTypeSchema = Schema.Literal("glob", "exact");
export const PolicyEffectSchema = Schema.Literal("allow", "deny");
export const PolicyApprovalModeSchema = Schema.Literal("auto", "required");

export const ArgumentConditionOperatorSchema = Schema.Literal(
  "equals",
  "contains",
  "starts_with",
  "not_equals",
);

export const PolicyArgumentConditionSchema = Schema.Struct({
  key: Schema.String,
  operator: ArgumentConditionOperatorSchema,
  value: Schema.String,
});

const policySchemaOverrides = {
  id: PolicyIdSchema,
  scopeType: PolicyScopeTypeSchema,
  organizationId: OrganizationIdSchema,
  workspaceId: Schema.NullOr(WorkspaceIdSchema),
  targetAccountId: Schema.NullOr(AccountIdSchema),
  clientId: Schema.NullOr(Schema.String),
  resourceType: PolicyResourceTypeSchema,
  matchType: PolicyMatchTypeSchema,
  effect: PolicyEffectSchema,
  approvalMode: PolicyApprovalModeSchema,
  argumentConditionsJson: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
} as const;

const PolicyStorageSchema = createSelectSchema(policiesTable, policySchemaOverrides);

const PolicyTypeSchema = Schema.Struct({
  id: PolicyIdSchema,
  configKey: Schema.NullOr(Schema.String),
  scopeType: PolicyScopeTypeSchema,
  organizationId: OrganizationIdSchema,
  workspaceId: Schema.NullOr(WorkspaceIdSchema),
  targetAccountId: Schema.NullOr(AccountIdSchema),
  clientId: Schema.NullOr(Schema.String),
  resourceType: PolicyResourceTypeSchema,
  resourcePattern: Schema.String,
  matchType: PolicyMatchTypeSchema,
  effect: PolicyEffectSchema,
  approvalMode: PolicyApprovalModeSchema,
  argumentConditionsJson: Schema.NullOr(Schema.String),
  priority: Schema.Number,
  enabled: Schema.Boolean,
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export const PolicySchema = Schema.transform(
  PolicyStorageSchema,
  PolicyTypeSchema,
  {
    strict: false,
    decode: (row, _input) => ({
      ...row,
      configKey: null,
    }),
    encode: (policy, _output) => ({
      id: policy.id,
      scopeType: policy.scopeType,
      organizationId: policy.organizationId,
      workspaceId: policy.workspaceId,
      targetAccountId: policy.targetAccountId,
      clientId: policy.clientId,
      resourceType: policy.resourceType,
      resourcePattern: policy.resourcePattern,
      matchType: policy.matchType,
      effect: policy.effect,
      approvalMode: policy.approvalMode,
      argumentConditionsJson: policy.argumentConditionsJson,
      priority: policy.priority,
      enabled: policy.enabled,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    }),
  },
);

export const PolicyInsertSchema = PolicyTypeSchema;
export const PolicyUpdateSchema = Schema.partial(PolicyTypeSchema);

export type PolicyResourceType = typeof PolicyResourceTypeSchema.Type;
export type PolicyMatchType = typeof PolicyMatchTypeSchema.Type;
export type PolicyEffect = typeof PolicyEffectSchema.Type;
export type PolicyApprovalMode = typeof PolicyApprovalModeSchema.Type;
export type PolicyScopeType = typeof PolicyScopeTypeSchema.Type;
export type ArgumentConditionOperator =
  typeof ArgumentConditionOperatorSchema.Type;
export type PolicyArgumentCondition = typeof PolicyArgumentConditionSchema.Type;
export type Policy = typeof PolicySchema.Type;
