CREATE TYPE "public"."charge_stage" AS ENUM('aguardando', 'em_analise', 'recusado', 'pago', 'estornado', 'cancelado');--> statement-breakpoint
ALTER TABLE "reservation_payments" DROP CONSTRAINT "reservation_payments_card_machine_check";--> statement-breakpoint
ALTER TABLE "reservation_payments" ADD COLUMN "charge_stage" charge_stage;--> statement-breakpoint
ALTER TABLE "reservation_payments" ADD CONSTRAINT "reservation_payments_card_machine_check" CHECK ("reservation_payments"."rate_basis_points_applied" IS NULL
          OR ("reservation_payments"."net_cents" IS NOT NULL AND "reservation_payments"."card_machine_modality" IS NOT NULL));