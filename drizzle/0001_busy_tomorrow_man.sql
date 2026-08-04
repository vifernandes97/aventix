-- Congela duracao e buffer na reserva (snapshot "como foi vendido").
--
-- EDITADA A MAO. O drizzle-kit gerou os dois ADD COLUMN ja com NOT NULL, o que
-- ABORTA em tabela com linhas — a mesma falha que derrubou a antiga 0002 e
-- motivou o colapso das migrations em 27/07. Aqui vira nullable -> backfill ->
-- SET NOT NULL. O estado FINAL e identico ao que o snapshot em meta/ declara,
-- entao `npm run db:generate` continua respondendo "No schema changes".
--
-- Precedente de SQL manual dentro de migration gerada: o CREATE EXTENSION
-- btree_gist e a exclusion constraint, na 0000.

ALTER TABLE "reservations" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "buffer_minutes" integer;--> statement-breakpoint

-- ===========================================================================
-- BACKFILL — o period congelado e a verdade do TOTAL; a experiencia, da DIVISAO
-- ===========================================================================
--
-- reservation_resources.period foi calculado NA VENDA, entao
-- `upper(period) - start_at` e o unico registro por reserva de quanto tempo foi
-- realmente vendido. O que ele nao faz e decompor: nao registra onde a duracao
-- termina e o buffer comeca. Por isso a divisao precisa vir da experiencia.
--
-- POR QUE O BUFFER E A METADE LIDA DA EXPERIENCIA (e a duracao, a derivada):
-- o buffer e constante operacional (15 min no Quadri Club), a duracao e o
-- produto — e e a duracao que o CRUD da Fase 3 vai deixar o dono editar. Se so
-- a duracao mudou entre a venda e esta migration, este caminho acerta os DOIS
-- campos; derivar pelo oposto (duracao da experiencia, buffer por diferenca)
-- erraria os dois.
--
-- TRES RAMOS, nesta ordem de precedencia:
--   1. reserva SEM alocacao (period inexistente) -> duracao e buffer da
--      experiencia atual. Nao ha o que congelar: a reserva nunca chegou a
--      ocupar vaga. Medido no banco local em 03/08: 0 linhas neste ramo.
--   2. total - buffer_atual > 0 -> o caso normal: duracao = total - buffer.
--   3. total - buffer_atual <= 0 -> DEGENERADO. So acontece se o buffer da
--      experiencia tiver crescido mais que o passeio inteiro desde a venda.
--      Gravar a subtracao aqui produziria duracao zero ou negativa, que o CHECK
--      no fim deste arquivo derrubaria — e a migration inteira falharia por
--      causa de uma linha. Cai para a experiencia atual e o bloco de aviso
--      logo abaixo denuncia a linha para revisao manual.
UPDATE "reservations" r
   SET buffer_minutes = sold.exp_buffer,
       duration_minutes = CASE
         WHEN sold.period_total IS NULL                THEN sold.exp_duration
         WHEN sold.period_total - sold.exp_buffer > 0  THEN sold.period_total - sold.exp_buffer
         ELSE sold.exp_duration
       END
  FROM (
    SELECT r2.id,
           (
             SELECT (EXTRACT(EPOCH FROM (MAX(upper(rr.period)) - r2.start_at)) / 60)::int
               FROM "reservation_resources" rr
              WHERE rr.reservation_id = r2.id
           )                    AS period_total,
           e.duration_minutes   AS exp_duration,
           e.buffer_minutes     AS exp_buffer
      FROM "reservations" r2
      JOIN "experiences" e ON e.id = r2.experience_id
  ) sold
 WHERE sold.id = r.id;--> statement-breakpoint

-- POS-CONDICAO: onde ha period, o snapshot TEM que fechar com ele. Divergencia
-- aqui significa que a linha caiu no ramo degenerado (3) e carrega duracao da
-- experiencia atual em vez da vendida. Nao aborta a migration — o dado ja e
-- melhor do que o nada que existia antes —, mas grita o id para revisao.
DO $$
DECLARE
  divergente record;
  total int := 0;
BEGIN
  FOR divergente IN
    SELECT r.id,
           r.duration_minutes + r.buffer_minutes AS snapshot_total,
           (EXTRACT(EPOCH FROM (MAX(upper(rr.period)) - r.start_at)) / 60)::int AS period_total
      FROM "reservations" r
      JOIN "reservation_resources" rr ON rr.reservation_id = r.id
     GROUP BY r.id, r.duration_minutes, r.buffer_minutes, r.start_at
    HAVING r.duration_minutes + r.buffer_minutes
           <> (EXTRACT(EPOCH FROM (MAX(upper(rr.period)) - r.start_at)) / 60)::int
  LOOP
    total := total + 1;
    RAISE WARNING
      'backfill 0001: reserva % ficou com snapshot de % min contra period de % min (ramo degenerado) — revisar a mao',
      divergente.id, divergente.snapshot_total, divergente.period_total;
  END LOOP;

  IF total > 0 THEN
    RAISE WARNING 'backfill 0001: % reserva(s) divergente(s) do proprio period.', total;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "reservations" ALTER COLUMN "duration_minutes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "buffer_minutes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_duration_minutes_check" CHECK ("reservations"."duration_minutes" > 0);--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_buffer_minutes_check" CHECK ("reservations"."buffer_minutes" >= 0);
