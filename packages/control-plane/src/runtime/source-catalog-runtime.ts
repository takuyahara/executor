import {
  type ToolCatalogEntry,
  type ToolDescriptor as CatalogToolDescriptor,
  typeSignatureFromSchema,
} from "@executor/codemode-core";
import type {
  AccountId,
  Source,
  StoredSourceRecord,
  StoredSourceCatalogRevisionRecord,
  WorkspaceId,
} from "#schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  projectCatalogForAgentSdk,
  type ProjectedCatalog,
} from "../ir/catalog";
import type {
  Capability,
  CatalogSnapshotV1,
  CatalogV1,
  Executable,
  GraphQLExecutable,
  HttpExecutable,
  McpExecutable,
  ShapeSymbol,
  Symbol as IrSymbol,
} from "../ir/model";
import { LocalSourceArtifactMissingError } from "./local-errors";
import {
  RuntimeLocalWorkspaceService,
  type RuntimeLocalWorkspaceState,
} from "./local-runtime-context";
import type { LocalSourceArtifact } from "./local-source-artifacts";
import {
  SourceArtifactStore,
  type SourceArtifactStoreShape,
} from "./local-storage";
import { namespaceFromSourceName } from "./source-names";
import {
  RuntimeSourceStoreService,
  type RuntimeSourceStore,
} from "./source-store";

type CatalogImportMetadata = CatalogSnapshotV1["import"];

export type LoadedSourceCatalog = {
  source: Source;
  sourceRecord: StoredSourceRecord;
  revision: StoredSourceCatalogRevisionRecord;
  snapshot: CatalogSnapshotV1;
  catalog: CatalogV1;
  projected: ProjectedCatalog;
  importMetadata: CatalogImportMetadata;
};

export type LoadedSourceCatalogTool = {
  path: string;
  searchNamespace: string;
  searchText: string;
  source: Source;
  sourceRecord: StoredSourceRecord;
  revision: StoredSourceCatalogRevisionRecord;
  capabilityId: keyof CatalogV1["capabilities"];
  executableId: keyof CatalogV1["executables"];
  capability: Capability;
  executable: Executable;
  descriptor: CatalogToolDescriptor;
  projectedCatalog: CatalogV1;
};

export type LoadedSourceCatalogToolIndexEntry = Omit<LoadedSourceCatalogTool, "revision">;

export const catalogToolCatalogEntry = (input: {
  tool: LoadedSourceCatalogToolIndexEntry;
  score: (queryTokens: readonly string[]) => number;
}): ToolCatalogEntry => ({
  descriptor: input.tool.descriptor,
  namespace: input.tool.searchNamespace,
  searchText: input.tool.searchText,
  score: input.score,
});

const catalogNamespaceFromPath = (path: string): string => {
  const [first, second] = path.split(".");
  return second ? `${first}.${second}` : first;
};

const chooseExecutable = (catalog: CatalogV1, capability: Capability): Executable => {
  const preferred =
    capability.preferredExecutableId !== undefined
      ? catalog.executables[capability.preferredExecutableId]
      : undefined;
  if (preferred) {
    return preferred;
  }

  const first = capability.executableIds
    .map((id) => catalog.executables[id])
    .find((entry): entry is Executable => entry !== undefined);
  if (!first) {
    throw new Error(`Capability ${capability.id} has no executable`);
  }
  return first;
};

const asShape = (catalog: CatalogV1, shapeId: string | undefined): ShapeSymbol | undefined => {
  if (!shapeId) {
    return undefined;
  }

  const symbol = catalog.symbols[shapeId];
  return symbol?.kind === "shape" ? symbol : undefined;
};

const symbolDocsSummary = (symbol: IrSymbol | undefined): string | undefined => {
  if (!symbol || !("docs" in symbol)) {
    return undefined;
  }

  return symbol.docs?.summary ?? symbol.docs?.description;
};

