import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ToolPath } from "@executor/codemode-core";

export type McpToolManifestEntry = {
  toolId: string;
  toolName: string;
  description: string | null;
  inputSchemaJson?: string;
  outputSchemaJson?: string;
};

export type McpToolManifest = {
  version: 1;
  tools: readonly McpToolManifestEntry[];
};

const sanitizeToolId = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "tool";
};

const uniqueToolId = (value: string, byBase: Map<string, number>): string => {
  const base = sanitizeToolId(value);
  const count = (byBase.get(base) ?? 0) + 1;
  byBase.set(base, count);

  return count === 1 ? base : `${base}_${count}`;
};

const stringifyJson = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

const ListedMcpToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  inputSchema: Schema.optional(Schema.Unknown),
  parameters: Schema.optional(Schema.Unknown),
  outputSchema: Schema.optional(Schema.Unknown),
});

const ListToolsResultSchema = Schema.Struct({
  tools: Schema.Array(ListedMcpToolSchema),
});

const decodeListToolsResultOption = Schema.decodeUnknownOption(ListToolsResultSchema);

const readListedTools = (value: unknown): ReadonlyArray<typeof ListedMcpToolSchema.Type> => {
  const decoded = decodeListToolsResultOption(value);
  if (Option.isNone(decoded)) {
    return [];
  }

  return decoded.value.tools;
};

export const extractMcpToolManifestFromListToolsResult = (
  listToolsResult: unknown,
): McpToolManifest => {
  const byBase = new Map<string, number>();

  const tools = readListedTools(listToolsResult)
    .map((tool): McpToolManifestEntry | null => {
      const toolName = tool.name.trim();
      if (toolName.length === 0) {
        return null;
      }

      return {
        toolId: uniqueToolId(toolName, byBase),
        toolName,
        description: tool.description ?? null,
        inputSchemaJson:
          stringifyJson(tool.inputSchema)
          ?? stringifyJson(tool.parameters),
        outputSchemaJson: stringifyJson(tool.outputSchema),
      };
    })
    .filter((tool): tool is McpToolManifestEntry => tool !== null);

  return {
    version: 1,
    tools,
  };
};

export const joinToolPath = (namespace: string | undefined, toolId: string): ToolPath => {
  if (!namespace || namespace.trim().length === 0) {
    return toolId as ToolPath;
  }

  return `${namespace}.${toolId}` as ToolPath;
};
