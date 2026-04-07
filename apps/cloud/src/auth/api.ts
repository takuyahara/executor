import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

const AuthUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
});

const AuthTeam = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

const AuthMeResponse = Schema.Struct({
  user: AuthUser,
  team: Schema.NullOr(AuthTeam),
});

export class CloudAuthApi extends HttpApiGroup.make("cloudAuth")
  .add(
    HttpApiEndpoint.get("me")`/auth/me`
      .addSuccess(AuthMeResponse),
  ) {}
