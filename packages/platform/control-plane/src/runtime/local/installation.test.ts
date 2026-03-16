import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createControlPlaneRuntime } from "../index";
import { getOrProvisionLocalInstallation } from "./installation";
import { resolveLocalWorkspaceContext } from "./config";

const TEST_WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), "executor-local-installation-"));
const TEST_HOME_CONFIG_PATH = join(TEST_WORKSPACE_ROOT, ".executor-home.jsonc");
const TEST_HOME_STATE_DIRECTORY = join(TEST_WORKSPACE_ROOT, ".executor-home-state");

const makeRuntime = Effect.acquireRelease(
  createControlPlaneRuntime({
    localDataDir: ":memory:",
    workspaceRoot: TEST_WORKSPACE_ROOT,
    homeConfigPath: TEST_HOME_CONFIG_PATH,
    homeStateDirectory: TEST_HOME_STATE_DIRECTORY,
  }),
  (runtime) => Effect.promise(() => runtime.close()).pipe(Effect.orDie),
);

describe("local-installation", () => {
  it.scoped("derives a stable local identity on first boot", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const installation = runtime.localInstallation;

      expect(installation.accountId).toBe("acc_local_default");
      expect(installation.workspaceId.startsWith("ws_local_")).toBe(true);
      expect(existsSync(join(TEST_WORKSPACE_ROOT, ".executor", "executor.jsonc"))).toBe(false);
    }),
    60_000,
  );

  it.scoped("is idempotent when loading the default local installation", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime;
      const context = yield* resolveLocalWorkspaceContext({
        workspaceRoot: TEST_WORKSPACE_ROOT,
        homeConfigPath: TEST_HOME_CONFIG_PATH,
        homeStateDirectory: TEST_HOME_STATE_DIRECTORY,
      });

      const first = runtime.localInstallation;
      const second = yield* getOrProvisionLocalInstallation({
        context,
      });

      expect(second.accountId).toBe(first.accountId);
      expect(second.workspaceId).toBe(first.workspaceId);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
