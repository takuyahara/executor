import { type UpsertSourcePayload } from "@executor-v2/management-api";
import { SourceSchema, type Source } from "@executor-v2/schema";
import { v } from "convex/values";
import * as Schema from "effect/Schema";

import { internal } from "../_generated/api";
import { action, internalQuery, internalMutation, mutation, query } from "../_generated/server";

const runtimeInternal = internal as any;

const decodeSource = Schema.decodeUnknownSync(SourceSchema);

const sourceStoreKey = (source: Source): string => `${source.workspaceId}:${source.id}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseConfigJson = (configJson: string | undefined): Record<string, unknown> => {
  if (typeof configJson !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(configJson) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeHttpUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
};

const requireHttpUrl = (value: unknown, errorMessage: string): string => {
  if (typeof value !== "string") {
    throw new Error(errorMessage);
  }

  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    throw new Error(errorMessage);
  }

  return normalized;
};

const buildOpenApiConfigJson = (
  payload: UpsertSourcePayload,
  baseUrl: string,
): string => {
  const config = parseConfigJson(payload.configJson);
  config.baseUrl = baseUrl;

  const specUrl = typeof config.specUrl === "string" ? config.specUrl.trim() : "";
  if (specUrl.length === 0) {
    config.specUrl = payload.endpoint;
  }

  return JSON.stringify(config);
};

const sortSources = (sources: ReadonlyArray<Source>): Array<Source> =>
  [...sources].sort((left, right) => {
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();

    if (leftName === rightName) {
      return sourceStoreKey(left).localeCompare(sourceStoreKey(right));
    }

    return leftName.localeCompare(rightName);
  });

const toSource = (document: Record<string, unknown>): Source => {
  const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...source } = document;
  return decodeSource(source);
};

const sourceKindValidator = v.union(
  v.literal("mcp"),
  v.literal("openapi"),
  v.literal("graphql"),
  v.literal("internal"),
);

const sourceStatusValidator = v.union(
  v.literal("draft"),
  v.literal("probing"),
  v.literal("auth_required"),
  v.literal("connected"),
  v.literal("error"),
);

export const listSources = query({
  args: {
    workspaceId: v.string(),
  },
  handler: async (ctx, args): Promise<Array<Source>> => {
    const documents = await ctx.db
      .query("sources")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return sortSources(
      documents.map((document) =>
        toSource(document as unknown as Record<string, unknown>),
      ),
    );
  },
});

export const upsertSourceRecord = internalMutation({
  args: {
    workspaceId: v.string(),
    payload: v.object({
      id: v.optional(v.string()),
      name: v.string(),
      kind: sourceKindValidator,
      endpoint: v.string(),
      status: v.optional(sourceStatusValidator),
      enabled: v.optional(v.boolean()),
      configJson: v.optional(v.string()),
      sourceHash: v.optional(v.union(v.string(), v.null())),
      lastError: v.optional(v.union(v.string(), v.null())),
    }),
  },
  handler: async (ctx, args): Promise<Source> => {
    const now = Date.now();
    const sourceId = args.payload.id ?? `src_${crypto.randomUUID()}`;

    const existing = await ctx.db
      .query("sources")
      .withIndex("by_domainId", (q) => q.eq("id", sourceId))
      .unique();

    const existingInWorkspace =
      existing && existing.workspaceId === args.workspaceId ? existing : null;

    const payload = args.payload as UpsertSourcePayload;

    const configJson = (() => {
      if (payload.kind !== "openapi") {
        return payload.configJson ?? "{}";
      }

      const configuredBaseUrl = requireHttpUrl(
        parseConfigJson(payload.configJson).baseUrl,
        "OpenAPI source requires configJson.baseUrl",
      );

      return buildOpenApiConfigJson(payload, configuredBaseUrl);
    })();

    const source = decodeSource({
      id: sourceId,
      workspaceId: args.workspaceId,
      name: payload.name,
      kind: payload.kind,
      endpoint: payload.endpoint,
      status: payload.status ?? "draft",
      enabled: payload.enabled ?? true,
      configJson,
      sourceHash: payload.sourceHash ?? null,
      lastError: payload.lastError ?? null,
      createdAt: existingInWorkspace?.createdAt ?? now,
      updatedAt: now,
    });

    if (existingInWorkspace) {
      await ctx.db.patch(existingInWorkspace._id, source);
    } else {
      await ctx.db.insert("sources", source);
    }

    return source;
  },
});

export const upsertSource = action({
  args: {
    workspaceId: v.string(),
    payload: v.object({
      id: v.optional(v.string()),
      name: v.string(),
      kind: sourceKindValidator,
      endpoint: v.string(),
      status: v.optional(sourceStatusValidator),
      enabled: v.optional(v.boolean()),
      configJson: v.optional(v.string()),
      sourceHash: v.optional(v.union(v.string(), v.null())),
      lastError: v.optional(v.union(v.string(), v.null())),
    }),
  },
  handler: async (ctx, args): Promise<Source> => {
    const shouldIngest = args.payload.status !== "draft";
    let payload = args.payload as UpsertSourcePayload;

    if (payload.kind === "openapi") {
      const config = parseConfigJson(payload.configJson);
      let resolvedBaseUrl = typeof config.baseUrl === "string"
        ? normalizeHttpUrl(config.baseUrl)
        : null;

      if (!resolvedBaseUrl) {
        const derived = await ctx.runAction(
          runtimeInternal.control_plane.openapi_ingest.deriveOpenApiBaseUrl,
          {
            specUrl: payload.endpoint,
          },
        );
        resolvedBaseUrl = requireHttpUrl(
          derived?.baseUrl,
          "OpenAPI source requires configJson.baseUrl",
        );
      }
      const baseUrl = requireHttpUrl(
        resolvedBaseUrl,
        "OpenAPI source requires configJson.baseUrl",
      );

      payload = {
        ...payload,
        configJson: buildOpenApiConfigJson(payload, baseUrl),
      };
    }

    const source = await ctx.runMutation(runtimeInternal.control_plane.sources.upsertSourceRecord, {
      workspaceId: args.workspaceId,
      payload: {
        ...payload,
        status: payload.status ?? (shouldIngest ? "probing" : "draft"),
      },
    });

    if (shouldIngest && source.kind !== "internal") {
      if (source.kind === "openapi") {
        await ctx.runAction(runtimeInternal.control_plane.openapi_ingest.ingestSourceArtifact, {
          workspaceId: source.workspaceId,
          sourceId: source.id,
        });
      } else {
        await ctx.scheduler.runAfter(
          0,
          runtimeInternal.control_plane.openapi_ingest.ingestSourceArtifact,
          {
            workspaceId: source.workspaceId,
            sourceId: source.id,
          },
        );
      }
    }

    return source;
  },
});

export const getSourceForIngest = internalQuery({
  args: {
    sourceId: v.string(),
  },
  handler: async (ctx, args): Promise<Source | null> => {
    const sourceRow = await ctx.db
      .query("sources")
      .withIndex("by_domainId", (q) => q.eq("id", args.sourceId))
      .unique();

    if (!sourceRow) {
      return null;
    }

    return toSource(sourceRow as unknown as Record<string, unknown>);
  },
});

export const setSourceIngestState = internalMutation({
  args: {
    sourceId: v.string(),
    status: sourceStatusValidator,
    sourceHash: v.optional(v.union(v.string(), v.null())),
    lastError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<void> => {
    const sourceRow = await ctx.db
      .query("sources")
      .withIndex("by_domainId", (q) => q.eq("id", args.sourceId))
      .unique();

    if (!sourceRow) {
      return;
    }

    await ctx.db.patch(sourceRow._id, {
      status: args.status,
      sourceHash: args.sourceHash !== undefined ? args.sourceHash : sourceRow.sourceHash,
      lastError: args.lastError !== undefined ? args.lastError : sourceRow.lastError,
      updatedAt: Date.now(),
    });
  },
});

export const removeSource = mutation({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    removed: boolean;
  }> => {
    const existing = await ctx.db
      .query("sources")
      .withIndex("by_domainId", (q) => q.eq("id", args.sourceId))
      .unique();

    if (!existing || existing.workspaceId !== args.workspaceId) {
      return { removed: false };
    }

    await ctx.runMutation(runtimeInternal.control_plane.tool_registry.removeSourceBindingsAndIndex, {
      workspaceId: args.workspaceId,
      sourceId: args.sourceId,
    });

    await ctx.db.delete(existing._id);

    return { removed: true };
  },
});
