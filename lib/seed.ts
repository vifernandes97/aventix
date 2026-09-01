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
import {
  experiences,
  operatingHours,
  paymentMethodDiscounts,
  resources,
  settings,
  tenants,
} from './db/schema';
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

/**
 * Desconto do Pix do Quadri Club, em BASIS POINTS (700 = 7%) — secao 4-B.1.
 *
 * >>> POR QUE AQUI, E NAO EM lib/templates/quadriciclo.ts <<<
 * Mesmo criterio de SEED_TENANT_SLUG, logo acima: 7% e decisao COMERCIAL DESTE
 * TENANT, nao fato do SEGMENTO. O proximo cliente de passeio de quadriciclo
 * recebe o mesmo template e negocia o proprio desconto — gravar 700 dentro do
 * template amarraria o segmento a uma tabela de precos e destruiria a razao de
 * o template existir.
 *
 * >>> E POR QUE ISTO NAO CAI NA ARMADILHA DA SECAO 4-B.6 <<<
 * A secao 4-B.6 proibe guardar configuracao financeira em `settings` porque o
 * seed SOBRESCREVE settings divergentes: o dono configuraria 7%, e o valor
 * sumiria no proximo seed, sem erro e sem log. A insercao abaixo e
 * INSERT-ONLY — nao existe `else` que atualize —, exatamente como a linha de
 * `tenants`. Um desconto que o dono mudar para 5% SOBREVIVE a todo seed futuro.
 *
 * Semear o valor inicial ainda vale a pena: sem ele o tenant nasce com 0% e a
 * primeira venda com desconto sairia pelo cheio.
 */
export const SEED_PIX_DISCOUNT_BASIS_POINTS = 700;

export type Tally = { created: number; updated: number; unchanged: number };
const tally = (): Tally => ({ created: 0, updated: 0, unchanged: 0 });

export type SeedReport = {
  settings: Tally;
  /** Configuracao financeira (secao 4-B.6). `updated` e sempre 0: e insert-only. */
  paymentDiscounts: Tally;
  resources: Tally;
  /** Insert-only desde 01/09: `updated` e sempre 0. Ver o bloco de experiences. */
  experiences: Tally;
  operatingHours: Tally;
  resourceIds: { id: number; name: string }[];
  experienceIds: { id: number; name: string; priceCents: number }[];
  orphans: string[];
  /**
   * O banco diverge do template, e o seed NAO corrigiu — porque aquele bloco e
   * insert-only.
   *
   * ==========================================================================
   * >>> RELATO NEUTRO, NAO ALARME. NAO TRANSFORME ISTO EM console.error. <<<
   *
   * Depois da primeira edicao do dono, divergencia e o estado NORMAL e
   * PERMANENTE — e o que a autonomia significa. Um aviso que dispara sempre nao
   * e aviso, e fundo: a regra e da secao 8-B, e nasceu do reconciliador que
   * gritava a cada 10 minutos sobre estado esperado ate ninguem mais ler o log.
   *
   * O valor disto nao e vigiar o dono. E ser o DIFF que o dev precisa quando for
   * investigar "por que producao nao e o template" — e o que mantem o template
   * util como documentacao em vez de ficcao.
   * ==========================================================================
   */
  divergences: string[];
  tenantCreated: boolean;
};

/** 'HH:MM:SS' e 'HH:MM' viram 'HH:MM' — o Postgres devolve `time` com segundos. */
const hhmm = (t: string) => t.slice(0, 5);

/**
 * Valor para a linha de divergencia. `null` sai como `(vazio)` e nao como a
 * string "null": este relato e lido por gente, e "null" ao lado de um numero se
 * confunde com o texto literal.
 */
