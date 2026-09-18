CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"network" text NOT NULL,
	"name" text,
	"wasm_hash" text,
	"spec_ledger" bigint,
	"spec_xdr" text[],
	"model" jsonb,
	"llms_txt" text,
	"openapi" jsonb,
	"mcp_scope" text DEFAULT 'ro' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fn_hints" (
	"contract_id" text NOT NULL,
	"fn" text NOT NULL,
	"kind" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fn_hints_contract_id_fn_pk" PRIMARY KEY("contract_id","fn")
);
--> statement-breakpoint
ALTER TABLE "fn_hints" ADD CONSTRAINT "fn_hints_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;