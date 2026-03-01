"use node";

import { createHash } from "node:crypto";

import { extractOpenApiManifest, fetchOpenApiDocument } from "@executor-v2/management-api";
import { type Source } from "@executor-v2/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { v } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

const runtimeInternal = internal as any;

const openApiExtractorVersion = "openapi_v2";
const graphqlExtractorVersion = "graphql_v1";
const mcpExtractorVersion = "mcp_v1";
const writeBatchSize = 500;

const maxRefHintBytes = 900_000;

const safeRefHintTableJson = (
  refHintTable: Record<string, unknown> | undefined,
): string | null => {
  if (!refHintTable) {
    return null;
  }

  const serialized = JSON.stringify(refHintTable);
  const bytes = new TextEncoder().encode(serialized).length;
  return bytes <= maxRefHintBytes ? serialized : null;
};

const graphqlSchemaRootsQuery = `query SchemaRoots {
  __schema {
    queryType { name }
    mutationType { name }
  }
}`;

const graphqlRootFieldsQuery = `query RootFields($name: String!) {
  __type(name: $name) {
    name
    fields {
      name
      description
      args {
        name
        description
        defaultValue
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }
  }
}`;

type GraphqlIngestTool = {
  toolId: string;
  name: string;
  description: string | null;
  operationType: string;
  fieldName: string;
  operationHash: string;
  invocationJson: string;
};

type McpIngestTool = {
  toolId: string;
  name: string;
  description: string | null;
  toolName: string;
  operationHash: string;
  invocationJson: string;
};

type McpTransport = "sse" | "streamable-http";

type McpConnection = {
  client: Client;
  close: () => Promise<void>;
  transport: McpTransport;
};

const SourceIngestStatusSchema = Schema.Union(
  Schema.Literal("error"),
  Schema.Literal("auth_required"),
);

type SourceIngestStatus = typeof SourceIngestStatusSchema.Type;

class SourceIngestError extends Schema.TaggedError<SourceIngestError>()(
  "SourceIngestError",
  {
    status: SourceIngestStatusSchema,
    message: Schema.String,
  },
) {}

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (isUnknownRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const hashUnknown = (value: unknown): string =>
  createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);

const sourceSlug = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");

  return slug.length > 0 ? slug : "graphql";
};

const toolSegment = (value: string): string => {
  const segment = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");

  return segment.length > 0 ? segment : "field";
};

const typeRefToLabel = (typeRef: unknown): string => {
  if (!isUnknownRecord(typeRef)) {
    return "Unknown";
  }

  const kind = normalizeString(typeRef.kind);
  const name = normalizeString(typeRef.name);
  const ofType = typeRef.ofType;

  if (kind === "NON_NULL") {
    return `${typeRefToLabel(ofType)}!`;
  }

  if (kind === "LIST") {
    return `[${typeRefToLabel(ofType)}]`;
  }

  if (name) {
    return name;
  }

  return kind ?? "Unknown";
};

const isRequiredType = (typeRef: unknown): boolean =>
  isUnknownRecord(typeRef) && normalizeString(typeRef.kind) === "NON_NULL";

