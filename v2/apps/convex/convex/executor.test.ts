import { describe, expect, it } from "@effect/vitest";
import { extractOpenApiManifest } from "@executor-v2/management-api";
import { convexTest } from "convex-test";
import * as Effect from "effect/Effect";

import { api, internal } from "./_generated/api";
import { executeRunImpl } from "./executor";
import schema from "./schema";

const runtimeInternal = internal as any;

const setup = () =>
  convexTest(schema, {
    "./http.ts": () => import("./http"),
    "./mcp.ts": () => import("./mcp"),
    "./executor.ts": () => import("./executor"),
    "./runtimeCallbacks.ts": () => import("./runtimeCallbacks"),
    "./source_tool_registry.ts": () => import("./source_tool_registry"),
    "./task_runs.ts": () => import("./task_runs"),
    "./control_plane/storage.ts": () => import("./control_plane/storage"),
    "./control_plane/sources.ts": () => import("./control_plane/sources"),
    "./control_plane/openapi_ingest_mvp.ts": () => import("./control_plane/openapi_ingest_mvp"),
    "./control_plane/openapi_ingest.ts": () => import("./control_plane/openapi_ingest"),
    "./controlPlane.ts": () => import("./controlPlane"),
    "./_generated/api.js": () => import("./_generated/api.js"),
  });

