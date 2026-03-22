import type {
  ToolCatalog,
  ToolInvoker,
  ToolMap,
} from "@executor/codemode-core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type LocalToolRuntime = {
  tools: ToolMap;
  catalog: ToolCatalog;
  toolInvoker: ToolInvoker;
  toolPaths: Set<string>;
};

export type LocalToolRuntimeLoaderShape = {
  load: () => Effect.Effect<LocalToolRuntime, Error, never>;
};

export class LocalToolRuntimeLoaderService extends Context.Tag(
  "#runtime/LocalToolRuntimeLoaderService",
)<LocalToolRuntimeLoaderService, LocalToolRuntimeLoaderShape>() {}

export const LocalToolRuntimeLoaderLive = Layer.effect(
  LocalToolRuntimeLoaderService,
  Effect.succeed(
    LocalToolRuntimeLoaderService.of({
      load: () =>
        Effect.die(
          new Error(
            "LocalToolRuntimeLoaderLive is unsupported; provide a bound local tool runtime loader from the host adapter.",
          ),
        ),
    }),
  ),
);
