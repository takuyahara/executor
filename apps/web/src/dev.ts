/**
 * Dev entry point for @hono/vite-dev-server.
 *
 * Exports `{ fetch }` so Vite can forward API requests to the executor
 * control-plane handler. Everything else (frontend assets, HMR) is
 * handled by Vite itself.
 */
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import { createLocalExecutorRequestHandler } from "@executor-v3/server";

const MAX_LOGGED_ERROR_BODY_LENGTH = 4_000;

const truncateForLog = (value: string): string =>
  value.length > MAX_LOGGED_ERROR_BODY_LENGTH
    ? `${value.slice(0, MAX_LOGGED_ERROR_BODY_LENGTH)}... [truncated]`
    : value;

const formatErrorForLog = (error: unknown) =>
  error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    : error;

// Create a long-lived scope that stays open for the lifetime of the process.
const handlerPromise = Effect.runPromise(
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const handler = yield* createLocalExecutorRequestHandler().pipe(
      Effect.provideService(Scope.Scope, scope),
    );
    return handler;
  }),
).catch((error) => {
  console.error("[executor dev api] failed to initialize request handler", formatErrorForLog(error));
  throw error;
});

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);

    try {
      const handler = await handlerPromise;
      handler.setBaseUrl(url.origin);

      const response = await handler.handleApiRequest(request);

      if (url.pathname.startsWith("/v1/") && response.status >= 500) {
        let bodyText = "<unavailable>";
        try {
          bodyText = truncateForLog(await response.clone().text());
        } catch {}

        console.error("[executor dev api] request failed", {
          method: request.method,
          url: url.toString(),
          status: response.status,
          contentType: response.headers.get("content-type"),
          body: bodyText,
        });
      }

      return response;
    } catch (error) {
      console.error("[executor dev api] unhandled request error", {
        method: request.method,
        url: url.toString(),
        error: formatErrorForLog(error),
      });
      throw error;
    }
  },
};
