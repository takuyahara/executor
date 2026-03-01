import * as BunContext from "@effect/platform-bun/BunContext";
import { ControlPlaneServiceLive } from "@executor-v2/control-plane";
import {
  RunExecutionServiceLive,
  RuntimeToolInvokerUnimplementedLive,
  ToolInvocationServiceLive,
} from "@executor-v2/domain";
import {
  RuntimeAdapterRegistryLive,
  ToolProviderRegistryService,
  makeToolProviderRegistry,
} from "@executor-v2/engine";
import { makeCloudflareWorkerLoaderRuntimeAdapter } from "@executor-v2/runtime-cloudflare-worker-loader";
import { makeDenoSubprocessRuntimeAdapter } from "@executor-v2/runtime-deno-subprocess";
import { makeLocalInProcessRuntimeAdapter } from "@executor-v2/runtime-local-inproc";
import {
  LocalSourceStoreLive,
  LocalStateStoreLive,
} from "@executor-v2/persistence-local";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PmConfigLive } from "./config";
import { PmCredentialResolverLive } from "./credential-resolver";
import { startPmHttpServer } from "./http-server";
import { PmMcpHandlerLive } from "./mcp-handler";
import { PmRuntimeExecutionPortLive } from "./runtime-execution-port";

const pmStateRootDir = process.env.PM_STATE_ROOT_DIR ?? ".executor-v2/pm-state";

const readConfiguredRuntimeKind = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const pmRuntimeAdapters = [
  makeLocalInProcessRuntimeAdapter(),
  makeDenoSubprocessRuntimeAdapter(),
  makeCloudflareWorkerLoaderRuntimeAdapter(),
];

const pmDefaultRuntimeKind =
  readConfiguredRuntimeKind(process.env.PM_RUNTIME_KIND) ?? pmRuntimeAdapters[0].kind;

const PmRuntimeAdapterRegistryLive = RuntimeAdapterRegistryLive(pmRuntimeAdapters);

const PmToolProviderRegistryLive = Layer.succeed(
  ToolProviderRegistryService,
  makeToolProviderRegistry([]),
);

const PmRuntimeExecutionDependenciesLive = Layer.merge(
  PmRuntimeAdapterRegistryLive,
  PmToolProviderRegistryLive,
);

const PmRuntimeExecutionPortDependenciesLive = PmRuntimeExecutionPortLive({
  defaultRuntimeKind: pmDefaultRuntimeKind,
}).pipe(Layer.provide(PmRuntimeExecutionDependenciesLive));

const PmRunExecutionLive = RunExecutionServiceLive().pipe(
  Layer.provide(PmRuntimeExecutionPortDependenciesLive),
);

const PmSourceStoreLive = LocalSourceStoreLive({
  rootDir: pmStateRootDir,
}).pipe(Layer.provide(BunContext.layer));

const PmStateStoreLive = LocalStateStoreLive({
  rootDir: pmStateRootDir,
}).pipe(Layer.provide(BunContext.layer));

const PmControlPlaneDependenciesLive = ControlPlaneServiceLive.pipe(
  Layer.provide(PmSourceStoreLive),
);

const PmToolInvocationDependenciesLive = ToolInvocationServiceLive.pipe(
  Layer.provide(RuntimeToolInvokerUnimplementedLive("pm")),
  Layer.provide(PmCredentialResolverLive.pipe(Layer.provide(PmStateStoreLive))),
);

const PmAppLive = Layer.mergeAll(
  PmConfigLive,
  PmMcpHandlerLive.pipe(Layer.provide(PmRunExecutionLive)),
  PmToolInvocationDependenciesLive,
  PmControlPlaneDependenciesLive,
);

const program = Effect.scoped(startPmHttpServer()).pipe(Effect.provide(PmAppLive));

await Effect.runPromise(program);
