CREATE TABLE "schedule_exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"date" date NOT NULL,
	"opens" time,
	"closes" time,
	"closed" boolean DEFAULT false NOT NULL,
	"reason" text,
	CONSTRAINT "schedule_exceptions_tenant_date_unique" UNIQUE("tenant_id","date"),
	CONSTRAINT "schedule_exceptions_closed_check" CHECK ("schedule_exceptions"."closed" = true OR ("schedule_exceptions"."opens" IS NOT NULL AND "schedule_exceptions"."closes" IS NOT NULL AND "schedule_exceptions"."closes" > "schedule_exceptions"."opens"))
);
--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;