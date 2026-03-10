import { createHash } from "node:crypto";

import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import {
  type McpToolManifest,
  createSdkMcpConnector,
  discoverMcpToolsFromConnector,
  type McpToolManifestEntry,
} from "@executor/codemode-mcp";
import {
  buildOpenApiToolPresentation,
  compileOpenApiToolDefinitions,
  extractOpenApiManifest,
} from "@executor/codemode-openapi";
import type { SqlControlPlaneRows } from "#persistence";
import {
  type SecretRef,
  type Source,
  type StoredSourceRecipeDocumentRecord,
  type StoredSourceRecipeOperationRecord,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  buildGraphqlToolPresentation,
  compileGraphqlToolDefinitions,
  extractGraphqlManifest,
  GRAPHQL_INTROSPECTION_QUERY,
} from "./graphql-tools";
import type {
  ResolveSecretMaterial as ResolveSourceSecretMaterial,
  SecretMaterialResolveContext,
} from "./secret-material-providers";

export type ResolvedSourceAuthMaterial = {
  headers: Readonly<Record<string, string>>;
};

const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const normalizeSearchText = (...parts: ReadonlyArray<string | null | undefined>): string =>
  parts
    .flatMap((part) => (part ? [part.trim()] : []))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const contentHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

type SourceBindingRecord = Awaited<
  ReturnType<SqlControlPlaneRows["sources"]["getByWorkspaceAndId"]>
> extends Effect.Effect<Option.Option<infer T>, unknown, never>
  ? T
  : never;

const loadSourceBindingRecord = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
}): Effect.Effect<SourceBindingRecord, Error, never> =>
  Effect.gen(function* () {
    const sourceRecord = yield* input.rows.sources.getByWorkspaceAndId(
      input.source.workspaceId,
      input.source.id,
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );

    if (Option.isNone(sourceRecord)) {
      return yield* Effect.fail(
        new Error(`Source disappeared while syncing recipe data for ${input.source.id}`),
      );
    }

    return sourceRecord.value;
  });

const replaceRecipeRevisionContent = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  manifestJson: string | null;
  manifestHash: string | null;
  documents: readonly StoredSourceRecipeDocumentRecord[];
  operations: readonly StoredSourceRecipeOperationRecord[];
  sourcePatch?: Partial<Pick<SourceBindingRecord, "sourceHash">>;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const sourceRecord = yield* loadSourceBindingRecord({
      rows: input.rows,
      source: input.source,
    });
    const now = Date.now();

    yield* input.rows.sourceRecipeRevisions.update(sourceRecord.recipeRevisionId, {
      manifestJson: input.manifestJson,
      manifestHash: input.manifestHash,
      updatedAt: now,
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );

    yield* input.rows.sourceRecipeDocuments.replaceForRevision({
      recipeRevisionId: sourceRecord.recipeRevisionId,
      documents: input.documents,
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );

    yield* input.rows.sourceRecipeOperations.replaceForRevision({
      recipeRevisionId: sourceRecord.recipeRevisionId,
      operations: input.operations,
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );

    if (input.sourcePatch) {
      const updatedSource = yield* input.rows.sources.update(
        input.source.workspaceId,
        input.source.id,
        {
          ...input.sourcePatch,
          updatedAt: now,
        },
      ).pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );

      if (Option.isNone(updatedSource)) {
        return yield* Effect.fail(
          new Error(`Source disappeared while updating sync metadata for ${input.source.id}`),
        );
      }
    }
  });

