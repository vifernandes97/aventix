ALTER TABLE "reservations" ADD COLUMN "full_price_cents" integer;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "discount_basis_points" integer;