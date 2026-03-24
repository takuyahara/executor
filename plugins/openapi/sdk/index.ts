import { createHash } from "node:crypto";
import * as Effect from "effect/Effect";

import {
  createCatalogImportMetadata,
  createSourceCatalogSyncResult,
} from "@executor/source-core";
import type { Source } from "@executor/platform-sdk/schema";
import type {
  ExecutorSdkPlugin,
  SourcePluginRuntime,
} from "@executor/platform-sdk/plugins";
import {
  previewOpenApiDocument,
  type OpenApiConnectInput,
  type OpenApiPreviewRequest,
  type OpenApiPreviewResponse,
  type OpenApiStoredSourceData,
} from "@executor/plugin-openapi-shared";

const stableSourceHash = (value: OpenApiStoredSourceData): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);

export type OpenApiSourceStorage = {
  get: (input: {
    scopeId: string;
    sourceId: string;
  }) => Effect.Effect<OpenApiStoredSourceData | null, Error, never>;
  put: (input: {
    scopeId: string;
    sourceId: string;
    value: OpenApiStoredSourceData;
  }) => Effect.Effect<void, Error, never>;
  remove?: (input: {
    scopeId: string;
    sourceId: string;
  }) => Effect.Effect<void, Error, never>;
};

export type OpenApiSecrets = {
  resolve: (input: {
    ref: string;
  }) => Effect.Effect<string, Error, never>;
};

export type OpenApiSdk = {
  previewDocument: (
    input: OpenApiPreviewRequest,
  ) => Effect.Effect<OpenApiPreviewResponse, Error, never>;
  createSource: (
    input: OpenApiConnectInput,
  ) => Effect.Effect<Source, Error, never>;
};

export type OpenApiSdkPluginOptions = {
  storage: OpenApiSourceStorage;
  secrets?: OpenApiSecrets;
};

const createStoredSourceData = (
  input: OpenApiConnectInput,
): OpenApiStoredSourceData => ({
  specUrl: input.specUrl.trim(),
  baseUrl: input.baseUrl?.trim() || null,
  auth: input.auth,
  defaultHeaders: null,
  etag: null,
  lastSyncAt: null,
});

const createOpenApiSourceRuntime = (
  options: OpenApiSdkPluginOptions,
): SourcePluginRuntime => ({
  kind: "openapi",
  displayName: "OpenAPI",
  catalogKind: "imported",
  catalogIdentity: ({ source }) => ({
    kind: "openapi",
    sourceId: source.id,
  }),
  getIrModel: ({ source }) =>
    Effect.gen(function* () {
      const stored = yield* options.storage.get({
        scopeId: source.scopeId,
        sourceId: source.id,
      });

      return createSourceCatalogSyncResult({
        fragment: {
          version: "ir.v1.fragment",
        },
        importMetadata: {
          ...createCatalogImportMetadata({
            source,
            pluginKey: "openapi",
          }),
          importerVersion: "ir.v1.openapi",
          sourceConfigHash:
            stored === null ? "openapi" : stableSourceHash(stored),
        },
        sourceHash: stored === null ? null : stableSourceHash(stored),
      });
    }),
  invoke: () =>
    Effect.fail(new Error("OpenAPI plugin invocation is not implemented.")),
});

export const openApiSdkPlugin = (
  options: OpenApiSdkPluginOptions,
): ExecutorSdkPlugin<"openapi", OpenApiSdk> => ({
  key: "openapi",
  sources: [createOpenApiSourceRuntime(options)],
  extendExecutor: ({ host }) => ({
    previewDocument: (input) =>
      Effect.tryPromise({
        try: () => previewOpenApiDocument(input),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      }),
    createSource: (input) =>
      Effect.gen(function* () {
        const stored = createStoredSourceData(input);
        const source = yield* host.sources.create({
          source: {
            name: input.name.trim(),
            kind: "openapi",
            status: "connected",
            enabled: true,
            namespace: null,
          },
        });

        yield* options.storage.put({
          scopeId: source.scopeId,
          sourceId: source.id,
          value: stored,
        });

        return source;
      }),
  }),
});
