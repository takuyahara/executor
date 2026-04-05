import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import * as SqlClient from "@effect/sql/SqlClient";
import { NodeFileSystem } from "@effect/platform-node";
import * as fs from "node:fs";

import { createExecutor, scopeKv } from "@executor/sdk";
import {
  makeSqliteKv,
  makeKvConfig,
  makeScopedKv,
  migrate,
} from "@executor/storage-file";
import { withConfigFile, loadConfig, SECRET_REF_PREFIX, type ConfigHeaderValue } from "@executor/config";
import {
  openApiPlugin,
  makeKvOperationStore,
  type OpenApiPluginExtension,
} from "@executor/plugin-openapi";
import {
  mcpPlugin,
  makeKvBindingStore,
  type McpPluginExtension,
} from "@executor/plugin-mcp";
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
import {
  onepasswordPlugin,
  type OnePasswordExtension,
} from "@executor/plugin-onepassword";

import type { Executor, ExecutorPlugin } from "@executor/sdk";

type ServerPlugins = readonly [
  ExecutorPlugin<"openapi", OpenApiPluginExtension>,
  ExecutorPlugin<"mcp", McpPluginExtension>,
  ExecutorPlugin<"googleDiscovery", GoogleDiscoveryPluginExtension>,
  ExecutorPlugin<"graphql", GraphqlPluginExtension>,
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
import { dirname, join, resolve } from "node:path";

const resolveDataDir = (): string => {
  if (process.env.EXECUTOR_DATA_DIR) return process.env.EXECUTOR_DATA_DIR;
  return join(homedir(), ".executor");
};

const DATA_DIR = resolveDataDir();

fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = `${DATA_DIR}/data.db`;

const hasWorkspacePackage = (dir: string): boolean => {
  try {
    const path = join(dir, "package.json");
    if (!fs.existsSync(path)) return false;
    const parsed = JSON.parse(fs.readFileSync(path, "utf8")) as { workspaces?: unknown };
    return Array.isArray(parsed.workspaces);
  } catch {
    return false;
  }
};

const resolveExecutorRoot = (startDir: string): string => {
  let current = resolve(startDir);
  let fallback = current;

  for (;;) {
    if (fs.existsSync(join(current, "executor.jsonc"))) {
      return current;
    }

    if (fs.existsSync(join(current, ".git")) || hasWorkspacePackage(current)) {
      fallback = current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return fallback;
    }
    current = parent;
  }
};

const toInvocationHeaders = (
  headers: Record<string, ConfigHeaderValue> | undefined,
): Record<string, string | { readonly secretId: string; readonly prefix?: string }> | undefined => {
  if (!headers) return undefined;

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      if (typeof value === "string") {
        return [
          key,
          value.startsWith(SECRET_REF_PREFIX)
            ? { secretId: value.slice(SECRET_REF_PREFIX.length) }
            : value,
        ];
      }

      const rawValue = value.value;
      return [
        key,
        rawValue.startsWith(SECRET_REF_PREFIX)
          ? {
              secretId: rawValue.slice(SECRET_REF_PREFIX.length),
              ...(value.prefix ? { prefix: value.prefix } : {}),
            }
          : rawValue,
      ];
    }),
  );
};

// ---------------------------------------------------------------------------
// Executor Layer — SQLite-backed, scoped to ManagedRuntime lifetime
// ---------------------------------------------------------------------------

const ExecutorLayer = Layer.effect(
  ExecutorService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* migrate.pipe(Effect.catchAll((e) => Effect.die(e)));

    const executorRoot = resolveExecutorRoot(process.cwd());
    const kv = makeSqliteKv(sql);
    const config = makeKvConfig(kv, { cwd: executorRoot });
    const scopedKv = makeScopedKv(kv, executorRoot);

    const configPath = join(executorRoot, "executor.jsonc");
    const fsLayer = NodeFileSystem.layer;

    const executor = yield* createExecutor({
      ...config,
      plugins: [
        openApiPlugin({
          operationStore: withConfigFile.openapi(
            makeKvOperationStore(scopedKv, "openapi"),
            configPath,
            fsLayer,
          ),
        }),
        mcpPlugin({
          bindingStore: withConfigFile.mcp(
            makeKvBindingStore(scopedKv, "mcp"),
            configPath,
            fsLayer,
          ),
        }),
        googleDiscoveryPlugin({
          bindingStore: makeKvGoogleDiscoveryBindingStore(
            scopedKv,
            "google-discovery",
          ),
        }),
        graphqlPlugin({
          operationStore: withConfigFile.graphql(
            makeKvGraphqlOperationStore(scopedKv, "graphql"),
            configPath,
            fsLayer,
          ),
        }),
        // keychainPlugin(),
        fileSecretsPlugin(),
        onepasswordPlugin({
          kv: scopeKv(scopedKv, "onepassword"),
        }),
      ] as const,
    });

    const fileConfig = yield* loadConfig(configPath).pipe(
      Effect.provide(fsLayer),
      Effect.catchAll((e) => Effect.die(e)),
    );

    if (fileConfig?.sources) {
      const existingSources = new Set((yield* executor.sources.list()).map((source) => source.id));

      for (const source of fileConfig.sources) {
        if (source.namespace && existingSources.has(source.namespace)) {
          continue;
        }

        if (source.kind === "openapi") {
          yield* executor.openapi.addSpec({
            spec: source.spec,
            ...(source.baseUrl ? { baseUrl: source.baseUrl } : {}),
            ...(source.namespace ? { namespace: source.namespace } : {}),
            ...(source.headers ? { headers: toInvocationHeaders(source.headers) } : {}),
          }).pipe(Effect.catchAll((e) => Effect.die(e)));
          continue;
        }

        if (source.kind === "graphql") {
          yield* executor.graphql.addSource({
            endpoint: source.endpoint,
            ...(source.introspectionJson ? { introspectionJson: source.introspectionJson } : {}),
            ...(source.namespace ? { namespace: source.namespace } : {}),
            ...(source.headers ? { headers: toInvocationHeaders(source.headers) } : {}),
          }).pipe(Effect.catchAll((e) => Effect.die(e)));
          continue;
        }

        yield* executor.mcp.addSource(
          source.transport === "stdio"
            ? {
                transport: "stdio",
                name: source.name,
                command: source.command,
                ...(source.args ? { args: [...source.args] } : {}),
                ...(source.env ? { env: source.env } : {}),
                ...(source.cwd ? { cwd: source.cwd } : {}),
                ...(source.namespace ? { namespace: source.namespace } : {}),
              }
            : {
                transport: "remote",
                name: source.name,
                endpoint: source.endpoint,
                ...(source.remoteTransport ? { remoteTransport: source.remoteTransport } : {}),
                ...(source.queryParams ? { queryParams: source.queryParams } : {}),
                ...(source.headers ? { headers: source.headers } : {}),
                ...(source.namespace ? { namespace: source.namespace } : {}),
              },
        ).pipe(Effect.catchAll((e) => Effect.die(e)));
      }
    }

    return executor;
  }),
).pipe(Layer.provide(SqliteClient.layer({ filename: DB_PATH })));

// ---------------------------------------------------------------------------
// ManagedRuntime — shared singleton for production, scoped handles for dev HMR
// ---------------------------------------------------------------------------

export const createServerExecutorHandle =
  async (): Promise<ServerExecutorHandle> => {
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
