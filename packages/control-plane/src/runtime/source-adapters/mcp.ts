import {
  applyCookiePlacementsToHeaders,
} from "@executor/codemode-core";
import {
  createSdkMcpConnector,
  discoverMcpToolsFromConnector,
  type McpToolManifest,
  type McpToolManifestEntry,
} from "@executor/codemode-mcp";
import type {
  Source,
} from "#schema";
import {
  SourceTransportSchema,
  StringMapSchema,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  createMcpCatalogSnapshot,
  type McpCatalogOperationInput,
} from "../source-catalog-snapshot";
import {
  contentHash,
  type SourceCatalogSyncResult,
} from "../source-catalog-support";
import { namespaceFromSourceName } from "../source-names";
import type { SourceAdapter } from "./types";
import {
  decodeBindingConfig,
  decodeSourceBindingPayload,
  emptySourceBindingState,
  encodeBindingConfig,
  McpConnectFieldsSchema,
  OptionalNullableStringSchema,
  SourceConnectCommonFieldsSchema,
} from "./shared";

const headersWithAuthCookies = (input: {
  headers: Readonly<Record<string, string>>;
  authHeaders: Readonly<Record<string, string>>;
  authCookies: Readonly<Record<string, string>>;
}): Record<string, string> =>
  applyCookiePlacementsToHeaders({
    headers: {
      ...input.headers,
      ...input.authHeaders,
    },
    cookies: input.authCookies,
  });

const McpConnectPayloadSchema = Schema.extend(
  SourceConnectCommonFieldsSchema,
  Schema.extend(
    McpConnectFieldsSchema,
    Schema.Struct({
      kind: Schema.Literal("mcp"),
    }),
  ),
);

const McpExecutorAddInputSchema = Schema.Struct({
  kind: Schema.optional(Schema.Literal("mcp")),
  endpoint: Schema.String,
  name: OptionalNullableStringSchema,
  namespace: OptionalNullableStringSchema,
});

const McpBindingConfigSchema = Schema.Struct({
  transport: Schema.NullOr(SourceTransportSchema),
  queryParams: Schema.NullOr(StringMapSchema),
  headers: Schema.NullOr(StringMapSchema),
});

type McpBindingConfig = typeof McpBindingConfigSchema.Type;

const McpSourceBindingPayloadSchema = Schema.Struct({
  transport: Schema.optional(Schema.NullOr(SourceTransportSchema)),
  queryParams: Schema.optional(Schema.NullOr(StringMapSchema)),
  headers: Schema.optional(Schema.NullOr(StringMapSchema)),
});

const MCP_BINDING_CONFIG_VERSION = 1;

const bindingHasAnyField = (
  value: unknown,
  fields: readonly string[],
): boolean =>
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && fields.some((field) => Object.prototype.hasOwnProperty.call(value, field));

const mcpBindingConfigFromSource = (
  source: Pick<Source, "id" | "bindingVersion" | "binding">,
): Effect.Effect<McpBindingConfig, Error, never> =>
  Effect.gen(function* () {
    if (bindingHasAnyField(source.binding, ["specUrl"])) {
      return yield* Effect.fail(new Error("MCP sources cannot define specUrl"));
    }
    if (bindingHasAnyField(source.binding, ["defaultHeaders"])) {
      return yield* Effect.fail(
        new Error("MCP sources cannot define HTTP source settings"),
      );
    }

    const bindingConfig = yield* decodeSourceBindingPayload({
      sourceId: source.id,
      label: "MCP",
      version: source.bindingVersion,
      expectedVersion: MCP_BINDING_CONFIG_VERSION,
      schema: McpSourceBindingPayloadSchema,
      value: source.binding,
      allowedKeys: ["transport", "queryParams", "headers"],
    });

    return {
      transport: bindingConfig.transport ?? null,
      queryParams: bindingConfig.queryParams ?? null,
      headers: bindingConfig.headers ?? null,
    } satisfies McpBindingConfig;
  });

const mcpCatalogOperationFromManifestEntry = (entry: McpToolManifestEntry): McpCatalogOperationInput => ({
  toolId: entry.toolId,
  title: entry.toolName,
  description: entry.description ?? null,
  effect: "action",
  inputSchema: entry.inputSchema,
  outputSchema: entry.outputSchema,
  providerData: {
    toolId: entry.toolId,
    toolName: entry.toolName,
    description: entry.description ?? null,
  },
});

