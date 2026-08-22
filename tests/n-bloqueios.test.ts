// GRUPO N — CRUD de bloqueios pontuais (CLAUDE.md secoes 4.3 e 6).
//
// blackouts e tabela de MOVIMENTO para a suite: o seed a deixa vazia e o
// wipeMovement a zera, entao este arquivo nao precisa restaurar catalogo (ao
// contrario do grupo M).

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { listActiveResources } from '@/lib/resources';

import { GET as listRoute, POST as createRoute } from '@/app/api/admin/blackouts/route';
import { DELETE as deleteRoute, PUT as putRoute } from '@/app/api/admin/blackouts/[id]/route';

import { EXP, assertCatalogSeeded, nextSaturday, wipeMovement } from './helpers/db';

const SAT = nextSaturday();
const OTHER_TENANT_ID = 81;

type Corpo = Record<string, unknown>;

async function post(body: unknown) {
  const response = await createRoute(
    new Request('http://localhost/api/admin/blackouts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function put(id: string | number, body: unknown) {
  const response = await putRoute(
    new Request(`http://localhost/api/admin/blackouts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function del(id: string | number) {
  const response = await deleteRoute(
    new Request(`http://localhost/api/admin/blackouts/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function blackouts() {
  return ((await (await listRoute()).json()) as { blackouts: Corpo[] }).blackouts;
}

const camposComErro = (body: Corpo) =>
  ((body.fields ?? []) as { param: string }[]).map((f) => f.param);

/** Sabado do seed opera 08:00-18:00. Bloqueia a manha inteira. */
const MANHA = { inicio: `${SAT}T08:00`, fim: `${SAT}T12:00` };

beforeAll(async () => {
  await assertCatalogSeeded();
  await db.execute(sql`
    INSERT INTO tenants (id, name) VALUES (${OTHER_TENANT_ID}, 'Tenant Vizinho N')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await wipeMovement();
  await db.execute(sql`DELETE FROM tenants WHERE id = ${OTHER_TENANT_ID}`);
});

beforeEach(wipeMovement);

describe('N — bloqueios: escrita', () => {
  it('87. cria bloqueio GERAL (todos os recursos) e devolve as pontas em ISO', async () => {
    const { status, body } = await post({ ...MANHA, motivo: 'Estrada interditada' });

    expect(status).toBe(201);
    const bl = body.blackout as Corpo;
    expect(bl.resourceId).toBeNull();
    expect(bl.resourceName).toBeNull();
    expect(bl.reason).toBe('Estrada interditada');
    // ISO 8601, nao o texto cru do Postgres (secao 3): o formato cru devolve
    // NaN em motor que nao seja o V8, e o sintoma so apareceria no navegador.
    expect(new Date(bl.startAt as string).toISOString()).toBe(bl.startAt);
    expect(new Date(bl.endAt as string).toISOString()).toBe(bl.endAt);
  });

  it('88. o horario e LOCAL do tenant, nao UTC', async () => {
    // 08:00 em Sao Paulo (UTC-3) = 11:00Z. Se a conversao usasse UTC direto, o
    // bloqueio nasceria tres horas fora do lugar, sem erro nenhum aparecendo —
    // e o dono so descobriria vendo horario livre que ele achou que bloqueou.
    const bl = (await post(MANHA)).body.blackout as Corpo;

    expect(bl.startAt).toBe(`${SAT}T11:00:00.000Z`);
    expect(bl.endAt).toBe(`${SAT}T15:00:00.000Z`);
  });

  it('89. cria bloqueio de UM recurso, com o nome resolvido', async () => {
    const [recurso] = await listActiveResources();

    const { status, body } = await post({ ...MANHA, recursoId: recurso.id, motivo: 'Manutenção' });

    expect(status).toBe(201);
    const bl = body.blackout as Corpo;
    expect(bl.resourceId).toBe(recurso.id);
    expect(bl.resourceName).toBe(recurso.name);
  });

  it('90. fim anterior ou igual ao inicio responde 422', async () => {
    // `tstzrange` com fim <= inicio produz range VAZIO, que nunca cruza com
    // nada: o banco aceitaria em silencio e o dono teria um bloqueio que nao
    // bloqueia. E o pior desfecho possivel desta tela.
    for (const [inicio, fim] of [
      [`${SAT}T12:00`, `${SAT}T08:00`],
      [`${SAT}T12:00`, `${SAT}T12:00`],
    ]) {
      const { status, body } = await post({ inicio, fim });
      expect(status, `${inicio}..${fim}`).toBe(422);
      expect(camposComErro(body)).toContain('fim');
    }
  });

  it('91. data/hora com fuso explicito e recusada — o contrato e horario local', async () => {
    // '...T14:00Z' seria lido como 14h UTC = 11h de Brasilia. Recusar a FORMA e
    // o que impede a ambiguidade de existir.
    for (const inicio of [`${SAT}T08:00Z`, `${SAT}T08:00-03:00`, `${SAT} 08:00`, `${SAT}T08:00:00`]) {
      const { status } = await post({ inicio, fim: `${SAT}T12:00` });
      expect(status, `inicio ${inicio}`).toBe(422);
    }
  });

  it('92. recurso inexistente ou de OUTRO tenant responde 422, nao 500 nem 404', async () => {
    // O recurso e campo do CORPO, nao alvo da rota: 404 diria que o BLOQUEIO
    // nao existe. E sem a checagem de tenant, a FK (que so olha a tabela)
    // deixaria passar um recurso alheio.
    const { status, body } = await post({ ...MANHA, recursoId: 999_999 });
    expect(status).toBe(422);
    expect(camposComErro(body)).toContain('recursoId');

    const [recurso] = await listActiveResources();
    await db.execute(sql`
      UPDATE resources SET tenant_id = ${OTHER_TENANT_ID} WHERE id = ${recurso.id}
    `);
    try {
      expect((await post({ ...MANHA, recursoId: recurso.id })).status).toBe(422);
    } finally {
      // Devolve o recurso ao tenant 1: e CATALOGO, e a suite nao pode deixa-lo
      // mexido para os outros arquivos.
      await db.execute(sql`UPDATE resources SET tenant_id = 1 WHERE id = ${recurso.id}`);
    }
  });

  it('93. corpo nao-JSON responde 400, nao 422', async () => {
    const response = await createRoute(
      new Request('http://localhost/api/admin/blackouts', { method: 'POST', body: 'nao e json' }),
    );
    expect(response.status).toBe(400);
  });
});

describe('N — bloqueios: edicao e remocao', () => {
  it('94. PUT substitui o bloqueio inteiro', async () => {
    const criado = (await post({ ...MANHA, motivo: 'Manutenção' })).body.blackout as Corpo;
    const [recurso] = await listActiveResources();

    const { status, body } = await put(criado.id as number, {
      inicio: `${SAT}T14:00`,
      fim: `${SAT}T16:00`,
      recursoId: recurso.id,
      motivo: 'Evento fechado',
    });

    expect(status).toBe(200);
    const bl = body.blackout as Corpo;
    expect(bl.id).toBe(criado.id);
    expect(bl.resourceId).toBe(recurso.id);
    expect(bl.startAt).toBe(`${SAT}T17:00:00.000Z`);
    expect(bl.reason).toBe('Evento fechado');
  });

  it('95. inexistente, id malformado e bloqueio de OUTRO tenant respondem 404', async () => {
    expect((await put(999_999, MANHA)).status).toBe(404);
    expect((await del(999_999)).status).toBe(404);
    expect((await put('abc', MANHA)).status).toBe(404);
    expect((await del('abc')).status).toBe(404);

    const alheio = (await post(MANHA)).body.blackout as Corpo;
    await db.execute(sql`
      UPDATE blackouts SET tenant_id = ${OTHER_TENANT_ID} WHERE id = ${alheio.id as number}
    `);
    expect((await put(alheio.id as number, MANHA)).status).toBe(404);
    expect((await del(alheio.id as number)).status).toBe(404);
  });
});

describe('N — o bloqueio muda a VENDA (atravessa o motor real)', () => {
  it('96. bloqueio GERAL tira os horarios cobertos, e so eles', async () => {
    const antes = await getAvailability({ experienceId: EXP.curta, date: SAT, resourcesNeeded: 1 });
    expect(antes.slots.some((s) => s.label < '12:00')).toBe(true);

    await post(MANHA);

    const depois = await getAvailability({ experienceId: EXP.curta, date: SAT, resourcesNeeded: 1 });
    // A manha some; a tarde continua vendendo. O dia NAO vira 'closed': o
    // bloqueio corta horario, nao fecha a grade (secao 6).
    expect(depois.dayState).toBe('open');
    expect(depois.slots.some((s) => s.label < '12:00')).toBe(false);
    expect(depois.slots.length).toBeGreaterThan(0);
  });

  it('97. bloqueio de UM recurso nao derruba o dia: o outro continua vendendo', async () => {
    const recursos = await listActiveResources();
    expect(recursos.length).toBeGreaterThanOrEqual(2);

    await post({ ...MANHA, recursoId: recursos[0].id, motivo: 'Manutenção' });

    // Pedindo 1 recurso, a manha continua disponivel — sobrou o outro quadri.
    const um = await getAvailability({ experienceId: EXP.curta, date: SAT, resourcesNeeded: 1 });
    expect(um.slots.some((s) => s.label < '12:00')).toBe(true);

    // Pedindo 2, a manha some: so ha um recurso livre.
    const dois = await getAvailability({ experienceId: EXP.curta, date: SAT, resourcesNeeded: 2 });
    expect(dois.slots.some((s) => s.label < '12:00')).toBe(false);
  });

  it('98. bloqueio aplica POR CIMA de dia aberto por excecao (secao 6)', async () => {
    // ====================================================================
    // A regra de precedencia completa, ponta a ponta: excecao vence grade
    // semanal, e blackout vence as duas. Um blackout que fosse ignorado num dia
    // aberto por excecao venderia o quadriciclo que esta na oficina.
    // ====================================================================
    const { POST: criarExcecao } = await import('@/app/api/admin/schedule-exceptions/route');
    const { nextTuesday } = await import('./helpers/db');
    const TUE = nextTuesday();

    await criarExcecao(
      new Request('http://localhost/api/admin/schedule-exceptions', {
        method: 'POST',
        body: JSON.stringify({ data: TUE, fechado: false, abre: '09:00', fecha: '17:00' }),
      }),
    );

    const semBloqueio = await getAvailability({
      experienceId: EXP.curta,
      date: TUE,
      resourcesNeeded: 1,
    });
    expect(semBloqueio.slots.some((s) => s.label < '12:00')).toBe(true);

    await post({ inicio: `${TUE}T09:00`, fim: `${TUE}T12:00`, motivo: 'Guia de folga' });

    const comBloqueio = await getAvailability({
      experienceId: EXP.curta,
      date: TUE,
      resourcesNeeded: 1,
    });
    expect(comBloqueio.dayState).toBe('open');
    expect(comBloqueio.slots.some((s) => s.label < '12:00')).toBe(false);
  });

  it('99. apagar o bloqueio devolve os horarios para a venda', async () => {
    const criado = (await post(MANHA)).body.blackout as Corpo;

    const bloqueado = await getAvailability({
      experienceId: EXP.curta,
      date: SAT,
      resourcesNeeded: 1,
    });
    expect(bloqueado.slots.some((s) => s.label < '12:00')).toBe(false);

    expect((await del(criado.id as number)).status).toBe(200);
    expect(await blackouts()).toHaveLength(0);

    const liberado = await getAvailability({
      experienceId: EXP.curta,
      date: SAT,
      resourcesNeeded: 1,
    });
    expect(liberado.slots.some((s) => s.label < '12:00')).toBe(true);
  });
});
