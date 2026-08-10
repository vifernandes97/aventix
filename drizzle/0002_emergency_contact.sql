-- Contato de emergencia do passo 5 do formulario publico (junto ao termo).
--
-- NULLABLE de proposito, nao NOT NULL: nao ha como retroagir o dado em reserva
-- ja existente (mesma licao da 0001 sobre coluna NOT NULL em tabela povoada).
-- A obrigatoriedade para reserva NOVA vive na aplicacao (rota + createReservation).

ALTER TABLE "reservations" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "emergency_contact_phone" text;
