import {
  type Source,
  type SqlControlPlaneRuntime,
  type ResolveExecutionEnvironment,
} from "@executor-v3/control-plane";
import {
  type ToolMap,
  createToolCatalogFromTools,
  createSystemToolMap,
  makeToolInvokerFromTools,
  mergeToolMaps,
} from "@executor-v3/codemode-core";
import { createSdkMcpConnector, discoverMcpToolsFromConnector } from "@executor-v3/codemode-mcp";
import {
  createOpenApiToolsFromSpec,
  fetchOpenApiDocument,
} from "@executor-v3/codemode-openapi";
import { makeInProcessExecutor } from "@executor-v3/runtime-local-inproc";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const McpSourceConfigSchema = Schema.Struct({
  namespace: Schema.optional(Schema.String),
  transport: Schema.optional(Schema.Literal("auto", "streamable-http", "sse")),
  queryParams: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  headers: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
}).pipe(Schema.partialWith({ exact: true }));

const decodeMcpSourceConfig = Schema.decodeUnknown(McpSourceConfigSchema);

const OpenApiSourceConfigSchema = Schema.Struct({
  namespace: Schema.optional(Schema.String),
  specUrl: Schema.optional(Schema.String),
  credentialEnvVar: Schema.optional(Schema.String),
  credentialHeader: Schema.optional(Schema.String),
  credentialPrefix: Schema.optional(Schema.String),
  defaultHeaders: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
}).pipe(Schema.partialWith({ exact: true }));

const decodeOpenApiSourceConfig = Schema.decodeUnknown(OpenApiSourceConfigSchema);

const namespaceFromSourceName = (name: string): string => {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return normalized.length > 0 ? normalized : "source";
};

const loadWorkspaceSourceTools = (input: {
  runtime: SqlControlPlaneRuntime;
  workspaceId: Parameters<SqlControlPlaneRuntime["persistence"]["rows"]["sources"]["listByWorkspaceId"]>[0];
}): Effect.Effect<
  {
    tools: ToolMap;
    catalog: ReturnType<typeof createToolCatalogFromTools>;
  },
  Error,
  never
> =>
  Effect.gen(function* () {
    const sources: ReadonlyArray<Source> = yield* input.runtime.persistence.rows.sources
      .listByWorkspaceId(input.workspaceId)
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );

    const enabledSources = sources.filter((source) => source.enabled);

    const discoveredToolMaps = yield* Effect.forEach(
      enabledSources,
      (source: Source) =>
        Effect.gen(function* () {
          if (source.kind === "mcp") {
            const rawConfig = yield* Effect.try({
              try: () => (source.configJson.length > 0 ? JSON.parse(source.configJson) : {}),
              catch: (cause) =>
                new Error(
                  `Invalid JSON config for source ${source.id}: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`,
                ),
            });

            const config = yield* decodeMcpSourceConfig(rawConfig).pipe(
              Effect.mapError(
                (cause) =>
                  new Error(
                    `Invalid MCP source config for ${source.id}: ${
                      cause instanceof Error ? cause.message : String(cause)
                    }`,
                  ),
              ),
            );

            const connector = yield* Effect.try({
              try: () =>
                createSdkMcpConnector({
                  endpoint: source.endpoint,
                  transport: config.transport,
                  queryParams: config.queryParams,
                  headers: config.headers,
                }),
              catch: (cause) =>
                new Error(
                  `Failed creating MCP connector for ${source.id}: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`,
                ),
            });

            const discovered = yield* discoverMcpToolsFromConnector({
              connect: connector,
              namespace: config.namespace ?? namespaceFromSourceName(source.name),
              sourceKey: source.id,
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new Error(
                    `Failed discovering MCP tools for ${source.id}: ${
                      cause instanceof Error ? cause.message : String(cause)
                    }`,
                  ),
              ),
            );

            return discovered.tools;
          }

          if (source.kind === "openapi") {
            const rawConfig = yield* Effect.try({
              try: () => (source.configJson.length > 0 ? JSON.parse(source.configJson) : {}),
              catch: (cause) =>
                new Error(
                  `Invalid JSON config for source ${source.id}: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`,
                ),
            });

            const config = yield* decodeOpenApiSourceConfig(rawConfig).pipe(
              Effect.mapError(
                (cause) =>
                  new Error(
                    `Invalid OpenAPI source config for ${source.id}: ${
                      cause instanceof Error ? cause.message : String(cause)
                    }`,
                  ),
              ),
            );

            const specUrl = config.specUrl?.trim();
            if (!specUrl) {
              return yield* Effect.fail(
                new Error(`Missing OpenAPI specUrl for source ${source.id}`),
              );
            }

            const openApiDocument = yield* Effect.tryPromise({
              try: () => fetchOpenApiDocument(specUrl),
              catch: (cause) =>
                new Error(
                  `Failed fetching OpenAPI spec for ${source.id}: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`,
                ),
            });

            const defaultHeaders = config.defaultHeaders ?? {};
            const credentialHeader = config.credentialHeader?.trim() || "Authorization";
            const credentialPrefix = config.credentialPrefix ?? "Bearer ";
            const credentialEnvVar = config.credentialEnvVar?.trim();
            const credentialValue = credentialEnvVar
              ? process.env[credentialEnvVar]?.trim()
              : undefined;
            const credentialHeaders =
              credentialEnvVar && credentialValue
                ? {
                    [credentialHeader]: `${credentialPrefix}${credentialValue}`,
                  }
                : {};

            const extracted = yield* createOpenApiToolsFromSpec({
              sourceName: source.name,
              openApiSpec: openApiDocument,
              baseUrl: source.endpoint,
              namespace: config.namespace ?? namespaceFromSourceName(source.name),
              sourceKey: source.id,
              defaultHeaders,
              credentialHeaders,
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new Error(
                    `Failed loading OpenAPI tools for ${source.id}: ${
                      cause instanceof Error ? cause.message : String(cause)
                    }`,
                  ),
              ),
            );

            return extracted.tools;
          }

          return {};
        }),
      { concurrency: "unbounded" },
    );

    const sourceTools = yield* Effect.try({
      try: () =>
        mergeToolMaps(discoveredToolMaps, {
          conflictMode: "throw",
        }),
      catch: (cause) =>
        new Error(
          `Failed merging discovered source tools: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        ),
    });
    const catalog = yield* Effect.try({
      try: () => createToolCatalogFromTools({ tools: sourceTools }),
      catch: (cause) =>
        new Error(
          `Failed creating tool catalog from source tools: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        ),
    });
    const allTools = yield* Effect.try({
      try: () =>
        mergeToolMaps([sourceTools, createSystemToolMap({ catalog })]),
      catch: (cause) =>
        new Error(
          `Failed creating source execution tool map: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        ),
    });

    return {
      tools: allTools,
      catalog,
    };
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
    ),
  );

export const makeControlPlaneExecutionResolver = (
  getRuntime: () => SqlControlPlaneRuntime | null,
): ResolveExecutionEnvironment =>
  (input) =>
    Effect.gen(function* () {
      const runtime = getRuntime();
      if (runtime === null) {
        return yield* Effect.fail(
          new Error("Control-plane runtime is not ready"),
        );
      }

      const loaded = yield* loadWorkspaceSourceTools({
        runtime,
        workspaceId: input.workspaceId,
      });

      return {
        executor: makeInProcessExecutor(),
        toolInvoker: makeToolInvokerFromTools({
          tools: loaded.tools,
          onElicitation: input.onElicitation,
        }),
        catalog: loaded.catalog,
      };
    });
