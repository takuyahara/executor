import { join } from "node:path";
import { FileSystem } from "@effect/platform";

import {
  SourceIdSchema,
  SourceCatalogIdSchema,
  StoredSourceCatalogRevisionRecordSchema,
  TimestampMsSchema,
  type Source,
  type SourceCatalogId,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { CatalogSnapshotV1Schema } from "../ir/model";
import type { SourceCatalogSyncResult } from "./source-catalog-support";
import type { ResolvedLocalWorkspaceContext } from "./local-config";
import {
  LocalFileSystemError,
  LocalSourceArtifactDecodeError,
  unknownLocalErrorDetails,
} from "./local-errors";
import {
  createSourceCatalogRevisionRecord,
  stableSourceCatalogId,
} from "./source-definitions";
import { contentHash } from "./source-catalog-support";

const LOCAL_SOURCE_ARTIFACT_VERSION = 2 as const;

export const LocalSourceArtifactSchema = Schema.Struct({
  version: Schema.Literal(LOCAL_SOURCE_ARTIFACT_VERSION),
  sourceId: SourceIdSchema,
  catalogId: SourceCatalogIdSchema,
  generatedAt: TimestampMsSchema,
  revision: StoredSourceCatalogRevisionRecordSchema,
  snapshot: CatalogSnapshotV1Schema,
});

export type LocalSourceArtifact = typeof LocalSourceArtifactSchema.Type;

const decodeLocalSourceArtifact = Schema.decodeUnknownSync(LocalSourceArtifactSchema);

const mapFileSystemError = (path: string, action: string) => (cause: unknown) =>
  new LocalFileSystemError({
    message: `Failed to ${action} ${path}: ${unknownLocalErrorDetails(cause)}`,
    action,
    path,
    details: unknownLocalErrorDetails(cause),
  });

const localSourceArtifactPath = (input: {
  context: ResolvedLocalWorkspaceContext;
  sourceId: string;
}): string =>
  join(
    input.context.artifactsDirectory,
    "sources",
    `${input.sourceId}.json`,
  );

const snapshotHash = (snapshot: SourceCatalogSyncResult["snapshot"]): string =>
  contentHash(JSON.stringify(snapshot));

export const buildLocalSourceArtifact = (input: {
  source: Source;
  syncResult: SourceCatalogSyncResult;
}): LocalSourceArtifact => {
  const catalogId: SourceCatalogId = stableSourceCatalogId(input.source);
  const generatedAt = Date.now();
  const hash = snapshotHash(input.syncResult.snapshot);
  const revision = createSourceCatalogRevisionRecord({
    source: input.source,
    catalogId,
    revisionNumber: 1,
    importMetadataJson: JSON.stringify(input.syncResult.snapshot.import),
    importMetadataHash: hash,
    snapshotHash: hash,
  });

  return {
    version: LOCAL_SOURCE_ARTIFACT_VERSION,
    sourceId: input.source.id,
    catalogId,
    generatedAt,
    revision,
    snapshot: input.syncResult.snapshot,
  };
};

export const readLocalSourceArtifact = (input: {
  context: ResolvedLocalWorkspaceContext;
  sourceId: string;
}): Effect.Effect<
  LocalSourceArtifact | null,
  LocalFileSystemError | LocalSourceArtifactDecodeError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = localSourceArtifactPath(input);
    const exists = yield* fs.exists(path).pipe(
      Effect.mapError(mapFileSystemError(path, "check source artifact path")),
    );
    if (!exists) {
      return null;
    }

    const content = yield* fs.readFileString(path, "utf8").pipe(
      Effect.mapError(mapFileSystemError(path, "read source artifact")),
    );
    return yield* Effect.try({
      try: () => decodeLocalSourceArtifact(JSON.parse(content) as unknown),
      catch: (cause) =>
        new LocalSourceArtifactDecodeError({
          message: `Invalid local source artifact at ${path}: ${unknownLocalErrorDetails(cause)}`,
          path,
          details: unknownLocalErrorDetails(cause),
        }),
    });
  });

export const writeLocalSourceArtifact = (input: {
  context: ResolvedLocalWorkspaceContext;
  sourceId: string;
  artifact: LocalSourceArtifact;
}): Effect.Effect<void, LocalFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = join(input.context.artifactsDirectory, "sources");
    const path = localSourceArtifactPath(input);
    yield* fs.makeDirectory(directory, { recursive: true }).pipe(
      Effect.mapError(mapFileSystemError(directory, "create source artifact directory")),
    );
    yield* fs.writeFileString(path, `${JSON.stringify(input.artifact, null, 2)}\n`).pipe(
      Effect.mapError(mapFileSystemError(path, "write source artifact")),
    );
  });

export const removeLocalSourceArtifact = (input: {
  context: ResolvedLocalWorkspaceContext;
  sourceId: string;
}): Effect.Effect<void, LocalFileSystemError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = localSourceArtifactPath(input);
    const exists = yield* fs.exists(path).pipe(
      Effect.mapError(mapFileSystemError(path, "check source artifact path")),
    );
    if (!exists) {
      return;
    }
    yield* fs.remove(path).pipe(
      Effect.mapError(mapFileSystemError(path, "remove source artifact")),
    );
  });
