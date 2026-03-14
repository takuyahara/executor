import { type Policy, PolicySchema } from "#schema";
import * as Option from "effect/Option";
import { Schema } from "effect";
import { and, asc, desc, eq, or } from "drizzle-orm";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";
import { firstOption } from "./shared";

const decodePolicy = Schema.decodeUnknownSync(PolicySchema);

export const createPoliciesRepo = (
  client: DrizzleClient,
  tables: DrizzleTables,
) => ({
  listByOrganizationId: (organizationId: Policy["organizationId"]) =>
    client.use("rows.policies.list_by_organization", async (db) => {
      const rows = await db
        .select()
        .from(tables.policiesTable)
        .where(
          and(
            eq(tables.policiesTable.organizationId, organizationId),
            eq(tables.policiesTable.scopeType, "organization"),
          ),
        )
        .orderBy(desc(tables.policiesTable.priority), asc(tables.policiesTable.updatedAt));

      return rows.map((row) => decodePolicy(row));
    }),

  listByWorkspaceId: (workspaceId: Exclude<Policy["workspaceId"], null>) =>
    client.use("rows.policies.list_by_workspace", async (db) => {
      const rows = await db
        .select()
        .from(tables.policiesTable)
        .where(
          and(
            eq(tables.policiesTable.workspaceId, workspaceId),
            eq(tables.policiesTable.scopeType, "workspace"),
          ),
        )
        .orderBy(desc(tables.policiesTable.priority), asc(tables.policiesTable.updatedAt));

      return rows.map((row) => decodePolicy(row));
    }),

  listForWorkspaceContext: (input: {
    organizationId: Policy["organizationId"];
    workspaceId: Exclude<Policy["workspaceId"], null>;
  }) =>
    client.use("rows.policies.list_for_workspace_context", async (db) => {
      const rows = await db
        .select()
        .from(tables.policiesTable)
        .where(
          and(
            eq(tables.policiesTable.organizationId, input.organizationId),
            or(
              eq(tables.policiesTable.scopeType, "organization"),
              and(
                eq(tables.policiesTable.scopeType, "workspace"),
                eq(tables.policiesTable.workspaceId, input.workspaceId),
              ),
            ),
          ),
        )
        .orderBy(desc(tables.policiesTable.priority), asc(tables.policiesTable.updatedAt));

      return rows.map((row) => decodePolicy(row));
    }),

  getById: (policyId: Policy["id"]) =>
    client.use("rows.policies.get_by_id", async (db) => {
      const rows = await db
        .select()
        .from(tables.policiesTable)
        .where(eq(tables.policiesTable.id, policyId))
        .limit(1);

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodePolicy(row.value))
        : Option.none<Policy>();
    }),

  insert: (policy: Policy) =>
    client.use("rows.policies.insert", async (db) => {
      const { configKey: _configKey, ...row } = policy;
      await db.insert(tables.policiesTable).values(row);
    }),

  update: (
    policyId: Policy["id"],
    patch: Partial<Omit<Policy, "id" | "scopeType" | "organizationId" | "workspaceId" | "createdAt">>,
  ) =>
    client.use("rows.policies.update", async (db) => {
      const { configKey: _configKey, ...rowPatch } = patch;
      const rows = await db
        .update(tables.policiesTable)
        .set(rowPatch)
        .where(eq(tables.policiesTable.id, policyId))
        .returning();

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodePolicy(row.value))
        : Option.none<Policy>();
    }),

  removeById: (policyId: Policy["id"]) =>
    client.use("rows.policies.remove", async (db) => {
      const deleted = await db
        .delete(tables.policiesTable)
        .where(eq(tables.policiesTable.id, policyId))
        .returning();

      return deleted.length > 0;
    }),
});
