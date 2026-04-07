import { Context } from "effect";
import type { makeUserStore } from "@executor/storage-postgres";

export class AuthContext extends Context.Tag("@executor/cloud/AuthContext")<
  AuthContext,
  {
    readonly userId: string;
    readonly teamId: string;
    readonly email: string;
    readonly name: string | null;
    readonly avatarUrl: string | null;
  }
>() {}

export class UserStoreService extends Context.Tag("@executor/cloud/UserStoreService")<
  UserStoreService,
  ReturnType<typeof makeUserStore>
>() {}