const shapeToJsonSchema = (catalog: CatalogV1, rootShapeId: string): unknown => {
  const defs: Record<string, unknown> = {};
  const visiting = new Set<string>();
  const built = new Set<string>();

  const defNameFor = (shapeId: string) => shapeId.replace(/[^A-Za-z0-9_]/g, "_");

  const visit = (shapeId: string): { $ref: string } => {
    const defName = defNameFor(shapeId);
    if (built.has(shapeId)) {
      return { $ref: `#/$defs/${defName}` };
    }
    if (visiting.has(shapeId)) {
      return { $ref: `#/$defs/${defName}` };
    }

    const shape = asShape(catalog, shapeId);
    visiting.add(shapeId);

    const schema = (() => {
      if (!shape) {
        return {} as Record<string, unknown>;
      }

      const withDocs = (schemaValue: Record<string, unknown>): Record<string, unknown> => ({
        ...(shape.title ? { title: shape.title } : {}),
        ...(shape.docs?.description ? { description: shape.docs.description } : {}),
        ...schemaValue,
      });

      switch (shape.node.type) {
        case "unknown":
          return withDocs({});
        case "const":
          return withDocs({ const: shape.node.value });
        case "enum":
          return withDocs({ enum: shape.node.values });
        case "scalar":
          return withDocs({
            type:
              shape.node.scalar === "bytes"
                ? "string"
                : shape.node.scalar,
            ...(shape.node.scalar === "bytes" ? { format: "binary" } : {}),
            ...(shape.node.format ? { format: shape.node.format } : {}),
            ...(shape.node.constraints ?? {}),
          });
        case "ref":
          return visit(shape.node.target);
        case "nullable":
          return withDocs({
            anyOf: [
              visit(shape.node.itemShapeId),
              { type: "null" },
            ],
          });
        case "allOf":
          return withDocs({
            allOf: shape.node.items.map((entry) => visit(entry)),
          });
        case "anyOf":
          return withDocs({
            anyOf: shape.node.items.map((entry) => visit(entry)),
          });
        case "oneOf":
          return withDocs({
            oneOf: shape.node.items.map((entry) => visit(entry)),
            ...(shape.node.discriminator
              ? {
                  discriminator: {
                    propertyName: shape.node.discriminator.propertyName,
                    ...(shape.node.discriminator.mapping
                      ? {
                          mapping: Object.fromEntries(
                            Object.entries(shape.node.discriminator.mapping).map(([key, value]) => [
                              key,
                              `#/$defs/${defNameFor(value)}`,
                            ]),
                          ),
                        }
                      : {}),
                  },
                }
              : {}),
          });
        case "not":
          return withDocs({
            not: visit(shape.node.itemShapeId),
          });
        case "conditional":
          return withDocs({
            if: visit(shape.node.ifShapeId),
            ...(shape.node.thenShapeId ? { then: visit(shape.node.thenShapeId) } : {}),
            ...(shape.node.elseShapeId ? { else: visit(shape.node.elseShapeId) } : {}),
          });
        case "array":
          return withDocs({
            type: "array",
            items: visit(shape.node.itemShapeId),
            ...(shape.node.minItems !== undefined ? { minItems: shape.node.minItems } : {}),
            ...(shape.node.maxItems !== undefined ? { maxItems: shape.node.maxItems } : {}),
          });
        case "tuple":
          return withDocs({
            type: "array",
            prefixItems: shape.node.itemShapeIds.map((entry) => visit(entry)),
            ...(shape.node.additionalItems !== undefined
              ? {
                  items:
                    typeof shape.node.additionalItems === "boolean"
                      ? shape.node.additionalItems
                      : visit(shape.node.additionalItems),
                }
              : {}),
          });
        case "map":
          return withDocs({
            type: "object",
            additionalProperties: visit(shape.node.valueShapeId),
          });
        case "object":
          return withDocs({
            type: "object",
            properties: Object.fromEntries(
              Object.entries(shape.node.fields).map(([key, field]) => [
                key,
                {
                  ...(visit(field.shapeId)),
                  ...(field.docs?.description ? { description: field.docs.description } : {}),
                },
              ]),
            ),
            ...(shape.node.required && shape.node.required.length > 0
              ? { required: shape.node.required }
              : {}),
            ...(shape.node.additionalProperties !== undefined
              ? {
                  additionalProperties:
                    typeof shape.node.additionalProperties === "boolean"
                      ? shape.node.additionalProperties
                      : visit(shape.node.additionalProperties),
                }
              : {}),
            ...(shape.node.patternProperties
              ? {
                  patternProperties: Object.fromEntries(
                    Object.entries(shape.node.patternProperties).map(([key, value]) => [
                      key,
                      visit(value),
                    ]),
                  ),
                }
              : {}),
          });
        case "graphqlInterface":
          return withDocs({
            type: "object",
            properties: Object.fromEntries(
              Object.entries(shape.node.fields).map(([key, field]) => [
                key,
                visit(field.shapeId),
              ]),
            ),
          });
        case "graphqlUnion":
          return withDocs({
            oneOf: shape.node.memberTypeIds.map((entry) => visit(entry)),
          });
      }
    })();

    visiting.delete(shapeId);
    built.add(shapeId);
    defs[defName] = schema;
    return { $ref: `#/$defs/${defName}` };
  };

  const rootRef = visit(rootShapeId);
  return {
    ...rootRef,
    $defs: defs,
  };
};

