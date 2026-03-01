import { type UpsertPolicyPayload } from "@executor-v2/management-api";
import { PolicySchema, type Policy } from "@executor-v2/schema";
import { v } from "convex/values";
import * as Schema from "effect/Schema";

import { mutation, query } from "../_generated/server";

const decodePolicy = Schema.decodeUnknownSync(PolicySchema);

const stripConvexSystemFields = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...rest } = value;
  return rest;
};

const toPolicy = (document: Record<string, unknown>): Policy =>
  decodePolicy(stripConvexSystemFields(document));

const policyDecisionValidator = v.union(
  v.literal("allow"),
  v.literal("require_approval"),
  v.literal("deny"),
);

const sortPolicies = (policies: ReadonlyArray<Policy>): Array<Policy> =>
  [...policies].sort((left, right) => {
    const leftPattern = left.toolPathPattern.toLowerCase();
    const rightPattern = right.toolPathPattern.toLowerCase();

    if (leftPattern === rightPattern) {
      return left.id.localeCompare(right.id);
    }

    return leftPattern.localeCompare(rightPattern);
  });

export const listPolicies = query({
  args: {
    workspaceId: v.string(),
  },
  handler: async (ctx, args): Promise<Array<Policy>> => {
    const rows = await ctx.db
      .query("policies")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return sortPolicies(
      rows.map((row) => toPolicy(row as unknown as Record<string, unknown>)),
    );
  },
});

export const upsertPolicy = mutation({
  args: {
    workspaceId: v.string(),
    payload: v.object({
      id: v.optional(v.string()),
      toolPathPattern: v.string(),
      decision: policyDecisionValidator,
    }),
  },
  handler: async (ctx, args): Promise<Policy> => {
    const payload = args.payload as UpsertPolicyPayload;
    const now = Date.now();
    const policyId = payload.id ?? `pol_${crypto.randomUUID()}`;

    const existing = await ctx.db
      .query("policies")
      .withIndex("by_domainId", (q) => q.eq("id", policyId))
      .unique();

    if (existing && existing.workspaceId !== args.workspaceId) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    const nextPolicy = decodePolicy({
      id: policyId,
      workspaceId: args.workspaceId,
      toolPathPattern: payload.toolPathPattern,
      decision: payload.decision,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    if (existing) {
      await ctx.db.patch(existing._id, nextPolicy);
    } else {
      await ctx.db.insert("policies", nextPolicy);
    }

    return nextPolicy;
  },
});

export const removePolicy = mutation({
  args: {
    workspaceId: v.string(),
    policyId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    removed: boolean;
  }> => {
    const existing = await ctx.db
      .query("policies")
      .withIndex("by_domainId", (q) => q.eq("id", args.policyId))
      .unique();

    if (!existing || existing.workspaceId !== args.workspaceId) {
      return { removed: false };
    }

    await ctx.db.delete(existing._id);

    return { removed: true };
  },
});
