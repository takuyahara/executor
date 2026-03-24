import * as Effect from "effect/Effect";

import {
  createCatalogImportMetadata,
  createSourceCatalogSyncResult,
} from "@executor/source-core";
import type { ExecutorSdkPlugin } from "../../../plugins";

import { runtimeEffectError } from "../../effect-errors";

export const InternalSourceSdkPlugin = {
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
          runtimeEffectError(
            "sources/source-plugins/internal",
            "Internal sources do not support persisted plugin invocation",
          ),
        ),
    },
  ],
} satisfies ExecutorSdkPlugin<"internal">;
