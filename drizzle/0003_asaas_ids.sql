ALTER TABLE "customers" ADD COLUMN "asaas_customer_id" text;--> statement-breakpoint
ALTER TABLE "reservation_payments" ADD COLUMN "asaas_invoice_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customers_asaas" ON "customers" USING btree ("asaas_customer_id") WHERE "customers"."asaas_customer_id" IS NOT NULL;