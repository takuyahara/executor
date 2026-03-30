import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { readDistributionPackageMetadata, repoRoot } from "./metadata";

const defaultOutputDir = resolve(repoRoot, "apps/executor/dist/npm");


export type BuildDistributionPackageOptions = {
  outputDir?: string;
  packageName?: string;
  packageVersion?: string;
  buildWeb?: boolean;
};

export type DistributionPackageArtifact = {
  packageDir: string;
  launcherPath: string;
  bundlePath: string;
  resourcesDir: string;
};

type CommandInput = {
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
};

const runCommand = async (input: CommandInput): Promise<void> => {
  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: process.env,
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

  if (exitCode === 0) {
    return;
  }

  throw new Error(
    [
      `${input.command} ${input.args.join(" ")} exited with code ${exitCode}`,
      stdout.trim().length > 0 ? `stdout:\n${stdout.trim()}` : null,
      stderr.trim().length > 0 ? `stderr:\n${stderr.trim()}` : null,
    ]
      .filter((part) => part !== null)
      .join("\n\n"),
  );
};

const resolveQuickJsWasmPath = (): string => {
  const requireFromQuickJsRuntime = createRequire(
    join(repoRoot, "packages/kernel/runtime-quickjs/package.json"),
  );
  const quickJsPackagePath = requireFromQuickJsRuntime.resolve(
    "quickjs-emscripten/package.json",
  );
  const wasmPath = resolve(
    dirname(quickJsPackagePath),
    "../@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm",
  );

  if (!existsSync(wasmPath)) {
    throw new Error(`Unable to locate QuickJS wasm asset at ${wasmPath}`);
  }

  return wasmPath;
};


const createPackageJson = (input: {
  packageName: string;
  packageVersion: string;
  description: string;
  keywords: ReadonlyArray<string>;
  homepage?: string;
  bugs?: {
    url?: string;
  };
  repository?: {
    type?: string;
    url?: string;
  };
  license?: string;
}) => {
  const packageJson = {
    name: input.packageName,
    version: input.packageVersion,
    description: input.description,
    keywords: input.keywords,
    homepage: input.homepage,
    bugs: input.bugs,
    repository: input.repository,
    license: input.license ?? "MIT",
    type: "module",
    private: false,
    bin: {
      executor: "bin/executor.js",
    },
    files: [
      "bin",
      "resources",
      "README.md",
      "package.json",
    ],
    engines: {
      node: ">=20",
    },
  };

  return JSON.stringify(packageJson, null, 2) + "\n";
};

const createLauncherSource = () => [
  "#!/usr/bin/env node",
  'import { readFileSync, readdirSync } from "node:fs";',
  'import { dirname, join } from "node:path";',
  'import { fileURLToPath } from "node:url";',
  "",
  "const isMusl = () => {",
  '  try {',
  '    return readFileSync("/usr/bin/ldd", "utf8").includes("musl");',
  "  } catch {}",
  "",
  '  if (typeof process.report?.getReport === "function") {',
  "    const report = process.report.getReport();",
  "    if (report?.header?.glibcVersionRuntime) {",
  "      return false;",
  "    }",
  "    if (Array.isArray(report?.sharedObjects)) {",
  '      return report.sharedObjects.some((file) => file.includes("libc.musl-") || file.includes("ld-musl-"));',
  "    }",
  "  }",
  "",
  "  return false;",
  "};",
  "",
  "const resolveBundledKeyringNativeLibraryPath = () => {",
  '  if (process.platform !== "linux" || process.arch !== "x64") {',
  "    return null;",
  "  }",
  "",
  "  const binDir = dirname(fileURLToPath(import.meta.url));",
  '  const pattern = isMusl()',
  '    ? /^keyring\\.linux-x64-musl-.*\\.node$/',
  '    : /^keyring\\.linux-x64-gnu-.*\\.node$/;',
  '  const match = readdirSync(binDir).find((entry) => pattern.test(entry));',
  "  return match ? join(binDir, match) : null;",
  "};",
  "",
  "const bundledKeyringNativeLibraryPath = resolveBundledKeyringNativeLibraryPath();",
  'if (bundledKeyringNativeLibraryPath && !process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {',
  "  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = bundledKeyringNativeLibraryPath;",
  "}",
  "",
  'await import("./executor.mjs");',
  "",
].join("\n");

const buildCliBundle = async (input: {
  binDir: string;
  bundlePath: string;
}): Promise<void> => {
  const builtEntrypointPath = join(input.binDir, "main.js");

  await runCommand({
    command: "bun",
    args: [
      "build",
      "./apps/executor/src/cli/main.ts",
      "--target",
      "node",
      "--outdir",
      input.binDir,
    ],
    cwd: repoRoot,
  });

  if (!existsSync(builtEntrypointPath)) {
    throw new Error(`Missing bundled CLI entrypoint at ${builtEntrypointPath}`);
  }

  await rm(input.bundlePath, { force: true });
  await rename(builtEntrypointPath, input.bundlePath);
};

export const buildDistributionPackage = async (
  options: BuildDistributionPackageOptions = {},
): Promise<DistributionPackageArtifact> => {
  const defaults = await readDistributionPackageMetadata();
  const packageDir = resolve(options.outputDir ?? defaultOutputDir);
  const binDir = join(packageDir, "bin");
  const resourcesDir = join(packageDir, "resources");
  const webDir = join(resourcesDir, "web");
  const bundlePath = join(binDir, "executor.mjs");
  const launcherPath = join(binDir, "executor.js");
  const quickJsWasmPath = resolveQuickJsWasmPath();

  const webDistDir = join(repoRoot, "apps/web/dist");
  const readmePath = join(repoRoot, "README.md");
  const packageName = options.packageName ?? defaults.name;
  const packageVersion = options.packageVersion ?? defaults.version;
  await rm(packageDir, { recursive: true, force: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(resourcesDir, { recursive: true });

  if ((options.buildWeb ?? true) || !existsSync(webDistDir)) {
    await runCommand({
      command: "bun",
      args: ["run", "build"],
      cwd: join(repoRoot, "apps/web"),
    });
  }

  if (!existsSync(webDistDir)) {
    throw new Error(`Missing built web assets at ${webDistDir}`);
  }

  await buildCliBundle({
    binDir,
    bundlePath,
  });

  await cp(webDistDir, webDir, { recursive: true });
  await cp(quickJsWasmPath, join(binDir, "emscripten-module.wasm"));
  await cp(
    join(repoRoot, "packages/kernel/runtime-deno-subprocess/src/deno-subprocess-worker.mjs"),
    join(binDir, "deno-subprocess-worker.mjs"),
  );
  await runCommand({
    command: "bun",
    args: [
      "build",
      "./packages/kernel/runtime-ses/src/sandbox-worker.mjs",
      "--target",
      "node",
      "--outfile",
      join(binDir, "sandbox-worker.mjs"),
    ],
    cwd: repoRoot,
  });
  await writeFile(join(packageDir, "package.json"), createPackageJson({
    packageName,
    packageVersion,
    description: defaults.description,
    keywords: defaults.keywords,
    homepage: defaults.homepage,
    bugs: defaults.bugs,
    repository: defaults.repository,
    license: defaults.license,
  }));
  await cp(readmePath, join(packageDir, "README.md"));
  await writeFile(launcherPath, createLauncherSource());
  await chmod(launcherPath, 0o755);

  return {
    packageDir,
    launcherPath,
    bundlePath,
    resourcesDir,
  };
};
