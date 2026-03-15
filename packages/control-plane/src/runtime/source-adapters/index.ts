import type { Source } from "#schema";
import * as Schema from "effect/Schema";

import { graphqlSourceAdapter } from "./graphql";
import { googleDiscoverySourceAdapter } from "./google-discovery";
import { internalSourceAdapter } from "./internal";
import { mcpSourceAdapter } from "./mcp";
import { openApiSourceAdapter } from "./openapi";
import type { SourceAdapter } from "./types";

export const builtInSourceAdapters = [
  openApiSourceAdapter,
  graphqlSourceAdapter,
  googleDiscoverySourceAdapter,
  mcpSourceAdapter,
  internalSourceAdapter,
] as const satisfies readonly SourceAdapter[];

export const connectableSourceAdapters = [
  mcpSourceAdapter,
  openApiSourceAdapter,
  graphqlSourceAdapter,
  googleDiscoverySourceAdapter,
] as const;

export const ConnectSourcePayloadSchema = Schema.Union(
  mcpSourceAdapter.connectPayloadSchema!,
  openApiSourceAdapter.connectPayloadSchema!,
  graphqlSourceAdapter.connectPayloadSchema!,
  googleDiscoverySourceAdapter.connectPayloadSchema!,
);

export type ConnectSourcePayload = typeof ConnectSourcePayloadSchema.Type;

export const executorAddableSourceAdapters = [
  mcpSourceAdapter,
  openApiSourceAdapter,
  graphqlSourceAdapter,
  googleDiscoverySourceAdapter,
] as const;

export const ExecutorAddSourceInputSchema = Schema.Union(
  mcpSourceAdapter.executorAddInputSchema!,
  openApiSourceAdapter.executorAddInputSchema!,
  graphqlSourceAdapter.executorAddInputSchema!,
  googleDiscoverySourceAdapter.executorAddInputSchema!,
);

export type ExecutorAddSourceInput = typeof ExecutorAddSourceInputSchema.Type;

const adaptersByKey = new Map<string, SourceAdapter>(
  builtInSourceAdapters.map((adapter) => [adapter.key, adapter]),
);

export const getSourceAdapter = (key: string): SourceAdapter => {
  const adapter = adaptersByKey.get(key);
  if (!adapter) {
    throw new Error(`Unsupported source adapter: ${key}`);
  }

  return adapter;
};

export const getSourceAdapterForSource = (source: Pick<Source, "kind">): SourceAdapter =>
  getSourceAdapter(source.kind);

export const sourceBindingStateFromSource = (source: Source) =>
  getSourceAdapterForSource(source).bindingStateFromSource(source);

export const hasSourceAdapterFamily = (
  key: string,
  family: SourceAdapter["family"],
): boolean => getSourceAdapter(key).family === family;
