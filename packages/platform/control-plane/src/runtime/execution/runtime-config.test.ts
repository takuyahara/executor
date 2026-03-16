import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  createControlPlaneRuntime,
} from "../index";
import { withControlPlaneClient } from "./test-http-client";

const writeProjectConfig = (
  workspaceRoot: string,
  config: Record<string, unknown>,
) => {
  const configDirectory = join(workspaceRoot, ".executor");
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(
    join(configDirectory, "executor.jsonc"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
};

const makeRuntime = (config: Record<string, unknown>) => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "executor-runtime-config-"));
  writeProjectConfig(workspaceRoot, config);

  return Effect.acquireRelease(
    createControlPlaneRuntime({
      workspaceRoot,
      homeConfigPath: join(workspaceRoot, ".executor-home.jsonc"),
      homeStateDirectory: join(workspaceRoot, ".executor-home-state"),
    }),
    (runtime) => Effect.promise(() => runtime.close()).pipe(Effect.orDie),
  );
};

describe("execution runtime config", () => {
  it.scoped("defaults to QuickJS when no runtime is configured", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime({
        sources: {},
      });
      const installation = runtime.localInstallation;

      const execution = yield* withControlPlaneClient(
        {
          runtime,
          accountId: installation.accountId,
        },
        (client) =>
          client.executions.create({
            path: {
              workspaceId: installation.workspaceId,
            },
            payload: {
              code: 'await fetch("https://example.com"); return 1;',
            },
          }),
      );

      expect(execution.execution.status).toBe("failed");
      expect(execution.execution.errorText).toContain(
        "fetch is disabled in QuickJS executor",
      );
    }),
    60_000,
  );

  it.scoped("uses the SES runtime when configured in executor.jsonc", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime({
        runtime: "ses",
        sources: {},
      });
      const installation = runtime.localInstallation;

      const execution = yield* withControlPlaneClient(
        {
          runtime,
          accountId: installation.accountId,
        },
        (client) =>
          client.executions.create({
            path: {
              workspaceId: installation.workspaceId,
            },
            payload: {
              code: 'await fetch("https://example.com"); return 1;',
            },
          }),
      );

      expect(execution.execution.status).toBe("failed");
      expect(execution.execution.errorText).toContain(
        "fetch is disabled in SES executor",
      );
    }),
    60_000,
  );

  it.scoped("uses the Deno runtime when configured in executor.jsonc", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime({
        runtime: "deno",
        sources: {},
      });
      const installation = runtime.localInstallation;

      const execution = yield* withControlPlaneClient(
        {
          runtime,
          accountId: installation.accountId,
        },
        (client) =>
          client.executions.create({
            path: {
              workspaceId: installation.workspaceId,
            },
            payload: {
              code: 'return typeof Deno !== "undefined";',
            },
          }),
      );

      if (execution.execution.status === "completed") {
        expect(execution.execution.resultJson).toBe("true");
        return;
      }

      expect(execution.execution.status).toBe("failed");
      expect(execution.execution.errorText).toContain("Install Deno or set DENO_BIN");
    }),
    60_000,
  );
});
