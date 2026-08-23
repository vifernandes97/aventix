// Aventix — aplicacao de um template de segmento ao tenant (CLAUDE.md secao 11-B).
//
// O template e DADO (lib/templates/quadriciclo.ts); este modulo e a APLICACAO.
//
// POR QUE ISTO VIVE EM /lib E NAO EM /scripts:
// e BIBLIOTECA — importar este arquivo nao faz nada; e preciso CHAMAR
// seedTenant() para que qualquer escrita aconteca. Quem executa e
// `scripts/seed.ts` (npm run db:seed) e `tests/global-setup.ts`. Mesmo padrao
// de lib/jobs/expire-holds.ts, cuja logica vive em /lib e cujo agendamento vive
// em instrumentation.ts.
//
// (Antes desta separacao a logica morava dentro de scripts/seed.ts, que chamava
// main() ao ser carregado. Nao dava para reusar sem disparar escrita no banco e
// sem matar o processo com process.exit — que num globalSetup do Vitest levaria
// a suite junto.)
//
// IDEMPOTENTE: rodar N vezes deixa o banco no mesmo estado que rodar uma vez.
// Roda inteiro numa unica transacao: ou o catalogo fica consistente, ou nada muda.
//
// NUNCA APAGA nada. Nem reservas, clientes e pagamentos (que o seed sequer toca),
// nem catalogo: um recurso ou experiencia que exista no banco e nao no template
// e DEIXADO EM PAZ e apenas reportado como orfao. Apagar quebraria a FK de
// reservas ja gravadas e destruiria historico. Desativar catalogo obsoleto e
// operacao do admin (`active = false`), nao do seed.
//
// NAO IMPORTA lib/tenant.ts NEM lib/reservations.ts: tenant.ts tem
// `import 'server-only'`, que LANCA fora do contexto React Server, e os dois
// chamadores deste modulo sao Node puro. O tenant vem de constante local.

import { and, eq } from 'drizzle-orm';

import { db } from './db/client';
import { experiences, operatingHours, resources, settings, tenants } from './db/schema';
import { quadricicloTemplate } from './templates/quadriciclo';
import type { SegmentTemplate } from './templates/types';

/** Tenant unico do MVP. Local de proposito: ver o bloco sobre server-only acima. */
export const SEED_TENANT_ID = 1;
export const SEED_TENANT_NAME = 'Quadri Club';

/**
 * Segmento da URL publica do tenant: /agendamento/quadriclub (secao 2-B).
 *
 * >>> POR QUE AQUI, E NAO EM lib/templates/quadriciclo.ts <<<
 * O slug e identidade de TENANT; o template e dado de SEGMENTO. `quadriciclo` e
 * um segmento reutilizavel — o segundo, o terceiro e o decimo cliente de passeio
 * de quadriciclo recebem o MESMO template, cada um com o SEU slug. Gravar
 * 'quadriclub' dentro do template amarraria o segmento a um tenant e destruiria
 * a razao de o template existir.
 *
 * Por isso ele mora ao lado de SEED_TENANT_ID e SEED_TENANT_NAME, que sao a
 * mesma categoria de dado: quem e este tenant, nao o que ele vende.
 *
 * A "regra das duas casas" (secao 19) NAO se aplica: ela existe porque
 * seedTenant() SOBRESCREVE settings divergentes, e um valor digitado a mao no
 * banco sumiria no seed seguinte. A linha de `tenants` nao e sobrescrita — o
 * seed so a INSERE quando ausente (ver abaixo).
 */
export const SEED_TENANT_SLUG = 'quadriclub';

export type Tally = { created: number; updated: number; unchanged: number };
const tally = (): Tally => ({ created: 0, updated: 0, unchanged: 0 });

export type SeedReport = {
  settings: Tally;
  resources: Tally;
  experiences: Tally;
  operatingHours: Tally;
  resourceIds: { id: number; name: string }[];
  experienceIds: { id: number; name: string; priceCents: number }[];
  orphans: string[];
  tenantCreated: boolean;
};

