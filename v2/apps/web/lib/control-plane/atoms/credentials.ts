import { Atom } from "@effect-atom/atom";
import type {
  RemoveCredentialBindingResult,
  UpsertCredentialBindingPayload,
} from "@executor-v2/management-api/credentials/api";
import type {
  CredentialBindingId,
  CredentialProvider,
  CredentialScopeType,
  SourceCredentialBinding,
  WorkspaceId,
} from "@executor-v2/schema";

import { controlPlaneClient } from "../client";
import { workspaceEntity, type EntityState } from "./entity";
import { credentialsKeys } from "./keys";

// ---------------------------------------------------------------------------
// Query atoms
// ---------------------------------------------------------------------------

export const credentialBindingsResultByWorkspace = Atom.family(
  (workspaceId: WorkspaceId) =>
    controlPlaneClient.query("credentials", "list", {
      path: { workspaceId },
      reactivityKeys: credentialsKeys,
    }),
);

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

const sortCredentialBindings = (a: SourceCredentialBinding, b: SourceCredentialBinding): number => {
  const aKey = `${a.sourceKey}:${a.provider}`.toLowerCase();
  const bKey = `${b.sourceKey}:${b.provider}`.toLowerCase();
  if (aKey === bKey) return `${a.workspaceId}:${a.id}`.localeCompare(`${b.workspaceId}:${b.id}`);
  return aKey.localeCompare(bKey);
};

export const credentialBindingsByWorkspace = workspaceEntity(
  credentialBindingsResultByWorkspace,
  sortCredentialBindings,
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const upsertCredentialBinding = controlPlaneClient.mutation("credentials", "upsert");
export const removeCredentialBinding = controlPlaneClient.mutation("credentials", "remove");

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

export const toCredentialBindingUpsertPayload = (input: {
  id?: CredentialBindingId;
  credentialId: SourceCredentialBinding["credentialId"];
  scopeType: CredentialScopeType;
  sourceKey: string;
  provider: CredentialProvider;
  secretRef: string;
  accountId?: SourceCredentialBinding["accountId"];
  additionalHeadersJson?: SourceCredentialBinding["additionalHeadersJson"];
  boundAuthFingerprint?: SourceCredentialBinding["boundAuthFingerprint"];
}): UpsertCredentialBindingPayload => ({
  ...(input.id ? { id: input.id } : {}),
  credentialId: input.credentialId,
  scopeType: input.scopeType,
  sourceKey: input.sourceKey,
  provider: input.provider,
  secretRef: input.secretRef,
  ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
  ...(input.additionalHeadersJson !== undefined
    ? { additionalHeadersJson: input.additionalHeadersJson }
    : {}),
  ...(input.boundAuthFingerprint !== undefined
    ? { boundAuthFingerprint: input.boundAuthFingerprint }
    : {}),
});

export const toCredentialBindingRemoveResult = (
  result: RemoveCredentialBindingResult,
): boolean => result.removed;

export type CredentialBindingsState = EntityState<SourceCredentialBinding>;