const codemodeDescriptorFromCapability = (input: {
  source: Source;
  projected: ProjectedCatalog;
  capability: Capability;
  executable: Executable;
  includeSchemas: boolean;
}): CatalogToolDescriptor => {
  const descriptor = input.projected.toolDescriptors[input.capability.id];
  const path = descriptor.toolPath.join(".");
  const interaction =
    descriptor.interaction.mayRequireApproval || descriptor.interaction.mayElicit
      ? "required"
      : "auto";
  const inputSchema = input.includeSchemas
    ? shapeToJsonSchema(input.projected.catalog, descriptor.callShapeId)
    : undefined;
  const outputSchema =
    input.includeSchemas && descriptor.resultShapeId
      ? shapeToJsonSchema(input.projected.catalog, descriptor.resultShapeId)
      : undefined;

  return {
    path: path as CatalogToolDescriptor["path"],
    sourceKey: input.source.id,
    description: input.capability.surface.summary ?? input.capability.surface.description,
    interaction,
    ...(inputSchema !== undefined ? { inputSchema } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    ...(inputSchema !== undefined
      ? {
          inputType: typeSignatureFromSchema(inputSchema, "unknown"),
        }
      : {}),
    ...(outputSchema !== undefined
      ? {
          outputType: typeSignatureFromSchema(outputSchema, "unknown"),
        }
      : {}),
    providerKind: input.executable.protocol,
    providerData: {
      capabilityId: input.capability.id,
      executableId: input.executable.id,
      protocol: input.executable.protocol,
    },
  };
};

const sourceRecordFromCatalogArtifact = (input: {
  source: Source;
  artifact: {
    catalogId: StoredSourceRecord["catalogId"];
    revision: StoredSourceCatalogRevisionRecord;
  };
}): StoredSourceRecord => ({
  id: input.source.id,
  workspaceId: input.source.workspaceId,
  catalogId: input.artifact.catalogId,
  catalogRevisionId: input.artifact.revision.id,
  name: input.source.name,
  kind: input.source.kind,
  endpoint: input.source.endpoint,
  status: input.source.status,
  enabled: input.source.enabled,
  namespace: input.source.namespace,
  importAuthPolicy: input.source.importAuthPolicy,
  bindingConfigJson: JSON.stringify(input.source.binding),
  sourceHash: input.source.sourceHash,
  lastError: input.source.lastError,
  createdAt: input.source.createdAt,
  updatedAt: input.source.updatedAt,
});

type RuntimeSourceCatalogStoreShape = {
  loadWorkspaceSourceCatalogs: (input: {
    workspaceId: WorkspaceId;
    actorAccountId?: AccountId | null;
  }) => Effect.Effect<readonly LoadedSourceCatalog[], Error, never>;
  loadSourceWithCatalog: (input: {
    workspaceId: WorkspaceId;
    sourceId: Source["id"];
    actorAccountId?: AccountId | null;
  }) => Effect.Effect<LoadedSourceCatalog, Error | LocalSourceArtifactMissingError, never>;
  loadWorkspaceSourceCatalogToolIndex: (input: {
    workspaceId: WorkspaceId;
    actorAccountId?: AccountId | null;
    includeSchemas: boolean;
  }) => Effect.Effect<readonly LoadedSourceCatalogToolIndexEntry[], Error, never>;
  loadWorkspaceSourceCatalogToolByPath: (input: {
    workspaceId: WorkspaceId;
    path: string;
    actorAccountId?: AccountId | null;
    includeSchemas: boolean;
  }) => Effect.Effect<LoadedSourceCatalogToolIndexEntry | null, Error, never>;
};

export type RuntimeSourceCatalogStore = RuntimeSourceCatalogStoreShape;

export class RuntimeSourceCatalogStoreService extends Context.Tag(
  "#runtime/RuntimeSourceCatalogStoreService",
)<RuntimeSourceCatalogStoreService, RuntimeSourceCatalogStoreShape>() {}

type RuntimeSourceCatalogStoreDeps = {
  runtimeLocalWorkspace: RuntimeLocalWorkspaceState;
  sourceStore: RuntimeSourceStore;
  sourceArtifactStore: SourceArtifactStoreShape;
};

type SourceCatalogRuntimeServices =
  | RuntimeLocalWorkspaceService
  | RuntimeSourceStoreService
  | SourceArtifactStore;

const ensureRuntimeCatalogWorkspace = (
  deps: RuntimeSourceCatalogStoreDeps,
  workspaceId: WorkspaceId,
) => {
  if (deps.runtimeLocalWorkspace.installation.workspaceId !== workspaceId) {
    return Effect.fail(
      new Error(
        `Runtime local workspace mismatch: expected ${workspaceId}, got ${deps.runtimeLocalWorkspace.installation.workspaceId}`,
      ),
    );
  }

  return Effect.succeed(deps.runtimeLocalWorkspace.context);
};

const buildSnapshotFromArtifact = (input: {
  source: Source;
  artifact: LocalSourceArtifact;
}): CatalogSnapshotV1 => {
  return input.artifact.snapshot;
};

const loadWorkspaceSourceCatalogsWithDeps = (deps: RuntimeSourceCatalogStoreDeps, input: {
  workspaceId: WorkspaceId;
  actorAccountId?: AccountId | null;
}): Effect.Effect<readonly LoadedSourceCatalog[], Error, never> =>
  Effect.gen(function* () {
    const workspaceContext = yield* ensureRuntimeCatalogWorkspace(
      deps,
      input.workspaceId,
    );
    const sources = yield* deps.sourceStore.loadSourcesInWorkspace(
      input.workspaceId,
      {
        actorAccountId: input.actorAccountId,
      },
    );

    const localCatalogs = yield* Effect.forEach(sources, (source) =>
      Effect.gen(function* () {
        const artifact = yield* deps.sourceArtifactStore.read({
          context: workspaceContext,
          sourceId: source.id,
        });
        if (artifact === null) {
          return null;
        }

        const snapshot = buildSnapshotFromArtifact({
          source,
          artifact,
        });
        const projected = projectCatalogForAgentSdk({
          catalog: snapshot.catalog,
        });

        return {
          source,
          sourceRecord: sourceRecordFromCatalogArtifact({
            source,
            artifact,
          }),
          revision: artifact.revision,
          snapshot,
          catalog: snapshot.catalog,
          projected,
          importMetadata: snapshot.import,
        } satisfies LoadedSourceCatalog;
      }),
    );

    return localCatalogs.filter((catalogEntry): catalogEntry is LoadedSourceCatalog => catalogEntry !== null);
  });

const loadSourceWithCatalogWithDeps = (deps: RuntimeSourceCatalogStoreDeps, input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
  actorAccountId?: AccountId | null;
}): Effect.Effect<LoadedSourceCatalog, Error | LocalSourceArtifactMissingError, never> =>
  Effect.gen(function* () {
    const workspaceContext = yield* ensureRuntimeCatalogWorkspace(
      deps,
      input.workspaceId,
    );
    const source = yield* deps.sourceStore.loadSourceById({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      actorAccountId: input.actorAccountId,
    });
    const artifact = yield* deps.sourceArtifactStore.read({
      context: workspaceContext,
      sourceId: source.id,
    });
    if (artifact === null) {
      return yield* Effect.fail(
        new LocalSourceArtifactMissingError({
          message: `Catalog artifact missing for source ${input.sourceId}`,
          sourceId: input.sourceId,
        }),
      );
    }

    const snapshot = buildSnapshotFromArtifact({
      source,
      artifact,
    });
    const projected = projectCatalogForAgentSdk({
      catalog: snapshot.catalog,
    });

    return {
      source,
      sourceRecord: sourceRecordFromCatalogArtifact({
        source,
        artifact,
      }),
      revision: artifact.revision,
      snapshot,
      catalog: snapshot.catalog,
      projected,
      importMetadata: snapshot.import,
    } satisfies LoadedSourceCatalog;
  });

