-- Idade minima do GARUPA, por experiencia (CLAUDE.md secao 4.3).
--
-- >>> EDITADA A MAO: o backfill abaixo NAO e gerado pelo drizzle-kit. <<<
-- Se esta migration for regerada, o backfill precisa ser recolocado. Mesma
-- situacao da 0001 e da 0004, ja registrada em docs/ESTADO-ATUAL.md.
--
-- Regra publicada por escrito pelo cliente em 24/08/2026: 6 anos na Trilha da
-- Fazenda, 12 na Trilha da Montanha. A idade e contada na DATA DO PASSEIO
-- (ver createReservation), nao na data da reserva.
--
-- ADITIVA e segura em producao: `DEFAULT 0 NOT NULL` num ADD COLUMN nao
-- reescreve a tabela no Postgres (o default fica no catalogo desde o PG 11), e
-- `0` significa SEM IDADE MINIMA — ou seja, toda linha preexistente continua
-- vendendo exatamente como vendia ate o backfill rodar.
ALTER TABLE "experiences" ADD COLUMN "min_passenger_age" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_min_passenger_age_check" CHECK ("experiences"."min_passenger_age" BETWEEN 0 AND 120);--> statement-breakpoint

-- BACKFILL (manual). Casa por NOME, que e a mesma chave de reconciliacao que o
-- seed usa (lib/seed.ts) — id nao serve: as trilhas ja foram recriadas uma vez
-- (ids 3 e 4) quando o template as renomeou em 28/07.
--
-- Nao usa WHERE por tenant: a coluna nasceu agora, entao qualquer linha com
-- esses nomes e do catalogo semeado por este template. Um tenant futuro com uma
-- trilha homonima recebe o valor pelo seu proprio seed.
UPDATE "experiences" SET "min_passenger_age" = 6  WHERE "name" = 'Trilha da Fazenda';--> statement-breakpoint
UPDATE "experiences" SET "min_passenger_age" = 12 WHERE "name" = 'Trilha da Montanha';
