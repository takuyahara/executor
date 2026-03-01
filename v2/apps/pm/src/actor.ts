import {
  ControlPlaneActorResolverLive,
  deriveWorkspaceMembershipsForPrincipal,
  requirePrincipalFromHeaders,
} from "@executor-v2/management-api";
import { ActorUnauthenticatedError, makeActor } from "@executor-v2/domain";
import {
  type LocalStateSnapshot,
  type LocalStateStore,
} from "@executor-v2/persistence-local";
import { type OrganizationMembership } from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

const organizationMembershipsForAccount = (
  snapshot: LocalStateSnapshot,
  accountId: OrganizationMembership["accountId"],
): ReadonlyArray<OrganizationMembership> =>
  snapshot.organizationMemberships.filter(
    (membership) => membership.accountId === accountId,
  );

export const PmActorLive = (localStateStore: LocalStateStore) =>
  ControlPlaneActorResolverLive({
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
