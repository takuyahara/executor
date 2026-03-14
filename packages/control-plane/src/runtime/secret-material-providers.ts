import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { SqlControlPlaneRows } from "#persistence";
import {
  type LocalConfigSecretProvider,
  type LocalExecutorConfig,
  type SecretMaterialPurpose,
  SecretMaterialIdSchema,
  type SecretRef,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { resolveConfigRelativePath } from "./local-config";
import { fromConfigSecretProviderId } from "./local-config-secrets";

export const ENV_SECRET_PROVIDER_ID = "env";
export const PARAMS_SECRET_PROVIDER_ID = "params";
export const KEYCHAIN_SECRET_PROVIDER_ID = "keychain";
export const POSTGRES_SECRET_PROVIDER_ID = "postgres";

export type SecretStoreProviderId =
  | typeof KEYCHAIN_SECRET_PROVIDER_ID
  | typeof POSTGRES_SECRET_PROVIDER_ID;

export type SecretMaterialResolveContext = {
  params?: Readonly<Record<string, string | undefined>>;
};

export type ResolveSecretMaterial = (input: {
  ref: SecretRef;
  context?: SecretMaterialResolveContext;
}) => Effect.Effect<string, Error, never>;

export type StoreSecretMaterial = (input: {
  purpose: SecretMaterialPurpose;
  value: string;
  name?: string | null;
}) => Effect.Effect<SecretRef, Error, never>;

export type DeleteSecretMaterial = (
  ref: SecretRef,
) => Effect.Effect<boolean, Error, never>;

type SecretMaterialProviderRuntime = {
  rows: SqlControlPlaneRows;
  env: NodeJS.ProcessEnv;
  dangerouslyAllowEnvSecrets: boolean;
  keychainServiceName: string;
  localConfig: LocalExecutorConfig | null;
  workspaceRoot: string | null;
};

type SecretMaterialProvider = {
  resolve: (input: {
    ref: SecretRef;
    context: SecretMaterialResolveContext;
    runtime: SecretMaterialProviderRuntime;
  }) => Effect.Effect<string, Error, never>;
  store?: (input: {
    purpose: SecretMaterialPurpose;
    value: string;
    name?: string | null;
    runtime: SecretMaterialProviderRuntime;
  }) => Effect.Effect<SecretRef, Error, never>;
  remove?: (input: {
    ref: SecretRef;
    runtime: SecretMaterialProviderRuntime;
  }) => Effect.Effect<boolean, Error, never>;
};

type SecretMaterialProviderRegistry = ReadonlyMap<string, SecretMaterialProvider>;

type SpawnResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const DEFAULT_KEYCHAIN_SERVICE_NAME = "executor";
const DANGEROUSLY_ALLOW_ENV_SECRETS_ENV = "DANGEROUSLY_ALLOW_ENV_SECRETS";
const SECRET_STORE_PROVIDER_ENV = "EXECUTOR_SECRET_STORE_PROVIDER";
const KEYCHAIN_SERVICE_NAME_ENV = "EXECUTOR_KEYCHAIN_SERVICE_NAME";

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseBooleanEnv = (value: string | undefined): boolean => {
  const normalized = trimOrNull(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

export const parseSecretStoreProviderId = (value: string | undefined): SecretStoreProviderId | null => {
  const normalized = trimOrNull(value)?.toLowerCase();
  if (normalized === KEYCHAIN_SECRET_PROVIDER_ID) {
    return KEYCHAIN_SECRET_PROVIDER_ID;
  }

  if (normalized === POSTGRES_SECRET_PROVIDER_ID) {
    return POSTGRES_SECRET_PROVIDER_ID;
  }

  return null;
};

const resolveDangerouslyAllowEnvSecrets = (value: boolean | undefined): boolean =>
  value ?? parseBooleanEnv(process.env[DANGEROUSLY_ALLOW_ENV_SECRETS_ENV]);

const resolveSecretStoreProviderId = (value: SecretStoreProviderId | undefined): SecretStoreProviderId =>
  value
  ?? parseSecretStoreProviderId(process.env[SECRET_STORE_PROVIDER_ENV])
  ?? POSTGRES_SECRET_PROVIDER_ID;

const resolveKeychainServiceName = (value: string | undefined): string =>
  trimOrNull(value)
  ?? trimOrNull(process.env[KEYCHAIN_SERVICE_NAME_ENV])
  ?? DEFAULT_KEYCHAIN_SERVICE_NAME;

const ensureNonEmptyString = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const runCommand = (input: {
  command: string;
  args: ReadonlyArray<string>;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  operation: string;
}): Effect.Effect<SpawnResult, Error, never> =>
  Effect.tryPromise({
    try: () =>
      new Promise<SpawnResult>((resolve, reject) => {
        const child = spawn(input.command, [...input.args], {
          stdio: "pipe",
          env: input.env,
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString("utf8");
        });

        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString("utf8");
        });

        child.on("error", (error) => {
          reject(new Error(`${input.operation}: failed spawning '${input.command}': ${error.message}`));
        });

        child.on("close", (code) => {
          resolve({
            exitCode: code ?? 0,
            stdout,
            stderr,
          });
        });

        if (input.stdin !== undefined) {
          child.stdin.write(input.stdin);
        }

        child.stdin.end();
      }),
    catch: (cause) =>
      cause instanceof Error
        ? cause
        : new Error(`${input.operation}: command execution failed: ${String(cause)}`),
  });

const ensureCommandSuccess = (input: {
  result: SpawnResult;
  operation: string;
  message: string;
}): Effect.Effect<SpawnResult, Error, never> => {
  if (input.result.exitCode === 0) {
    return Effect.succeed(input.result);
  }

  const details = ensureNonEmptyString(input.result.stderr)
    ?? ensureNonEmptyString(input.result.stdout)
    ?? "command returned non-zero exit code";

  return Effect.fail(new Error(`${input.operation}: ${input.message}: ${details}`));
};

const parseKeychainHandle = (handle: string): string | null => {
  if (!handle.startsWith(`${KEYCHAIN_SECRET_PROVIDER_ID}:`)) {
    return null;
  }

  return trimOrNull(handle.slice(`${KEYCHAIN_SECRET_PROVIDER_ID}:`.length));
};

const createParamsSecretMaterialProvider = (): SecretMaterialProvider => ({
  resolve: ({ ref, context }) => {
    const value = ensureNonEmptyString(context.params?.[ref.handle]);
    if (value === null) {
      return Effect.fail(new Error(`Secret parameter ${ref.handle} is not set`));
    }

    return Effect.succeed(value);
  },

  remove: () => Effect.succeed(false),
});

const createEnvSecretMaterialProvider = (): SecretMaterialProvider => ({
  resolve: ({ ref, runtime }) => {
    if (!runtime.dangerouslyAllowEnvSecrets) {
      return Effect.fail(
        new Error(
          `Env-backed secrets are disabled. Set ${DANGEROUSLY_ALLOW_ENV_SECRETS_ENV}=true to allow provider '${ENV_SECRET_PROVIDER_ID}'.`,
        ),
      );
    }

    const value = ensureNonEmptyString(runtime.env[ref.handle]);
    if (value === null) {
      return Effect.fail(new Error(`Environment variable ${ref.handle} is not set`));
    }

    return Effect.succeed(value);
  },

  remove: () => Effect.succeed(false),
});

const createPostgresSecretMaterialProvider = (): SecretMaterialProvider => ({
  resolve: ({ ref, runtime }) =>
    Effect.gen(function* () {
      const materialId = SecretMaterialIdSchema.make(ref.handle);
      const stored = yield* runtime.rows.secretMaterials.getById(materialId);
      if (Option.isNone(stored)) {
        return yield* Effect.fail(new Error(`Secret material not found: ${ref.handle}`));
      }

      return stored.value.value;
    }),

  store: ({ purpose, value, name, runtime }) =>
    Effect.gen(function* () {
      const now = Date.now();
      const id = SecretMaterialIdSchema.make(`sec_${randomUUID()}`);
      yield* runtime.rows.secretMaterials.upsert({
        id,
        name: trimOrNull(name),
        purpose,
        value,
        createdAt: now,
        updatedAt: now,
      });

      return {
        providerId: POSTGRES_SECRET_PROVIDER_ID,
        handle: id,
      } satisfies SecretRef;
    }),

  remove: ({ ref, runtime }) =>
    Effect.gen(function* () {
      const materialId = SecretMaterialIdSchema.make(ref.handle);
      return yield* runtime.rows.secretMaterials.removeById(materialId);
    }),
});

const keychainStoreWithSecurityCli = (): SecretMaterialProvider => ({
  resolve: ({ ref, runtime }) => {
    const id = parseKeychainHandle(ref.handle);
    if (id === null) {
      return Effect.fail(new Error(`Invalid keychain secret handle: ${ref.handle}`));
    }

    return runCommand({
      command: "security",
      args: [
        "find-generic-password",
        "-a",
        id,
        "-s",
        runtime.keychainServiceName,
        "-w",
      ],
      operation: "keychain.get",
    }).pipe(
      Effect.flatMap((result) =>
        ensureCommandSuccess({
          result,
          operation: "keychain.get",
          message: "Failed loading secret from macOS keychain",
        }),
      ),
      Effect.map((result) => result.stdout.trimEnd()),
    );
  },

  store: ({ name, value, runtime }) => {
    const id = randomUUID();

    return runCommand({
      command: "security",
      args: [
        "add-generic-password",
        "-a",
        id,
        "-s",
        runtime.keychainServiceName,
        "-w",
        value,
        ...(trimOrNull(name) ? ["-l", trimOrNull(name)!] : []),
        "-U",
      ],
      operation: "keychain.put",
    }).pipe(
      Effect.flatMap((result) =>
        ensureCommandSuccess({
          result,
          operation: "keychain.put",
          message: "Failed storing secret in macOS keychain",
        }),
      ),
      Effect.as({
        providerId: KEYCHAIN_SECRET_PROVIDER_ID,
        handle: `${KEYCHAIN_SECRET_PROVIDER_ID}:${id}`,
      } satisfies SecretRef),
    );
  },

  remove: ({ ref, runtime }) => {
    const id = parseKeychainHandle(ref.handle);
    if (id === null) {
      return Effect.fail(new Error(`Invalid keychain secret handle: ${ref.handle}`));
    }

    return runCommand({
      command: "security",
      args: [
        "delete-generic-password",
        "-a",
        id,
        "-s",
        runtime.keychainServiceName,
      ],
      operation: "keychain.delete",
    }).pipe(
      Effect.map((result) => result.exitCode === 0),
    );
  },
});

const keychainStoreWithSecretTool = (): SecretMaterialProvider => ({
  resolve: ({ ref, runtime }) => {
    const id = parseKeychainHandle(ref.handle);
    if (id === null) {
      return Effect.fail(new Error(`Invalid keychain secret handle: ${ref.handle}`));
    }

    return runCommand({
      command: "secret-tool",
      args: [
        "lookup",
        "service",
        runtime.keychainServiceName,
        "account",
        id,
      ],
      operation: "keychain.get",
    }).pipe(
      Effect.flatMap((result) =>
        ensureCommandSuccess({
          result,
          operation: "keychain.get",
          message: "Failed loading secret from desktop keyring",
        }),
      ),
      Effect.map((result) => result.stdout.trimEnd()),
    );
  },

  store: ({ name, value, runtime }) => {
    const id = randomUUID();

    return runCommand({
      command: "secret-tool",
      args: [
        "store",
        "--label",
        trimOrNull(name) ?? runtime.keychainServiceName,
        "service",
        runtime.keychainServiceName,
        "account",
        id,
      ],
      stdin: value,
      operation: "keychain.put",
    }).pipe(
      Effect.flatMap((result) =>
        ensureCommandSuccess({
          result,
          operation: "keychain.put",
          message: "Failed storing secret in desktop keyring",
        }),
      ),
      Effect.as({
        providerId: KEYCHAIN_SECRET_PROVIDER_ID,
        handle: `${KEYCHAIN_SECRET_PROVIDER_ID}:${id}`,
      } satisfies SecretRef),
    );
  },

  remove: ({ ref, runtime }) => {
    const id = parseKeychainHandle(ref.handle);
    if (id === null) {
      return Effect.fail(new Error(`Invalid keychain secret handle: ${ref.handle}`));
    }

    return runCommand({
      command: "secret-tool",
      args: [
        "clear",
        "service",
        runtime.keychainServiceName,
        "account",
        id,
      ],
      operation: "keychain.delete",
    }).pipe(
      Effect.map((result) => result.exitCode === 0),
    );
  },
});

const createKeychainSecretMaterialProvider = (): SecretMaterialProvider => {
  if (process.platform === "darwin") {
    return keychainStoreWithSecurityCli();
  }

  if (process.platform === "linux") {
    return keychainStoreWithSecretTool();
  }

  const unsupported = (operation: string) =>
    Effect.fail(new Error(`${operation}: keychain provider is unsupported on platform '${process.platform}'`));

  return {
    resolve: () => unsupported("keychain.get"),
    store: () => unsupported("keychain.put"),
    remove: () => Effect.succeed(false),
  } satisfies SecretMaterialProvider;
};

const createSecretMaterialProviderRegistry = (): SecretMaterialProviderRegistry =>
  new Map([
    [PARAMS_SECRET_PROVIDER_ID, createParamsSecretMaterialProvider()],
    [ENV_SECRET_PROVIDER_ID, createEnvSecretMaterialProvider()],
    [KEYCHAIN_SECRET_PROVIDER_ID, createKeychainSecretMaterialProvider()],
    [POSTGRES_SECRET_PROVIDER_ID, createPostgresSecretMaterialProvider()],
  ]);

const getSecretMaterialProvider = (input: {
  providers: SecretMaterialProviderRegistry;
  providerId: string;
}): Effect.Effect<SecretMaterialProvider, Error, never> => {
  const provider = input.providers.get(input.providerId);
  if (provider) {
    return Effect.succeed(provider);
  }

  return Effect.fail(new Error(`Unsupported secret provider: ${input.providerId}`));
};

const createSecretMaterialProviderRuntime = (input: {
  rows: SqlControlPlaneRows;
  dangerouslyAllowEnvSecrets?: boolean;
  keychainServiceName?: string;
  localConfig?: LocalExecutorConfig | null;
  workspaceRoot?: string | null;
}): SecretMaterialProviderRuntime => ({
  rows: input.rows,
  env: process.env,
  dangerouslyAllowEnvSecrets: resolveDangerouslyAllowEnvSecrets(input.dangerouslyAllowEnvSecrets),
  keychainServiceName: resolveKeychainServiceName(input.keychainServiceName),
  localConfig: input.localConfig ?? null,
  workspaceRoot: input.workspaceRoot ?? null,
});

const isRegularFilePath = (path: string, allowSymlink: boolean): boolean => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    if (!allowSymlink) {
      return false;
    }
    const targetStat = lstatSync(realpathSync(path));
    return targetStat.isFile();
  }
  return stat.isFile();
};

