import * as Effect from "effect/Effect";

import {
  RuntimeAdapterError,
  type RuntimeAdapter,
} from "@executor-v2/engine";

export const makeCloudflareWorkerLoaderRuntimeAdapter = (): RuntimeAdapter => ({
  kind: "cloudflare-worker-loader",
  isAvailable: () => Effect.succeed(false),
  execute: () =>
    new RuntimeAdapterError({
      operation: "execute",
      runtimeKind: "cloudflare-worker-loader",
      message: "Cloudflare worker loader runtime adapter is not implemented yet",
      details: null,
    }),
});
