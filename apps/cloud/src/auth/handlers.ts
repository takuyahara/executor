import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { addGroup } from "@executor/api";
import { CloudAuthApi } from "./api";
import { AuthContext, UserStoreService } from "./context";

const ApiWithCloudAuth = addGroup(CloudAuthApi);

export const CloudAuthHandlers = HttpApiBuilder.group(
  ApiWithCloudAuth,
  "cloudAuth",
  (handlers) =>
    handlers.handle("me", () =>
      Effect.gen(function* () {
        const auth = yield* AuthContext;
        const userStore = yield* UserStoreService;

        const team = yield* Effect.tryPromise(() =>
          userStore.getTeam(auth.teamId),
        ).pipe(Effect.orDie);

        return {
          user: {
            id: auth.userId,
            email: auth.email,
            name: auth.name,
            avatarUrl: auth.avatarUrl,
          },
          team: team ? { id: team.id, name: team.name } : null,
        };
      }),
    ),
);