export const loadWorkspaceSourceCatalogs = (input: {
  workspaceId: WorkspaceId;
  actorAccountId?: AccountId | null;
}): Effect.Effect<readonly LoadedSourceCatalog[], Error, SourceCatalogRuntimeServices> =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* RuntimeLocalWorkspaceService;
    const sourceStore = yield* RuntimeSourceStoreService;
    const sourceArtifactStore = yield* SourceArtifactStore;

    return yield* loadWorkspaceSourceCatalogsWithDeps(
      {
        runtimeLocalWorkspace,
        sourceStore,
        sourceArtifactStore,
      },
      input,
    );
  });

export const loadSourceWithCatalog = (input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
  actorAccountId?: AccountId | null;
}): Effect.Effect<
  LoadedSourceCatalog,
  Error | LocalSourceArtifactMissingError,
  SourceCatalogRuntimeServices
> =>
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* RuntimeLocalWorkspaceService;
    const sourceStore = yield* RuntimeSourceStoreService;
    const sourceArtifactStore = yield* SourceArtifactStore;

    return yield* loadSourceWithCatalogWithDeps(
      {
        runtimeLocalWorkspace,
        sourceStore,
        sourceArtifactStore,
      },
      input,
    );
  });

export const expandCatalogTools = (input: {
  catalogs: readonly LoadedSourceCatalog[];
  includeSchemas: boolean;
}): Effect.Effect<readonly LoadedSourceCatalogTool[], Error, never> =>
  Effect.succeed(
    input.catalogs.flatMap((catalogEntry) =>
      Object.values(catalogEntry.catalog.capabilities).map((capability) => {
        const executable = chooseExecutable(catalogEntry.projected.catalog, capability);
        const descriptor = codemodeDescriptorFromCapability({
          source: catalogEntry.source,
          projected: catalogEntry.projected,
          capability,
          executable,
          includeSchemas: input.includeSchemas,
        });
        const path = descriptor.path;
        const searchDoc = catalogEntry.projected.searchDocs[capability.id];
        const searchNamespace = catalogNamespaceFromPath(path);
        const searchText = [
          path,
          searchNamespace,
          catalogEntry.source.name,
          capability.surface.title,
          capability.surface.summary,
          capability.surface.description,
          ...(searchDoc?.tags ?? []),
          ...(searchDoc?.protocolHints ?? []),
          ...(searchDoc?.authHints ?? []),
        ]
          .filter((part): part is string => typeof part === "string" && part.length > 0)
          .join(" ")
          .toLowerCase();

        return {
          path,
          searchNamespace,
          searchText,
          source: catalogEntry.source,
          sourceRecord: catalogEntry.sourceRecord,
          revision: catalogEntry.revision,
          capabilityId: capability.id,
          executableId: executable.id,
          capability,
          executable,
          descriptor,
          projectedCatalog: catalogEntry.projected.catalog,
        } satisfies LoadedSourceCatalogTool;
      }),
    ),
  );