const fmt = (v: unknown) => (v === null || v === undefined ? '(vazio)' : String(v));

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
      paymentDiscounts: tally(),
      resources: tally(),
      experiences: tally(),
      operatingHours: tally(),
      resourceIds: [],
      experienceIds: [],
      orphans: [],
      divergences: [],
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
    //
    // ========================================================================
    // >>> INSERT-ONLY DESDE 01/09. NAO ACRESCENTE UM `update` AQUI. <<<
    //
    // Ate essa data este bloco RECONCILIAVA os nove campos, e o dono editava
    // preco, sinal ou idade no /admin/experiencias e via o valor voltar sozinho
    // no proximo seed — sem erro e sem log. A tela existia, funcionava, e o
    // seed a desfazia.
    //
    // >>> A MUDANCA FOI DE PREMISSA, NAO DE OPINIAO SOBRE SEGURANCA. <<<
    // O Aventix e vendido para OUTRAS EMPRESAS. Se cada configuracao depender
    // do dev, o produto nao escala — "proteger o cliente de si mesmo" na
    // pratica significa o dev virar gargalo permanente de cada venda. A
    // responsabilidade por baixar uma idade minima e do DONO, que e quem
    // publica a regra e quem responde por ela. Ver docs/DECISOES.md (01/09).
    //
    // >>> A LINHA E "TEM TELA", E ELA VAI ANDAR. <<<
    // `settings` e `resources` continuam reconciliando HOJE por NAO TEREM TELA,
    // nao por decisao de que devam. Sem tela, tirar a reconciliacao troca um
    // caminho ruim (editar template + deploy, que ao menos passa por revisao e
    // fica no git) por um pior (psql em producao — secao 19).
    //
    // O DESTINO de todos eles e insert-only. A ordem e inviolavel:
    // **TELA PRIMEIRO, insert-only JUNTO com ela, item a item.** Nunca antes,
    // senao o valor fica sem caminho de conserto.
    // ========================================================================
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
        // >>> ENTRAVA na reconciliacao ate 01/09, com o argumento de que idade
        // minima e regra de SEGURANCA e por isso o template seria a casa
        // definitiva. REVERTIDO — ver docs/DECISOES.md (01/09). Em resumo: o
        // CRUD ja expunha este campo, entao reconciliar fazia a tela mentir
        // sobre uma regra de seguranca; e a responsabilidade por baixa-la e do
        // DONO, nao do sistema.
        minPassengerAge: item.minPassengerAge,
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

      // >>> O PRECO DO BANCO, NAO O DO TEMPLATE. <<<
      // Enquanto este bloco reconciliava, os dois eram o mesmo numero depois do
      // seed e ler do template era inofensivo. Com insert-only deixaram de ser:
      // imprimir `item.priceCents` faria o relatorio anunciar R$ 349,99 numa
      // experiencia que o dono pos em R$ 379,00 — o seed relatando o preco que
      // ele NAO gravou, logo acima do bloco que diz que os dois divergem.
      report.experienceIds.push({
        id: current.id,
        name: current.name,
        priceCents: current.priceCents,
      });

      const changed = (Object.keys(desired) as (keyof typeof desired)[]).filter(
        (k) => current[k] !== desired[k],
      );

      if (changed.length > 0) {
        for (const k of changed) {
          report.divergences.push(
            `experience "${item.name}".${k}: banco=${fmt(current[k])} template=${fmt(desired[k])}`,
          );
        }
      }
      // INSERT-ONLY: nao ha `update` aqui, e a ausencia e o ponto. `unchanged`
      // passa a significar "o seed nao tocou", como ja significa no desconto.
      report.experiences.unchanged += 1;
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

    // -- configuracao financeira (secao 4-B.6) --------------------------------
    //
    // >>> INSERT-ONLY. NAO ACRESCENTE UM `else` QUE ATUALIZE. <<<
    // Este e o unico bloco do seed que se recusa a reconciliar de proposito, e
    // e o ponto inteiro da secao 4-B.6: o desconto e configurado pelo DONO na
    // tela /admin/financeiro, e um seed que o reescrevesse reproduziria
    // exatamente a falha que tirar a configuracao de `settings` foi feito para
    // evitar — o valor voltando sozinho ao do codigo, sem erro e sem log.
    //
    // O mesmo criterio da linha de `tenants` (o slug, mais acima): o seed
    // ESTABELECE o valor inicial, nunca o corrige depois.
    //
    // `card_machine_rates` NAO e semeada: os percentuais reais nao chegaram do
    // cliente, e taxa chutada vira numero errado com aparencia de certo. Tabela
    // vazia significa "nao configurado", que e o estado honesto hoje.
    const [existingDiscount] = await tx
      .select({
        method: paymentMethodDiscounts.method,
        discountBasisPoints: paymentMethodDiscounts.discountBasisPoints,
      })
      .from(paymentMethodDiscounts)
      .where(
        and(
          eq(paymentMethodDiscounts.tenantId, SEED_TENANT_ID),
          eq(paymentMethodDiscounts.method, 'pix'),
        ),
      );

    if (!existingDiscount) {
      await tx.insert(paymentMethodDiscounts).values({
        tenantId: SEED_TENANT_ID,
        method: 'pix',
        discountBasisPoints: SEED_PIX_DISCOUNT_BASIS_POINTS,
      });
      report.paymentDiscounts.created += 1;
    } else {
      // Este bloco e insert-only desde a Fase 0 e ate 01/09 divergia EM
      // SILENCIO: o dono baixava o desconto para 5%, o seed nao mexia (certo) e
      // nao dizia nada (a metade que faltava). Agora o relato existe para os
      // dois blocos insert-only, pelo mesmo motivo e no mesmo tom.
      if (existingDiscount.discountBasisPoints !== SEED_PIX_DISCOUNT_BASIS_POINTS) {
        report.divergences.push(
          `payment_method_discounts "pix".discountBasisPoints: ` +
            `banco=${fmt(existingDiscount.discountBasisPoints)} ` +
            `template=${fmt(SEED_PIX_DISCOUNT_BASIS_POINTS)}`,
        );
      }
      report.paymentDiscounts.unchanged += 1;
    }

    return report;
  });
}