export const catalogSyncResultFromMcpManifestEntries = (input: {
  source: Source;
  endpoint: string;
  manifestEntries: readonly McpToolManifestEntry[];
}): SourceCatalogSyncResult => {
  const now = Date.now();
  const manifest: McpToolManifest = {
    version: 1,
    tools: input.manifestEntries,
  };
  const manifestJson = JSON.stringify(manifest);
  const manifestHash = contentHash(manifestJson);

  return {
    snapshot: createMcpCatalogSnapshot({
      source: input.source,
      documents: [{
        documentKind: "mcp_manifest",
        documentKey: input.endpoint,
        contentText: manifestJson,
        fetchedAt: now,
      }],
      operations: input.manifestEntries.map(mcpCatalogOperationFromManifestEntry),
    }),
    sourceHash: manifestHash,
  };
};

export const mcpSourceAdapter: SourceAdapter = {
  key: "mcp",
  displayName: "MCP",
  family: "mcp",
  bindingConfigVersion: MCP_BINDING_CONFIG_VERSION,
  providerKey: "generic_mcp",
  defaultImportAuthPolicy: "reuse_runtime",
  connectPayloadSchema: McpConnectPayloadSchema,
  executorAddInputSchema: McpExecutorAddInputSchema,
  executorAddHelpText: [
    'Omit kind or set kind: "mcp". endpoint is the MCP server URL.',
  ],
  executorAddInputSignatureWidth: 240,
  serializeBindingConfig: (source) =>
    encodeBindingConfig({
      adapterKey: "mcp",
      version: MCP_BINDING_CONFIG_VERSION,
      payloadSchema: McpBindingConfigSchema,
      payload: Effect.runSync(mcpBindingConfigFromSource(source)),
    }),
  deserializeBindingConfig: ({ id, bindingConfigJson }) =>
    Effect.map(
      decodeBindingConfig({
        sourceId: id,
        label: "MCP",
        adapterKey: "mcp",
        version: MCP_BINDING_CONFIG_VERSION,
        payloadSchema: McpBindingConfigSchema,
        value: bindingConfigJson,
      }),
      ({ version, payload }) => ({
        version,
        payload,
      }),
    ),
  bindingStateFromSource: (source) =>
    Effect.map(mcpBindingConfigFromSource(source), (bindingConfig) => ({
        ...emptySourceBindingState,
        transport: bindingConfig.transport,
        queryParams: bindingConfig.queryParams,
        headers: bindingConfig.headers,
      }),
    ),
  sourceConfigFromSource: (source) =>
    Effect.runSync(
      Effect.map(mcpBindingConfigFromSource(source), (bindingConfig) => ({
        kind: "mcp",
        endpoint: source.endpoint,
        transport: bindingConfig.transport,
        queryParams: bindingConfig.queryParams,
        headers: bindingConfig.headers,
      })),
    ),
  validateSource: (source) =>
    Effect.gen(function* () {
      const bindingConfig = yield* mcpBindingConfigFromSource(source);

      return {
        ...source,
        bindingVersion: MCP_BINDING_CONFIG_VERSION,
        binding: {
          transport: bindingConfig.transport,
          queryParams: bindingConfig.queryParams,
          headers: bindingConfig.headers,
        },
      };
    }),
  shouldAutoProbe: () => false,
  syncCatalog: ({ source, resolveAuthMaterialForSlot }) =>
    Effect.gen(function* () {
      const bindingConfig = yield* mcpBindingConfigFromSource(source);
      const auth = yield* resolveAuthMaterialForSlot("import");
      const connector = yield* Effect.try({
        try: () =>
          createSdkMcpConnector({
            endpoint: source.endpoint,
            transport: bindingConfig.transport ?? undefined,
            queryParams: {
              ...(bindingConfig.queryParams ?? {}),
              ...auth.queryParams,
            },
            headers: headersWithAuthCookies({
              headers: bindingConfig.headers ?? {},
              authHeaders: auth.headers,
              authCookies: auth.cookies,
            }),
          }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });

      const discovered = yield* discoverMcpToolsFromConnector({
        connect: connector,
        namespace: source.namespace ?? namespaceFromSourceName(source.name),
        sourceKey: source.id,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new Error(
              `Failed discovering MCP tools for ${source.id}: ${cause.message}`,
            ),
        ),
      );

      return catalogSyncResultFromMcpManifestEntries({
        source,
        endpoint: source.endpoint,
        manifestEntries: discovered.manifest.tools,
      });
    }),
};