const toOpenApiRecipeOperationRecord = (input: {
  recipeRevisionId: SourceBindingRecord["recipeRevisionId"];
  definition: ReturnType<typeof compileOpenApiToolDefinitions>[number];
  manifest: Parameters<typeof buildOpenApiToolPresentation>[0]["manifest"];
  now: number;
}): StoredSourceRecipeOperationRecord => {
  const presentation = buildOpenApiToolPresentation({
    manifest: input.manifest,
    definition: input.definition,
  });
  const method = input.definition.method.toUpperCase();

  return {
    id: `src_recipe_op_${crypto.randomUUID()}`,
    recipeRevisionId: input.recipeRevisionId,
    operationKey: input.definition.toolId,
    transportKind: "http",
    toolId: input.definition.toolId,
    title: input.definition.name,
    description: input.definition.description,
    operationKind:
      method === "GET" || method === "HEAD"
        ? "read"
        : method === "DELETE"
          ? "delete"
          : "write",
    searchText: normalizeSearchText(
      input.definition.toolId,
      input.definition.name,
      input.definition.description,
      input.definition.rawToolId,
      input.definition.operationId ?? undefined,
      input.definition.method,
      input.definition.path,
      input.definition.group,
      input.definition.leaf,
      input.definition.tags.join(" "),
    ),
    inputSchemaJson: presentation.inputSchemaJson ?? null,
    outputSchemaJson: presentation.outputSchemaJson ?? null,
    providerKind: "openapi",
    providerDataJson: presentation.providerDataJson,
    mcpToolName: null,
    openApiMethod: input.definition.method,
    openApiPathTemplate: input.definition.path,
    openApiOperationHash: input.definition.operationHash,
    openApiRawToolId: input.definition.rawToolId,
    openApiOperationId: input.definition.operationId ?? null,
    openApiTagsJson: JSON.stringify(input.definition.tags),
    openApiRequestBodyRequired: input.definition.invocation.requestBody?.required ?? null,
    graphqlOperationType: null,
    graphqlOperationName: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
};

const toGraphqlRecipeOperationRecord = (input: {
  recipeRevisionId: SourceBindingRecord["recipeRevisionId"];
  definition: ReturnType<typeof compileGraphqlToolDefinitions>[number];
  manifest: Parameters<typeof buildGraphqlToolPresentation>[0]["manifest"];
  now: number;
}): StoredSourceRecipeOperationRecord => {
  const presentation = buildGraphqlToolPresentation({
    manifest: input.manifest,
    definition: input.definition,
  });

  return {
    id: `src_recipe_op_${crypto.randomUUID()}`,
    recipeRevisionId: input.recipeRevisionId,
    operationKey: input.definition.toolId,
    transportKind: "graphql",
    toolId: input.definition.toolId,
    title: input.definition.name,
    description: input.definition.description,
    operationKind:
      input.definition.operationType === "query"
        ? "read"
        : input.definition.operationType === "mutation"
          ? "write"
          : "unknown",
    searchText: normalizeSearchText(
      input.definition.toolId,
      input.definition.name,
      input.definition.description,
      input.definition.rawToolId,
      input.definition.group,
      input.definition.leaf,
      input.definition.fieldName,
      input.definition.operationType,
      input.definition.operationName,
      input.definition.searchTerms.join(" "),
    ),
    inputSchemaJson: presentation.inputSchemaJson ?? null,
    outputSchemaJson: presentation.outputSchemaJson ?? null,
    providerKind: "graphql",
    providerDataJson: presentation.providerDataJson,
    mcpToolName: null,
    openApiMethod: null,
    openApiPathTemplate: null,
    openApiOperationHash: null,
    openApiRawToolId: null,
    openApiOperationId: null,
    openApiTagsJson: null,
    openApiRequestBodyRequired: null,
    graphqlOperationType: input.definition.operationType,
    graphqlOperationName: input.definition.operationName,
    createdAt: input.now,
    updatedAt: input.now,
  };
};

const toMcpRecipeOperationRecord = (input: {
  recipeRevisionId: SourceBindingRecord["recipeRevisionId"];
  entry: McpToolManifestEntry;
  now: number;
}): StoredSourceRecipeOperationRecord => ({
  id: `src_recipe_op_${crypto.randomUUID()}`,
  recipeRevisionId: input.recipeRevisionId,
  operationKey: input.entry.toolId,
  transportKind: "mcp",
  toolId: input.entry.toolId,
  title: input.entry.toolName,
  description: input.entry.description ?? null,
  operationKind: "unknown",
  searchText: normalizeSearchText(
    input.entry.toolId,
    input.entry.toolName,
    input.entry.description ?? undefined,
    "mcp",
  ),
  inputSchemaJson: input.entry.inputSchemaJson ?? null,
  outputSchemaJson: input.entry.outputSchemaJson ?? null,
  providerKind: "mcp",
  providerDataJson: JSON.stringify({
    kind: "mcp",
    toolId: input.entry.toolId,
    toolName: input.entry.toolName,
    description: input.entry.description ?? null,
  }),
  mcpToolName: input.entry.toolName,
  openApiMethod: null,
  openApiPathTemplate: null,
  openApiOperationHash: null,
  openApiRawToolId: null,
  openApiOperationId: null,
  openApiTagsJson: null,
  openApiRequestBodyRequired: null,
  graphqlOperationType: null,
  graphqlOperationName: null,
  createdAt: input.now,
  updatedAt: input.now,
});

const persistMcpRecipeRevision = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  manifestEntries: readonly McpToolManifestEntry[];
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const sourceRecord = yield* loadSourceBindingRecord({
      rows: input.rows,
      source: input.source,
    });
    const now = Date.now();
    const manifest: McpToolManifest = {
      version: 1,
      tools: input.manifestEntries,
    };
    const manifestJson = JSON.stringify(manifest);
    const manifestHash = contentHash(manifestJson);

    yield* replaceRecipeRevisionContent({
      rows: input.rows,
      source: input.source,
      manifestJson,
      manifestHash,
      documents: [{
        id: `src_recipe_doc_${crypto.randomUUID()}`,
        recipeRevisionId: sourceRecord.recipeRevisionId,
        documentKind: "mcp_manifest",
        documentKey: input.source.endpoint,
        contentText: manifestJson,
        contentHash: manifestHash,
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      }],
      operations: input.manifestEntries.map((entry) =>
        toMcpRecipeOperationRecord({
          recipeRevisionId: sourceRecord.recipeRevisionId,
          entry,
          now,
        })
      ),
      sourcePatch: {
        sourceHash: manifestHash,
      },
    });
  });