const parseSourceConfig = (configJson: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(configJson) as unknown;
    return isUnknownRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const collectAuthHeadersFromSourceConfig = (config: Record<string, unknown>): Record<string, string> => {
  const headers: Record<string, string> = {};

  const auth = config.auth;
  if (!isUnknownRecord(auth)) {
    return headers;
  }

  const authType = normalizeString(auth.type)?.toLowerCase();

  if (authType === "bearer") {
    const token = normalizeString(auth.token) ?? normalizeString(auth.value);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  if (authType === "apikey" || authType === "api_key") {
    const value = normalizeString(auth.value) ?? normalizeString(auth.token);
    if (value) {
      const headerName = normalizeString(auth.header) ?? "Authorization";
      headers[headerName] = value;
    }
  }

  if (authType === "basic") {
    const username = normalizeString(auth.username);
    const password = normalizeString(auth.password);
    if (username && password) {
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    }
  }

  return headers;
};

const collectConfiguredHeadersFromSourceConfig = (config: Record<string, unknown>): Record<string, string> => {
  const headers: Record<string, string> = {};
  const configuredHeaders = config.headers;

  if (!isUnknownRecord(configuredHeaders)) {
    return headers;
  }

  for (const [headerKey, headerValue] of Object.entries(configuredHeaders)) {
    const key = normalizeString(headerKey);
    const value = normalizeString(headerValue);
    if (key && value) {
      headers[key] = value;
    }
  }

  return headers;
};

const collectGraphqlHeadersFromSourceConfig = (source: Source): Record<string, string> => {
  const config = parseSourceConfig(source.configJson);
  return {
    "content-type": "application/json",
    ...collectConfiguredHeadersFromSourceConfig(config),
    ...collectAuthHeadersFromSourceConfig(config),
  };
};

const collectMcpHeadersFromSourceConfig = (source: Source): Record<string, string> => {
  const config = parseSourceConfig(source.configJson);
  return {
    ...collectConfiguredHeadersFromSourceConfig(config),
    ...collectAuthHeadersFromSourceConfig(config),
  };
};

const mergeHeaders = (...sets: ReadonlyArray<Record<string, string>>): Record<string, string> => {
  const merged: Record<string, string> = {};
  const keyByLower = new Map<string, string>();

  for (const headers of sets) {
    for (const [rawKey, rawValue] of Object.entries(headers)) {
      const key = rawKey.trim();
      const value = rawValue.trim();
      if (key.length === 0 || value.length === 0) {
        continue;
      }

      const normalizedKey = key.toLowerCase();
      const existingKey = keyByLower.get(normalizedKey);
      if (existingKey && existingKey !== key) {
        delete merged[existingKey];
      }

      keyByLower.set(normalizedKey, key);
      merged[key] = value;
    }
  }

  return merged;
};

const graphqlAuthErrorCodes = new Set(["unauthenticated", "forbidden", "unauthorized"]);

const payloadHasGraphqlAuthError = (payload: unknown): boolean => {
  if (!isUnknownRecord(payload) || !Array.isArray(payload.errors)) {
    return false;
  }

  return payload.errors.some((entry) => {
    if (!isUnknownRecord(entry)) {
      return false;
    }

    const message = normalizeString(entry.message)?.toLowerCase();
    if (message && (message.includes("unauthor") || message.includes("forbidden") || message.includes("auth"))) {
      return true;
    }

    if (!isUnknownRecord(entry.extensions)) {
      return false;
    }

    const code = normalizeString(entry.extensions.code)?.toLowerCase();
    return code ? graphqlAuthErrorCodes.has(code) : false;
  });
};

const looksLikeAuthErrorMessage = (value: string): boolean => {
  const message = value.toLowerCase();
  return message.includes("unauthor") || message.includes("forbidden") || message.includes("auth required");
};

const sourceIngestStatusFromCause = (cause: unknown): SourceIngestStatus => {
  if (cause instanceof SourceIngestError) {
    return cause.status;
  }

  const message = formatError(cause);
  return looksLikeAuthErrorMessage(message) ? "auth_required" : "error";
};

const extractGraphqlErrorMessage = (payload: unknown, status: number): string => {
  if (isUnknownRecord(payload) && Array.isArray(payload.errors) && payload.errors.length > 0) {
    const firstError = payload.errors[0];
    if (isUnknownRecord(firstError)) {
      const message = normalizeString(firstError.message);
      if (message) {
        return message;
      }
    }
  }

  return `GraphQL schema request failed (${status})`;
};

const fetchGraphqlPayload = (
  source: Source,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Effect.Effect<Record<string, unknown>, SourceIngestError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(source.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          cache: "no-store",
        }),
      catch: (cause) =>
        SourceIngestError.make({
          status: "error",
          message: `GraphQL schema request failed: ${formatError(cause)}`,
        }),
    });

    const payload = yield* Effect.tryPromise({
      try: () => response.json().catch(() => null),
      catch: (cause) =>
        SourceIngestError.make({
          status: "error",
          message: `GraphQL schema response parse failed: ${formatError(cause)}`,
        }),
    });

    if (!response.ok) {
      const message = extractGraphqlErrorMessage(payload, response.status);
      const authRequired =
        response.status === 401 || response.status === 403 || payloadHasGraphqlAuthError(payload);

      return yield* SourceIngestError.make({
        status: authRequired ? "auth_required" : "error",
        message,
      });
    }

    if (!isUnknownRecord(payload)) {
      return yield* SourceIngestError.make({
        status: "error",
        message: "GraphQL response is not an object",
      });
    }

    return payload;
  });

