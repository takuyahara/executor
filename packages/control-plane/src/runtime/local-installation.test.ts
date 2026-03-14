import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { assertTrue } from "@effect/vitest/utils";
import * as Effect from "effect/Effect";

import { createSqlControlPlaneRuntime } from "./index";
import { getOrProvisionLocalInstallation } from "./local-installation";
import { resolveLocalWorkspaceContext } from "./local-config";

const TEST_WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), "executor-local-installation-"));

const makeRuntime = Effect.acquireRelease(
  createSqlControlPlaneRuntime({
    localDataDir: ":memory:",
    workspaceRoot: TEST_WORKSPACE_ROOT,
  }),
  (runtime) => Effect.promise(() => runtime.close()).pipe(Effect.orDie),
);

describe("local-installation", () => {
  it.scoped("provisions a local account, organization, and workspace on first boot", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;

      const account = yield* runtime.persistence.rows.accounts.getById(installation.accountId);
      const organization = yield* runtime.persistence.rows.organizations.getById(
        installation.organizationId,
      );
      const workspace = yield* runtime.persistence.rows.workspaces.getById(
        installation.workspaceId,
      );

      assertTrue(account._tag === "Some");
      assertTrue(organization._tag === "Some");
      assertTrue(workspace._tag === "Some");
      expect(existsSync(join(TEST_WORKSPACE_ROOT, ".executor", "executor.jsonc"))).toBe(false);
    }),
  );

  it.scoped("is idempotent when loading the default local installation", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const context = yield* Effect.promise(() =>
        resolveLocalWorkspaceContext({ workspaceRoot: TEST_WORKSPACE_ROOT }),
      );

      const first = runtime.localInstallation;
      const second = yield* getOrProvisionLocalInstallation({
        rows: runtime.persistence.rows,
        context,
      });

      expect(second.id).toBe(first.id);
      expect(second.accountId).toBe(first.accountId);
      expect(second.organizationId).toBe(first.organizationId);
      expect(second.workspaceId).toBe(first.workspaceId);
    }),
  );
});
