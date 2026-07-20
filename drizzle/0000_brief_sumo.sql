-- btree_gist: exigido pela exclusion constraint de reservation_resources (int WITH = + range WITH &&).
-- Nao gerado pelo drizzle-kit; adicionado manualmente (CLAUDE.md secao 2 / 4.4).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."participant_role" AS ENUM('operator', 'passenger');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('pix', 'card');--> statement-breakpoint
CREATE TYPE "public"."price_mode" AS ENUM('per_resource');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('pending_payment', 'confirmed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "blackouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"resource_id" integer,
	"period" "tstzrange" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"cpf" text,
	"birthdate" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_phone_unique" UNIQUE("tenant_id","phone")
);
--> statement-breakpoint
CREATE TABLE "experiences" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"buffer_minutes" integer DEFAULT 15 NOT NULL,
	"price_mode" "price_mode" DEFAULT 'per_resource' NOT NULL,
	"price_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "experiences_duration_check" CHECK ("experiences"."duration_minutes" > 0),
	CONSTRAINT "experiences_buffer_check" CHECK ("experiences"."buffer_minutes" >= 0),
	CONSTRAINT "experiences_price_check" CHECK ("experiences"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operating_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"weekday" integer NOT NULL,
	"opens" time NOT NULL,
	"closes" time NOT NULL,
	CONSTRAINT "operating_hours_weekday_check" CHECK ("operating_hours"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "operating_hours_range_check" CHECK ("operating_hours"."closes" > "operating_hours"."opens")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"birthdate" date,
	"role" "participant_role" NOT NULL,
	"document_number" text
);
--> statement-breakpoint
CREATE TABLE "reservation_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"resource_id" integer NOT NULL,
	"period" "tstzrange" NOT NULL,
	"status" "reservation_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"customer_id" uuid NOT NULL,
	"experience_id" integer NOT NULL,
	"resources_needed" integer NOT NULL,
	"total_price_cents" integer NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"channel" text,
	"termo_version" text NOT NULL,
	"termo_accepted_at" timestamp with time zone NOT NULL,
	"termo_accepted_ip" text,
	"termo_accepted_user_agent" text,
	"status" "reservation_status" DEFAULT 'pending_payment' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"payment_method" "payment_method" DEFAULT 'pix' NOT NULL,
	"payment_id" text,
	"external_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "reservations_resources_needed_check" CHECK ("reservations"."resources_needed" >= 1)
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"capacity" integer DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "resources_capacity_check" CHECK ("resources"."capacity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"tenant_id" integer NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "settings_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "shared_calendar_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"label" text NOT NULL,
	"token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "shared_calendar_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blackouts" ADD CONSTRAINT "blackouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackouts" ADD CONSTRAINT "blackouts_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_hours" ADD CONSTRAINT "operating_hours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_resources" ADD CONSTRAINT "reservation_resources_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_resources" ADD CONSTRAINT "reservation_resources_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_calendar_links" ADD CONSTRAINT "shared_calendar_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_reservations_payment" ON "reservations" USING btree ("payment_id") WHERE "reservations"."payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_reservations_status_hold" ON "reservations" USING btree ("status","hold_expires_at");--> statement-breakpoint
CREATE INDEX "idx_reservations_start" ON "reservations" USING btree ("tenant_id","start_at");--> statement-breakpoint
CREATE INDEX "idx_reservations_customer" ON "reservations" USING btree ("customer_id");--> statement-breakpoint
-- Trava anti-overbooking (CLAUDE.md secao 4.4 / 4.6): defesa real contra double-booking por recurso.
-- Nao representavel no DSL do Drizzle; adicionada manualmente. Reserva de N recursos insere N linhas;
-- qualquer sobreposicao de periodo no mesmo recurso (status ativo) => rollback total.
ALTER TABLE "reservation_resources" ADD CONSTRAINT "reservation_resources_no_overlap" EXCLUDE USING gist (
  "resource_id" WITH =,
  "period" WITH &&
) WHERE (status IN ('pending_payment','confirmed'));