export const loadWorkspaceSourceCatalogToolIndex = (input: {
  workspaceId: WorkspaceId;
  actorAccountId?: AccountId | null;
  includeSchemas: boolean;
}): Effect.Effect<
  readonly LoadedSourceCatalogToolIndexEntry[],
  Error,
  SourceCatalogRuntimeServices
> =>
  Effect.gen(function* () {
    const catalogs = yield* loadWorkspaceSourceCatalogs({
      workspaceId: input.workspaceId,
      actorAccountId: input.actorAccountId,
    });
    const tools = yield* expandCatalogTools({
      catalogs,
      includeSchemas: input.includeSchemas,
    });
    return tools.map((tool) => ({
      path: tool.path,
      searchNamespace: tool.searchNamespace,
      searchText: tool.searchText,
      source: tool.source,
      sourceRecord: tool.sourceRecord,
      capabilityId: tool.capabilityId,
      executableId: tool.executableId,
      capability: tool.capability,
      executable: tool.executable,
      descriptor: tool.descriptor,
      projectedCatalog: tool.projectedCatalog,
    }));
  });

export const loadWorkspaceSourceCatalogToolByPath = (input: {
  workspaceId: WorkspaceId;
  path: string;
  actorAccountId?: AccountId | null;
  includeSchemas: boolean;
}): Effect.Effect<
  LoadedSourceCatalogToolIndexEntry | null,
  Error,
  SourceCatalogRuntimeServices
