import { describe, expect, it } from "@effect/vitest";

import type { Source } from "#schema";

import {
  createGoogleDiscoveryCatalogSnapshot,
  createGraphqlCatalogSnapshot,
  createOpenApiCatalogSnapshot,
} from "./source-catalog-snapshot";

const baseSource: Source = {
  id: "src_calendar" as Source["id"],
  workspaceId: "ws_test" as Source["workspaceId"],
  name: "Calendar",
  kind: "openapi",
  endpoint: "https://api.example.test",
  status: "connected",
  enabled: true,
  namespace: "google.calendar",
  bindingVersion: 1,
  binding: {
    specUrl: "https://api.example.test/openapi.json",
    defaultHeaders: null,
  },
  importAuthPolicy: "none",
  importAuth: { kind: "none" },
  auth: { kind: "none" },
  sourceHash: "hash_source",
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("source-catalog-snapshot", () => {
  it("builds an HTTP capability graph from OpenAPI operation inputs", () => {
    const snapshot = createOpenApiCatalogSnapshot({
      source: baseSource,
      documents: [{
          documentKind: "openapi",
          documentKey: "https://api.example.test/openapi.json",
          contentText: "{}",
          fetchedAt: 1,
        }],
      operations: [{
          toolId: "events.update",
          title: "Update event",
          description: "Update a calendar event",
          effect: "write",
          inputSchema: {
            type: "object",
            properties: {
              calendarId: { type: "string", description: "Calendar ID" },
              eventId: { type: "string" },
              sendUpdates: { type: "string", enum: ["all", "none"] },
              body: {
                type: "object",
                properties: {
                  summary: { type: "string" },
                },
              },
            },
            required: ["calendarId", "eventId", "body"],
          },
          outputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              summary: { type: "string" },
            },
            required: ["id"],
          },
          providerData: {
            kind: "openapi",
            toolId: "events.update",
            rawToolId: "events.update",
            group: "events",
            leaf: "update",
            tags: ["events"],
            method: "patch",
            path: "/calendars/{calendarId}/events/{eventId}",
            operationHash: "op_hash",
            invocation: {
              method: "patch",
              pathTemplate: "/calendars/{calendarId}/events/{eventId}",
              parameters: [
                { name: "calendarId", location: "path", required: true },
                { name: "eventId", location: "path", required: true },
                { name: "sendUpdates", location: "query", required: false },
              ],
              requestBody: {
                required: true,
                contentTypes: ["application/json"],
              },
            },
            documentation: {
              summary: "Update event",
              parameters: [
                {
                  name: "calendarId",
                  location: "path",
                  required: true,
                  description: "Calendar identifier",
                },
              ],
              requestBody: {
                description: "Event patch body",
              },
              response: {
                statusCode: "200",
                description: "Updated event",
                contentTypes: ["application/json"],
              },
            },
          },
        }],
    });

    expect(snapshot.version).toBe("ir.v1.snapshot");
    expect(Object.keys(snapshot.catalog.capabilities)).toHaveLength(1);

    const capability = Object.values(snapshot.catalog.capabilities)[0]!;
    const executable = Object.values(snapshot.catalog.executables)[0]!;
    const responseSet = Object.values(snapshot.catalog.responseSets)[0]!;

    expect(capability.surface.toolPath).toEqual(["google", "calendar", "events", "update"]);
    expect(capability.semantics.effect).toBe("write");
    expect(executable.protocol).toBe("http");
    expect(executable.method).toBe("PATCH");
    expect(executable.pathTemplate).toBe("/calendars/{calendarId}/events/{eventId}");
    expect(responseSet.variants).toHaveLength(1);
  });

  it("imports Google Discovery scopes as auth requirements", () => {
    const snapshot = createGoogleDiscoveryCatalogSnapshot({
      source: {
        ...baseSource,
        kind: "google_discovery",
        namespace: "google.drive",
      },
      documents: [],
      operations: [{
          toolId: "files.list",
          title: "List files",
          description: "List drive files",
          effect: "read",
          inputSchema: { type: "object", properties: { pageSize: { type: "integer" } } },
          outputSchema: { type: "object", properties: { files: { type: "array", items: { type: "string" } } } },
          providerData: {
            kind: "google_discovery",
            service: "drive",
            version: "v3",
            toolId: "files.list",
            rawToolId: "files.list",
            methodId: "drive.files.list",
            group: "files",
            leaf: "list",
            invocation: {
              method: "get",
              path: "/drive/v3/files",
              flatPath: null,
              rootUrl: "https://www.googleapis.com/",
              servicePath: "drive/v3/",
              parameters: [],
              requestSchemaId: null,
              responseSchemaId: "FileList",
              scopes: ["https://www.googleapis.com/auth/drive.readonly"],
              supportsMediaUpload: false,
              supportsMediaDownload: false,
            },
          },
        }],
    });

    const capability = Object.values(snapshot.catalog.capabilities)[0]!;
    const securityScheme = Object.values(snapshot.catalog.symbols).find((symbol) => symbol.kind === "securityScheme");

    expect(capability.auth.kind).toBe("scheme");
    expect(securityScheme?.kind).toBe("securityScheme");
  });

  it("converts GraphQL field operations into GraphQL executables", () => {
    const snapshot = createGraphqlCatalogSnapshot({
      source: {
        ...baseSource,
        kind: "graphql",
        namespace: "github",
      },
      documents: [],
      operations: [{
          toolId: "viewer",
          title: "Viewer",
          description: "Load the current viewer",
          effect: "read",
          inputSchema: { type: "object", properties: {} },
          outputSchema: { type: "object", properties: { login: { type: "string" } } },
          providerData: {
            kind: "graphql",
            toolKind: "field",
            toolId: "viewer",
            rawToolId: "viewer",
            group: "query",
            leaf: "viewer",
            fieldName: "viewer",
            operationType: "query",
            operationName: "ViewerQuery",
            operationDocument: "query ViewerQuery { viewer { login } }",
            queryTypeName: "Query",
            mutationTypeName: null,
            subscriptionTypeName: null,
          },
        }],
    });

    const executable = Object.values(snapshot.catalog.executables)[0]!;

    expect(executable.protocol).toBe("graphql");
    expect(executable.operationType).toBe("query");
    expect(executable.rootField).toBe("viewer");
    expect(executable.selectionMode).toBe("fixed");
  });
});
