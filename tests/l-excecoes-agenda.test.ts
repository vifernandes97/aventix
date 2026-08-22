// GRUPO L — CRUD de excecoes de agenda (CLAUDE.md secoes 6 e 7.2).
//
// Testa os HANDLERS das rotas, nao so a lib: 404 x 409 x 422 e a forma do corpo
// sao decisoes da borda HTTP e sumiriam num teste de lib.
//
// >>> O TESTE QUE MAIS IMPORTA E O 71 <<<
// Ele nao verifica a rota: verifica que a excecao MUDA A VENDA, atravessando o
// motor de disponibilidade real. Um CRUD que grava lindamente linhas que o
// motor ignora e pior que CRUD nenhum — o dono cadastra o feriado, acredita que
// abriu, e descobre no dia que nao vendeu nada.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { createReservation } from '@/lib/reservations';
import { todayLocalDate } from '@/lib/time';

import { GET as listRoute, POST as createRoute } from '@/app/api/admin/schedule-exceptions/route';
import {
  DELETE as deleteRoute,
  PUT as putRoute,
} from '@/app/api/admin/schedule-exceptions/[id]/route';

import {
  EXP,
  assertCatalogSeeded,
  nextSaturday,
  nextTuesday,
  reservationInput,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();
const TUE = nextTuesday();
const OTHER_TENANT_ID = 79;

type Corpo = Record<string, unknown>;

async function post(body: unknown) {
  const response = await createRoute(
    new Request('http://localhost/api/admin/schedule-exceptions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function put(id: string | number, body: unknown) {
  const response = await putRoute(
    new Request(`http://localhost/api/admin/schedule-exceptions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function del(id: string | number) {
  const response = await deleteRoute(
    new Request(`http://localhost/api/admin/schedule-exceptions/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function list() {
  const response = await listRoute();
  return (await response.json()) as { exceptions: Corpo[] };
}

/** Campos reprovados numa resposta 422, para assercao legivel. */
const camposComErro = (body: Corpo) =>
  ((body.fields ?? []) as { param: string }[]).map((f) => f.param);

beforeAll(async () => {
  await assertCatalogSeeded();
  await db.execute(sql`
    INSERT INTO tenants (id, name) VALUES (${OTHER_TENANT_ID}, 'Tenant Vizinho L')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await wipeMovement();
  await db.execute(sql`DELETE FROM tenants WHERE id = ${OTHER_TENANT_ID}`);
});

// wipeMovement ja zera schedule_exceptions: o seed as deixa vazias, entao
// limpar restaura exatamente o estado semeado.
beforeEach(wipeMovement);

describe('L — excecoes de agenda: escrita', () => {
  it('61. cria dia FECHADO sem horario (recesso)', async () => {
    const { status, body } = await post({ data: SAT, fechado: true, motivo: 'Recesso' });

    expect(status).toBe(201);
    const excecao = body.exception as Corpo;
    expect(excecao.date).toBe(SAT);
    expect(excecao.closed).toBe(true);
    // Dia fechado grava NULL nos dois: guardar horario numa data fechada seria
    // dado que contradiz a propria linha e ressuscitaria se alguem so virasse o
    // `closed` depois.
    expect(excecao.opens).toBeNull();
    expect(excecao.closes).toBeNull();
    expect(excecao.reason).toBe('Recesso');
  });

  it('62. cria dia ABERTO e devolve o horario em HH:MM, sem os segundos do Postgres', async () => {
    const { status, body } = await post({
      data: TUE,
      fechado: false,
      abre: '09:00',
      fecha: '17:00',
      motivo: 'Feriado - abre',
    });

    expect(status).toBe(201);
    const excecao = body.exception as Corpo;
    expect(excecao.closed).toBe(false);
    // A coluna e `time` e o driver devolve '09:00:00'. Sem o corte, o valor
    // volta ao <input type="time"> da tela, que o rejeita em silencio e deixa o
    // campo vazio — o dono salva de novo e perde o horario.
    expect(excecao.opens).toBe('09:00');
    expect(excecao.closes).toBe('17:00');
  });

  it('63. segunda excecao para a MESMA data responde 409, nao 422 nem 500', async () => {
    await post({ data: SAT, fechado: true, motivo: 'Primeira' });

    const { status, body } = await post({ data: SAT, fechado: true, motivo: 'Segunda' });

    // 409 porque o corpo esta certo e o que conflita e o ESTADO. A tela usa o
    // codigo para oferecer editar a linha existente em vez de acusar de
    // invalida uma data que o dono digitou corretamente.
    expect(status).toBe(409);
    expect(body.code).toBe('data_ocupada');
    expect(body.date).toBe(SAT);

    // E nao gravou a segunda.
    expect((await list()).exceptions).toHaveLength(1);
  });

  it('64. dia aberto SEM horario responde 422 nomeando os dois campos', async () => {
    const { status, body } = await post({ data: SAT, fechado: false });

    // Sem esta validacao o CHECK schedule_exceptions_closed_check recusaria no
    // banco, e violacao de CHECK chega como erro do driver: 500 numa tela em que
    // o dono so esqueceu de preencher dois campos.
    expect(status).toBe(422);
    expect(camposComErro(body)).toEqual(expect.arrayContaining(['abre', 'fecha']));
  });

  it('65. fechamento anterior ou igual a abertura responde 422', async () => {
    for (const [abre, fecha] of [
      ['17:00', '09:00'],
      ['09:00', '09:00'],
    ]) {
      const { status, body } = await post({ data: SAT, fechado: false, abre, fecha });
      expect(status, `${abre}-${fecha}`).toBe(422);
      expect(camposComErro(body)).toContain('fecha');
    }
  });

  it('66. data que nao existe no calendario responde 422, nunca 500', async () => {
    // '2026-02-31' passa na regex e o Postgres ABORTA com 22008. O helper
    // isValidCalendarDate (o mesmo do motor de disponibilidade) e quem barra.
    for (const data of ['2026-02-31', '2027-13-01', '2027-00-10', 'ontem']) {
      const { status } = await post({ data, fechado: true });
      expect(status, `data ${data}`).toBe(422);
    }
  });

  it('67. data no passado responde 422; HOJE e aceito', async () => {
    // Excecao em data passada nao muda nada (a grade so oferece horario
    // futuro), entao aceitar em silencio faria o dono crer que resolveu algo.
    const { status: passado } = await post({ data: '2020-01-01', fechado: true });
    expect(passado).toBe(422);

    // Mudar a grade do dia corrente e uso legitimo — e `todayLocalDate` usa o
    // fuso do tenant, nao UTC: as 21h de Brasilia ja e amanha em UTC, e a regra
    // recusaria o dia seguinte por engano.
    const { status: hoje } = await post({ data: todayLocalDate(), fechado: true });
    expect(hoje).toBe(201);
  });

  it('68. corpo nao-JSON responde 400, nao 422', async () => {
    const response = await createRoute(
      new Request('http://localhost/api/admin/schedule-exceptions', {
        method: 'POST',
        body: 'isto nao e json',
      }),
    );
    // 400 = "nao entendi o pedido"; 422 = "entendi e ele nao vale". Mesma
    // distincao do CRUD de experiencias.
    expect(response.status).toBe(400);
  });
});

describe('L — excecoes de agenda: edicao e remocao', () => {
  it('69. PUT substitui a linha inteira, inclusive virando fechado em aberto', async () => {
    const criada = (await post({ data: SAT, fechado: true, motivo: 'Recesso' })).body
      .exception as Corpo;

    const { status, body } = await put(criada.id as number, {
      data: SAT,
      fechado: false,
      abre: '10:00',
      fecha: '16:00',
      motivo: 'Mudou de ideia',
    });

    expect(status).toBe(200);
    const excecao = body.exception as Corpo;
    expect(excecao.closed).toBe(false);
    expect(excecao.opens).toBe('10:00');
    expect(excecao.reason).toBe('Mudou de ideia');
    // Mesma linha, nao uma nova.
    expect(excecao.id).toBe(criada.id);
    expect((await list()).exceptions).toHaveLength(1);
  });

  it('70. inexistente, id malformado e excecao de OUTRO tenant respondem 404 nos dois verbos', async () => {
    const corpoValido = { data: SAT, fechado: true };

    expect((await put(999_999, corpoValido)).status).toBe(404);
    expect((await del(999_999)).status).toBe(404);

    // Id nao numerico: sem a guarda, `WHERE id = 'abc'` aborta com 22P02 e vira
    // 500. Um id digitado errado nao e erro de servidor.
    expect((await put('abc', corpoValido)).status).toBe(404);
    expect((await del('abc')).status).toBe(404);

    // Outro tenant: 404 e nao 403 — 403 confirmaria a existencia do id para
    // quem esta sondando, e `serial` e adivinhavel por contagem.
    const alheia = (await post({ data: SAT, fechado: true })).body.exception as Corpo;
    await db.execute(sql`
      UPDATE schedule_exceptions SET tenant_id = ${OTHER_TENANT_ID} WHERE id = ${alheia.id as number}
    `);
    expect((await put(alheia.id as number, corpoValido)).status).toBe(404);
    expect((await del(alheia.id as number)).status).toBe(404);
  });

  it('71. DELETE apaga de verdade e o segundo DELETE responde 404', async () => {
    const criada = (await post({ data: SAT, fechado: true })).body.exception as Corpo;

    expect((await del(criada.id as number)).status).toBe(200);
    expect((await list()).exceptions).toHaveLength(0);
    expect((await del(criada.id as number)).status).toBe(404);
  });
});

describe('L — a excecao muda a VENDA (atravessa o motor real)', () => {
  it('72. excecao FECHADA zera a grade de um dia que normalmente opera', async () => {
    // Sabado tem 08:00-18:00 no seed: antes, o dia vende.
    const antes = await getAvailability({ experienceId: EXP.curta, date: SAT, resourcesNeeded: 1 });
    expect(antes.dayState).toBe('open');
    expect(antes.slots.length).toBeGreaterThan(0);

    await post({ data: SAT, fechado: true, motivo: 'Recesso' });

    const depois = await getAvailability({ experienceId: EXP.curta, date: SAT, resourcesNeeded: 1 });
    expect(depois.slots).toHaveLength(0);
    // 'closed_exception', nao 'closed_weekday': a tela precisa distinguir "o
    // dono fechou este dia" de "o tenant nunca opera nesse dia da semana".
    expect(depois.dayState).toBe('closed_exception');
  });

  it('73. excecao ABERTA faz vender numa terca, em que o tenant nao opera', async () => {
    // ====================================================================
    // ESTE E O CASO DE USO QUE MOTIVOU A TABELA: feriado numa terca.
    // Comprova a PRECEDENCIA da secao 6 ponta a ponta — a excecao ignora o
    // operating_hours do weekday, que aqui simplesmente nao existe.
    // ====================================================================
    const antes = await getAvailability({ experienceId: EXP.curta, date: TUE, resourcesNeeded: 1 });
    expect(antes.dayState).toBe('closed_weekday');
    expect(antes.slots).toHaveLength(0);

    await post({ data: TUE, fechado: false, abre: '09:00', fecha: '13:00', motivo: 'Feriado' });

    const depois = await getAvailability({ experienceId: EXP.curta, date: TUE, resourcesNeeded: 1 });
    expect(depois.dayState).toBe('open');
    expect(depois.slots.length).toBeGreaterThan(0);

    // A janela e a DA EXCECAO, nao a do sabado (08:00-18:00). O ultimo slot
    // respeita `T + duracao <= fecha`.
    const horarios = depois.slots.map((s) => s.label);
    expect(horarios[0]).toBe('09:00');
    expect(horarios.every((h) => h >= '09:00' && h <= '13:00')).toBe(true);
  });

  it('74. apagar a excecao NAO cancela reserva ja vendida naquele dia', async () => {
    // ====================================================================
    // O AVISO QUE A TELA PRECISA DAR, PROVADO NO BANCO.
    // O dono abre uma terca por excecao, vende, e depois apaga a excecao. A
    // reserva CONTINUA DE PE: a vaga dela vive em reservation_resources.period,
    // congelado na venda (secao 4.6), e a grade governa so o que ainda pode ser
    // vendido. Sem este teste, alguem "consertaria" o CRUD para cascatear.
    // ====================================================================
    const criada = (
      await post({ data: TUE, fechado: false, abre: '09:00', fecha: '13:00' })
    ).body.exception as Corpo;

    const { slots } = await getAvailability({
      experienceId: EXP.curta,
      date: TUE,
      resourcesNeeded: 1,
    });
    const { reservationId } = await createReservation(
      reservationInput({ experienceId: EXP.curta, startAt: slots[0]!.startAt, resourcesNeeded: 1 }),
    );

    expect((await del(criada.id as number)).status).toBe(200);

    // A reserva segue viva, com a alocacao intacta.
    const { rows } = await db.execute<{ status: string; alocacoes: number }>(sql`
      SELECT r.status::text AS status,
             (SELECT count(*)::int FROM reservation_resources rr
               WHERE rr.reservation_id = r.id) AS alocacoes
      FROM reservations r WHERE r.id = ${reservationId}::uuid
    `);
    expect(rows[0].status).toBe('pending_payment');
    expect(rows[0].alocacoes).toBe(1);

    // E o dia voltou a nao vender, porque terca nao tem operating_hours.
    const depois = await getAvailability({
      experienceId: EXP.curta,
      date: TUE,
      resourcesNeeded: 1,
    });
    expect(depois.dayState).toBe('closed_weekday');
  });
});
