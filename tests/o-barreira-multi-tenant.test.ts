// GRUPO O — BARREIRA DE MULTI-TENANCY (CLAUDE.md secao 2-B, Etapas 1 e 2).
//
// ============================================================================
// ESTE ARQUIVO NAO TESTA UMA FUNCIONALIDADE. ELE GUARDA UMA JANELA ABERTA.
//
// A Etapa 1 (23/08) fez a URL resolver o tenant: /agendamento/{slug} consulta
// `tenants.slug` e devolve 404 para slug desconhecido. A Etapa 2 NAO foi feita:
// `getTenantId()` continua devolvendo 1 fixo, e e ele que governa TODAS as
// consultas de negocio.
//
// Enquanto existir UM tenant, os dois concordam e nada disso aparece. O dia em
// que alguem cadastrar o segundo, /agendamento/{slug-do-cliente-2} renderiza a
// pagina certa e serve, por baixo, o catalogo, os horarios e as reservas do
// Quadri Club. Sem excecao, sem log, sem nada quebrado na tela — a pior forma
// possivel de um bug de isolamento de dados.
//
// >>> O QUE ESTE ARQUIVO GARANTE, e por que nesta forma <<<
// Ele NAO conta linhas em `tenants` e torce para rodar por ultimo. Uma barreira
// que depende de ordem alfabetica de arquivo desaparece no dia em que alguem
// renomeia um teste, e desaparece em SILENCIO — que e exatamente a categoria de
// falha que ela existe para impedir.
//
// Em vez disso, ele testa a DIVERGENCIA em si, do jeito mais direto: cria um
// segundo tenant de verdade e prova que o sistema se RECUSA a servi-lo. Isso
// vale independentemente de ordem, de paralelismo e de quantos fixtures existam.
//
// >>> CRITERIO DE CONCLUSAO DA ETAPA 2 <<<
// Quando getTenantId() resolver o tenant da requisicao, a divergencia deixa de
// ser possivel: `assertResolvedTenantIsCurrent` e ESTE ARQUIVO devem ser
// APAGADOS no mesmo commit. Poder apaga-los e como se sabe que a Etapa 2
// terminou. Ate la, um vermelho aqui e a barreira funcionando, nao um teste
// chato para contornar.
// ============================================================================

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import BookingPage from '@/app/(public)/agendamento/[slug]/page';
import { db } from '@/lib/db/client';
import { SEED_TENANT_ID, SEED_TENANT_SLUG } from '@/lib/seed';
import { getTenantId } from '@/lib/tenant';
import {
  MultiTenantNotReadyError,
  assertResolvedTenantIsCurrent,
  findTenantBySlug,
} from '@/lib/tenant-slug';

import { FIXTURE_TENANT_SLUG_PREFIX, assertCatalogSeeded } from './helpers/db';

/**
 * Tenant 2 deste arquivo. Id alto e slug obviamente de teste, pelo mesmo motivo
 * dos vizinhos de J..N: ninguem pode confundir com cliente real ao ler depois.
 */
const SEGUNDO_TENANT_ID = 88;
const SEGUNDO_TENANT_SLUG = `${FIXTURE_TENANT_SLUG_PREFIX}o-etapa2`;

async function criarSegundoTenant(): Promise<void> {
  await db.execute(sql`
    INSERT INTO tenants (id, name, slug)
    VALUES (${SEGUNDO_TENANT_ID}, 'Cliente Dois (fixture)', ${SEGUNDO_TENANT_SLUG})
    ON CONFLICT (id) DO NOTHING
  `);
}

async function removerSegundoTenant(): Promise<void> {
  await db.execute(sql`DELETE FROM tenants WHERE id = ${SEGUNDO_TENANT_ID}`);
}

beforeAll(assertCatalogSeeded);
afterEach(removerSegundoTenant);
afterAll(removerSegundoTenant);

