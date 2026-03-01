import {
  ControlPlaneAuthHeaders,
  ControlPlaneService,
  controlPlaneOpenApiSpec,
  makeControlPlaneWebHandler,
} from "@executor-v2/management-api";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { httpAction, type ActionCtx } from "../_generated/server";
import { ConvexControlPlaneActorLive } from "./actor";
import {
  controlPlaneErrorResponse,
  normalizeControlPlaneErrorResponse,
  toSourceStoreError,
} from "./errors";
import { makeConvexControlPlaneService } from "./service";

const isOpenApiRequest = (request: Request): boolean =>
  new URL(request.url).pathname === "/v1/openapi.json";

const controlPlaneCorsHeaders = (request: Request): Headers => {
  const origin = request.headers.get("origin");
  const requestedHeaders = request.headers.get("access-control-request-headers");
  const headers = new Headers();

  headers.set("access-control-allow-origin", origin && origin.length > 0 ? origin : "*");
  headers.set("vary", "origin");
  headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (requestedHeaders && requestedHeaders.trim().length > 0) {
    headers.set("access-control-allow-headers", requestedHeaders);
  } else {
    headers.set(
      "access-control-allow-headers",
      [
        "content-type",
        "authorization",
        "traceparent",
        "b3",
        ControlPlaneAuthHeaders.accountId,
        ControlPlaneAuthHeaders.principalProvider,
        ControlPlaneAuthHeaders.principalSubject,
        ControlPlaneAuthHeaders.principalEmail,
        ControlPlaneAuthHeaders.principalDisplayName,
      ].join(", "),
    );
  }
  headers.set("access-control-max-age", "86400");

  return headers;
};

const withControlPlaneCors = (request: Request, response: Response): Response => {
  const headers = new Headers(response.headers);
  const corsHeaders = controlPlaneCorsHeaders(request);

  for (const [name, value] of corsHeaders.entries()) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const handleControlPlaneRequest = (
  ctx: ActionCtx,
  request: Request,
): Effect.Effect<Response, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      if (request.method === "OPTIONS") {
        return withControlPlaneCors(request, new Response(null, { status: 204 }));
      }

      if (isOpenApiRequest(request)) {
        return withControlPlaneCors(
          request,
          Response.json(controlPlaneOpenApiSpec, { status: 200 }),
        );
      }

      const webHandler = makeControlPlaneWebHandler(
        Layer.succeed(ControlPlaneService, makeConvexControlPlaneService(ctx)),
        ConvexControlPlaneActorLive(ctx),
      );

      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({
          try: () => webHandler.dispose(),
          catch: (cause) => toSourceStoreError("controlPlane.dispose", cause),
        }).pipe(
          Effect.asVoid,
          Effect.catchAll(() => Effect.void),
        ),
      );

      const response = yield* Effect.tryPromise({
        try: () => webHandler.handler(request),
        catch: (cause) => toSourceStoreError("controlPlane.http", cause),
      });

      return withControlPlaneCors(
        request,
        normalizeControlPlaneErrorResponse(response),
      );
    }),
  ).pipe(
    Effect.catchAll((error) =>
      Effect.succeed(
        withControlPlaneCors(
          request,
          controlPlaneErrorResponse(
            500,
            "Control plane request failed",
            error.details,
          ),
        ),
      ),
    ),
  );

export const controlPlaneHttpHandler = httpAction((ctx, request) =>
  Effect.runPromise(handleControlPlaneRequest(ctx, request)),
);
