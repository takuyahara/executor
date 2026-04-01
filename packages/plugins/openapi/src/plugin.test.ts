import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpClient,
  OpenApi,
} from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";

import { createExecutor, makeTestConfig } from "@executor/sdk";
import { openApiPlugin } from "./plugin";

// ---------------------------------------------------------------------------
// Define a test API with Effect HttpApi
// ---------------------------------------------------------------------------

class Item extends Schema.Class<Item>("Item")({
  id: Schema.Number,
  name: Schema.String,
}) {}

const ItemsGroup = HttpApiGroup.make("items")
  .add(
    HttpApiEndpoint.get("listItems", "/items").addSuccess(Schema.Array(Item)),
  )
  .add(
    HttpApiEndpoint.get("getItem", "/items/:itemId")
      .setPath(Schema.Struct({ itemId: Schema.NumberFromString }))
      .addSuccess(Item),
  );

const TestApi = HttpApi.make("testApi").add(ItemsGroup);

const spec = OpenApi.fromApi(TestApi);
const specJson = JSON.stringify(spec);

// ---------------------------------------------------------------------------
// Implement handlers
// ---------------------------------------------------------------------------

const ITEMS = [
  { id: 1, name: "Widget" },
  { id: 2, name: "Gadget" },
  { id: 3, name: "Doohickey" },
];

const ItemsGroupLive = HttpApiBuilder.group(TestApi, "items", (handlers) =>
  handlers
    .handle("listItems", () => Effect.succeed(ITEMS))
    .handle("getItem", (req) =>
      Effect.succeed(
        ITEMS.find((i) => i.id === req.path.itemId) ?? {
          id: 0,
          name: "Unknown",
        },
      ),
    ),
);

// ---------------------------------------------------------------------------
// Test layer: real server on port 0 + HttpClient pointing at it
// ---------------------------------------------------------------------------

const ApiLive = HttpApiBuilder.api(TestApi).pipe(
  Layer.provide(ItemsGroupLive),
);

const TestLayer = HttpApiBuilder.serve().pipe(
  Layer.provide(ApiLive),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

// ---------------------------------------------------------------------------
// Tests — layer() shares the server across all tests in this describe block
// ---------------------------------------------------------------------------

layer(TestLayer)("OpenAPI Plugin", (it) => {
  it.effect("previewSpec returns metadata and header presets", () =>
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const clientLayer = Layer.succeed(HttpClient.HttpClient, httpClient);

      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            openApiPlugin({ httpClientLayer: clientLayer }),
          ] as const,
        }),
      );

      const preview = yield* executor.openapi.previewSpec(specJson);

      expect(preview.operationCount).toBeGreaterThanOrEqual(2);
      expect(preview.servers).toBeDefined();
    }),
  );

  it.effect("registers tools from an OpenAPI spec", () =>
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const clientLayer = Layer.succeed(HttpClient.HttpClient, httpClient);

      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            openApiPlugin({ httpClientLayer: clientLayer }),
          ] as const,
        }),
      );

      const result = yield* executor.openapi.addSpec({
        spec: specJson,
        namespace: "test",
        baseUrl: "",
      });

      expect(result.toolCount).toBeGreaterThanOrEqual(2);

      const tools = yield* executor.tools.list();
      const names = tools.map((t) => t.name);
      expect(names).toContain("items.listItems");
      expect(names).toContain("items.getItem");
    }),
  );

  it.effect("invokes listItems", () =>
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const clientLayer = Layer.succeed(HttpClient.HttpClient, httpClient);

      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            openApiPlugin({ httpClientLayer: clientLayer }),
          ] as const,
        }),
      );

      yield* executor.openapi.addSpec({
        spec: specJson,
        namespace: "test",
        baseUrl: "",
      });

      const result = yield* executor.tools.invoke("test.items.listItems", {});
      expect(result.error).toBeNull();
      expect(result.data).toEqual(ITEMS);
    }),
  );

  it.effect("invokes getItem with path parameter", () =>
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const clientLayer = Layer.succeed(HttpClient.HttpClient, httpClient);

      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            openApiPlugin({ httpClientLayer: clientLayer }),
          ] as const,
        }),
      );

      yield* executor.openapi.addSpec({
        spec: specJson,
        namespace: "test",
        baseUrl: "",
      });

      const result = yield* executor.tools.invoke("test.items.getItem", {
        itemId: "2",
      });
      expect(result.error).toBeNull();
      expect(result.data).toEqual({ id: 2, name: "Gadget" });
    }),
  );

  it.effect("removeSpec cleans up registered tools", () =>
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const clientLayer = Layer.succeed(HttpClient.HttpClient, httpClient);

      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            openApiPlugin({ httpClientLayer: clientLayer }),
          ] as const,
        }),
      );

      yield* executor.openapi.addSpec({
        spec: specJson,
        namespace: "removable",
        baseUrl: "",
      });

      expect((yield* executor.tools.list()).length).toBeGreaterThan(0);

      yield* executor.openapi.removeSpec("removable");

      expect(yield* executor.tools.list()).toHaveLength(0);
    }),
  );
});
