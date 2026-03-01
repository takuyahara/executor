export {
  ControlPlaneApi,
  RemoveSourceResultSchema,
  UpsertSourcePayloadSchema,
  controlPlaneOpenApiSpec,
  type RemoveSourceResult,
  type UpsertSourcePayload,
} from "./api";

export {
  ControlPlaneBadRequestError,
  ControlPlaneForbiddenError,
  ControlPlaneStorageError,
  ControlPlaneUnauthorizedError,
} from "./errors";

export {
  ControlPlaneService,
  ControlPlaneServiceLive,
  makeControlPlaneService,
  type ControlPlaneServiceShape,
} from "./service";

export {
  ControlPlaneApiLive,
  ControlPlaneActorResolverLive,
  makeControlPlaneWebHandler,
} from "./http";

export {
  ControlPlaneActorResolver,
  type ControlPlaneActorResolverShape,
  type ResolveWorkspaceActorInput,
} from "./auth/actor-resolver";

export {
  ControlPlaneAuthHeaders,
  readPrincipalFromHeaders,
  requirePrincipalFromHeaders,
} from "./auth/principal";

export { deriveWorkspaceMembershipsForPrincipal } from "./auth/workspace-membership";

export {
  ControlPlaneSourcesLive,
  makeControlPlaneSourcesService,
  type ControlPlaneSourcesServiceShape,
  type RemoveSourceInput,
  type UpsertSourceInput,
} from "./sources";

export {
  createControlPlaneAtomClient,
  makeControlPlaneClient,
  type ControlPlaneAtomClient,
  type ControlPlaneClientError,
  type ControlPlaneClientOptions,
} from "./client";
