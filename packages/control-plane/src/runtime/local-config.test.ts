import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  loadLocalExecutorConfig,
  resolveDefaultHomeConfigCandidates,
  resolveDefaultHomeStateDirectory,
  resolveHomeConfigPath,
  resolveLocalWorkspaceContext,
} from "./local-config";

const makeWorkspaceRoot = () =>
  mkdtempSync(join(tmpdir(), "executor-local-config-"));

describe("local-config", () => {
  it.effect("parses jsonc project config with comments and trailing commas", () =>
    Effect.gen(function* () {
      const workspaceRoot = makeWorkspaceRoot();
      const configDirectory = join(workspaceRoot, ".executor");
      yield* Effect.promise(() => mkdir(configDirectory, { recursive: true }));
      yield* Effect.promise(() =>
        writeFile(
          join(configDirectory, "executor.jsonc"),
          `{
  // local workspace config
  "sources": {
    "github": {
      "kind": "openapi",
      "connection": {
        "endpoint": "https://api.github.com",
      },
      "binding": {
        "specUrl": "https://example.com/openapi.json",
      },
    },
  },
}
`,
          "utf8",
        ),
      );

      const context = yield* resolveLocalWorkspaceContext({ workspaceRoot });
      const loaded = yield* loadLocalExecutorConfig(context);

      expect(loaded.config?.sources?.github?.kind).toBe("openapi");
      expect(loaded.config?.sources?.github?.connection.endpoint).toBe(
        "https://api.github.com",
      );
      expect(context.homeStateDirectory).toContain("executor");
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("reports jsonc syntax errors with line and column details", () =>
    Effect.gen(function* () {
      const workspaceRoot = makeWorkspaceRoot();
      const configDirectory = join(workspaceRoot, ".executor");
      yield* Effect.promise(() => mkdir(configDirectory, { recursive: true }));
      yield* Effect.promise(() =>
        writeFile(
          join(configDirectory, "executor.jsonc"),
          `{
  "sources": {
    "github": {
      "kind": "openapi"
      "connection": {
        "endpoint": "https://api.github.com"
      }
    }
  }
}
`,
          "utf8",
        ),
      );

      const context = yield* resolveLocalWorkspaceContext({ workspaceRoot });
      const failure = yield* Effect.flip(loadLocalExecutorConfig(context));

      expect(failure.message).toContain("Invalid executor config");
      expect(failure.message).toContain("line 5, column 7");
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it("uses platform-standard home config candidates", () => {
    const linuxCandidates = resolveDefaultHomeConfigCandidates({
      platform: "linux",
      homeDirectory: "/home/alice",
      env: {},
    });
    const macCandidates = resolveDefaultHomeConfigCandidates({
      platform: "darwin",
      homeDirectory: "/Users/alice",
      env: {},
    });

    expect(linuxCandidates[0]).toBe("/home/alice/.config/executor/executor.jsonc");
    expect(macCandidates[0]).toBe(
      "/Users/alice/Library/Application Support/Executor/executor.jsonc",
    );
    expect(macCandidates[2]).toBe("/Users/alice/.config/executor/executor.jsonc");
  });

  it("uses platform-standard home state directories", () => {
    const linuxStateDirectory = resolveDefaultHomeStateDirectory({
      platform: "linux",
      homeDirectory: "/home/alice",
      env: {},
    });
    const macStateDirectory = resolveDefaultHomeStateDirectory({
      platform: "darwin",
      homeDirectory: "/Users/alice",
      env: {},
    });

    expect(linuxStateDirectory).toBe("/home/alice/.local/state/executor");
    expect(macStateDirectory).toBe(
      "/Users/alice/Library/Application Support/Executor/State",
    );
  });

  it.effect("prefers an existing legacy home config path before the canonical path", () =>
    Effect.gen(function* () {
      const homeDirectory = makeWorkspaceRoot();
      const legacyConfigDirectory = join(homeDirectory, ".config", "executor");
      yield* Effect.promise(() => mkdir(legacyConfigDirectory, { recursive: true }));
      yield* Effect.promise(() =>
        writeFile(
          join(legacyConfigDirectory, "executor.jsonc"),
          "{\n  \"sources\": {}\n}\n",
          "utf8",
        ),
      );

      const resolvedPath = yield* resolveHomeConfigPath({
        platform: "darwin",
        homeDirectory,
        env: {},
      });

      expect(resolvedPath).toBe(join(legacyConfigDirectory, "executor.jsonc"));
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
