import { describe, expect, it } from "@effect/vitest";
import type {
  LocalStateSnapshot,
  LocalStateStore,
} from "@executor-v2/persistence-local";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  createPmApprovalsService,
  createPmPersistentToolApprovalPolicy,
} from "./approvals-service";

const createTestSnapshot = (): LocalStateSnapshot =>
  ({
    schemaVersion: 1,
    generatedAt: Date.now(),
    profile: {
      id: "profile_local",
      defaultWorkspaceId: "ws_local",
      displayName: "Local",
      runtimeMode: "local",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    organizations: [],
    organizationMemberships: [],
    workspaces: [],
    sources: [],
    toolArtifacts: [],
    credentialBindings: [],
    oauthTokens: [],
    policies: [],
    approvals: [],
    taskRuns: [],
    storageInstances: [],
    syncStates: [],
  }) as unknown as LocalStateSnapshot;

describe("PM persistent approval policy", () => {
  it.effect("creates pending approval records and reuses resolved decisions", () =>
    Effect.gen(function* () {
      let snapshot: LocalStateSnapshot = createTestSnapshot();

      const localStateStore: LocalStateStore = {
        getSnapshot: () => Effect.succeed(Option.some(snapshot)),
        writeSnapshot: (nextSnapshot) =>
          Effect.sync(() => {
            snapshot = nextSnapshot;
          }),
        readEvents: () => Effect.succeed([]),
        appendEvents: () => Effect.void,
      };

      const policy = createPmPersistentToolApprovalPolicy(localStateStore, {
        requireApprovals: true,
        retryAfterMs: 250,
      });

      const first = yield* Effect.promise(() =>
        Promise.resolve(
          policy.evaluate({
            runId: "run_approval_1",
            callId: "call_approval_1",
            toolPath: "github.repos.delete",
            input: {
              owner: "octocat",
              repo: "hello-world",
            },
            workspaceId: "ws_local",
            source: "github",
            defaultMode: "auto",
          }),
        ),
      );

      expect(first.kind).toBe("pending");
      if (first.kind === "pending") {
        expect(first.retryAfterMs).toBe(250);
      }
      expect(snapshot.approvals).toHaveLength(1);
      expect(snapshot.approvals[0]?.status).toBe("pending");
      expect(snapshot.approvals[0]?.callId).toBe("call_approval_1");

      const second = yield* Effect.promise(() =>
        Promise.resolve(
          policy.evaluate({
            runId: "run_approval_1",
            callId: "call_approval_1",
            toolPath: "github.repos.delete",
            workspaceId: "ws_local",
            source: "github",
            defaultMode: "auto",
          }),
        ),
      );

      expect(second).toEqual(first);
      expect(snapshot.approvals).toHaveLength(1);

      const approvalsService = createPmApprovalsService(localStateStore);
      const createdApproval = snapshot.approvals[0];
      if (!createdApproval) {
        throw new Error("expected pending approval record");
      }

      yield* approvalsService.resolveApproval({
        workspaceId: "ws_local" as any,
        approvalId: createdApproval.id,
        payload: {
          status: "approved",
          reason: "approved by test",
        },
      });

      const finalDecision = yield* Effect.promise(() =>
        Promise.resolve(
          policy.evaluate({
            runId: "run_approval_1",
            callId: "call_approval_1",
            toolPath: "github.repos.delete",
            workspaceId: "ws_local",
            source: "github",
            defaultMode: "auto",
          }),
        ),
      );

      expect(finalDecision).toEqual({
        kind: "approved",
      });
    }),
  );
});