const loadGraphqlSchemaRoots = (
  source: Source,
  headers: Record<string, string>,
): Effect.Effect<
  {
    queryTypeName: string | null;
    mutationTypeName: string | null;
  },
  SourceIngestError
> =>
  Effect.gen(function* () {
    const payload = yield* fetchGraphqlPayload(source, headers, {
      query: graphqlSchemaRootsQuery,
    });

    const data = payload.data;
    const schema = isUnknownRecord(data) && isUnknownRecord(data.__schema)
      ? data.__schema
      : null;

    if (!schema) {
      return yield* SourceIngestError.make({
        status: "error",
        message: "GraphQL schema roots payload is missing __schema",
      });
    }

    return {
      queryTypeName: isUnknownRecord(schema.queryType) ? normalizeString(schema.queryType.name) : null,
      mutationTypeName: isUnknownRecord(schema.mutationType)
        ? normalizeString(schema.mutationType.name)
        : null,
    };
  });

const loadGraphqlRootFields = (
  source: Source,
  headers: Record<string, string>,
  rootTypeName: string | null,
): Effect.Effect<Array<Record<string, unknown>>, SourceIngestError> =>
  Effect.gen(function* () {
    if (!rootTypeName) {
      return [];
    }

    const payload = yield* fetchGraphqlPayload(source, headers, {
      query: graphqlRootFieldsQuery,
      variables: {
        name: rootTypeName,
      },
    });

    const data = payload.data;
    const rootType = isUnknownRecord(data) && isUnknownRecord(data.__type)
      ? data.__type
      : null;

    if (!rootType) {
      return [];
    }

    const fields = rootType.fields;
    if (!Array.isArray(fields)) {
      return [];
    }

    return fields.filter((field): field is Record<string, unknown> => isUnknownRecord(field));
  });

const ensureUniqueToolIds = (tools: Array<GraphqlIngestTool>): Array<GraphqlIngestTool> => {
  const counts = new Map<string, number>();

  return tools.map((tool) => {
    const count = (counts.get(tool.toolId) ?? 0) + 1;
    counts.set(tool.toolId, count);

    if (count === 1) {
      return tool;
    }

    return {
      ...tool,
      toolId: `${tool.toolId}_${count}`,
    };
  });
};

const extractGraphqlTools = (
  source: Source,
  roots: {
    queryTypeName: string | null;
    mutationTypeName: string | null;
  },
  queryFields: ReadonlyArray<Record<string, unknown>>,
  mutationFields: ReadonlyArray<Record<string, unknown>>,
): {
  schemaHash: string;
  tools: Array<GraphqlIngestTool>;
} => {
  const slug = sourceSlug(source.name);

  const rawInvocation = {
    kind: "graphql_raw",
    endpoint: source.endpoint,
  };

  const tools: Array<GraphqlIngestTool> = [
    {
      toolId: `${slug}.graphql`,
      name: `${source.name} GraphQL`,
      description: `Run raw GraphQL queries against ${source.name}.`,
      operationType: "raw",
      fieldName: "graphql",
      operationHash: hashUnknown(rawInvocation),
      invocationJson: JSON.stringify(rawInvocation),
    },
  ];

  const fieldSignatures: Array<unknown> = [];

  const addOperationTools = (
    operationType: "query" | "mutation",
    fields: ReadonlyArray<Record<string, unknown>>,
  ): void => {
    for (const field of fields) {
      const fieldName = normalizeString(field.name);
      if (!fieldName) {
        continue;
      }

      const args = Array.isArray(field.args)
        ? field.args
            .filter((arg): arg is Record<string, unknown> => isUnknownRecord(arg))
            .map((arg) => ({
              name: normalizeString(arg.name) ?? "arg",
              description: normalizeString(arg.description),
              required: isRequiredType(arg.type),
              type: typeRefToLabel(arg.type),
              defaultValue: normalizeString(arg.defaultValue),
            }))
        : [];

      const invocation = {
        kind: "graphql_field",
        endpoint: source.endpoint,
        operationType,
        fieldName,
        args,
      };

      tools.push({
        toolId: `${slug}.${operationType}.${toolSegment(fieldName)}`,
        name: fieldName,
        description: normalizeString(field.description),
        operationType,
        fieldName,
        operationHash: hashUnknown(invocation),
        invocationJson: JSON.stringify(invocation),
      });

      fieldSignatures.push({
        operationType,
        fieldName,
        args: args.map((arg) => ({
          name: arg.name,
          required: arg.required,
          type: arg.type,
        })),
      });
    }
  };

  addOperationTools("query", queryFields);
  addOperationTools("mutation", mutationFields);

  return {
    schemaHash: hashUnknown({
      queryTypeName: roots.queryTypeName,
      mutationTypeName: roots.mutationTypeName,
      fieldSignatures,
    }),
    tools: ensureUniqueToolIds(tools),
  };
};

