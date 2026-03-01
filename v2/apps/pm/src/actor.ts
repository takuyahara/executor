import {
  ControlPlaneActorResolverLive,
  deriveWorkspaceMembershipsForPrincipal,
  requirePrincipalFromHeaders,
} from "@executor-v2/management-api";
import {
  ActorUnauthenticatedError,
  makeActor,
  makeAllowAllActor,
} from "@executor-v2/domain";
import {
  type LocalStateSnapshot,
  type LocalStateStore,
} from "@executor-v2/persistence-local";
import {
  type OrganizationMembership,
  type WorkspaceMembership,
} from "@executor-v2/schema";
import * as PlatformHeaders from "@effect/platform/Headers";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

const isTruthy = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const localAdminFallbackEnabled = (() => {
  const configured = process.env.PM_ALLOW_LOCAL_ADMIN;

  if (configured === undefined || configured.trim().length === 0) {
    return process.env.NODE_ENV !== "production";
  }

  return isTruthy(configured);
})();

const organizationMembershipsForAccount = (
  snapshot: LocalStateSnapshot,
  accountId: OrganizationMembership["accountId"],
): ReadonlyArray<OrganizationMembership> =>
  snapshot.organizationMemberships.filter(
    (membership) => membership.accountId === accountId,
  );

const workspaceMembershipsForAccount = (
  snapshot: LocalStateSnapshot,
  accountId: OrganizationMembership["accountId"],
  organizationMemberships: ReadonlyArray<OrganizationMembership>,
): ReadonlyArray<WorkspaceMembership> =>
  snapshot.workspaces.flatMap((workspace) =>
    deriveWorkspaceMembershipsForPrincipal({
      principalAccountId: accountId,
      workspaceId: workspace.id,
      workspace,
      organizationMemberships,
    }),
  );

const resolveActorFromSnapshot = (
  localStateStore: LocalStateStore,
  headers: PlatformHeaders.Headers,
) =>
  Effect.gen(function* () {
    const principal = yield* requirePrincipalFromHeaders(headers);

    const snapshotOption = yield* localStateStore.getSnapshot().pipe(
      Effect.mapError(
        (error) =>
          new ActorUnauthenticatedError({
            message: `Unable to read local auth state (${error.operation})`,
          }),
      ),
    );

    const snapshot = Option.getOrNull(snapshotOption);

    if (snapshot === null && localAdminFallbackEnabled) {
      return makeAllowAllActor(principal);
    }

    const organizationMemberships =
      snapshot === null
        ? []
        : organizationMembershipsForAccount(snapshot, principal.accountId);
    const workspaceMemberships =
      snapshot === null
        ? []
        : workspaceMembershipsForAccount(snapshot, principal.accountId, organizationMemberships);

    return yield* makeActor({
      principal,
      workspaceMemberships,
      organizationMemberships,
    });
  });

export const PmActorLive = (localStateStore: LocalStateStore) =>
  ControlPlaneActorResolverLive({
    resolveActor: (input) => resolveActorFromSnapshot(localStateStore, input.headers),
    resolveWorkspaceActor: (input) =>
      Effect.gen(function* () {
        const principal = yield* requirePrincipalFromHeaders(input.headers);

        const snapshotOption = yield* localStateStore.getSnapshot().pipe(
          Effect.mapError(
            (error) =>
              new ActorUnauthenticatedError({
                message: `Unable to read local auth state (${error.operation})`,
              }),
          ),
        );

        const snapshot = Option.getOrNull(snapshotOption);

        if (snapshot === null && localAdminFallbackEnabled) {
          return makeAllowAllActor(principal);
        }

        const organizationMemberships =
          snapshot === null
            ? []
            : organizationMembershipsForAccount(snapshot, principal.accountId);

        const workspace =
          snapshot === null
            ? null
            : snapshot.workspaces.find((item) => item.id === input.workspaceId) ?? null;

        const workspaceMemberships = deriveWorkspaceMembershipsForPrincipal({
          principalAccountId: principal.accountId,
          workspaceId: input.workspaceId,
          workspace,
          organizationMemberships,
        });

        return yield* makeActor({
          principal,
          workspaceMemberships,
          organizationMemberships,
        });
      }),
  });