describe('O — barreira: a URL resolve por slug, o sistema ainda nao', () => {
  it('64. o tenant semeado resolve pelo slug e a guarda deixa passar', async () => {
    const tenant = await findTenantBySlug(SEED_TENANT_SLUG);

    expect(tenant).not.toBeNull();
    expect(tenant!.id).toBe(SEED_TENANT_ID);
    expect(tenant!.slug).toBe(SEED_TENANT_SLUG);

    // O caso feliz de hoje: um tenant so, URL e sistema concordam.
    expect(() => assertResolvedTenantIsCurrent(tenant!)).not.toThrow();
  });

  it('65. slug inexistente resolve para null (e a pagina vira 404)', async () => {
    expect(await findTenantBySlug('nao-existe-este-tenant')).toBeNull();
  });

  it('66. slug de formato invalido nao chega ao banco', async () => {
    // Varredura de bot e travessia de caminho: barradas pelo formato, sem
    // consulta. Se um dia isto passar a devolver tenant, o espaco de endereco
    // deixou de ser fechado.
    for (const lixo of ['../../etc/passwd', 'wp-login.php', '.env', 'ADMIN', '', '-x', 'x-']) {
      expect(await findTenantBySlug(lixo)).toBeNull();
    }
  });

  it('67. >>> BARREIRA <<< um SEGUNDO tenant faz a guarda recusar servir a pagina', async () => {
    await criarSegundoTenant();

    const tenant = await findTenantBySlug(SEGUNDO_TENANT_SLUG);

    // A URL resolve o tenant 2 corretamente — esta metade FUNCIONA.
    expect(tenant).not.toBeNull();
    expect(tenant!.id).toBe(SEGUNDO_TENANT_ID);

    // ...e o resto do sistema continua no tenant 1. Esta e a divergencia.
    expect(getTenantId()).toBe(SEED_TENANT_ID);
    expect(tenant!.id).not.toBe(getTenantId());

    // A guarda transforma a divergencia silenciosa em falha alta.
    let capturado: unknown;
    try {
      assertResolvedTenantIsCurrent(tenant!);
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(MultiTenantNotReadyError);

    // A MENSAGEM E PARTE DO CONTRATO. Quem cadastrar o tenant 2 vai encontrar
    // este texto num log de 500 e precisa saber, sem ler codigo, que o problema
    // nao e o cadastro dele: e a Etapa 2 que nao foi feita.
    const mensagem = (capturado as Error).message;
    expect(mensagem).toContain('Etapa 2');
    expect(mensagem).toContain('getTenantId()');
    expect(mensagem).toContain(SEGUNDO_TENANT_SLUG);
    expect(mensagem).toContain(String(SEGUNDO_TENANT_ID));
  });

  it('67b. >>> A PROVA QUE IMPORTA <<< a LP do tenant 2 se RECUSA a renderizar', async () => {
    // O caso 67 prova a guarda isolada. Este prova o efeito de ponta a ponta, no
    // componente de pagina de verdade — que e onde o vazamento aconteceria.
    //
    // Sem a guarda, este teste passaria renderizando o wizard: catalogo,
    // horarios e precos do Quadri Club sob a URL do cliente 2. E o bug inteiro
    // que a Etapa 1 poderia ter introduzido, num unico assert.
    await criarSegundoTenant();

    let renderizou: unknown = null;
    let capturado: unknown = null;
    try {
      renderizou = await BookingPage({
        params: Promise.resolve({ slug: SEGUNDO_TENANT_SLUG }),
        searchParams: Promise.resolve({}),
      });
    } catch (error) {
      capturado = error;
    }

    expect(renderizou).toBeNull();
    expect(capturado).toBeInstanceOf(MultiTenantNotReadyError);
  });

  it('68. nenhum tenant REAL alem do semeado existe no banco', async () => {
    // Tripwire de catalogo, complementar ao caso 67. O 67 prova que a guarda
    // reage; este prova que ninguem cadastrou um tenant de verdade sem passar
    // pela Etapa 2 — por exemplo acrescentando-o ao seed.
    //
    // Ignora os tenants de FIXTURE pelo PREFIXO do slug, nao por ordem de
    // arquivo: e o que mantem esta checagem valida com qualquer paralelismo e
    // com qualquer renomeacao de arquivo de teste.
    const { rows } = await db.execute<{ id: number; name: string; slug: string }>(sql`
      SELECT id, name, slug FROM tenants
       WHERE slug NOT LIKE ${`${FIXTURE_TENANT_SLUG_PREFIX}%`}
       ORDER BY id
    `);

    expect(
      rows,
      'Ha tenant(s) reais alem do semeado: ' +
        rows.map((r) => `${r.id}/${r.slug}`).join(', ') +
        '. A URL ja resolve por slug (Etapa 1), mas getTenantId() (lib/tenant.ts) ' +
        'ainda devolve 1 fixo — todas as consultas de negocio servem o tenant 1. ' +
        'Faca a Etapa 2 ANTES de cadastrar um segundo tenant.',
    ).toHaveLength(1);

    expect(rows[0].id).toBe(SEED_TENANT_ID);
    expect(rows[0].slug).toBe(SEED_TENANT_SLUG);
  });
});
