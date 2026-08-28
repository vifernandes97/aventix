CREATE TYPE "public"."card_machine_modality" AS ENUM('debit', 'credit', 'credit_installment');--> statement-breakpoint
CREATE TABLE "card_machine_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"modality" "card_machine_modality" NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_machine_rates_tenant_modality_key" UNIQUE("tenant_id","modality"),
	CONSTRAINT "card_machine_rates_range_check" CHECK ("card_machine_rates"."rate_basis_points" >= 0 AND "card_machine_rates"."rate_basis_points" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "payment_method_discounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"method" "payment_method" NOT NULL,
	"discount_basis_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_method_discounts_tenant_method_key" UNIQUE("tenant_id","method"),
	CONSTRAINT "payment_method_discounts_range_check" CHECK ("payment_method_discounts"."discount_basis_points" >= 0 AND "payment_method_discounts"."discount_basis_points" < 10000)
);
--> statement-breakpoint
ALTER TABLE "card_machine_rates" ADD CONSTRAINT "card_machine_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method_discounts" ADD CONSTRAINT "payment_method_discounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;