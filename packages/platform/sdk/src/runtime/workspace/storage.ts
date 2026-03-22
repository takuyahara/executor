import type { LocalInstallation, LocalExecutorConfig } from "#schema";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import type { LoadedLocalExecutorConfig } from "../workspace-config";
import type { LocalSourceArtifact } from "../source-artifacts";
import type { LocalWorkspaceState } from "../workspace-state";
import type { SourceCatalogSyncResult } from "@executor/source-core";
import type { Source } from "#schema";

export type InstallationStoreShape = {
  load: () => import("effect/Effect").Effect<LocalInstallation, Error, never>;
  getOrProvision: () => import("effect/Effect").Effect<LocalInstallation, Error, never>;
};

export class InstallationStore extends Context.Tag(
  "#runtime/InstallationStore",
)<InstallationStore, InstallationStoreShape>() {}

export type WorkspaceConfigStoreShape = {
  load: () => import("effect/Effect").Effect<LoadedLocalExecutorConfig, Error, never>;
  writeProject: (input: {
    config: LocalExecutorConfig;
  }) => import("effect/Effect").Effect<void, Error, never>;
  resolveRelativePath: (input: { path: string; workspaceRoot: string }) => string;
};

export class WorkspaceConfigStore extends Context.Tag(
  "#runtime/WorkspaceConfigStore",
)<WorkspaceConfigStore, WorkspaceConfigStoreShape>() {}

export type WorkspaceStateStoreShape = {
  load: () => import("effect/Effect").Effect<LocalWorkspaceState, Error, never>;
  write: (input: {
    state: LocalWorkspaceState;
  }) => import("effect/Effect").Effect<void, Error, never>;
};

export class WorkspaceStateStore extends Context.Tag(
  "#runtime/WorkspaceStateStore",
)<WorkspaceStateStore, WorkspaceStateStoreShape>() {}

export type SourceArtifactStoreShape = {
  build: (input: {
    source: Source;
    syncResult: SourceCatalogSyncResult;
  }) => LocalSourceArtifact;
  read: (input: {
    sourceId: string;
  }) => import("effect/Effect").Effect<LocalSourceArtifact | null, Error, never>;
  write: (input: {
    sourceId: string;
    artifact: LocalSourceArtifact;
  }) => import("effect/Effect").Effect<void, Error, never>;
  remove: (input: {
    sourceId: string;
  }) => import("effect/Effect").Effect<void, Error, never>;
};

export class SourceArtifactStore extends Context.Tag(
  "#runtime/SourceArtifactStore",
)<SourceArtifactStore, SourceArtifactStoreShape>() {}

export type LocalStorageServices =
  | InstallationStore
  | WorkspaceConfigStore
  | WorkspaceStateStore
  | SourceArtifactStore;

export type WorkspaceStorageServices =
  | WorkspaceConfigStore
  | WorkspaceStateStore
  | SourceArtifactStore;

export const makeWorkspaceStorageLayer = (input: {
  workspaceConfigStore: WorkspaceConfigStoreShape;
  workspaceStateStore: WorkspaceStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
}) =>
  Layer.mergeAll(
    Layer.succeed(WorkspaceConfigStore, input.workspaceConfigStore),
    Layer.succeed(WorkspaceStateStore, input.workspaceStateStore),
    Layer.succeed(SourceArtifactStore, input.sourceArtifactStore),
  );

export const makeLocalStorageLayer = (input: {
  installationStore: InstallationStoreShape;
  workspaceConfigStore: WorkspaceConfigStoreShape;
  workspaceStateStore: WorkspaceStateStoreShape;
  sourceArtifactStore: SourceArtifactStoreShape;
}) =>
  Layer.mergeAll(
    Layer.succeed(InstallationStore, input.installationStore),
    makeWorkspaceStorageLayer(input),
  );
