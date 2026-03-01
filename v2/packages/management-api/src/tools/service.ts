import { type SourceStoreError } from "@executor-v2/persistence-ports";
import { type SourceId, type WorkspaceId } from "@executor-v2/schema";
import * as Effect from "effect/Effect";

import type { SourceToolSummary } from "./api";

export type ListSourceToolsInput = {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
};

export type ControlPlaneToolsServiceShape = {
  listWorkspaceTools: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<ReadonlyArray<SourceToolSummary>, SourceStoreError>;
  listSourceTools: (
    input: ListSourceToolsInput,
  ) => Effect.Effect<ReadonlyArray<SourceToolSummary>, SourceStoreError>;
};

export const makeControlPlaneToolsService = (
  service: ControlPlaneToolsServiceShape,
): ControlPlaneToolsServiceShape => service;