/** 'HH:MM:SS' e 'HH:MM' viram 'HH:MM' — o Postgres devolve `time` com segundos. */
const hhmm = (t: string) => t.slice(0, 5);

/**
 * Aplica o template ao tenant e devolve o relatorio do que mudou.
 *
 * Nao imprime nada e nao encerra o processo: quem chama decide como reportar.
 */
export async function seedTenant(
  template: SegmentTemplate = quadricicloTemplate,
): Promise<SeedReport> {
  return db.transaction(async (tx) => {
    const report: SeedReport = {
      settings: tally(),
      resources: tally(),
      experiences: tally(),
      operatingHours: tally(),
      resourceIds: [],
      experienceIds: [],
      orphans: [],
      tenantCreated: false,
    };

    // -- tenant --------------------------------------------------------------
    const [existingTenant] = await tx.select().from(tenants).where(eq(tenants.id, SEED_TENANT_ID));
    if (!existingTenant) {
      await tx
        .insert(tenants)
        .values({ id: SEED_TENANT_ID, name: SEED_TENANT_NAME, slug: SEED_TENANT_SLUG });
      report.tenantCreated = true;
    }
    // NAO ha `else` que atualize o slug de um tenant existente, e e deliberado:
    // o slug e ENDERECO PUBLICO. Um seed que o reescrevesse mudaria a URL
    // divulgada ao cliente final sem ninguem pedir — o oposto do que o seed faz
    // com settings, onde o template e a fonte da verdade justamente porque
    // aqueles valores sao texto de UI. Renomear slug e migration, nao seed.

    // -- settings ------------------------------------------------------------
    // Chave natural existe no schema: PK (tenant_id, key). Upsert direto.
    for (const [key, value] of Object.entries(template.settings)) {
      const [current] = await tx
        .select({ value: settings.value })
        .from(settings)
        .where(and(eq(settings.tenantId, SEED_TENANT_ID), eq(settings.key, key)));

      if (!current) {
        await tx.insert(settings).values({ tenantId: SEED_TENANT_ID, key, value });
        report.settings.created += 1;
      } else if (current.value !== value) {
        await tx
          .update(settings)
          .set({ value })
          .where(and(eq(settings.tenantId, SEED_TENANT_ID), eq(settings.key, key)));
        report.settings.updated += 1;
      } else {
        report.settings.unchanged += 1;
      }
    }

    // -- resources -----------------------------------------------------------
    // RECONCILIACAO POR NOME. `resources.id` e serial, entao nao ha chave
    // natural no schema — o nome e o unico identificador estavel que o template
    // oferece. Consequencia assumida: RENOMEAR um recurso no template cria um
    // NOVO recurso em vez de renomear o antigo, e o antigo aparece como orfao no
    // relatorio. E o comportamento seguro: o recurso antigo pode ter reservas.
    const existingResources = await tx
      .select()
      .from(resources)
      .where(eq(resources.tenantId, SEED_TENANT_ID));
    const resourceByName = new Map(existingResources.map((r) => [r.name, r]));

    for (const item of template.resources) {
      const current = resourceByName.get(item.name);

      if (!current) {
        const [inserted] = await tx
          .insert(resources)
          .values({
            tenantId: SEED_TENANT_ID,
            name: item.name,
            capacity: item.capacity,
            active: item.active,
          })
          .returning({ id: resources.id, name: resources.name });
        report.resources.created += 1;
        report.resourceIds.push(inserted);
        continue;
      }

      report.resourceIds.push({ id: current.id, name: current.name });

      if (current.capacity !== item.capacity || current.active !== item.active) {
        await tx
          .update(resources)
          .set({ capacity: item.capacity, active: item.active })
          .where(eq(resources.id, current.id));
        report.resources.updated += 1;
      } else {
        report.resources.unchanged += 1;
      }
    }

    const templateResourceNames = new Set(template.resources.map((r) => r.name));
    for (const r of existingResources) {
      if (!templateResourceNames.has(r.name)) {
        report.orphans.push(`resource "${r.name}" (id ${r.id})`);
      }
    }

    // -- experiences ---------------------------------------------------------
    // Mesma reconciliacao por nome, mesma consequencia no rename.
    //
    // >>> FOI ESTA CONSEQUENCIA QUE QUEBROU A SUITE EM 2026-07-28. <<<
    // O commit ce3e4c6 renomeou as duas trilhas no template; o seed as inseriu
    // como registros NOVOS (ids 3 e 4) e reportou as antigas como orfas. Os
    // testes procuravam as experiencias por id fixo (1 e 2) e passaram a contar
    // zero. O seed fez o certo; quem estava errado era a suite, que agora
    // resolve as experiencias a partir DESTE MESMO template (tests/helpers/db.ts).
    const existingExperiences = await tx
      .select()
      .from(experiences)
      .where(eq(experiences.tenantId, SEED_TENANT_ID));
    const experienceByName = new Map(existingExperiences.map((e) => [e.name, e]));

    for (const item of template.experiences) {
      const desired = {
        durationMinutes: item.durationMinutes,
        bufferMinutes: item.bufferMinutes,
        priceMode: item.priceMode,
        priceCents: item.priceCents,
        paymentMode: item.paymentMode,
        depositPercent: item.depositPercent ?? null,
        depositFixedCents: item.depositFixedCents ?? null,
        active: item.active,
      };

      const current = experienceByName.get(item.name);

      if (!current) {
        const [inserted] = await tx
          .insert(experiences)
          .values({ tenantId: SEED_TENANT_ID, name: item.name, ...desired })
          .returning({
            id: experiences.id,
            name: experiences.name,
            priceCents: experiences.priceCents,
          });
        report.experiences.created += 1;
        report.experienceIds.push(inserted);
        continue;
      }

      report.experienceIds.push({
        id: current.id,
        name: current.name,
        priceCents: item.priceCents,
      });

      const differs = (Object.keys(desired) as (keyof typeof desired)[]).some(
        (k) => current[k] !== desired[k],
      );

      if (differs) {
        await tx.update(experiences).set(desired).where(eq(experiences.id, current.id));
        report.experiences.updated += 1;
      } else {
        report.experiences.unchanged += 1;
      }
    }

    const templateExperienceNames = new Set(template.experiences.map((e) => e.name));
    for (const e of existingExperiences) {
      if (!templateExperienceNames.has(e.name)) {
        report.orphans.push(`experience "${e.name}" (id ${e.id})`);
      }
    }

    // -- operating_hours -----------------------------------------------------
    // RECONCILIACAO POR (weekday, opens, closes): a faixa inteira e a identidade,
    // porque nao ha nada mais nela para atualizar. Existe -> no-op; nao existe ->
    // insere. Comparacao normalizada para 'HH:MM' porque o Postgres devolve
    // `time` com segundos ('08:00:00').
    const existingHours = await tx
      .select()
      .from(operatingHours)
      .where(eq(operatingHours.tenantId, SEED_TENANT_ID));
    const hoursKey = (weekday: number, opens: string, closes: string) =>
      `${weekday}|${hhmm(opens)}|${hhmm(closes)}`;
    const existingHoursKeys = new Set(
      existingHours.map((h) => hoursKey(h.weekday, h.opens, h.closes)),
    );

    for (const item of template.operatingHours) {
      if (existingHoursKeys.has(hoursKey(item.weekday, item.opens, item.closes))) {
        report.operatingHours.unchanged += 1;
        continue;
      }
      await tx.insert(operatingHours).values({
        tenantId: SEED_TENANT_ID,
        weekday: item.weekday,
        opens: item.opens,
        closes: item.closes,
      });
      report.operatingHours.created += 1;
    }

    const templateHoursKeys = new Set(
      template.operatingHours.map((h) => hoursKey(h.weekday, h.opens, h.closes)),
    );
    for (const h of existingHours) {
      if (!templateHoursKeys.has(hoursKey(h.weekday, h.opens, h.closes))) {
        report.orphans.push(
          `operating_hours weekday ${h.weekday} ${hhmm(h.opens)}-${hhmm(h.closes)} (id ${h.id})`,
        );
      }
    }

    return report;
  });
}
