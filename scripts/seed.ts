// Aventix — aplica um template de segmento ao tenant (CLAUDE.md secao 11-B).
//
//     npm run db:seed
//
// O template e DADO (lib/templates/quadriciclo.ts); este script e a APLICACAO.
//
// IDEMPOTENTE: rodar N vezes deixa o banco no mesmo estado que rodar uma vez.
// Roda inteiro numa unica transacao — ou o catalogo fica consistente, ou nada muda.
//
// NUNCA APAGA nada. Nem reservas, clientes e pagamentos (que o seed sequer toca),
// nem catalogo: um recurso ou experiencia que exista no banco e nao no template
// e DEIXADO EM PAZ e apenas reportado. Apagar quebraria a FK de reservas ja
// gravadas e destruiria historico. Desativar catalogo obsoleto e operacao do
// admin (`active = false`), nao do seed.
//
// POR QUE ESTE ARQUIVO VIVE EM /scripts E NAO EM /lib:
// e um EXECUTAVEL — chama main() ao ser carregado e escreve no banco. Em /lib
// ele conviveria com os modulos que o Next importa, e um import acidental
// dispararia escrita no banco. /lib e biblioteca, /scripts e entrypoint.
// (A secao 14 do CLAUDE.md nao lista /scripts na arvore; e um acrescimo.)
//
// NAO IMPORTA lib/tenant.ts NEM lib/reservations.ts: tenant.ts tem
// `import 'server-only'`, que LANCA fora do contexto React Server, e este script
// e Node puro. Os `import type` abaixo sao apagados na compilacao e por isso sao
// seguros. O tenant vem de constante local.

import 'dotenv/config';

import { and, eq } from 'drizzle-orm';

import { db } from '../lib/db/client';
import { experiences, operatingHours, resources, settings, tenants } from '../lib/db/schema';
import { quadricicloTemplate } from '../lib/templates/quadriciclo';
import type { SegmentTemplate } from '../lib/templates/types';

/** Tenant unico do MVP. Local de proposito: ver o bloco sobre server-only acima. */
const TENANT_ID = 1;
const TENANT_NAME = 'Quadri Club';

type Tally = { created: number; updated: number; unchanged: number };
const tally = (): Tally => ({ created: 0, updated: 0, unchanged: 0 });

/** 'HH:MM:SS' e 'HH:MM' viram 'HH:MM' — o Postgres devolve `time` com segundos. */
const hhmm = (t: string) => t.slice(0, 5);

async function applyTemplate(template: SegmentTemplate) {
  return db.transaction(async (tx) => {
    const report = {
      settings: tally(),
      resources: tally(),
      experiences: tally(),
      operatingHours: tally(),
      resourceIds: [] as { id: number; name: string }[],
      experienceIds: [] as { id: number; name: string; priceCents: number }[],
      orphans: [] as string[],
      tenantCreated: false,
    };

    // -- tenant --------------------------------------------------------------
    const [existingTenant] = await tx.select().from(tenants).where(eq(tenants.id, TENANT_ID));
    if (!existingTenant) {
      await tx.insert(tenants).values({ id: TENANT_ID, name: TENANT_NAME });
      report.tenantCreated = true;
    }

    // -- settings ------------------------------------------------------------
    // Chave natural existe no schema: PK (tenant_id, key). Upsert direto.
    for (const [key, value] of Object.entries(template.settings)) {
      const [current] = await tx
        .select({ value: settings.value })
        .from(settings)
        .where(and(eq(settings.tenantId, TENANT_ID), eq(settings.key, key)));

      if (!current) {
        await tx.insert(settings).values({ tenantId: TENANT_ID, key, value });
        report.settings.created += 1;
      } else if (current.value !== value) {
        await tx
          .update(settings)
          .set({ value })
          .where(and(eq(settings.tenantId, TENANT_ID), eq(settings.key, key)));
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
      .where(eq(resources.tenantId, TENANT_ID));
    const resourceByName = new Map(existingResources.map((r) => [r.name, r]));

    for (const item of template.resources) {
      const current = resourceByName.get(item.name);

      if (!current) {
        const [inserted] = await tx
          .insert(resources)
          .values({
            tenantId: TENANT_ID,
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
      if (!templateResourceNames.has(r.name)) report.orphans.push(`resource "${r.name}" (id ${r.id})`);
    }

    // -- experiences ---------------------------------------------------------
    // Mesma reconciliacao por nome, mesma consequencia no rename.
    const existingExperiences = await tx
      .select()
      .from(experiences)
      .where(eq(experiences.tenantId, TENANT_ID));
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
          .values({ tenantId: TENANT_ID, name: item.name, ...desired })
          .returning({
            id: experiences.id,
            name: experiences.name,
            priceCents: experiences.priceCents,
          });
        report.experiences.created += 1;
        report.experienceIds.push(inserted);
        continue;
      }

      report.experienceIds.push({ id: current.id, name: current.name, priceCents: item.priceCents });

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
      .where(eq(operatingHours.tenantId, TENANT_ID));
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
        tenantId: TENANT_ID,
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
        report.orphans.push(`operating_hours weekday ${h.weekday} ${hhmm(h.opens)}-${hhmm(h.closes)} (id ${h.id})`);
      }
    }

    return report;
  });
}

function line(label: string, t: Tally) {
  console.log(
    `  ${label.padEnd(16)} criados: ${t.created}   atualizados: ${t.updated}   sem mudanca: ${t.unchanged}`,
  );
}

async function main() {
  const template = quadricicloTemplate;

  console.log(`\nSeed: template "${template.segment}" v${template.version} -> tenant ${TENANT_ID}\n`);

  const report = await applyTemplate(template);

  console.log(`  tenant           ${report.tenantCreated ? 'criado' : 'ja existia'}`);
  line('settings', report.settings);
  line('resources', report.resources);
  line('experiences', report.experiences);
  line('operating_hours', report.operatingHours);

  console.log('\n  RECURSOS');
  for (const r of report.resourceIds) console.log(`    id ${r.id}  ${r.name}`);

  console.log('\n  EXPERIENCIAS');
  for (const e of report.experienceIds) {
    console.log(`    id ${e.id}  ${e.name}  (R$ ${(e.priceCents / 100).toFixed(2)} por recurso)`);
  }

  if (report.orphans.length > 0) {
    console.log('\n  NAO ESTAO NO TEMPLATE (deixados intactos, nada foi apagado):');
    for (const o of report.orphans) console.log(`    ${o}`);
  }

  console.log('\nOK\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('\nSeed FALHOU. Nada foi gravado (a transacao inteira sofreu rollback).\n');
  console.error(error);
  process.exit(1);
});
