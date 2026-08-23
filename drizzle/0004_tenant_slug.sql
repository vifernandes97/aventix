-- Slug do tenant: o segmento da URL publica /agendamento/{slug} (secao 2-B).
--
-- EDITADA A MAO, mesma razao e mesmo padrao da 0001: o drizzle-kit gerou
-- `ADD COLUMN "slug" text NOT NULL`, que ABORTA em tabela com linhas — e
-- `tenants` tem o tenant 1 em producao desde o primeiro seed. Aqui vira
-- nullable -> backfill -> SET NOT NULL. O estado FINAL e identico ao que o
-- snapshot em meta/ declara, entao `npm run db:generate` continua respondendo
-- "No schema changes".
--
-- ADITIVA: nenhuma coluna sai, nenhum dado muda de significado. Uma versao
-- ANTERIOR do app rodando contra este schema continua funcionando, porque
-- ninguem le a coluna nova. Isso importa: esta migration pode chegar ao banco
-- de producao antes (ou sem) o codigo que a consome.

ALTER TABLE "tenants" ADD COLUMN "slug" text;--> statement-breakpoint

-- ===========================================================================
-- BACKFILL — determinista, e nunca deixa NULL para o SET NOT NULL tropecar
-- ===========================================================================
--
-- Dois passos, nesta ordem, e a ordem e o ponto:
--
--   1. TODO tenant recebe 'tenant-{id}'. Placeholder feio de proposito: e um
--      slug valido e unico (o id ja e unico), entao o SET NOT NULL abaixo nao
--      tem como falhar, e ao mesmo tempo ninguem confunde com endereco
--      divulgado. Hoje so existe o tenant 1, mas a migration nao pode DEPENDER
--      disso — banco de dev, copia de staging e o banco de quem clonar o repo
--      podem ter linhas que ninguem previu, e uma migration que aborta em
--      producao por causa de uma linha inesperada e o pior momento de
--      descobrir.
--
--   2. O tenant 1 recebe o slug de verdade, 'quadriclub'. Casado com
--      SEED_TENANT_ID e SEED_TENANT_SLUG em lib/seed.ts, que e a casa
--      canonica dessa identidade — se um dia divergirem, lib/seed.ts vence.
UPDATE "tenants" SET slug = 'tenant-' || id WHERE slug IS NULL;--> statement-breakpoint
UPDATE "tenants" SET slug = 'quadriclub' WHERE id = 1;--> statement-breakpoint

-- Denuncia (sem abortar) qualquer tenant que tenha ficado com placeholder. Num
-- banco so com o tenant 1 este bloco fica em silencio. Se gritar, alguem tem um
-- tenant que a Etapa 2 nao previu — e getTenantId() ainda devolve 1 fixo para
-- ele, que e exatamente o bug que tests/o-barreira-multi-tenant.test.ts existe
-- para impedir de nascer.
DO $$
DECLARE
  placeholder record;
  total int := 0;
BEGIN
  FOR placeholder IN
    SELECT id, name, slug FROM "tenants" WHERE slug LIKE 'tenant-%'
  LOOP
    total := total + 1;
    RAISE WARNING
      'backfill 0004: tenant % (%) ficou com slug placeholder % — defina o slug real antes de divulgar a LP',
      placeholder.id, placeholder.name, placeholder.slug;
  END LOOP;

  IF total > 0 THEN
    RAISE WARNING
      'backfill 0004: % tenant(s) com slug placeholder. getTenantId() ainda devolve 1 fixo (Etapa 2 pendente).',
      total;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "tenants" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- UNIQUE por ultimo: o slug e ENDERECO. Dois tenants com o mesmo slug fazem a
-- LP de um servir o outro, e sob concorrencia so o banco consegue impedir isso.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_slug_unique" UNIQUE("slug");
