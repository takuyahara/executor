// ---------------------------------------------------------------------------
// Database service — PGlite for dev, node-postgres for prod
// ---------------------------------------------------------------------------

import { Context, Effect, Layer } from "effect";
import { resolve } from "node:path";
import * as sharedSchema from "@executor/storage-postgres";
import * as cloudSchema from "./schema";
import type { DrizzleDb } from "@executor/storage-postgres";

const schema = { ...sharedSchema, ...cloudSchema };

export type { DrizzleDb };

const MIGRATIONS_DIR = resolve(
  import.meta.dirname,
  "../../../../packages/core/storage-postgres/drizzle",
);

let dbPromise: Promise<DrizzleDb> | undefined;

const createDb = async (): Promise<DrizzleDb> => {
  if (process.env.DATABASE_URL) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool, { schema }) as DrizzleDb;
    await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR });
    return db;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DATA_DIR ?? ".pglite";
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema }) as DrizzleDb;
  await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR });
  return db;
};

const getOrCreateDb = async (): Promise<DrizzleDb> => {
  if (!dbPromise) {
    dbPromise = createDb().catch((error) => {
      dbPromise = undefined;
      throw error;
    });
  }
  return dbPromise;
};

export class DbService extends Context.Tag("@executor/cloud/DbService")<
  DbService,
  DrizzleDb
>() {
  static Live = Layer.effect(
    this,
    Effect.promise(getOrCreateDb),
  );
}