const shouldIndexSource = (source: Source): boolean =>
  source.enabled
  && source.status === "connected"
  && (source.kind === "mcp" || source.kind === "openapi" || source.kind === "graphql");

export const namespaceFromSourceName = (name: string): string => {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return normalized.length > 0 ? normalized : "source";
};

export const resolveSourceAuthMaterial = (input: {
  source: Source;
  resolveSecretMaterial: ResolveSourceSecretMaterial;
  context?: SecretMaterialResolveContext;
}): Effect.Effect<ResolvedSourceAuthMaterial, Error, never> =>
  Effect.gen(function* () {
    if (input.source.auth.kind === "none") {
      return { headers: {} } satisfies ResolvedSourceAuthMaterial;
    }

    const tokenRef =
      input.source.auth.kind === "bearer"
        ? input.source.auth.token
        : input.source.auth.accessToken;

    const token = yield* input.resolveSecretMaterial({
      ref: tokenRef,
      context: input.context,
    });

    return {
      headers: {
        [input.source.auth.headerName]: `${input.source.auth.prefix}${token}`,
      },
    } satisfies ResolvedSourceAuthMaterial;
  });

const fetchOpenApiDocumentWithHeaders = (input: {
  url: string;
  headers?: Readonly<Record<string, string>>;
}): Effect.Effect<string, Error, never> =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk,
    );
    const request = HttpClientRequest.get(input.url).pipe(
      HttpClientRequest.setHeaders(input.headers ?? {}),
    );
    const response = yield* client.execute(request).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );

    return yield* response.text.pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
  );

