import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promises as fs } from "node:fs";

import {
  LocalExecutorConfigSchema,
  type LocalExecutorConfig,
  type LocalConfigPolicy,
  type LocalConfigSecretProvider,
  type LocalConfigSource,
} from "#schema";
import * as Schema from "effect/Schema";

const decodeLocalExecutorConfig = Schema.decodeUnknownSync(LocalExecutorConfigSchema);

const PROJECT_CONFIG_BASENAME = "executor.jsonc";
const PROJECT_CONFIG_FALLBACK_BASENAME = "executor.json";
const PROJECT_CONFIG_DIRECTORY = ".executor";
const HOME_CONFIG_DIRECTORY = join(homedir(), ".config", "executor");
const HOME_CONFIG_PATH = join(HOME_CONFIG_DIRECTORY, PROJECT_CONFIG_BASENAME);

const normalizeSlashPath = (value: string): string =>
  value.replaceAll("\\", "/");

const stableHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 16);

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};

const trimOrUndefined = (value: string | undefined | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const stripJsonComments = (input: string): string => {
  let output = "";
  let inString = false;
  let stringChar = '"';
  let escapeNext = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    const next = input[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escapeNext) {
        escapeNext = false;
      } else if (char === "\\") {
        escapeNext = true;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringChar = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
};

const parseJsonc = (input: { path: string; content: string }): LocalExecutorConfig => {
  try {
    const parsed = JSON.parse(stripJsonComments(input.content)) as unknown;
    return decodeLocalExecutorConfig(parsed);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid executor config at ${input.path}: ${message}`);
  }
};

const mergeSourceMaps = (
  base: Record<string, LocalConfigSource> | undefined,
  extra: Record<string, LocalConfigSource> | undefined,
): Record<string, LocalConfigSource> | undefined => {
  if (!base && !extra) {
    return undefined;
  }
  return {
    ...(base ?? {}),
    ...(extra ?? {}),
  };
};

const mergePolicyMaps = (
  base: Record<string, LocalConfigPolicy> | undefined,
  extra: Record<string, LocalConfigPolicy> | undefined,
): Record<string, LocalConfigPolicy> | undefined => {
  if (!base && !extra) {
    return undefined;
  }
  return {
    ...(base ?? {}),
    ...(extra ?? {}),
  };
};

const mergeSecretProviderMaps = (
  base: Record<string, LocalConfigSecretProvider> | undefined,
  extra: Record<string, LocalConfigSecretProvider> | undefined,
): Record<string, LocalConfigSecretProvider> | undefined => {
  if (!base && !extra) {
    return undefined;
  }
  return {
    ...(base ?? {}),
    ...(extra ?? {}),
  };
};

export const mergeLocalExecutorConfigs = (
  base: LocalExecutorConfig | null,
  extra: LocalExecutorConfig | null,
): LocalExecutorConfig | null => {
  if (!base && !extra) {
    return null;
  }

  return decodeLocalExecutorConfig({
    workspace: {
      ...(base?.workspace ?? {}),
      ...(extra?.workspace ?? {}),
    },
    sources: mergeSourceMaps(base?.sources, extra?.sources),
    policies: mergePolicyMaps(base?.policies, extra?.policies),
    secrets: {
      providers: mergeSecretProviderMaps(
        base?.secrets?.providers,
        extra?.secrets?.providers,
      ),
      defaults: {
        ...(base?.secrets?.defaults ?? {}),
        ...(extra?.secrets?.defaults ?? {}),
      },
    },
  });
};

const resolveProjectConfigPath = async (workspaceRoot: string): Promise<string> => {
  const jsoncPath = join(workspaceRoot, PROJECT_CONFIG_DIRECTORY, PROJECT_CONFIG_BASENAME);
  if (await fileExists(jsoncPath)) {
    return jsoncPath;
  }

  const jsonPath = join(workspaceRoot, PROJECT_CONFIG_DIRECTORY, PROJECT_CONFIG_FALLBACK_BASENAME);
  if (await fileExists(jsonPath)) {
    return jsonPath;
  }

  return jsoncPath;
};

const hasProjectConfig = async (workspaceRoot: string): Promise<boolean> =>
  fileExists(join(workspaceRoot, PROJECT_CONFIG_DIRECTORY, PROJECT_CONFIG_BASENAME))
  || fileExists(join(workspaceRoot, PROJECT_CONFIG_DIRECTORY, PROJECT_CONFIG_FALLBACK_BASENAME));

const resolveWorkspaceRootFromCwd = async (cwd: string): Promise<string> => {
  let current = resolve(cwd);
  let nearestProjectConfigRoot: string | null = null;
  let nearestGitRoot: string | null = null;

  while (true) {
    if (nearestProjectConfigRoot === null && (await hasProjectConfig(current))) {
      nearestProjectConfigRoot = current;
    }

    if (nearestGitRoot === null && (await pathExists(join(current, ".git")))) {
      nearestGitRoot = current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return nearestProjectConfigRoot ?? nearestGitRoot ?? resolve(cwd);
};

export type ResolvedLocalWorkspaceContext = {
  cwd: string;
  workspaceRoot: string;
  workspaceName: string;
  configDirectory: string;
  projectConfigPath: string;
  homeConfigPath: string;
  artifactsDirectory: string;
  stateDirectory: string;
  installationId: string;
};

export type LoadedLocalExecutorConfig = {
  config: LocalExecutorConfig | null;
  homeConfig: LocalExecutorConfig | null;
  projectConfig: LocalExecutorConfig | null;
  homeConfigPath: string;
  projectConfigPath: string;
};

export const resolveLocalWorkspaceContext = async (input: {
  cwd?: string;
  workspaceRoot?: string;
} = {}): Promise<ResolvedLocalWorkspaceContext> => {
  const cwd = resolve(input.cwd ?? process.cwd());
  const workspaceRoot = resolve(
    input.workspaceRoot ?? (await resolveWorkspaceRootFromCwd(cwd)),
  );
  const workspaceName = basename(workspaceRoot) || "workspace";
  const projectConfigPath = await resolveProjectConfigPath(workspaceRoot);

  return {
    cwd,
    workspaceRoot,
    workspaceName,
    configDirectory: join(workspaceRoot, PROJECT_CONFIG_DIRECTORY),
    projectConfigPath,
    homeConfigPath: HOME_CONFIG_PATH,
    artifactsDirectory: join(workspaceRoot, PROJECT_CONFIG_DIRECTORY, "artifacts"),
    stateDirectory: join(workspaceRoot, PROJECT_CONFIG_DIRECTORY, "state"),
    installationId: `local_${stableHash(normalizeSlashPath(workspaceRoot))}`,
  };
};

export const readOptionalLocalExecutorConfig = async (
  path: string,
): Promise<LocalExecutorConfig | null> => {
  if (!(await fileExists(path))) {
    return null;
  }

  const content = await fs.readFile(path, "utf8");
  return parseJsonc({ path, content });
};

export const loadLocalExecutorConfig = async (
  context: ResolvedLocalWorkspaceContext,
): Promise<LoadedLocalExecutorConfig> => {
  const [homeConfig, projectConfig] = await Promise.all([
    readOptionalLocalExecutorConfig(context.homeConfigPath),
    readOptionalLocalExecutorConfig(context.projectConfigPath),
  ]);

  return {
    config: mergeLocalExecutorConfigs(homeConfig, projectConfig),
    homeConfig,
    projectConfig,
    homeConfigPath: context.homeConfigPath,
    projectConfigPath: context.projectConfigPath,
  };
};

export const encodeLocalExecutorConfig = (config: LocalExecutorConfig): string =>
  `${JSON.stringify(config, null, 2)}\n`;

export const writeProjectLocalExecutorConfig = async (input: {
  context: ResolvedLocalWorkspaceContext;
  config: LocalExecutorConfig;
}): Promise<void> => {
  await fs.mkdir(input.context.configDirectory, { recursive: true });
  await fs.writeFile(
    input.context.projectConfigPath,
    encodeLocalExecutorConfig(input.config),
    "utf8",
  );
};

export const resolveConfigRelativePath = (input: {
  path: string;
  workspaceRoot: string;
}): string => {
  const trimmed = input.path.trim();
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  if (trimmed === "~") {
    return homedir();
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  return resolve(input.workspaceRoot, trimmed);
};

export const defaultWorkspaceDisplayName = (context: ResolvedLocalWorkspaceContext): string =>
  trimOrUndefined(context.workspaceName) ?? "workspace";
