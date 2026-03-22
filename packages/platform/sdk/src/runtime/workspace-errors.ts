import * as Data from "effect/Data";

export class RuntimeLocalWorkspaceUnavailableError extends Data.TaggedError(
  "RuntimeLocalWorkspaceUnavailableError",
)<{
  readonly message: string;
}> {}

export class RuntimeLocalWorkspaceMismatchError extends Data.TaggedError(
  "RuntimeLocalWorkspaceMismatchError",
)<{
  readonly message: string;
  readonly requestedWorkspaceId: string;
  readonly activeWorkspaceId: string;
}> {}

export class LocalConfiguredSourceNotFoundError extends Data.TaggedError(
  "LocalConfiguredSourceNotFoundError",
)<{
  readonly message: string;
  readonly sourceId: string;
}> {}

export class LocalSourceArtifactMissingError extends Data.TaggedError(
  "LocalSourceArtifactMissingError",
)<{
  readonly message: string;
  readonly sourceId: string;
}> {}

export class LocalUnsupportedSourceKindError extends Data.TaggedError(
  "LocalUnsupportedSourceKindError",
)<{
  readonly message: string;
  readonly kind: string;
}> {}
