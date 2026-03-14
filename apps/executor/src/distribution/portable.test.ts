import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPortableDistribution,
  resolveDefaultPortableTarget,
} from "./portable";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const runCommand = async (input: {
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
  env: NodeJS.ProcessEnv;
  okExitCodes?: ReadonlyArray<number>;
}): Promise<CommandResult> => {
  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolveExitCode, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolveExitCode(code ?? -1);
    });
  });

  const result = {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  } satisfies CommandResult;

  if ((input.okExitCodes ?? [0]).includes(exitCode)) {
    return result;
  }

  throw new Error(
    [
      `${input.command} ${input.args.join(" ")} exited with code ${exitCode}`,
      result.stdout.length > 0 ? `stdout:\n${result.stdout}` : null,
      result.stderr.length > 0 ? `stderr:\n${result.stderr}` : null,
    ].filter((part) => part !== null).join("\n\n"),
  );
};

const allocatePort = async (): Promise<number> =>
  await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate test port")));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolvePort(address.port);
      });
    });
  });

describe("portable distribution flow", () => {
  it("installs and boots a portable bundle in a fresh home", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "executor-portable-"));

    try {
      const distDir = join(tempRoot, "dist");
      const homeDir = join(tempRoot, "home");
      const binDir = join(homeDir, ".local", "bin");
      const installHome = process.platform === "darwin"
        ? join(homeDir, "Library", "Application Support", "Executor")
        : join(homeDir, ".local", "share", "executor");
      const runHome = process.platform === "darwin"
        ? join(installHome, "run")
        : join(homeDir, ".local", "state", "executor", "run");
      const legacyExecutorBin = join(homeDir, ".executor", "bin", "executor");
      const baseUrl = `http://127.0.0.1:${await allocatePort()}`;

      await mkdir(homeDir, { recursive: true });
      await mkdir(binDir, { recursive: true });

      const artifact = await buildPortableDistribution({
        outputDir: distDir,
        buildWeb: false,
        targets: [resolveDefaultPortableTarget()],
      });
      const bundle = artifact.artifacts[0]!;

      const env = {
        ...process.env,
        HOME: homeDir,
        PATH: `${binDir}:/usr/bin:/bin`,
      } satisfies NodeJS.ProcessEnv;

      await runCommand({
        command: "sh",
        args: [bundle.installScriptPath],
        cwd: bundle.bundleDir,
        env,
      });

      await runCommand({
        command: "sh",
        args: [bundle.installScriptPath],
        cwd: bundle.bundleDir,
        env,
      });

      expect(existsSync(join(binDir, "executor"))).toBe(true);
      expect(existsSync(join(installHome, "portable"))).toBe(true);
      expect(existsSync(legacyExecutorBin)).toBe(false);

      const initialDoctor = await runCommand({
        command: "executor",
        args: ["doctor", "--json", "--base-url", baseUrl],
        cwd: tempRoot,
        env,
      });
      const initialDoctorJson = JSON.parse(initialDoctor.stdout) as {
        ok: boolean;
        checks: Record<string, { ok: boolean }>;
      };
      expect(initialDoctorJson.ok).toBe(false);
      expect(initialDoctorJson.checks.webAssets?.ok).toBe(true);
      expect(initialDoctorJson.checks.migrations?.ok).toBe(true);

      await runCommand({
        command: "executor",
        args: ["up", "--base-url", baseUrl],
        cwd: tempRoot,
        env,
      });

      const statusResult = await runCommand({
        command: "executor",
        args: ["status", "--json", "--base-url", baseUrl],
        cwd: tempRoot,
        env,
      });
      const status = JSON.parse(statusResult.stdout) as {
        reachable: boolean;
        pidRunning: boolean;
        logFile: string;
        localDataDir: string;
        pidFile: string;
        installation: { workspaceId: string; accountId: string } | null;
      };
      expect(status.reachable).toBe(true);
      expect(status.pidRunning).toBe(true);
      expect(status.installation).not.toBeNull();
      expect(status.logFile.startsWith(runHome)).toBe(true);
      expect(status.localDataDir.startsWith(join(installHome, "data"))).toBe(true);
      expect(status.pidFile.startsWith(runHome)).toBe(true);

      const html = await fetch(new URL("/", baseUrl));
      expect(html.status).toBe(200);
      expect(html.headers.get("content-type")).toContain("text/html");
      expect(await html.text()).toContain('<div id="root"></div>');

      const installationResponse = await fetch(new URL("/v1/local/installation", baseUrl));
      expect(installationResponse.status).toBe(200);
      const installation = await installationResponse.json() as {
        workspaceId: string;
        accountId: string;
      };

      await runCommand({
        command: "executor",
        args: ["down", "--base-url", baseUrl],
        cwd: tempRoot,
        env,
      });
      await runCommand({
        command: "executor",
        args: ["up", "--base-url", baseUrl],
        cwd: tempRoot,
        env,
      });

      const installationAfterRestartResponse = await fetch(new URL("/v1/local/installation", baseUrl));
      expect(installationAfterRestartResponse.status).toBe(200);
      const installationAfterRestart = await installationAfterRestartResponse.json() as {
        workspaceId: string;
        accountId: string;
      };
      expect(installationAfterRestart.workspaceId).toBe(installation.workspaceId);
      expect(installationAfterRestart.accountId).toBe(installation.accountId);

      await runCommand({
        command: "executor",
        args: ["down", "--base-url", baseUrl],
        cwd: tempRoot,
        env,
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 240_000);
});
