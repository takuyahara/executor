import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import * as SqlClient from "@effect/sql/SqlClient";
import * as fs from "node:fs";

import { createExecutor, scopeKv } from "@executor/sdk";
import { makeSqliteKv, makeKvConfig, migrate } from "@executor/storage-file";
import { openApiPlugin, makeKvOperationStore, type OpenApiPluginExtension } from "@executor/plugin-openapi";
import { mcpPlugin, makeKvBindingStore, type McpPluginExtension } from "@executor/plugin-mcp";
import {
  googleDiscoveryPlugin,
  makeKvBindingStore as makeKvGoogleDiscoveryBindingStore,
  type GoogleDiscoveryPluginExtension,
} from "@executor/plugin-google-discovery";
import {
  graphqlPlugin,
  makeKvOperationStore as makeKvGraphqlOperationStore,
  type GraphqlPluginExtension,
} from "@executor/plugin-graphql";
import { keychainPlugin } from "@executor/plugin-keychain";
import { fileSecretsPlugin } from "@executor/plugin-file-secrets";
import { onepasswordPlugin, type OnePasswordExtension } from "@executor/plugin-onepassword";

import type { Executor, ExecutorPlugin } from "@executor/sdk";

type ServerPlugins = readonly [
  ExecutorPlugin<"openapi", OpenApiPluginExtension>,
  ExecutorPlugin<"mcp", McpPluginExtension>,
  ExecutorPlugin<"googleDiscovery", GoogleDiscoveryPluginExtension>,
  ExecutorPlugin<"graphql", GraphqlPluginExtension>,
  ReturnType<typeof keychainPlugin>,
  ReturnType<typeof fileSecretsPlugin>,
  ExecutorPlugin<"onepassword", OnePasswordExtension>,
];
export type ServerExecutor = Executor<ServerPlugins>;
export type ServerExecutorHandle = {
  readonly executor: ServerExecutor;
  readonly dispose: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class ExecutorService extends Context.Tag("ExecutorService")<
  ExecutorService,
  ServerExecutor
>() {}

// ---------------------------------------------------------------------------
// Data directory
// ---------------------------------------------------------------------------

import { homedir } from "node:os";
import { join } from "node:path";

const resolveDataDir = (): string => {
  if (process.env.EXECUTOR_DATA_DIR) return process.env.EXECUTOR_DATA_DIR;
  const platform = process.platform;
  const home = homedir();
  if (platform === "darwin") return join(home, "Library", "Application Support", "Executor");
  if (platform === "win32") return join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Executor");
  return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "executor");
};

const DATA_DIR = resolveDataDir();

fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = `${DATA_DIR}/data.db`;

// ---------------------------------------------------------------------------
// Executor Layer — SQLite-backed, scoped to ManagedRuntime lifetime
// ---------------------------------------------------------------------------

const ExecutorLayer = Layer.effect(
  ExecutorService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* migrate.pipe(Effect.catchAll((e) => Effect.die(e)));

    const kv = makeSqliteKv(sql);
    const config = makeKvConfig(kv);

    return yield* createExecutor({
      ...config,
      plugins: [
        openApiPlugin({
          operationStore: makeKvOperationStore(kv, "openapi"),
        }),
        mcpPlugin({
          bindingStore: makeKvBindingStore(kv, "mcp"),
        }),
        googleDiscoveryPlugin({
          bindingStore: makeKvGoogleDiscoveryBindingStore(kv, "google-discovery"),
        }),
        graphqlPlugin({
          operationStore: makeKvGraphqlOperationStore(kv, "graphql"),
        }),
        keychainPlugin(),
        fileSecretsPlugin(),
        onepasswordPlugin({
          kv: scopeKv(kv, "onepassword"),
        }),
      ] as const,
    });
  }),
).pipe(
  Layer.provide(SqliteClient.layer({ filename: DB_PATH })),
);

// ---------------------------------------------------------------------------
// ManagedRuntime — shared singleton for production, scoped handles for dev HMR
// ---------------------------------------------------------------------------

export const createServerExecutorHandle = async (): Promise<ServerExecutorHandle> => {
  const runtime = ManagedRuntime.make(ExecutorLayer);
  const executor = await runtime.runPromise(ExecutorService);

  return {
    executor,
    dispose: async () => {
      await Effect.runPromise(executor.close()).catch(() => undefined);
      await runtime.dispose().catch(() => undefined);
    },
  };
};

let sharedHandlePromise: Promise<ServerExecutorHandle> | null = null;

const loadSharedHandle = (): Promise<ServerExecutorHandle> => {
  if (!sharedHandlePromise) {
    sharedHandlePromise = createServerExecutorHandle();
  }
  return sharedHandlePromise;
};

/**
 * Get the shared executor instance. The ManagedRuntime keeps the SQLite
 * connection (and everything else) alive until the process exits.
 */
export const getExecutor = (): Promise<ServerExecutor> =>
  loadSharedHandle().then((handle) => handle.executor);

/**
 * Dispose the shared executor/runtime. Mainly useful in development when the
 * backend module graph is hot-reloaded and we need fresh plugin init.
 */
export const disposeExecutor = async (): Promise<void> => {
  const currentHandlePromise = sharedHandlePromise;
  sharedHandlePromise = null;

  const handle = await currentHandlePromise?.catch(() => null);
  await handle?.dispose().catch(() => undefined);
};

/**
 * Dispose and eagerly recreate the shared executor.
 */
export const reloadExecutor = async (): Promise<ServerExecutor> => {
  await disposeExecutor();
  return getExecutor();
};

/**
 * Provide `ExecutorService` to an Effect layer using the shared runtime.
 * Used by the API handler.
 */
export const ExecutorServiceLayer = Layer.effect(
  ExecutorService,
  Effect.promise(() => getExecutor()),
);
