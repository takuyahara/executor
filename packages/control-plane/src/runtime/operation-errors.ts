import {
  ControlPlaneBadRequestError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "../api/errors";
import { ControlPlanePersistenceError } from "#persistence";
import * as Effect from "effect/Effect";

const unknownPersistenceError = (
  operation: string,
  cause: unknown,
  details: string,
): ControlPlanePersistenceError =>
  new ControlPlanePersistenceError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    details,
    code: null,
    constraint: null,
    table: null,
    kind: "unknown",
    cause,
  });

export type OperationErrors<TOperation extends string = string> = {
  readonly operation: TOperation;
  readonly child: <TSuffix extends string>(
    suffix: TSuffix,
  ) => OperationErrors<`${TOperation}.${TSuffix}`>;
  readonly badRequest: (
    message: string,
    details: string,
  ) => ControlPlaneBadRequestError;
  readonly notFound: (
    message: string,
    details: string,
  ) => ControlPlaneNotFoundError;
  readonly storage: (
    error: ControlPlanePersistenceError,
  ) => ControlPlaneStorageError;
  readonly unknownPersistence: (
    cause: unknown,
    details: string,
  ) => ControlPlanePersistenceError;
  readonly unknownStorage: (
    cause: unknown,
    details: string,
  ) => ControlPlaneStorageError;
  readonly mapStorage: <A>(
    effect: Effect.Effect<A, ControlPlanePersistenceError>,
  ) => Effect.Effect<A, ControlPlaneStorageError>;
};

export type OperationErrorsLike = OperationErrors | string;

export const operationErrors = <TOperation extends string>(
  operation: TOperation,
): OperationErrors<TOperation> => {
  const self: OperationErrors<TOperation> = {
    operation,
    child: (suffix) =>
      operationErrors(`${operation}.${suffix}` as `${TOperation}.${typeof suffix}`),
    badRequest: (message, details) =>
      new ControlPlaneBadRequestError({
        operation,
        message,
        details,
      }),
    notFound: (message, details) =>
      new ControlPlaneNotFoundError({
        operation,
        message,
        details,
      }),
    storage: (error) =>
      new ControlPlaneStorageError({
        operation,
        message: error.message,
        details: error.details ?? "Persistence operation failed",
      }),
    unknownPersistence: (cause, details) =>
      unknownPersistenceError(operation, cause, details),
    unknownStorage: (cause, details) =>
      self.storage(self.unknownPersistence(cause, details)),
    mapStorage: (effect) =>
      effect.pipe(
        Effect.mapError(self.storage),
      ),
  };

  return self;
};

export const asOperationErrors = (
  errors: OperationErrorsLike,
): OperationErrors =>
  typeof errors === "string"
    ? operationErrors(errors)
    : errors;