const parseMcpTransportPreference = (source: Source): McpTransport | null => {
  const config = parseSourceConfig(source.configJson);
  const transport = normalizeString(config.transport)?.toLowerCase();

  if (transport === "sse") {
    return "sse";
  }

  if (transport === "streamable-http" || transport === "streamable_http") {
    return "streamable-http";
  }

  return null;
};

const parseMcpQueryParams = (source: Source): Record<string, string> => {
  const config = parseSourceConfig(source.configJson);
  const queryParams = config.queryParams;

  if (!isUnknownRecord(queryParams)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(queryParams)) {
    const key = normalizeString(rawKey);
    const value = normalizeString(rawValue);
    if (key && value) {
      normalized[key] = value;
    }
  }

  return normalized;
};

const withMcpHeaders = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  headers: Record<string, string>,
): Promise<Response> => {
  const mergedHeaders = new Headers(init?.headers ?? {});
  for (const [key, value] of Object.entries(headers)) {
    mergedHeaders.set(key, value);
  }

  return fetch(input, {
    ...init,
    headers: mergedHeaders,
  });
};

const connectMcp = (
  source: Source,
  headers: Record<string, string>,
): Effect.Effect<McpConnection, SourceIngestError> =>
  Effect.gen(function* () {
    const endpoint = yield* Effect.try({
      try: () => new URL(source.endpoint),
      catch: () =>
        SourceIngestError.make({
          status: "error",
          message: `Invalid MCP endpoint URL: ${source.endpoint}`,
        }),
    });

    const queryParams = parseMcpQueryParams(source);
    for (const [key, value] of Object.entries(queryParams)) {
      endpoint.searchParams.set(key, value);
    }

    const connectWithTransport = (
      transport: McpTransport,
    ): Effect.Effect<McpConnection, SourceIngestError> =>
      Effect.tryPromise({
        try: async () => {
          const client = new Client(
            {
              name: "executor-v2-control-plane",
              version: "0.1.0",
            },
            { capabilities: {} },
          );

          if (transport === "streamable-http") {
            await client.connect(new StreamableHTTPClientTransport(endpoint, {
              requestInit: { headers },
            }));
          } else {
            await client.connect(new SSEClientTransport(endpoint, {
              requestInit: { headers },
              eventSourceInit: {
                fetch: (input, init) => withMcpHeaders(input, init, headers),
              },
            }));
          }

          return {
            client,
            close: () => client.close(),
            transport,
          };
        },
        catch: (cause) =>
          SourceIngestError.make({
            status: sourceIngestStatusFromCause(cause),
            message: `Failed to connect to MCP source: ${formatError(cause)}`,
          }),
      });

    const preferred = parseMcpTransportPreference(source);
    if (preferred === "streamable-http") {
      return yield* connectWithTransport("streamable-http");
    }

    if (preferred === "sse") {
      return yield* connectWithTransport("sse");
    }

    const streamableAttempt = yield* connectWithTransport("streamable-http").pipe(Effect.either);
    if (streamableAttempt._tag === "Right") {
      return streamableAttempt.right;
    }

    return yield* connectWithTransport("sse");
  });

