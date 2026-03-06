import {
  type SecretMaterial,
  SecretMaterialSchema,
} from "#schema";
import * as Option from "effect/Option";
import { Schema } from "effect";
import { eq } from "drizzle-orm";

import type { DrizzleClient } from "../client";
import type { DrizzleTables } from "../schema";
import { firstOption, withoutCreatedAt } from "./shared";

const decodeSecretMaterial = Schema.decodeUnknownSync(SecretMaterialSchema);

export const createSecretMaterialsRepo = (
  client: DrizzleClient,
  tables: DrizzleTables,
) => ({
  getById: (id: SecretMaterial["id"]) =>
    client.use("rows.secret_materials.get_by_id", async (db) => {
      const rows = await db
        .select()
        .from(tables.secretMaterialsTable)
        .where(eq(tables.secretMaterialsTable.id, id))
        .limit(1);

      const row = firstOption(rows);
      return Option.isSome(row)
        ? Option.some(decodeSecretMaterial(row.value))
        : Option.none<SecretMaterial>();
    }),

  upsert: (material: SecretMaterial) =>
    client.use("rows.secret_materials.upsert", async (db) => {
      await db
        .insert(tables.secretMaterialsTable)
        .values(material)
        .onConflictDoUpdate({
          target: [tables.secretMaterialsTable.id],
          set: {
            ...withoutCreatedAt(material),
          },
        });
    }),

  removeById: (id: SecretMaterial["id"]) =>
    client.use("rows.secret_materials.remove", async (db) => {
      const deleted = await db
        .delete(tables.secretMaterialsTable)
        .where(eq(tables.secretMaterialsTable.id, id))
        .returning();

      return deleted.length > 0;
    }),
});