describe("Convex executor and control-plane", () => {
  it.effect("executes code via executeRunImpl", () =>
    Effect.gen(function* () {
      const result = yield* executeRunImpl({
        code: "return 6 * 7;",
      });

      expect(result.status).toBe("completed");
      expect(result.result).toBe(42);
    }),
  );

  it.effect("upserts, lists, and removes sources", () =>
    Effect.gen(function* () {
      const t = setup();

      const added = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.upsertSource, {
          workspaceId: "ws_1",
          payload: {
            id: "src_1",
            name: "Weather",
            kind: "openapi",
            endpoint: "https://example.com/openapi.json",
            enabled: true,
            configJson: "{}",
            status: "draft",
            sourceHash: null,
            lastError: null,
          },
        }),
      )) as {
        id: string;
        workspaceId: string;
        name: string;
      };

      yield* Effect.tryPromise(() => t.finishInProgressScheduledFunctions());

      expect(added.id).toBe("src_1");
      expect(added.workspaceId).toBe("ws_1");
      expect(added.name).toBe("Weather");

      const listed = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listSources, {
          workspaceId: "ws_1",
        }),
      )) as Array<{
        id: string;
      }>;

      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe("src_1");

      const removed = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.removeSource, {
          workspaceId: "ws_1",
          sourceId: "src_1",
        }),
      )) as {
        removed: boolean;
      };

      expect(removed.removed).toBe(true);

      const listedAfterRemove = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listSources, {
          workspaceId: "ws_1",
        }),
      )) as Array<unknown>;

      expect(listedAfterRemove).toHaveLength(0);
    }),
  );

  it.effect("upserts, lists, and removes credentials, policies, and storage", () =>
    Effect.gen(function* () {
      const t = setup();

      const addedCredential = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.upsertCredentialBinding, {
          workspaceId: "ws_1",
          payload: {
            id: "credential_binding_1",
            credentialId: "cred_1",
            scopeType: "workspace",
            sourceKey: "github",
            provider: "bearer",
            secretRef: "secret://github/token",
            accountId: null,
            additionalHeadersJson: null,
            boundAuthFingerprint: null,
          },
        }),
      )) as {
        id: string;
        workspaceId: string | null;
      };

      expect(addedCredential.id).toBe("credential_binding_1");
      expect(addedCredential.workspaceId).toBe("ws_1");

      const listedCredentials = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listCredentialBindings, {
          workspaceId: "ws_1",
        }),
      )) as Array<{
        id: string;
      }>;

      expect(listedCredentials).toHaveLength(1);
      expect(listedCredentials[0]?.id).toBe("credential_binding_1");

      const removedCredential = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.removeCredentialBinding, {
          workspaceId: "ws_1",
          credentialBindingId: "credential_binding_1",
        }),
      )) as {
        removed: boolean;
      };

      expect(removedCredential.removed).toBe(true);

      const listedCredentialsAfterRemove = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listCredentialBindings, {
          workspaceId: "ws_1",
        }),
      )) as Array<unknown>;

      expect(listedCredentialsAfterRemove).toHaveLength(0);

      const addedPolicy = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.upsertPolicy, {
          workspaceId: "ws_1",
          payload: {
            id: "pol_1",
            toolPathPattern: "github.repos.*",
            decision: "require_approval",
          },
        }),
      )) as {
        id: string;
        workspaceId: string;
      };

      expect(addedPolicy.id).toBe("pol_1");
      expect(addedPolicy.workspaceId).toBe("ws_1");

      const listedPolicies = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listPolicies, {
          workspaceId: "ws_1",
        }),
      )) as Array<{
        id: string;
      }>;

      expect(listedPolicies).toHaveLength(1);
      expect(listedPolicies[0]?.id).toBe("pol_1");

      const removedPolicy = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.removePolicy, {
          workspaceId: "ws_1",
          policyId: "pol_1",
        }),
      )) as {
        removed: boolean;
      };

      expect(removedPolicy.removed).toBe(true);

      const listedPoliciesAfterRemove = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listPolicies, {
          workspaceId: "ws_1",
        }),
      )) as Array<unknown>;

      expect(listedPoliciesAfterRemove).toHaveLength(0);

      const openedStorage = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.openStorageInstance, {
          workspaceId: "ws_1",
          payload: {
            scopeType: "workspace",
            durability: "ephemeral",
            provider: "agentfs-local",
            purpose: "test storage",
            ttlHours: 1,
            sessionId: "session_1",
          },
        }),
      )) as {
        id: string;
        status: string;
      };

      expect(openedStorage.status).toBe("active");

      const listedStorage = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listStorageInstances, {
          workspaceId: "ws_1",
        }),
      )) as Array<{
        id: string;
      }>;

      expect(listedStorage).toHaveLength(1);
      expect(listedStorage[0]?.id).toBe(openedStorage.id);

      yield* Effect.tryPromise(() =>
        t.mutation(runtimeInternal.control_plane.storage.upsertStorageFileEntry, {
          workspaceId: "ws_1",
          storageInstanceId: openedStorage.id,
          payload: {
            path: "/notes/today.txt",
            content: "hello convex storage",
          },
        }),
      );

      const listedDirectory = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listStorageDirectory, {
          workspaceId: "ws_1",
          storageInstanceId: openedStorage.id,
          payload: {
            path: "/",
          },
        }),
      )) as {
        path: string;
        entries: ReadonlyArray<{
          name: string;
          path: string;
          kind: "file" | "directory";
        }>;
      };

      expect(listedDirectory.path).toBe("/");
      expect(listedDirectory.entries).toHaveLength(1);
      expect(listedDirectory.entries[0]?.name).toBe("notes");
      expect(listedDirectory.entries[0]?.kind).toBe("directory");

      const listedNestedDirectory = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listStorageDirectory, {
          workspaceId: "ws_1",
          storageInstanceId: openedStorage.id,
          payload: {
            path: "/notes",
          },
        }),
      )) as {
        path: string;
        entries: ReadonlyArray<{
          name: string;
          path: string;
          kind: "file" | "directory";
        }>;
      };

      expect(listedNestedDirectory.path).toBe("/notes");
      expect(listedNestedDirectory.entries).toHaveLength(1);
      expect(listedNestedDirectory.entries[0]?.name).toBe("today.txt");
      expect(listedNestedDirectory.entries[0]?.kind).toBe("file");

      const readStorageFile = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.readStorageFile, {
          workspaceId: "ws_1",
          storageInstanceId: openedStorage.id,
          payload: {
            path: "/notes/today.txt",
            encoding: "utf8",
          },
        }),
      )) as {
        content: string;
      };

      expect(readStorageFile.content).toBe("hello convex storage");

      yield* Effect.tryPromise(() =>
        t.mutation(runtimeInternal.control_plane.storage.upsertStorageKvEntry, {
          workspaceId: "ws_1",
          storageInstanceId: openedStorage.id,
          payload: {
            key: "feature.enabled",
            valueJson: "true",
          },
        }),
      );

      const listedKv = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listStorageKv, {
          workspaceId: "ws_1",
          storageInstanceId: openedStorage.id,
          payload: {
            prefix: "feature.",
          },
        }),
      )) as {
        items: Array<{
          key: string;
          value: unknown;
        }>;
      };

      expect(listedKv.items).toHaveLength(1);
      expect(listedKv.items[0]?.key).toBe("feature.enabled");
      expect(listedKv.items[0]?.value).toBe(true);

      yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.queryStorageSql, {
          workspaceId: "ws_1",
          storageInstanceId: openedStorage.id,
          payload: {
            sql: "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
          },
        }),
      );

      yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.queryStorageSql, {
          workspaceId: "ws_1",
          storageInstanceId: openedStorage.id,
          payload: {
            sql: "INSERT INTO kv_store (key, value) VALUES ('hello', 'world');",
          },
        }),
      );

      const queriedSql = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.queryStorageSql, {
          workspaceId: "ws_1",
          storageInstanceId: openedStorage.id,
          payload: {
            sql: "SELECT key, value FROM kv_store LIMIT 10;",
          },
        }),
      )) as {
        rowCount: number;
        columns: Array<string>;
        rows: Array<Record<string, unknown>>;
      };

      expect(queriedSql.rowCount).toBe(1);
      expect(queriedSql.columns).toEqual(["key", "value"]);
      expect(queriedSql.rows[0]).toEqual({ key: "hello", value: "world" });

      const closedStorage = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.closeStorageInstance, {
          workspaceId: "ws_1",
          storageInstanceId: openedStorage.id,
        }),
      )) as {
        id: string;
        status: string;
      };

      expect(closedStorage.id).toBe(openedStorage.id);
      expect(closedStorage.status).toBe("closed");

      const removedStorage = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.removeStorageInstance, {
          workspaceId: "ws_1",
          storageInstanceId: openedStorage.id,
        }),
      )) as {
        removed: boolean;
      };

      expect(removedStorage.removed).toBe(true);

      const listedStorageAfterRemove = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listStorageInstances, {
          workspaceId: "ws_1",
        }),
      )) as Array<unknown>;

      expect(listedStorageAfterRemove).toHaveLength(0);
    }),
  );

  it.effect("upserts and lists organizations/workspaces and tool views", () =>
    Effect.gen(function* () {
      const t = setup();

      const organization = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.upsertOrganization, {
          payload: {
            id: "org_1",
            slug: "acme",
            name: "Acme Inc",
            status: "active",
          },
        }),
      )) as {
        id: string;
        name: string;
      };

      expect(organization.id).toBe("org_1");
      expect(organization.name).toBe("Acme Inc");

      const organizations = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listOrganizations, {}),
      )) as Array<{
        id: string;
      }>;

      expect(organizations).toHaveLength(1);
      expect(organizations[0]?.id).toBe("org_1");

      const workspace = (yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.upsertWorkspace, {
          payload: {
            id: "ws_1",
            organizationId: "org_1",
            name: "Primary Workspace",
          },
        }),
      )) as {
        id: string;
        organizationId: string | null;
      };

      expect(workspace.id).toBe("ws_1");
      expect(workspace.organizationId).toBe("org_1");

      const workspaces = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listWorkspaces, {}),
      )) as Array<{
        id: string;
      }>;

      expect(workspaces).toHaveLength(1);
      expect(workspaces[0]?.id).toBe("ws_1");

      yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.upsertSource, {
          workspaceId: "ws_1",
          payload: {
            id: "src_1",
            name: "Weather API",
            kind: "openapi",
            endpoint: "https://example.com/openapi.json",
            enabled: true,
            configJson: "{}",
            status: "draft",
            sourceHash: null,
            lastError: null,
          },
        }),
      );
      yield* Effect.tryPromise(() => t.finishInProgressScheduledFunctions());

      const manifest = yield* extractOpenApiManifest("Weather API", {
        openapi: "3.0.0",
        info: {
          title: "Weather API",
          version: "1.0.0",
        },
        paths: {
          "/weather": {
            get: {
              operationId: "getWeather",
              responses: {
                "200": {
                  description: "ok",
                },
              },
            },
          },
        },
      });

      const now = Date.now();
      yield* Effect.tryPromise(() =>
        t.mutation(runtimeInternal.source_tool_registry.upsertToolArtifactForSource, {
          artifact: {
            id: "tool_artifact_src_1",
            workspaceId: "ws_1",
            sourceId: "src_1",
            sourceHash: manifest.sourceHash,
            toolCount: manifest.tools.length,
            manifestJson: JSON.stringify(manifest),
            createdAt: now,
            updatedAt: now,
          },
        }),
      );

      const workspaceTools = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listWorkspaceTools, {
          workspaceId: "ws_1",
        }),
      )) as Array<{
        sourceId: string;
      }>;

      expect(workspaceTools).toHaveLength(1);
      expect(workspaceTools[0]?.sourceId).toBe("src_1");

      const sourceTools = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listSourceTools, {
          workspaceId: "ws_1",
          sourceId: "src_1",
        }),
      )) as Array<{
        sourceId: string;
      }>;

      expect(sourceTools).toHaveLength(1);
      expect(sourceTools[0]?.sourceId).toBe("src_1");

      const sourceToolsFromWrongWorkspace = (yield* Effect.tryPromise(() =>
        t.query(api.controlPlane.listSourceTools, {
          workspaceId: "ws_2",
          sourceId: "src_1",
        }),
      )) as Array<unknown>;

      expect(sourceToolsFromWrongWorkspace).toHaveLength(0);
    }),
  );

  it.effect("persists approval state for runtime tool calls", () =>
    Effect.gen(function* () {
      const t = setup();

      const missingRunDecision = (yield* Effect.tryPromise(() =>
        t.mutation(runtimeInternal.source_tool_registry.evaluateToolApproval, {
          workspaceId: "ws_1",
          runId: "run_approval_1",
          callId: "call_approval_1",
          toolPath: "github.repos.delete",
          inputPreviewJson: "{}",
          defaultMode: "auto",
          requireApprovals: true,
          retryAfterMs: 333,
        }),
      )) as {
        kind: "approved" | "pending" | "denied";
        error?: string;
      };

      expect(missingRunDecision.kind).toBe("denied");
      expect(missingRunDecision.error).toContain("Unknown run for approval request");

      yield* Effect.tryPromise(() =>
        t.mutation(runtimeInternal.task_runs.startTaskRun, {
          workspaceId: "ws_1",
          runId: "run_approval_1",
        }),
      );

      // First evaluation writes a pending approval row when this runId/callId is unseen.
      const firstDecision = (yield* Effect.tryPromise(() =>
        t.mutation(runtimeInternal.source_tool_registry.evaluateToolApproval, {
          workspaceId: "ws_1",
          runId: "run_approval_1",
          callId: "call_approval_1",
          toolPath: "github.repos.delete",
          inputPreviewJson: "{}",
          defaultMode: "auto",
          requireApprovals: true,
          retryAfterMs: 333,
        }),
      )) as {
        kind: "approved" | "pending" | "denied";
        approvalId?: string;
        retryAfterMs?: number;
      };

      expect(firstDecision.kind).toBe("pending");
      expect(firstDecision.retryAfterMs).toBe(333);
      expect(firstDecision.approvalId).toBeTypeOf("string");

      const secondDecision = (yield* Effect.tryPromise(() =>
        t.mutation(runtimeInternal.source_tool_registry.evaluateToolApproval, {
          workspaceId: "ws_1",
          runId: "run_approval_1",
          callId: "call_approval_1",
          toolPath: "github.repos.delete",
          inputPreviewJson: "{}",
          defaultMode: "auto",
          requireApprovals: true,
          retryAfterMs: 333,
        }),
      )) as {
        kind: "approved" | "pending" | "denied";
        approvalId?: string;
      };

      expect(secondDecision.kind).toBe("pending");
      expect(secondDecision.approvalId).toBe(firstDecision.approvalId);

      const approvalId = firstDecision.approvalId;
      if (!approvalId) {
        throw new Error("expected approval id");
      }

      yield* Effect.tryPromise(() =>
        t.mutation(api.controlPlane.resolveApproval, {
          workspaceId: "ws_1",
          approvalId,
          payload: {
            status: "approved",
            reason: "approved by test",
          },
        }),
      );

      const resolvedDecision = (yield* Effect.tryPromise(() =>
        t.mutation(runtimeInternal.source_tool_registry.evaluateToolApproval, {
          workspaceId: "ws_1",
          runId: "run_approval_1",
          callId: "call_approval_1",
          toolPath: "github.repos.delete",
          inputPreviewJson: "{}",
          defaultMode: "auto",
          requireApprovals: true,
          retryAfterMs: 333,
        }),
      )) as {
        kind: "approved" | "pending" | "denied";
      };

      expect(resolvedDecision).toEqual({
        kind: "approved",
      });
    }),
  );
});
