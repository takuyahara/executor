import { Context, Effect, Layer } from "effect";
import { createExecutor, makeTestConfig } from "@executor/sdk";
import { openApiPlugin, type OpenApiPluginExtension } from "@executor/plugin-openapi";

import type { Executor } from "@executor/sdk";
import type { ExecutorPlugin } from "@executor/sdk";

type ServerPlugins = readonly [ExecutorPlugin<"openapi", OpenApiPluginExtension>];
type ServerExecutor = Executor<ServerPlugins>;

// ---------------------------------------------------------------------------
// Service tag — provides the executor instance to HTTP handlers
// ---------------------------------------------------------------------------

export class ExecutorService extends Context.Tag("ExecutorService")<
  ExecutorService,
  ServerExecutor
>() {}

// ---------------------------------------------------------------------------
// Default layer — creates an in-memory executor with plugins
// ---------------------------------------------------------------------------

export const ExecutorServiceLive = Layer.effect(
  ExecutorService,
  createExecutor(
    makeTestConfig({
      plugins: [openApiPlugin()] as const,
    }),
  ),
);
