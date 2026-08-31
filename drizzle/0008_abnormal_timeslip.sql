ALTER TABLE "reservation_payments" ADD COLUMN "card_machine_modality" "card_machine_modality";--> statement-breakpoint
ALTER TABLE "reservation_payments" ADD COLUMN "rate_basis_points_applied" integer;--> statement-breakpoint
ALTER TABLE "reservation_payments" ADD COLUMN "net_cents" integer;--> statement-breakpoint
ALTER TABLE "reservation_payments" ADD COLUMN "registered_by" text;--> statement-breakpoint
ALTER TABLE "reservation_payments" ADD COLUMN "registered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservation_payments" ADD CONSTRAINT "reservation_payments_card_machine_check" CHECK (("reservation_payments"."rate_basis_points_applied" IS NULL) = ("reservation_payments"."net_cents" IS NULL)
          AND ("reservation_payments"."rate_basis_points_applied" IS NULL OR "reservation_payments"."card_machine_modality" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "reservation_payments" ADD CONSTRAINT "reservation_payments_rate_applied_range_check" CHECK ("reservation_payments"."rate_basis_points_applied" IS NULL
          OR ("reservation_payments"."rate_basis_points_applied" >= 0 AND "reservation_payments"."rate_basis_points_applied" <= 10000));