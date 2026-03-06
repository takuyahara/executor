import { HttpApiBuilder, HttpServerRequest } from "@effect/platform";
import * as Effect from "effect/Effect";

import { ControlPlaneApi } from "../api";
import { ControlPlaneService } from "../service";

export const ControlPlaneLocalLive = HttpApiBuilder.group(
  ControlPlaneApi,
  "local",
  (handlers) =>
    handlers
      .handle("installation", () =>
        Effect.gen(function* () {
          const service = yield* ControlPlaneService;
          return yield* service.getLocalInstallation();
        }),
      )
      .handle("oauthCallback", () =>
        Effect.gen(function* () {
          const service = yield* ControlPlaneService;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const requestUrl = new URL(request.url, "http://127.0.0.1");

          const source = yield* service.completeSourceAuthCallback({
            state: requestUrl.searchParams.get("state") ?? "",
            code: requestUrl.searchParams.get("code"),
            error: requestUrl.searchParams.get("error"),
            errorDescription: requestUrl.searchParams.get("error_description"),
          });

          return `Source connected: ${source.id}. You can close this window.`;
        }),
      ),
);
