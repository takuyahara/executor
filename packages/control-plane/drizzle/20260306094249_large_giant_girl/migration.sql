CREATE TABLE "secret_materials" (
	"id" text PRIMARY KEY,
	"purpose" text NOT NULL,
	"value" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "secret_materials_purpose_check" CHECK ("purpose" in ('auth_material', 'oauth_access_token', 'oauth_refresh_token', 'oauth_client_info'))
);
--> statement-breakpoint
CREATE TABLE "source_auth_sessions" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"source_id" text NOT NULL,
	"execution_id" text,
	"interaction_id" text,
	"strategy" text NOT NULL,
	"status" text NOT NULL,
	"endpoint" text NOT NULL,
	"state" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scope" text,
	"resource_metadata_url" text,
	"authorization_server_url" text,
	"resource_metadata_json" text,
	"authorization_server_metadata_json" text,
	"client_information_json" text,
	"code_verifier" text,
	"authorization_url" text,
	"error_text" text,
	"completed_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "source_auth_sessions_strategy_check" CHECK ("strategy" in ('oauth2_authorization_code')),
	CONSTRAINT "source_auth_sessions_status_check" CHECK ("status" in ('pending', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX "secret_materials_updated_idx" ON "secret_materials" ("updated_at","id");--> statement-breakpoint
CREATE INDEX "source_auth_sessions_workspace_idx" ON "source_auth_sessions" ("workspace_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_auth_sessions_state_idx" ON "source_auth_sessions" ("state");