const normalizeJsonSchema = (value: unknown): Record<string, unknown> => {
  if (value === true) {
    return {};
  }

  if (value === false) {
    return { not: {} };
  }

  return isUnknownRecord(value) ? value : {};
};

const extractMcpListedToolRows = (value: unknown): Array<Record<string, unknown>> => {
  if (!isUnknownRecord(value) || !Array.isArray(value.tools)) {
    return [];
  }

  return value.tools.filter((tool): tool is Record<string, unknown> => isUnknownRecord(tool));
};

const ensureUniqueMcpToolIds = (tools: Array<McpIngestTool>): Array<McpIngestTool> => {
  const counts = new Map<string, number>();

  return tools.map((tool) => {
    const count = (counts.get(tool.toolId) ?? 0) + 1;
    counts.set(tool.toolId, count);

    if (count === 1) {
      return tool;
    }

    return {
      ...tool,
      toolId: `${tool.toolId}_${count}`,
    };
  });
};

const extractMcpTools = (
  source: Source,
  transport: McpTransport,
  listedTools: ReadonlyArray<Record<string, unknown>>,
): {
  sourceHash: string;
  tools: Array<McpIngestTool>;
} => {
  const slug = sourceSlug(source.name);
  const queryParams = parseMcpQueryParams(source);

  const tools: Array<McpIngestTool> = [];
  const toolSignatures: Array<unknown> = [];

  for (const tool of listedTools) {
    const toolName = normalizeString(tool.name);
    if (!toolName) {
      continue;
    }

    const inputSchema = normalizeJsonSchema(tool.inputSchema);
    const outputSchema = normalizeJsonSchema(tool.outputSchema);
    const invocation = {
      kind: "mcp_tool",
      endpoint: source.endpoint,
      transport,
      queryParams,
      toolName,
    };

    tools.push({
      toolId: `${slug}.mcp.${toolSegment(toolName)}`,
      name: toolName,
      description: normalizeString(tool.description),
      toolName,
      operationHash: hashUnknown({ invocation, inputSchema, outputSchema }),
      invocationJson: JSON.stringify({
        ...invocation,
        inputSchema,
        outputSchema,
      }),
    });

    toolSignatures.push({ toolName, inputSchema, outputSchema });
  }

  return {
    sourceHash: hashUnknown({
      endpoint: source.endpoint,
      transport,
      queryParams,
      toolSignatures,
    }),
    tools: ensureUniqueMcpToolIds(tools),
  };
};

const formatError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const trySourceIngestPromise = <A>(
  promise: () => Promise<A>,
  message: string,
): Effect.Effect<A, SourceIngestError> =>
  Effect.tryPromise({
    try: promise,
    catch: (cause) =>
      SourceIngestError.make({
        status: "error",
        message: `${message}: ${formatError(cause)}`,
      }),
  });

