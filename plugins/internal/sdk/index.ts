import * as Effect from "effect/Effect";

import {
  createCatalogImportMetadata,
  createSourceCatalogSyncResult,
} from "@executor/source-core";
import type { ExecutorSdkPlugin } from "@executor/platform-sdk/plugins";

export const internalSdkPlugin = (): ExecutorSdkPlugin<"internal"> => ({
  key: "internal",
  sources: [
    {
      kind: "internal",
      displayName: "Internal",
      catalogKind: "internal",
      catalogIdentity: ({ source }) => ({
        kind: "internal",
        sourceId: source.id,
      }),
      getIrModel: ({ source }) =>
        Effect.succeed(
          createSourceCatalogSyncResult({
            fragment: {
              version: "ir.v1.fragment",
            },
            importMetadata: {
              ...createCatalogImportMetadata({
                source,
                pluginKey: "internal",
              }),
              importerVersion: "ir.v1.internal",
              sourceConfigHash: "internal",
            },
            sourceHash: null,
          }),
        ),
      invoke: () =>
        Effect.fail(
          new Error("Internal sources do not support persisted plugin invocation"),
        ),
    },
  ],
});