const fetchGraphqlIntrospectionDocumentWithHeaders = (input: {
  url: string;
  headers?: Readonly<Record<string, string>>;
}): Effect.Effect<string, Error, never> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(input.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(input.headers ?? {}),
        },
        body: JSON.stringify({
          query: GRAPHQL_INTROSPECTION_QUERY,
          operationName: "IntrospectionQuery",
        }),
      });
      const text = await response.text();

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (cause) {
        throw new Error(
          `GraphQL introspection endpoint did not return JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `GraphQL introspection failed with status ${response.status}`,
        );
      }

      return JSON.stringify(parsed, null, 2);
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });

const indexMcpSourceToolArtifacts = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  manifestEntries: readonly McpToolManifestEntry[];
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    yield* persistMcpRecipeRevision(input);
    yield* input.rows.toolArtifacts.removeByWorkspaceAndSourceId(
      input.source.workspaceId,
      input.source.id,
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );
  });

const discoverAndIndexMcpSourceToolArtifacts = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  auth: ResolvedSourceAuthMaterial;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const connector = yield* Effect.try({
      try: () =>
        createSdkMcpConnector({
          endpoint: input.source.endpoint,
          transport: input.source.transport ?? undefined,
          queryParams: input.source.queryParams ?? undefined,
          headers: {
            ...(input.source.headers ?? {}),
            ...input.auth.headers,
          },
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    const discovered = yield* discoverMcpToolsFromConnector({
      connect: connector,
      namespace: input.source.namespace ?? namespaceFromSourceName(input.source.name),
      sourceKey: input.source.id,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new Error(
            `Failed discovering MCP tools for ${input.source.id}: ${cause.message}`,
          ),
      ),
    );

    return yield* indexMcpSourceToolArtifacts({
      rows: input.rows,
      source: input.source,
      manifestEntries: discovered.manifest.tools,
    });
  });

const indexOpenApiSourceToolArtifacts = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  auth: ResolvedSourceAuthMaterial;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    if (!input.source.specUrl) {
      return yield* Effect.fail(
        new Error(`Missing OpenAPI specUrl for source ${input.source.id}`),
      );
    }

    const openApiDocument = yield* fetchOpenApiDocumentWithHeaders({
      url: input.source.specUrl,
      headers: {
        ...(input.source.defaultHeaders ?? {}),
        ...input.auth.headers,
      },
    }).pipe(
      Effect.mapError((cause) =>
        new Error(
          `Failed fetching OpenAPI spec for ${input.source.id}: ${cause.message}`,
        ),
      ),
    );

    const manifest = yield* extractOpenApiManifest(
      input.source.name,
      openApiDocument,
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error
          ? cause
          : new Error(String(cause)),
      ),
    );

    const sourceRecord = yield* loadSourceBindingRecord({
      rows: input.rows,
      source: input.source,
    });
    const definitions = compileOpenApiToolDefinitions(manifest);
    const now = Date.now();

    yield* replaceRecipeRevisionContent({
      rows: input.rows,
      source: input.source,
      manifestJson: JSON.stringify(manifest),
      manifestHash: manifest.sourceHash,
      documents: [{
        id: `src_recipe_doc_${crypto.randomUUID()}`,
        recipeRevisionId: sourceRecord.recipeRevisionId,
        documentKind: "openapi",
        documentKey: input.source.specUrl ?? input.source.endpoint,
        contentText: openApiDocument,
        contentHash: contentHash(openApiDocument),
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      }],
      operations: definitions.map((definition) =>
        toOpenApiRecipeOperationRecord({
          recipeRevisionId: sourceRecord.recipeRevisionId,
          definition,
          manifest,
          now,
        })
      ),
      sourcePatch: {
        sourceHash: manifest.sourceHash,
      },
    });

    yield* input.rows.toolArtifacts.removeByWorkspaceAndSourceId(
      input.source.workspaceId,
      input.source.id,
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );
  });

const indexGraphqlSourceToolArtifacts = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  auth: ResolvedSourceAuthMaterial;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const graphqlDocument = yield* fetchGraphqlIntrospectionDocumentWithHeaders({
      url: input.source.endpoint,
      headers: {
        ...(input.source.defaultHeaders ?? {}),
        ...input.auth.headers,
      },
    }).pipe(
      Effect.mapError((cause) =>
        new Error(
          `Failed fetching GraphQL introspection for ${input.source.id}: ${cause.message}`,
        ),
      ),
    );

    const manifest = yield* extractGraphqlManifest(
      input.source.name,
      graphqlDocument,
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );

    const sourceRecord = yield* loadSourceBindingRecord({
      rows: input.rows,
      source: input.source,
    });
    const definitions = compileGraphqlToolDefinitions(manifest);
    const now = Date.now();

    yield* replaceRecipeRevisionContent({
      rows: input.rows,
      source: input.source,
      manifestJson: JSON.stringify(manifest),
      manifestHash: manifest.sourceHash,
      documents: [{
        id: `src_recipe_doc_${crypto.randomUUID()}`,
        recipeRevisionId: sourceRecord.recipeRevisionId,
        documentKind: "graphql_introspection",
        documentKey: input.source.endpoint,
        contentText: graphqlDocument,
        contentHash: contentHash(graphqlDocument),
        fetchedAt: now,
        createdAt: now,
        updatedAt: now,
      }],
      operations: definitions.map((definition) =>
        toGraphqlRecipeOperationRecord({
          recipeRevisionId: sourceRecord.recipeRevisionId,
          definition,
          manifest,
          now,
        })
      ),
      sourcePatch: {
        sourceHash: manifest.sourceHash,
      },
    });

    yield* input.rows.toolArtifacts.removeByWorkspaceAndSourceId(
      input.source.workspaceId,
      input.source.id,
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
      ),
    );
  });

export const syncSourceToolArtifacts = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  resolveSecretMaterial: ResolveSourceSecretMaterial;
}): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    if (!shouldIndexSource(input.source)) {
      yield* input.rows.toolArtifacts.removeByWorkspaceAndSourceId(
        input.source.workspaceId,
        input.source.id,
      ).pipe(
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );
      return;
    }

    const auth = yield* resolveSourceAuthMaterial({
      source: input.source,
      resolveSecretMaterial: input.resolveSecretMaterial,
    });

    if (input.source.kind === "mcp") {
      return yield* discoverAndIndexMcpSourceToolArtifacts({
        rows: input.rows,
        source: input.source,
        auth,
      });
    }

    if (input.source.kind === "openapi") {
      return yield* indexOpenApiSourceToolArtifacts({
        rows: input.rows,
        source: input.source,
        auth,
      });
    }

    if (input.source.kind === "graphql") {
      return yield* indexGraphqlSourceToolArtifacts({
        rows: input.rows,
        source: input.source,
        auth,
      });
    }

    return;
  });

export const persistMcpToolArtifactsFromManifest = (input: {
  rows: SqlControlPlaneRows;
  source: Source;
  manifestEntries: readonly McpToolManifestEntry[];
}): Effect.Effect<void, Error, never> =>
  indexMcpSourceToolArtifacts(input);