const ingestOpenApiSource = (ctx: any, source: Source): Effect.Effect<string, SourceIngestError> =>
  Effect.gen(function* () {
    const openApiDocument = yield* trySourceIngestPromise(
      () => fetchOpenApiDocument(source.endpoint),
      "Failed to fetch OpenAPI document",
    );

    const manifest = yield* extractOpenApiManifest(source.name, openApiDocument).pipe(
      Effect.mapError((cause) =>
        SourceIngestError.make({
          status: "error",
          message: formatError(cause),
        }),
      ),
    );

    const artifactMeta = yield* trySourceIngestPromise<{
      artifactId: string;
      created: boolean;
    }>(
      () =>
        ctx.runMutation(runtimeInternal.control_plane.openapi_ingest_mvp.upsertOpenApiArtifactMeta, {
          sourceHash: manifest.sourceHash,
          extractorVersion: openApiExtractorVersion,
          toolCount: manifest.tools.length,
          refHintTableJson: safeRefHintTableJson(manifest.refHintTable),
        }),
      "Failed to upsert OpenAPI artifact metadata",
    );

    if (artifactMeta.created) {
      const allTools = manifest.tools.map((tool) => ({
        toolId: tool.toolId,
        name: tool.name,
        description: tool.description,
        method: tool.method,
        path: tool.path,
        operationHash: tool.operationHash,
        invocationJson: JSON.stringify(tool.invocation),
        inputSchemaJson: tool.typing?.inputSchemaJson ?? null,
        outputSchemaJson: tool.typing?.outputSchemaJson ?? null,
      }));

      for (let index = 0; index < allTools.length; index += writeBatchSize) {
        const batch = allTools.slice(index, index + writeBatchSize);
        yield* trySourceIngestPromise(
          () =>
            ctx.runMutation(runtimeInternal.control_plane.openapi_ingest_mvp.putOpenApiArtifactToolsBatch, {
              artifactId: artifactMeta.artifactId,
              insertOnly: true,
              tools: batch,
            }),
          "Failed to write OpenAPI artifact tools",
        );
      }
    }

    yield* trySourceIngestPromise(
      () =>
        ctx.runMutation(runtimeInternal.control_plane.openapi_ingest_mvp.bindSourceToOpenApiArtifact, {
          workspaceId: source.workspaceId,
          sourceId: source.id,
          artifactId: artifactMeta.artifactId,
          sourceHash: manifest.sourceHash,
          extractorVersion: openApiExtractorVersion,
        }),
      "Failed to bind source to OpenAPI artifact",
    );

    return manifest.sourceHash;
  });

const ingestGraphqlSource = (ctx: any, source: Source): Effect.Effect<string, SourceIngestError> =>
  Effect.gen(function* () {
    const credentialHeadersResult = yield* trySourceIngestPromise<{
      headers: Record<string, string>;
    }>(
      () =>
        ctx.runQuery(runtimeInternal.control_plane.credentials.resolveSourceCredentialHeadersForIngest, {
          workspaceId: source.workspaceId,
          sourceId: source.id,
          sourceName: source.name,
          sourceEndpoint: source.endpoint,
        }),
      "Failed to resolve source credentials for GraphQL ingest",
    );

    const headers = mergeHeaders(
      collectGraphqlHeadersFromSourceConfig(source),
      credentialHeadersResult.headers,
    );

    const roots = yield* loadGraphqlSchemaRoots(source, headers);
    const queryFields = yield* loadGraphqlRootFields(source, headers, roots.queryTypeName);
    const mutationFields = yield* loadGraphqlRootFields(source, headers, roots.mutationTypeName);
    const extracted = extractGraphqlTools(source, roots, queryFields, mutationFields);

    const artifactMeta = yield* trySourceIngestPromise<{
      artifactId: string;
      created: boolean;
    }>(
      () =>
        ctx.runMutation(runtimeInternal.control_plane.graphql_ingest_support.upsertGraphqlArtifactMeta, {
          schemaHash: extracted.schemaHash,
          extractorVersion: graphqlExtractorVersion,
          toolCount: extracted.tools.length,
        }),
      "Failed to upsert GraphQL artifact metadata",
    );

    if (artifactMeta.created) {
      for (let index = 0; index < extracted.tools.length; index += writeBatchSize) {
        const batch = extracted.tools.slice(index, index + writeBatchSize);
        yield* trySourceIngestPromise(
          () =>
            ctx.runMutation(
              runtimeInternal.control_plane.graphql_ingest_support.putGraphqlArtifactToolsBatch,
              {
                artifactId: artifactMeta.artifactId,
                insertOnly: true,
                tools: batch,
              },
            ),
          "Failed to write GraphQL artifact tools",
        );
      }
    }

    yield* trySourceIngestPromise(
      () =>
        ctx.runMutation(runtimeInternal.control_plane.graphql_ingest_support.bindSourceToGraphqlArtifact, {
          workspaceId: source.workspaceId,
          sourceId: source.id,
          artifactId: artifactMeta.artifactId,
          schemaHash: extracted.schemaHash,
          extractorVersion: graphqlExtractorVersion,
        }),
      "Failed to bind source to GraphQL artifact",
    );

    return extracted.schemaHash;
  });

