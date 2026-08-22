// GRUPO M — CRUD da grade semanal (CLAUDE.md secoes 4.3 e 6).
//
// >>> ESTE ARQUIVO MEXE NO CATALOGO SEMEADO <<<
// operating_hours faz parte do catalogo, que a suite trata como PRE-CONDICAO e
// nunca apaga (ver tests/helpers/db.ts). Estes testes precisam escrever nele, e
// por isso restauram o estado do seed no afterAll — sem isso, o grupo C
// (disponibilidade) rodaria contra uma grade diferente da que ele espera, e
// falharia num arquivo que ninguem tocou.

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { seedTenant } from '@/lib/seed';

import { GET as listRoute, POST as createRoute } from '@/app/api/admin/operating-hours/route';
import {
  DELETE as deleteRoute,
  PUT as putRoute,
} from '@/app/api/admin/operating-hours/[id]/route';

import { EXP, assertCatalogSeeded, nextSaturday, nextTuesday, wipeMovement } from './helpers/db';

const SAT = nextSaturday();
const TUE = nextTuesday();
const SATURDAY = 6;
const TUESDAY = 2;
const OTHER_TENANT_ID = 80;

type Corpo = Record<string, unknown>;

async function post(body: unknown) {
  const response = await createRoute(
    new Request('http://localhost/api/admin/operating-hours', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function put(id: string | number, body: unknown) {
  const response = await putRoute(
    new Request(`http://localhost/api/admin/operating-hours/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function del(id: string | number) {
  const response = await deleteRoute(
    new Request(`http://localhost/api/admin/operating-hours/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function hours() {
  return ((await (await listRoute()).json()) as { hours: Corpo[] }).hours;
}

const camposComErro = (body: Corpo) =>
  ((body.fields ?? []) as { param: string }[]).map((f) => f.param);

/**
 * Devolve operating_hours ao estado do seed.
 *
 * `seedTenant` reconcilia por (weekday, opens, closes) e nunca apaga, entao
 * apagar primeiro o que este arquivo criou e chamar o seed em seguida restaura
 * exatamente a grade original.
 */
async function restaurarGradeDoSeed() {
  await db.execute(sql`DELETE FROM operating_hours WHERE tenant_id = 1`);
  await seedTenant();
}

beforeAll(async () => {
  await assertCatalogSeeded();
  await wipeMovement();
  await db.execute(sql`
    INSERT INTO tenants (id, name) VALUES (${OTHER_TENANT_ID}, 'Tenant Vizinho M')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterEach(restaurarGradeDoSeed);

afterAll(async () => {
  await restaurarGradeDoSeed();
  await db.execute(sql`DELETE FROM tenants WHERE id = ${OTHER_TENANT_ID}`);
});

describe('M — grade semanal: escrita', () => {
  it('75. cria faixa num dia sem grade e devolve HH:MM sem os segundos', async () => {
    const { status, body } = await post({ diaDaSemana: TUESDAY, abre: '09:00', fecha: '17:00' });

    expect(status).toBe(201);
    const faixa = body.range as Corpo;
    expect(faixa.weekday).toBe(TUESDAY);
    // Sem o corte, '09:00:00' volta ao <input type="time"> da tela e e
    // descartado em silencio, esvaziando o campo.
    expect(faixa.opens).toBe('09:00');
    expect(faixa.closes).toBe('17:00');
  });

  it('76. aceita DUAS faixas no mesmo dia (manha e tarde)', async () => {
    // O caso de uso mais comum da tabela: intervalo de almoco no meio.
    expect((await post({ diaDaSemana: TUESDAY, abre: '08:00', fecha: '12:00' })).status).toBe(201);
    expect((await post({ diaDaSemana: TUESDAY, abre: '14:00', fecha: '18:00' })).status).toBe(201);

    const doDia = (await hours()).filter((h) => h.weekday === TUESDAY);
    expect(doDia).toHaveLength(2);
  });

  it('77. faixas que APENAS ENCOSTAM convivem: 08:00-12:00 e 12:00-18:00', async () => {
    // Encostar nao e sobrepor. Recusar isto inviabilizaria manha+tarde sem
    // intervalo, que e cadastro legitimo.
    expect((await post({ diaDaSemana: TUESDAY, abre: '08:00', fecha: '12:00' })).status).toBe(201);
    expect((await post({ diaDaSemana: TUESDAY, abre: '12:00', fecha: '18:00' })).status).toBe(201);
  });

  it('78. faixa SOBREPOSTA no mesmo dia responde 409 dizendo qual conflita', async () => {
    // =====================================================================
    // A DIVIDA QUE ESTE CRUD FOI CHAMADO PARA PAGAR.
    // O schema nao impede faixas cruzadas, e lib/availability.ts se defende
    // delas deduplicando candidatos — com um comentario dizendo que "o certo e
    // o CRUD de horarios recusar no cadastro". E aqui.
    // =====================================================================
    await post({ diaDaSemana: TUESDAY, abre: '08:00', fecha: '12:00' });

    const { status, body } = await post({ diaDaSemana: TUESDAY, abre: '10:00', fecha: '14:00' });

    expect(status).toBe(409);
    expect(body.code).toBe('faixa_sobreposta');
    // A tela precisa dizer QUAL faixa atrapalha, nao so que algo atrapalha.
    expect(body.conflict).toEqual({ opens: '08:00', closes: '12:00' });

    expect((await hours()).filter((h) => h.weekday === TUESDAY)).toHaveLength(1);
  });

  it('79. sobreposicao e por DIA DA SEMANA: o mesmo horario noutro dia passa', async () => {
    await post({ diaDaSemana: TUESDAY, abre: '08:00', fecha: '12:00' });
    // Quarta com o mesmo horario nao conflita com terca.
    expect((await post({ diaDaSemana: 3, abre: '08:00', fecha: '12:00' })).status).toBe(201);
  });

  it('80. fecha <= abre e weekday fora de 0..6 respondem 422', async () => {
    const fora = await post({ diaDaSemana: TUESDAY, abre: '18:00', fecha: '09:00' });
    expect(fora.status).toBe(422);
    expect(camposComErro(fora.body)).toContain('fecha');

    for (const dia of [-1, 7, 1.5]) {
      const { status } = await post({ diaDaSemana: dia, abre: '09:00', fecha: '17:00' });
      expect(status, `dia ${dia}`).toBe(422);
    }
  });

  it('81. corpo nao-JSON responde 400, nao 422', async () => {
    const response = await createRoute(
      new Request('http://localhost/api/admin/operating-hours', {
        method: 'POST',
        body: 'nao e json',
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('M — grade semanal: edicao e remocao', () => {
  it('82. PUT edita a propria faixa sem acusar sobreposicao consigo mesma', async () => {
    // Sem excluir a propria linha da checagem, TODA edicao responderia 409.
    const criada = (await post({ diaDaSemana: TUESDAY, abre: '08:00', fecha: '12:00' })).body
      .range as Corpo;

    const { status, body } = await put(criada.id as number, {
      diaDaSemana: TUESDAY,
      abre: '08:00',
      fecha: '13:00',
    });

    expect(status).toBe(200);
    expect((body.range as Corpo).closes).toBe('13:00');
  });

  it('83. PUT que cruza OUTRA faixa responde 409', async () => {
    await post({ diaDaSemana: TUESDAY, abre: '08:00', fecha: '12:00' });
    const segunda = (await post({ diaDaSemana: TUESDAY, abre: '14:00', fecha: '18:00' })).body
      .range as Corpo;

    const { status } = await put(segunda.id as number, {
      diaDaSemana: TUESDAY,
      abre: '11:00',
      fecha: '18:00',
    });

    expect(status).toBe(409);
  });

  it('84. inexistente, id malformado e faixa de OUTRO tenant respondem 404', async () => {
    const corpo = { diaDaSemana: TUESDAY, abre: '09:00', fecha: '17:00' };

    expect((await put(999_999, corpo)).status).toBe(404);
    expect((await del(999_999)).status).toBe(404);
    expect((await put('abc', corpo)).status).toBe(404);
    expect((await del('abc')).status).toBe(404);

    const alheia = (await post({ diaDaSemana: TUESDAY, abre: '09:00', fecha: '17:00' })).body
      .range as Corpo;
    await db.execute(sql`
      UPDATE operating_hours SET tenant_id = ${OTHER_TENANT_ID} WHERE id = ${alheia.id as number}
    `);
    expect((await put(alheia.id as number, corpo)).status).toBe(404);
    expect((await del(alheia.id as number)).status).toBe(404);

    // Limpa a linha empurrada para o outro tenant (o restaurarGradeDoSeed do
    // afterEach so apaga as do tenant 1).
    await db.execute(sql`DELETE FROM operating_hours WHERE tenant_id = ${OTHER_TENANT_ID}`);
  });
});

describe('M — a grade muda a VENDA (atravessa o motor real)', () => {
  it('85. criar faixa numa terca faz o dia passar a vender', async () => {
    const antes = await getAvailability({ experienceId: EXP.curta, date: TUE, resourcesNeeded: 1 });
    expect(antes.dayState).toBe('closed_weekday');

    await post({ diaDaSemana: TUESDAY, abre: '09:00', fecha: '13:00' });

    const depois = await getAvailability({ experienceId: EXP.curta, date: TUE, resourcesNeeded: 1 });
    expect(depois.dayState).toBe('open');
    expect(depois.slots.length).toBeGreaterThan(0);
    expect(depois.slots[0].label).toBe('09:00');
  });

  it('86. apagar a ultima faixa do sabado tira o dia da venda, SEM tocar em reserva', async () => {
    // ====================================================================
    // O AVISO DA TELA, PROVADO NO BANCO.
    // O dono apaga o sabado esperando "cancelar os passeios de sabado". Nao e
    // isso que acontece: a reserva ja vendida continua de pe, porque a vaga
    // dela vive em reservation_resources.period, congelado na venda (secao
    // 4.6). A grade governa so o que ainda PODE SER VENDIDO.
    // ====================================================================
    const { createReservation } = await import('@/lib/reservations');
    const { reservationInput } = await import('./helpers/db');

    const { slots } = await getAvailability({
      experienceId: EXP.curta,
      date: SAT,
      resourcesNeeded: 1,
    });
    const { reservationId } = await createReservation(
      reservationInput({ experienceId: EXP.curta, startAt: slots[0]!.startAt, resourcesNeeded: 1 }),
    );

    for (const faixa of (await hours()).filter((h) => h.weekday === SATURDAY)) {
      expect((await del(faixa.id as number)).status).toBe(200);
    }

    const depois = await getAvailability({ experienceId: EXP.curta, date: SAT, resourcesNeeded: 1 });
    expect(depois.dayState).toBe('closed_weekday');
    expect(depois.slots).toHaveLength(0);

    const { rows } = await db.execute<{ status: string; alocacoes: number }>(sql`
      SELECT r.status::text AS status,
             (SELECT count(*)::int FROM reservation_resources rr
               WHERE rr.reservation_id = r.id) AS alocacoes
      FROM reservations r WHERE r.id = ${reservationId}::uuid
    `);
    expect(rows[0].status).toBe('pending_payment');
    expect(rows[0].alocacoes).toBe(1);

    await wipeMovement();
  });
});