> =>
  Effect.gen(function* () {
    const catalogs = yield* loadWorkspaceSourceCatalogs({
      workspaceId: input.workspaceId,
      actorAccountId: input.actorAccountId,
    });
    const tools = yield* expandCatalogTools({
      catalogs,
      includeSchemas: input.includeSchemas,
    });
    const tool = tools.find((entry) => entry.path === input.path) ?? null;
    return tool
      ? {
          path: tool.path,
          searchNamespace: tool.searchNamespace,
          searchText: tool.searchText,
          source: tool.source,
          sourceRecord: tool.sourceRecord,
          capabilityId: tool.capabilityId,
          executableId: tool.executableId,
          capability: tool.capability,
          executable: tool.executable,
          descriptor: tool.descriptor,
          projectedCatalog: tool.projectedCatalog,
        }
      : null;
  });

export const RuntimeSourceCatalogStoreLive = Layer.effect(
  RuntimeSourceCatalogStoreService,
  Effect.gen(function* () {
    const runtimeLocalWorkspace = yield* RuntimeLocalWorkspaceService;
    const sourceStore = yield* RuntimeSourceStoreService;
    const sourceArtifactStore = yield* SourceArtifactStore;

    const deps: RuntimeSourceCatalogStoreDeps = {
      runtimeLocalWorkspace,
      sourceStore,
      sourceArtifactStore,
    };

    return RuntimeSourceCatalogStoreService.of({
      loadWorkspaceSourceCatalogs: (input) =>
        loadWorkspaceSourceCatalogsWithDeps(deps, input),
      loadSourceWithCatalog: (input) =>
        loadSourceWithCatalogWithDeps(deps, input),
      loadWorkspaceSourceCatalogToolIndex: (input) =>
        loadWorkspaceSourceCatalogToolIndex(input).pipe(
          Effect.provideService(RuntimeLocalWorkspaceService, runtimeLocalWorkspace),
          Effect.provideService(RuntimeSourceStoreService, sourceStore),
          Effect.provideService(SourceArtifactStore, sourceArtifactStore),
        ),
      loadWorkspaceSourceCatalogToolByPath: (input) =>
        loadWorkspaceSourceCatalogToolByPath(input).pipe(
          Effect.provideService(RuntimeLocalWorkspaceService, runtimeLocalWorkspace),
          Effect.provideService(RuntimeSourceStoreService, sourceStore),
          Effect.provideService(SourceArtifactStore, sourceArtifactStore),
        ),
    });
  }),
);
