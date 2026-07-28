// Aventix — entrypoint do seed (CLAUDE.md secao 11-B).
//
//     npm run db:seed
//
// ARQUIVO FINO DE PROPOSITO: toda a logica vive em lib/seed.ts. Aqui so
// acontecem tres coisas — carregar o .env, chamar seedTenant() e imprimir o
// relatorio. /lib e biblioteca, /scripts e executavel: este arquivo roda ao ser
// carregado e escreve no banco, e por isso nao pode ser importado por ninguem.
//
// A ORDEM DOS IMPORTS IMPORTA: `dotenv/config` vem primeiro porque
// lib/db/client.ts le process.env.DATABASE_URL no momento do import. O ESM
// avalia os modulos na ordem em que aparecem, entao inverter estas duas linhas
// deixaria a Pool sem connection string.

import 'dotenv/config';

import { SEED_TENANT_ID, type SeedReport, type Tally, seedTenant } from '../lib/seed';
import { quadricicloTemplate } from '../lib/templates/quadriciclo';

function line(label: string, t: Tally) {
  console.log(
    `  ${label.padEnd(16)} criados: ${t.created}   atualizados: ${t.updated}   sem mudanca: ${t.unchanged}`,
  );
}

function report(r: SeedReport) {
  console.log(`  tenant           ${r.tenantCreated ? 'criado' : 'ja existia'}`);
  line('settings', r.settings);
  line('resources', r.resources);
  line('experiences', r.experiences);
  line('operating_hours', r.operatingHours);

  console.log('\n  RECURSOS');
  for (const item of r.resourceIds) console.log(`    id ${item.id}  ${item.name}`);

  console.log('\n  EXPERIENCIAS');
  for (const item of r.experienceIds) {
    console.log(`    id ${item.id}  ${item.name}  (R$ ${(item.priceCents / 100).toFixed(2)} por recurso)`);
  }

  if (r.orphans.length > 0) {
    console.log('\n  NAO ESTAO NO TEMPLATE (deixados intactos, nada foi apagado):');
    for (const orphan of r.orphans) console.log(`    ${orphan}`);
  }
}

async function main() {
  const template = quadricicloTemplate;

  console.log(
    `\nSeed: template "${template.segment}" v${template.version} -> tenant ${SEED_TENANT_ID}\n`,
  );

  report(await seedTenant(template));

  console.log('\nOK\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('\nSeed FALHOU. Nada foi gravado (a transacao inteira sofreu rollback).\n');
  console.error(error);
  process.exit(1);
});