const ingestMcpSource = (ctx: any, source: Source): Effect.Effect<string, SourceIngestError> =>
  Effect.gen(function* () {
    const credentialHeadersResult = yield* trySourceIngestPromise<{
      headers: Record<string, string>;
    }>(
      () =>
        ctx.runQuery(runtimeInternal.control_plane.credentials.resolveSourceCredentialHeadersForIngest, {
          workspaceId: source.workspaceId,
          sourceId: source.id,
          sourceName: source.name,
          sourceEndpoint: source.endpoint,
        }),
      "Failed to resolve source credentials for MCP ingest",
    );

    const headers = mergeHeaders(
      collectMcpHeadersFromSourceConfig(source),
      credentialHeadersResult.headers,
    );

    const connection = yield* connectMcp(source, headers);

    const listedResult = yield* Effect.tryPromise({
      try: () => connection.client.listTools(),
      catch: (cause) =>
        SourceIngestError.make({
          status: sourceIngestStatusFromCause(cause),
          message: `Failed to list MCP tools: ${formatError(cause)}`,
        }),
    }).pipe(
      Effect.ensuring(
        Effect.promise(() => connection.close().catch(() => undefined)),
      ),
    );

    const listedTools = extractMcpListedToolRows(listedResult);
    const extracted = extractMcpTools(source, connection.transport, listedTools);

    const artifactMeta = yield* trySourceIngestPromise<{
      artifactId: string;
      created: boolean;
    }>(
      () =>
        ctx.runMutation(runtimeInternal.control_plane.mcp_ingest_support.upsertMcpArtifactMeta, {
          sourceHash: extracted.sourceHash,
          extractorVersion: mcpExtractorVersion,
          toolCount: extracted.tools.length,
        }),
      "Failed to upsert MCP artifact metadata",
    );

    if (artifactMeta.created) {
      for (let index = 0; index < extracted.tools.length; index += writeBatchSize) {
        const batch = extracted.tools.slice(index, index + writeBatchSize);
        yield* trySourceIngestPromise(
          () =>
            ctx.runMutation(runtimeInternal.control_plane.mcp_ingest_support.putMcpArtifactToolsBatch, {
              artifactId: artifactMeta.artifactId,
              insertOnly: true,
              tools: batch,
            }),
          "Failed to write MCP artifact tools",
        );
      }
    }

    yield* trySourceIngestPromise(
      () =>
        ctx.runMutation(runtimeInternal.control_plane.mcp_ingest_support.bindSourceToMcpArtifact, {
          workspaceId: source.workspaceId,
          sourceId: source.id,
          artifactId: artifactMeta.artifactId,
          sourceHash: extracted.sourceHash,
          extractorVersion: mcpExtractorVersion,
        }),
      "Failed to bind source to MCP artifact",
    );

    return extracted.sourceHash;
  });

export const ingestSourceArtifact = internalAction({
  args: {
    workspaceId: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const source = await ctx.runQuery(runtimeInternal.control_plane.sources.getSourceForIngest, {
      sourceId: args.sourceId,
    });

    if (!source || source.workspaceId !== args.workspaceId) {
      return;
    }

    await ctx.runMutation(runtimeInternal.control_plane.sources.setSourceIngestState, {
      sourceId: source.id,
      status: "probing",
      lastError: null,
    });

    const ingestEffect = source.kind === "openapi"
      ? ingestOpenApiSource(ctx, source)
      : source.kind === "graphql"
        ? ingestGraphqlSource(ctx, source)
        : source.kind === "mcp"
          ? ingestMcpSource(ctx, source)
          : Effect.fail(
              SourceIngestError.make({
                status: "error",
                message: `Source ingest for kind '${source.kind}' is not implemented yet`,
              }),
            );

    const result = await Effect.runPromise(
      ingestEffect.pipe(
        Effect.match({
          onFailure: (error) => ({
            status: error.status,
            sourceHash: null as string | null,
            lastError: error.message,
          }),
          onSuccess: (sourceHash) => ({
            status: "connected" as const,
            sourceHash,
            lastError: null as string | null,
          }),
        }),
      ),
    );

    await ctx.runMutation(runtimeInternal.control_plane.sources.setSourceIngestState, {
      sourceId: source.id,
      status: result.status,
      sourceHash: result.sourceHash,
      lastError: result.lastError,
    });
  },
});
