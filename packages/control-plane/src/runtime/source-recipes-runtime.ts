import {
  type ToolDescriptor,
  type ToolPath,
  typeSignatureFromSchemaJson,
} from "@executor/codemode-core";
import type {
  McpToolManifest,
} from "@executor/codemode-mcp";
import {
  openApiOutputTypeSignatureFromSchemaJson,
  type OpenApiToolManifest,
} from "@executor/codemode-openapi";
import type { SqlControlPlaneRows } from "#persistence";
import type {
  AccountId,
  Source,
  StoredSourceRecord,
  StoredSourceRecipeDocumentRecord,
  StoredSourceRecipeOperationRecord,
  StoredSourceRecipeRevisionRecord,
  WorkspaceId,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { GraphqlToolManifest } from "./graphql-tools";
import { loadSourceById, loadSourcesInWorkspace } from "./source-store";
import { namespaceFromSourceName } from "./tool-artifacts";

type RecipeManifest =
  | OpenApiToolManifest
  | GraphqlToolManifest
  | McpToolManifest
  | null;

const asToolPath = (value: string): ToolPath => value as ToolPath;

export type LoadedSourceRecipe = {
  source: Source;
  sourceRecord: StoredSourceRecord;
  revision: StoredSourceRecipeRevisionRecord;
  documents: readonly StoredSourceRecipeDocumentRecord[];
  operations: readonly StoredSourceRecipeOperationRecord[];
  manifest: RecipeManifest;
};

export type LoadedSourceRecipeTool = {
  path: string;
  searchNamespace: string;
  searchText: string;
  source: Source;
  sourceRecord: StoredSourceRecord;
  revision: StoredSourceRecipeRevisionRecord;
  operation: StoredSourceRecipeOperationRecord;
  manifest: RecipeManifest;
  descriptor: ToolDescriptor;
};

const parseJson = <T>(input: {
  label: string;
  value: string | null;
}): Effect.Effect<T | null, Error, never> =>
  input.value === null
    ? Effect.succeed<T | null>(null)
    : Effect.try({
        try: () => {
          const value = input.value!;
          return JSON.parse(value) as T;
        },
        catch: (cause) =>
          cause instanceof Error
            ? new Error(`Invalid ${input.label}: ${cause.message}`)
            : new Error(`Invalid ${input.label}: ${String(cause)}`),
      });

const parseManifestForRecipe = (input: {
  source: Source;
  revision: StoredSourceRecipeRevisionRecord;
}): Effect.Effect<RecipeManifest, Error, never> =>
  Effect.gen(function* () {
    if (input.revision.manifestJson === null) {
      return null;
    }

    if (input.source.kind === "openapi") {
      return yield* parseJson<OpenApiToolManifest>({
        label: `OpenAPI manifest for ${input.source.id}`,
        value: input.revision.manifestJson,
      });
    }

    if (input.source.kind === "graphql") {
      return yield* parseJson<GraphqlToolManifest>({
        label: `GraphQL manifest for ${input.source.id}`,
        value: input.revision.manifestJson,
      });
    }

    if (input.source.kind === "mcp") {
      return yield* parseJson<McpToolManifest>({
        label: `MCP manifest for ${input.source.id}`,
        value: input.revision.manifestJson,
      });
    }

    return null;
  });

const catalogNamespaceFromPath = (path: string): string => {
  const [first, second] = path.split(".");
  return second ? `${first}.${second}` : first;
};

export const recipeToolPath = (input: {
  source: Source;
  operation: StoredSourceRecipeOperationRecord;
}): string => {
  const namespace = input.source.namespace ?? namespaceFromSourceName(input.source.name);
  return namespace ? `${namespace}.${input.operation.toolId}` : input.operation.toolId;
};

export const recipeToolSearchNamespace = (input: {
  source: Source;
  path: string;
  operation: StoredSourceRecipeOperationRecord;
}): string =>
  input.operation.providerKind === "graphql"
    ? (input.source.namespace ?? namespaceFromSourceName(input.source.name))
    : catalogNamespaceFromPath(input.path);

export const recipeToolDescriptor = (input: {
  source: Source;
  operation: StoredSourceRecipeOperationRecord;
  path: string;
  includeSchemas: boolean;
}): ToolDescriptor => {
  const interaction =
    input.operation.providerKind === "openapi"
      ? (
        input.operation.openApiMethod?.toUpperCase() === "GET"
        || input.operation.openApiMethod?.toUpperCase() === "HEAD"
          ? "auto"
          : "required"
      )
      : input.operation.providerKind === "graphql"
        ? input.operation.graphqlOperationType === "query"
          ? "auto"
          : "required"
        : "auto";

  return {
    path: asToolPath(input.path),
    sourceKey: input.source.id,
    description: input.operation.description ?? input.operation.title ?? undefined,
    interaction,
    inputType: typeSignatureFromSchemaJson(
      input.operation.inputSchemaJson ?? undefined,
      "unknown",
      320,
    ),
    outputType:
      input.operation.providerKind === "openapi"
        ? openApiOutputTypeSignatureFromSchemaJson(
            input.operation.outputSchemaJson ?? undefined,
            320,
          )
        : typeSignatureFromSchemaJson(
            input.operation.outputSchemaJson ?? undefined,
            "unknown",
            320,
          ),
    inputSchemaJson: input.includeSchemas ? input.operation.inputSchemaJson ?? undefined : undefined,
    outputSchemaJson: input.includeSchemas ? input.operation.outputSchemaJson ?? undefined : undefined,
    ...(input.operation.providerKind
      ? { providerKind: input.operation.providerKind }
      : {}),
    ...(input.operation.providerDataJson
      ? { providerDataJson: input.operation.providerDataJson }
      : {}),
  };
};

const sourceRecipeDocumentForSource = (input: {
  source: Source;
  documents: readonly StoredSourceRecipeDocumentRecord[];
}): StoredSourceRecipeDocumentRecord | null => {
  const preferredKind =
    input.source.kind === "openapi"
      ? "openapi"
      : input.source.kind === "graphql"
        ? "graphql_introspection"
        : input.source.kind === "mcp"
          ? "mcp_manifest"
          : null;

  if (preferredKind === null) {
    return null;
  }

  return input.documents.find((document) => document.documentKind === preferredKind) ?? null;
};

export const recipePrimaryDocumentText = (input: {
  source: Source;
  documents: readonly StoredSourceRecipeDocumentRecord[];
}): string | null =>
  sourceRecipeDocumentForSource(input)?.contentText ?? null;

export const loadWorkspaceSourceRecipes = (input: {
  rows: SqlControlPlaneRows;
  workspaceId: WorkspaceId;
  actorAccountId?: AccountId | null;
}): Effect.Effect<readonly LoadedSourceRecipe[], Error, never> =>
  Effect.gen(function* () {
    const sourceRecords = yield* input.rows.sources.listByWorkspaceId(input.workspaceId);
    const sources = yield* loadSourcesInWorkspace(input.rows, input.workspaceId, {
      actorAccountId: input.actorAccountId,
    });

    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const relevantSourceRecords = sourceRecords.filter((sourceRecord) => sourceById.has(sourceRecord.id));
    const revisionIds = [...new Set(relevantSourceRecords.map((sourceRecord) => sourceRecord.recipeRevisionId))];

    const revisions = yield* input.rows.sourceRecipeRevisions.listByIds(revisionIds);
    const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
    const documents = yield* input.rows.sourceRecipeDocuments.listByRevisionIds(revisionIds);
    const documentsByRevisionId = new Map<string, StoredSourceRecipeDocumentRecord[]>();
    for (const document of documents) {
      const existing = documentsByRevisionId.get(document.recipeRevisionId) ?? [];
      existing.push(document);
      documentsByRevisionId.set(document.recipeRevisionId, existing);
    }
    const operations = yield* input.rows.sourceRecipeOperations.listByRevisionIds(revisionIds);
    const operationsByRevisionId = new Map<string, StoredSourceRecipeOperationRecord[]>();
    for (const operation of operations) {
      const existing = operationsByRevisionId.get(operation.recipeRevisionId) ?? [];
      existing.push(operation);
      operationsByRevisionId.set(operation.recipeRevisionId, existing);
    }

    return yield* Effect.forEach(relevantSourceRecords, (sourceRecord) =>
      Effect.gen(function* () {
        const source = sourceById.get(sourceRecord.id);
        if (!source) {
          return yield* Effect.fail(
            new Error(`Projected source missing for ${sourceRecord.id}`),
          );
        }

        const revision = revisionById.get(sourceRecord.recipeRevisionId);
        if (!revision) {
          return yield* Effect.fail(
            new Error(`Recipe revision missing for source ${sourceRecord.id}`),
          );
        }

        const manifest = yield* parseManifestForRecipe({
          source,
          revision,
        });

        return {
          source,
          sourceRecord,
          revision,
          documents: documentsByRevisionId.get(sourceRecord.recipeRevisionId) ?? [],
          operations: operationsByRevisionId.get(sourceRecord.recipeRevisionId) ?? [],
          manifest,
        } satisfies LoadedSourceRecipe;
      }),
    );
  });

export const loadSourceRecipe = (input: {
  rows: SqlControlPlaneRows;
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
  actorAccountId?: AccountId | null;
}): Effect.Effect<LoadedSourceRecipe, Error, never> =>
  Effect.gen(function* () {
    const sourceRecord = yield* input.rows.sources.getByWorkspaceAndId(
      input.workspaceId,
      input.sourceId,
    );
    if (Option.isNone(sourceRecord)) {
      return yield* Effect.fail(
        new Error(`Source not found: workspaceId=${input.workspaceId} sourceId=${input.sourceId}`),
      );
    }

    const source = yield* loadSourceById(input.rows, {
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      actorAccountId: input.actorAccountId,
    });
    const revision = yield* input.rows.sourceRecipeRevisions.getById(sourceRecord.value.recipeRevisionId);
    if (Option.isNone(revision)) {
      return yield* Effect.fail(
        new Error(`Recipe revision missing for source ${input.sourceId}`),
      );
    }
    const [documents, operations, manifest] = yield* Effect.all([
      input.rows.sourceRecipeDocuments.listByRevisionId(sourceRecord.value.recipeRevisionId),
      input.rows.sourceRecipeOperations.listByRevisionId(sourceRecord.value.recipeRevisionId),
      parseManifestForRecipe({
        source,
        revision: revision.value,
      }),
    ]);

    return {
      source,
      sourceRecord: sourceRecord.value,
      revision: revision.value,
      documents,
      operations,
      manifest,
    } satisfies LoadedSourceRecipe;
  });

export const expandRecipeTools = (input: {
  recipes: readonly LoadedSourceRecipe[];
  includeSchemas: boolean;
}): readonly LoadedSourceRecipeTool[] =>
  input.recipes.flatMap((recipe) =>
    recipe.operations.map((operation) => {
      const path = recipeToolPath({
        source: recipe.source,
        operation,
      });
      const searchNamespace = recipeToolSearchNamespace({
        source: recipe.source,
        path,
        operation,
      });

      return {
        path,
        searchNamespace,
        searchText: [
          path,
          searchNamespace,
          recipe.source.name,
          operation.searchText,
        ]
          .filter((part) => part.length > 0)
          .join(" ")
          .toLowerCase(),
        source: recipe.source,
        sourceRecord: recipe.sourceRecord,
        revision: recipe.revision,
        operation,
        manifest: recipe.manifest,
        descriptor: recipeToolDescriptor({
          source: recipe.source,
          operation,
          path,
          includeSchemas: input.includeSchemas,
        }),
      } satisfies LoadedSourceRecipeTool;
    })
  );
