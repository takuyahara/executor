import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Schema } from "effect";

import { secretMaterialsTable } from "../../persistence/schema";
import { TimestampMsSchema } from "../common";
import { SecretMaterialIdSchema } from "../ids";

export const SecretMaterialPurposeSchema = Schema.Literal(
  "auth_material",
  "oauth_access_token",
  "oauth_refresh_token",
  "oauth_client_info",
);

const secretMaterialSchemaOverrides = {
  id: SecretMaterialIdSchema,
  purpose: SecretMaterialPurposeSchema,
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
} as const;

export const SecretMaterialSchema = createSelectSchema(
  secretMaterialsTable,
  secretMaterialSchemaOverrides,
);

export type SecretMaterialPurpose = typeof SecretMaterialPurposeSchema.Type;
export type SecretMaterial = typeof SecretMaterialSchema.Type;
