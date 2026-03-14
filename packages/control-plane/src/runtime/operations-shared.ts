import {
  ControlPlaneBadRequestError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "../api/errors";
import { ControlPlanePersistenceError } from "#persistence";
import type { Organization } from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  asOperationErrors,
  operationErrors,
  type OperationErrorsLike,
} from "./operation-errors";
import type { ControlPlaneStoreShape } from "./store";
import { slugify } from "./slug";

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const isUniqueViolation = (error: ControlPlanePersistenceError): boolean =>
  error.kind === "unique_violation";

export const mapPersistenceError = <A>(
  operation: OperationErrorsLike,
  effect: Effect.Effect<A, ControlPlanePersistenceError | Error>,
): Effect.Effect<A, ControlPlaneBadRequestError | ControlPlaneStorageError> =>
  effect.pipe(
    Effect.mapError((error) => {
      const errors = asOperationErrors(operation);
      if (error instanceof ControlPlanePersistenceError) {
        return isUniqueViolation(error)
          ? errors.badRequest("Unique constraint violation", error.details ?? "duplicate key")
          : errors.storage(error);
      }

      return errors.unknownStorage(
        error,
        error.message,
      );
    }),
  );

export const parseJsonString = (
  operation: OperationErrorsLike,
  fieldName: string,
  value: string,
): Effect.Effect<string, ControlPlaneBadRequestError> =>
  Effect.try({
    try: () => {
      JSON.parse(value);
      return value;
    },
    catch: () => {
      const errors = asOperationErrors(operation);
      return errors.badRequest(
        `Invalid ${fieldName}`,
        `${fieldName} must be valid JSON`,
      );
    },
  });

export const ensureUniqueOrganizationSlug = (
  store: ControlPlaneStoreShape,
  baseName: string,
  operation = operationErrors("organizations.create"),
): Effect.Effect<string, ControlPlaneStorageError> =>
  Effect.gen(function* () {
    const normalized = slugify(baseName);
    const seed = normalized.length > 0 ? normalized : "item";

    let counter = 0;
    while (true) {
      const candidate = counter === 0 ? seed : `${seed}-${counter + 1}`;

      const existing = yield* operation.child("slug_lookup").mapStorage(
        store.organizations.getBySlug(candidate as Organization["slug"]),
      );

      if (Option.isNone(existing)) {
        return candidate;
      }

      counter += 1;
    }
  });

export const ensureOrganizationExists = (
  store: ControlPlaneStoreShape,
  operation: OperationErrorsLike,
  organizationId: Organization["id"],
): Effect.Effect<Organization, ControlPlaneNotFoundError | ControlPlaneStorageError> =>
  Effect.gen(function* () {
    const errors = asOperationErrors(operation);
    const organization = yield* errors.child("organization_lookup").mapStorage(
      store.organizations.getById(organizationId),
    );

    if (Option.isNone(organization)) {
      return yield* Effect.fail(
        errors.notFound(
          "Organization not found",
          `organizationId=${organizationId}`,
        ),
      );
    }

    return organization.value;
  });