const ensureTrustedDir = (path: string, trustedDirs: readonly string[] | undefined): boolean => {
  if (!trustedDirs || trustedDirs.length === 0) {
    return true;
  }

  const real = realpathSync(path);
  return trustedDirs.some((dir) => {
    const trusted = realpathSync(dir);
    return real === trusted || real.startsWith(`${trusted}/`);
  });
};

const readFileSecretValue = (input: {
  provider: Extract<LocalConfigSecretProvider, { source: "file" }>;
  ref: SecretRef;
  workspaceRoot: string;
}): Effect.Effect<string, Error, never> =>
  Effect.tryPromise({
    try: async () => {
      const resolvedPath = resolveConfigRelativePath({
        path: input.provider.path,
        workspaceRoot: input.workspaceRoot,
      });
      const raw = await fs.readFile(resolvedPath, "utf8");
      const mode = input.provider.mode ?? "singleValue";
      if (mode === "singleValue") {
        return raw.trim();
      }

      const parsed = JSON.parse(raw) as unknown;
      if (input.ref.handle.startsWith("/")) {
        const segments = input.ref.handle
          .split("/")
          .slice(1)
          .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
        let current: unknown = parsed;
        for (const segment of segments) {
          if (typeof current !== "object" || current === null || !(segment in current)) {
            throw new Error(`Secret path not found in ${resolvedPath}: ${input.ref.handle}`);
          }
          current = (current as Record<string, unknown>)[segment];
        }
        if (typeof current !== "string" || current.trim().length === 0) {
          throw new Error(`Secret path did not resolve to a string: ${input.ref.handle}`);
        }
        return current;
      }

      if (typeof parsed !== "object" || parsed === null) {
        throw new Error(`JSON secret provider must resolve to an object: ${resolvedPath}`);
      }
      const value = (parsed as Record<string, unknown>)[input.ref.handle];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Secret key not found in ${resolvedPath}: ${input.ref.handle}`);
      }
      return value;
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });

const resolveConfiguredSecretProvider = (input: {
  ref: SecretRef;
  runtime: SecretMaterialProviderRuntime;
}): Effect.Effect<string, Error, never> => {
  const providerAlias = fromConfigSecretProviderId(input.ref.providerId);
  if (providerAlias === null) {
    return Effect.fail(new Error(`Unsupported secret provider: ${input.ref.providerId}`));
  }

  const provider = input.runtime.localConfig?.secrets?.providers?.[providerAlias];
  if (!provider) {
    return Effect.fail(
      new Error(`Config secret provider "${providerAlias}" is not configured`),
    );
  }
  if (input.runtime.workspaceRoot === null) {
    return Effect.fail(
      new Error(`Config secret provider "${providerAlias}" requires a workspace root`),
    );
  }

  if (provider.source === "env") {
    const value = ensureNonEmptyString(input.runtime.env[input.ref.handle]);
    return value === null
      ? Effect.fail(new Error(`Environment variable ${input.ref.handle} is not set`))
      : Effect.succeed(value);
  }

  if (provider.source === "file") {
    return readFileSecretValue({
      provider,
      ref: input.ref,
      workspaceRoot: input.runtime.workspaceRoot,
    });
  }

  const command = provider.command.trim();
  if (!isAbsolute(command)) {
    return Effect.fail(
      new Error(`Exec secret provider command must be absolute: ${command}`),
    );
  }
  if (!isRegularFilePath(command, provider.allowSymlinkCommand ?? false)) {
    return Effect.fail(
      new Error(`Exec secret provider command is not an allowed regular file: ${command}`),
    );
  }
  if (!ensureTrustedDir(command, provider.trustedDirs)) {
    return Effect.fail(
      new Error(`Exec secret provider command is outside trustedDirs: ${command}`),
    );
  }

  return runCommand({
    command,
    args: [...(provider.args ?? []), input.ref.handle],
    env: {
      ...input.runtime.env,
      ...(provider.env ?? {}),
    },
    operation: `config-secret.get:${providerAlias}`,
  }).pipe(
    Effect.flatMap((result) =>
      ensureCommandSuccess({
        result,
        operation: `config-secret.get:${providerAlias}`,
        message: "Failed resolving configured exec secret",
      }),
    ),
    Effect.map((result) => result.stdout.trimEnd()),
  );
};

export const createDefaultSecretMaterialResolver = (input: {
  rows: SqlControlPlaneRows;
  dangerouslyAllowEnvSecrets?: boolean;
  keychainServiceName?: string;
  localConfig?: LocalExecutorConfig | null;
  workspaceRoot?: string | null;
}): ResolveSecretMaterial => {
  const providers = createSecretMaterialProviderRegistry();
  const runtime = createSecretMaterialProviderRuntime(input);

  return ({ ref, context }) =>
    Effect.gen(function* () {
      const provider = yield* getSecretMaterialProvider({
        providers,
        providerId: ref.providerId,
      }).pipe(
        Effect.catchAll(() =>
          fromConfigSecretProviderId(ref.providerId) !== null
            ? Effect.succeed(null)
            : Effect.fail(new Error(`Unsupported secret provider: ${ref.providerId}`)),
        ),
      );

      if (provider === null) {
        return yield* resolveConfiguredSecretProvider({
          ref,
          runtime,
        });
      }

      return yield* provider.resolve({
        ref,
        context: context ?? {},
        runtime,
      });
    });
};

export const createDefaultSecretMaterialStorer = (input: {
  rows: SqlControlPlaneRows;
  storeProviderId?: SecretStoreProviderId;
  dangerouslyAllowEnvSecrets?: boolean;
  keychainServiceName?: string;
}): StoreSecretMaterial => {
  const providers = createSecretMaterialProviderRegistry();
  const runtime = createSecretMaterialProviderRuntime(input);
  const defaultStoreProviderId = resolveSecretStoreProviderId(input.storeProviderId);

  return ({ purpose, value, name }) =>
    Effect.gen(function* () {
      const provider = yield* getSecretMaterialProvider({
        providers,
        providerId: defaultStoreProviderId,
      });

      if (!provider.store) {
        return yield* Effect.fail(
          new Error(`Secret provider ${defaultStoreProviderId} does not support storing secret material`),
        );
      }

      return yield* provider.store({
        purpose,
        value,
        name,
        runtime,
      });
    });
};

export const createDefaultSecretMaterialDeleter = (input: {
  rows: SqlControlPlaneRows;
  dangerouslyAllowEnvSecrets?: boolean;
  keychainServiceName?: string;
}): DeleteSecretMaterial => {
  const providers = createSecretMaterialProviderRegistry();
  const runtime = createSecretMaterialProviderRuntime(input);

  return (ref) =>
    Effect.gen(function* () {
      const provider = yield* getSecretMaterialProvider({
        providers,
        providerId: ref.providerId,
      });

      if (!provider.remove) {
        return false;
      }

      return yield* provider.remove({
        ref,
        runtime,
      });
    });
};
