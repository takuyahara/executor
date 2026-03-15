import { typeSignatureFromSchema } from "@executor/codemode-core";

import type {
  OpenApiExample,
  OpenApiInvocationPayload,
  OpenApiToolDocumentation,
  OpenApiToolProviderData,
} from "./openapi-types";
import {
  openApiProviderDataFromDefinition,
  type OpenApiToolDefinition,
} from "./openapi-definitions";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const isStrictEmptyObjectSchema = (value: unknown): boolean => {
  const schema = asRecord(value);
  if (schema.type !== "object" && schema.properties === undefined) {
    return false;
  }

  const properties = asRecord(schema.properties);
  return Object.keys(properties).length === 0 && schema.additionalProperties === false;
};

export const openApiOutputTypeSignatureFromSchema = (
  schema: unknown,
  maxLength: number = 320,
 ): string => {
  if (schema === undefined || schema === null) {
    return "void";
  }

  if (isStrictEmptyObjectSchema(schema)) {
    return "{}";
  }

  return typeSignatureFromSchema(schema, "unknown", maxLength);
};

const firstExample = (
  examples: ReadonlyArray<OpenApiExample> | undefined,
): OpenApiExample | undefined => examples?.[0];

const fallbackInputSchemaFromInvocation = (
  invocation: OpenApiInvocationPayload,
): Record<string, unknown> | undefined => {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of invocation.parameters) {
    properties[parameter.name] = {
      type: "string",
    };
    if (parameter.required) {
      required.push(parameter.name);
    }
  }

  if (invocation.requestBody) {
    properties.body = {
      type: "object",
    };
    if (invocation.requestBody.required) {
      required.push("body");
    }
  }

  return Object.keys(properties).length > 0
    ? {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    }
    : undefined;
};

const buildExampleInput = (
  documentation: OpenApiToolDocumentation | undefined,
): Record<string, unknown> | undefined => {
  if (!documentation) {
    return undefined;
  }

  const input: Record<string, unknown> = {};

  for (const parameter of documentation.parameters) {
    const example = firstExample(parameter.examples);
    if (!example) {
      continue;
    }

    input[parameter.name] = JSON.parse(example.valueJson) as unknown;
  }

  const requestBodyExample = firstExample(documentation.requestBody?.examples);
  if (requestBodyExample) {
    input.body = JSON.parse(requestBodyExample.valueJson) as unknown;
  }

  return Object.keys(input).length > 0 ? input : undefined;
};

const buildExampleOutput = (
  documentation: OpenApiToolDocumentation | undefined,
): unknown | undefined => {
  const example = firstExample(documentation?.response?.examples)?.valueJson;
  return example ? JSON.parse(example) as unknown : undefined;
};

export type OpenApiToolPresentation = {
  inputType: string;
  outputType: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  exampleInput?: unknown;
  exampleOutput?: unknown;
  providerData: OpenApiToolProviderData;
};

export const buildOpenApiToolPresentation = (input: {
  definition: OpenApiToolDefinition;
}): OpenApiToolPresentation => {
  const inputSchema =
    input.definition.typing?.inputSchema
    ?? fallbackInputSchemaFromInvocation(input.definition.invocation);
  const outputSchema = input.definition.typing?.outputSchema;
  const exampleInput = buildExampleInput(input.definition.documentation);
  const exampleOutput = buildExampleOutput(input.definition.documentation);

  return {
    inputType: typeSignatureFromSchema(inputSchema, "unknown", Infinity),
    outputType: openApiOutputTypeSignatureFromSchema(outputSchema, Infinity),
    ...(inputSchema !== undefined ? { inputSchema } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    ...(exampleInput !== undefined ? { exampleInput } : {}),
    ...(exampleOutput !== undefined ? { exampleOutput } : {}),
    providerData: openApiProviderDataFromDefinition(input.definition),
  };
};
