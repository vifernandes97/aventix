// GRUPO S — configuracao financeira do tenant (CLAUDE.md secao 4-B.6 e 4-B.7).
//
// >>> ESTE ARQUIVO MEXE EM DADO QUE NAO E MOVIMENTO <<<
// payment_method_discounts e card_machine_rates nao sao limpas por
// wipeMovement (elas sao CONFIGURACAO, nao movimento). Este arquivo limpa as
// duas por conta propria antes de cada caso e RESTAURA o estado do seed no
// afterAll — sem isso, o desconto de 7% do Quadri Club ficaria com o valor do
// ultimo teste que rodou, no banco de desenvolvimento.
//
// A restauracao NAO pode ser so `seedTenant()`: a insercao do desconto e
// INSERT-ONLY de proposito (e o ponto da secao 4-B.6), entao o seed nao corrige
// um valor divergente. Por isso o afterAll APAGA e so depois semeia.

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  BASIS_POINTS_SCALE,
  applyDiscount,
  applyRate,
  formatBasisPoints,
  parseBasisPoints,
  partOfCents,
  splitByBasisPoints,
} from '@/lib/basis-points';
import { db } from '@/lib/db/client';
import {
  getCardMachineRate,
  getDiscountBasisPoints,
  listCardMachineRates,
  listPaymentDiscounts,
} from '@/lib/financial-config';
import { SEED_PIX_DISCOUNT_BASIS_POINTS, seedTenant } from '@/lib/seed';

import { GET as configRoute } from '@/app/api/admin/financial-config/route';
import { PUT as discountRoute } from '@/app/api/admin/financial-config/discounts/[method]/route';
import { POST as createRateRoute } from '@/app/api/admin/financial-config/card-machine-rates/route';
import {
  DELETE as deleteRateRoute,
  PUT as updateRateRoute,
} from '@/app/api/admin/financial-config/card-machine-rates/[id]/route';

import { TENANT_ID, insertFixtureTenant, removeFixtureTenant } from './helpers/db';

const OTHER_TENANT_ID = 81;

type Corpo = Record<string, unknown>;

// -- chamadas as rotas -------------------------------------------------------

async function putDiscount(method: string, body: unknown) {
  const response = await discountRoute(
    new Request(`http://localhost/api/admin/financial-config/discounts/${method}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ method }) },
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function postRate(body: unknown) {
  const response = await createRateRoute(
    new Request('http://localhost/api/admin/financial-config/card-machine-rates', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function putRate(id: string | number, body: unknown) {
  const response = await updateRateRoute(
    new Request(`http://localhost/api/admin/financial-config/card-machine-rates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function delRate(id: string | number) {
  const response = await deleteRateRoute(
    new Request(`http://localhost/api/admin/financial-config/card-machine-rates/${id}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: (await response.json()) as Corpo };
}

async function wipeConfig() {
  await db.execute(sql`DELETE FROM card_machine_rates`);
  await db.execute(sql`DELETE FROM payment_method_discounts`);
}

beforeEach(wipeConfig);

afterAll(async () => {
  await wipeConfig();
  await removeFixtureTenant(OTHER_TENANT_ID);
  // Devolve o desconto de 7% do Quadri Club. Precisa vir DEPOIS do wipe: o seed
  // e insert-only e nao corrigiria um valor divergente deixado por um teste.
  await seedTenant();
});

// ============================================================================
// Aritmetica — modulo PURO, sem banco (lib/basis-points.ts)
// ============================================================================

describe('S1 aritmetica de basis points', () => {
  it('S1.1 aplica 7% sobre 34999 e chega em 32549, o valor da secao 4-B.2', () => {
    const { discountCents, payableCents } = applyDiscount(34_999, 700);

    // 34999 x 700 / 10000 = 2449,93 -> 2450. Cliente paga R$ 325,49.
    expect(discountCents).toBe(2_450);
    expect(payableCents).toBe(32_549);
  });

  it('S1.2 da o MESMO resultado em execucoes repetidas', () => {
    const results = Array.from({ length: 1_000 }, () => applyDiscount(34_999, 700));

    // Nao ha ponto flutuante na conta, entao nao ha o que divergir entre
    // execucoes, entre maquinas ou entre versoes do motor. O teste existe para
    // que uma reescrita futura que introduza `cents * 0.07` seja pega aqui.
    const distintos = new Set(results.map((r) => `${r.discountCents}/${r.payableCents}`));
    expect(distintos.size).toBe(1);
    expect([...distintos][0]).toBe('2450/32549');
  });

  it('S1.3 confirma a aritmetica da Trilha da Fazenda (249,99 -> 232,49)', () => {
    // Indicio registrado em docs/ESTADO-ATUAL.md: o cliente citou 232,49, que so
    // fecha se o cheio for 249,99 (com 249,00 daria 231,57). O teste NAO decide o
    // preco — ele fixa a aritmetica que sustenta o indicio.
    expect(applyDiscount(24_999, 700).payableCents).toBe(23_249);
    expect(applyDiscount(24_900, 700).payableCents).toBe(23_157);
  });

  it('S1.4 parte + resto fecha o total por construcao, em toda a faixa', () => {
    for (let cents = 0; cents <= 50_000; cents += 7) {
      for (const bp of [0, 1, 250, 700, 3_333, 9_999]) {
        const { part, rest } = splitByBasisPoints(cents, bp);
        // A garantia da secao 4-B.5: o complemento vem de SUBTRACAO, nunca de um
        // segundo calculo independente — que fecharia na maioria dos valores e
        // falharia em alguns.
        expect(part + rest).toBe(cents);
      }
    }
  });

  it('S1.5 taxa da maquininha usa a mesma conta (secao 4-B.7)', () => {
    // R$ 150,00 a 5% -> liquido R$ 142,50, o exemplo literal da secao 4-B.7.
    expect(applyRate(15_000, 500)).toEqual({ feeCents: 750, netCents: 14_250 });
    // E a 6%, o reajuste do mesmo exemplo: R$ 141,00.
    expect(applyRate(15_000, 600)).toEqual({ feeCents: 900, netCents: 14_100 });
  });

  it('S1.6 recusa entrada nao inteira em vez de arredondar em silencio', () => {
    expect(() => partOfCents(100.5, 700)).toThrow(RangeError);
    expect(() => partOfCents(100, 7.5)).toThrow(RangeError);
    expect(() => partOfCents(-100, 700)).toThrow(RangeError);
  });

  it('S1.7 formata e reinterpreta percentual sem passar por float', () => {
    expect(formatBasisPoints(700)).toBe('7');
    expect(formatBasisPoints(349)).toBe('3,49');
    expect(formatBasisPoints(350)).toBe('3,5');
    expect(formatBasisPoints(0)).toBe('0');

    expect(parseBasisPoints('7')).toBe(700);
    expect(parseBasisPoints('7,5')).toBe(750);
    expect(parseBasisPoints('3.49')).toBe(349); // colado de planilha, com ponto
    expect(parseBasisPoints('abc')).toBeNull();
    expect(parseBasisPoints('7,555')).toBeNull(); // tres casas nao existem em bp
    expect(parseBasisPoints('-1')).toBeNull();
  });
});

// ============================================================================
// Desconto por metodo
// ============================================================================

describe('S2 desconto por metodo de pagamento', () => {
  it('S2.1 grava, le de volta e some da lista com o valor certo', async () => {
    const criado = await putDiscount('pix', { descontoBasisPoints: 700 });
    expect(criado.status).toBe(200);

    expect(await getDiscountBasisPoints('pix')).toBe(700);

    const lista = await listPaymentDiscounts();
    expect(lista).toEqual([
      { method: 'pix', discountBasisPoints: 700, updatedAt: expect.any(String) },
      { method: 'card', discountBasisPoints: 0, updatedAt: null },
    ]);
  });

  it('S2.2 metodo sem linha vale ZERO — o cliente paga o cheio (fail-safe)', async () => {
    // A direcao do default importa: assumir desconto que ninguem configurou daria
    // abatimento nao autorizado em toda venda, sem nada acusar erro.
    expect(await getDiscountBasisPoints('pix')).toBe(0);
    expect(await getDiscountBasisPoints('card')).toBe(0);
  });

  it('S2.3 regravar o mesmo metodo ATUALIZA, nunca duplica', async () => {
    await putDiscount('pix', { descontoBasisPoints: 700 });
    await putDiscount('pix', { descontoBasisPoints: 500 });

    expect(await getDiscountBasisPoints('pix')).toBe(500);

    const [{ count }] = (
      await db.execute(sql`SELECT count(*)::int AS count FROM payment_method_discounts`)
    ).rows as { count: number }[];
    expect(count).toBe(1);
  });

  it('S2.4 recusa percentual negativo, acima de 100 e nao inteiro (422)', async () => {
    for (const valor of [-1, -700, BASIS_POINTS_SCALE, BASIS_POINTS_SCALE + 1, 15_000, 7.5]) {
      const resposta = await putDiscount('pix', { descontoBasisPoints: valor });
      expect(resposta.status, `descontoBasisPoints=${valor}`).toBe(422);
      expect(resposta.body.error).toBe('dados invalidos');
    }

    // Nada foi gravado por nenhuma das tentativas.
    expect(await listPaymentDiscounts()).toEqual([
      { method: 'pix', discountBasisPoints: 0, updatedAt: null },
      { method: 'card', discountBasisPoints: 0, updatedAt: null },
    ]);
  });

  it('S2.5 desconto de exatamente 100% e recusado: zeraria a venda', async () => {
    // Total zero violaria `CHECK (amount_cents > 0)` na criacao da cobranca e a
    // venda cairia com 500 (secao 4.6). E por isso que o CHECK do banco tem teto
    // EXCLUSIVO, diferente do da maquininha.
    const resposta = await putDiscount('pix', { descontoBasisPoints: BASIS_POINTS_SCALE });
    expect(resposta.status).toBe(422);

    await expect(
      db.execute(sql`
        INSERT INTO payment_method_discounts (tenant_id, method, discount_basis_points)
        VALUES (${TENANT_ID}, 'pix', ${BASIS_POINTS_SCALE})
      `),
    ).rejects.toThrow(); // o banco tambem recusa, nao so a rota
  });

  it('S2.6 metodo fora do enum e 404 (endereco), nao 422 (corpo)', async () => {
    const resposta = await putDiscount('boleto', { descontoBasisPoints: 700 });
    expect(resposta.status).toBe(404);
  });

  it('S2.7 corpo nao-JSON e 400, distinto do 422 de regra', async () => {
    const response = await discountRoute(
      new Request('http://localhost/api/admin/financial-config/discounts/pix', {
        method: 'PUT',
        body: 'nao sou json',
      }),
      { params: Promise.resolve({ method: 'pix' }) },
    );
    expect(response.status).toBe(400);
  });
});

// ============================================================================
// Taxas da maquininha
// ============================================================================

describe('S3 taxas da maquininha', () => {
  it('S3.1 nasce VAZIA — "nao configurado" e o estado honesto hoje', async () => {
    expect(await listCardMachineRates()).toEqual([]);
    // null, e NAO zero: a Fase D precisa distinguir "sem taxa" de "taxa zero",
    // porque assumir zero produziria liquido igual ao bruto com cara de certo.
    expect(await getCardMachineRate('debit')).toBeNull();
  });

  it('S3.2 cadastra uma taxa por modalidade', async () => {
    const debito = await postRate({ modalidade: 'debit', taxaBasisPoints: 199 });
    expect(debito.status).toBe(201);

    const credito = await postRate({ modalidade: 'credit', taxaBasisPoints: 349 });
    expect(credito.status).toBe(201);

    expect(await getCardMachineRate('debit')).toBe(199);
    expect(await getCardMachineRate('credit')).toBe(349);
    expect(await getCardMachineRate('credit_installment')).toBeNull();
  });

  it('S3.3 modalidade DUPLICADA e 409, nunca sobrescrita silenciosa', async () => {
    const primeira = await postRate({ modalidade: 'credit', taxaBasisPoints: 349 });
    expect(primeira.status).toBe(201);

    const segunda = await postRate({ modalidade: 'credit', taxaBasisPoints: 599 });
    expect(segunda.status).toBe(409);
    expect(segunda.body.code).toBe('modalidade_ocupada');
    // A tela precisa saber QUAL linha conflita para oferecer editar a existente.
    expect(segunda.body.conflict).toMatchObject({ modality: 'credit' });

    // O valor original ficou de pe: 409 nao pode ter gravado nada pelo caminho.
    expect(await getCardMachineRate('credit')).toBe(349);
  });

  it('S3.4 o banco recusa a duplicata mesmo se a rota for contornada', async () => {
    await postRate({ modalidade: 'debit', taxaBasisPoints: 199 });

    // A checagem da rota e conveniencia de mensagem; a garantia e a UNIQUE.
    await expect(
      db.execute(sql`
        INSERT INTO card_machine_rates (tenant_id, modality, rate_basis_points)
        VALUES (${TENANT_ID}, 'debit', 250)
      `),
    ).rejects.toThrow();
  });

  it('S3.5 editar a propria linha sem trocar de modalidade NAO conflita consigo', async () => {
    const criada = await postRate({ modalidade: 'debit', taxaBasisPoints: 199 });
    const id = (criada.body.rate as { id: number }).id;

    const editada = await putRate(id, { modalidade: 'debit', taxaBasisPoints: 210 });
    expect(editada.status).toBe(200);
    expect(await getCardMachineRate('debit')).toBe(210);
  });

  it('S3.6 mover uma linha para modalidade ja ocupada e 409', async () => {
    const debito = await postRate({ modalidade: 'debit', taxaBasisPoints: 199 });
    await postRate({ modalidade: 'credit', taxaBasisPoints: 349 });

    const id = (debito.body.rate as { id: number }).id;
    const movida = await putRate(id, { modalidade: 'credit', taxaBasisPoints: 199 });
    expect(movida.status).toBe(409);

    expect(await getCardMachineRate('debit')).toBe(199);
    expect(await getCardMachineRate('credit')).toBe(349);
  });

  it('S3.7 apagar devolve a modalidade a "nao configurado"', async () => {
    const criada = await postRate({ modalidade: 'debit', taxaBasisPoints: 199 });
    const id = (criada.body.rate as { id: number }).id;

    expect((await delRate(id)).status).toBe(200);
    expect(await getCardMachineRate('debit')).toBeNull();
  });

  it('S3.8 recusa percentual negativo e acima de 100 (422)', async () => {
    for (const valor of [-1, BASIS_POINTS_SCALE + 1, 20_000, 3.49]) {
      const resposta = await postRate({ modalidade: 'debit', taxaBasisPoints: valor });
      expect(resposta.status, `taxaBasisPoints=${valor}`).toBe(422);
    }

    // 100% e ACEITO aqui, ao contrario do desconto: e absurdo comercialmente,
    // mas produz liquido zero sem quebrar nada. O teto so barra digito extra.
    expect((await postRate({ modalidade: 'debit', taxaBasisPoints: BASIS_POINTS_SCALE })).status)
      .toBe(201);

    expect(await listCardMachineRates()).toHaveLength(1);
  });

  it('S3.9 modalidade fora do enum e 422, e id malformado e 404', async () => {
    expect((await postRate({ modalidade: 'pix', taxaBasisPoints: 199 })).status).toBe(422);
    expect((await putRate('abc', { modalidade: 'debit', taxaBasisPoints: 199 })).status).toBe(404);
    expect((await delRate('abc')).status).toBe(404);
    expect((await delRate(999_999)).status).toBe(404);
  });
});

// ============================================================================
// Isolamento entre tenants
// ============================================================================

describe('S4 a configuracao de um tenant nao vaza para outro', () => {
  it('S4.1 nao LE a configuracao do vizinho', async () => {
    await insertFixtureTenant(OTHER_TENANT_ID, 's');

    // Configuracao inteira do vizinho, escrita direto no banco: getTenantId()
    // devolve 1 fixo (Etapa 2 pendente), entao as rotas nao conseguiriam grava-la.
    await db.execute(sql`
      INSERT INTO payment_method_discounts (tenant_id, method, discount_basis_points)
      VALUES (${OTHER_TENANT_ID}, 'pix', 1500), (${OTHER_TENANT_ID}, 'card', 300)
    `);
    await db.execute(sql`
      INSERT INTO card_machine_rates (tenant_id, modality, rate_basis_points)
      VALUES (${OTHER_TENANT_ID}, 'debit', 999), (${OTHER_TENANT_ID}, 'credit', 888)
    `);

    // O tenant 1 continua enxergando a PROPRIA configuracao — vazia.
    expect(await getDiscountBasisPoints('pix')).toBe(0);
    expect(await getCardMachineRate('debit')).toBeNull();
    expect(await listCardMachineRates()).toEqual([]);
    expect(await listPaymentDiscounts()).toEqual([
      { method: 'pix', discountBasisPoints: 0, updatedAt: null },
      { method: 'card', discountBasisPoints: 0, updatedAt: null },
    ]);

    const config = await configRoute();
    const corpo = (await config.json()) as { discounts: unknown[]; cardMachineRates: unknown[] };
    expect(corpo.cardMachineRates).toEqual([]);
    expect(corpo.discounts).toEqual([
      { method: 'pix', discountBasisPoints: 0, updatedAt: null },
      { method: 'card', discountBasisPoints: 0, updatedAt: null },
    ]);
  });

  it('S4.2 nao ESCREVE por cima da configuracao do vizinho', async () => {
    await insertFixtureTenant(OTHER_TENANT_ID, 's');
    await db.execute(sql`
      INSERT INTO payment_method_discounts (tenant_id, method, discount_basis_points)
      VALUES (${OTHER_TENANT_ID}, 'pix', 1500)
    `);
    await db.execute(sql`
      INSERT INTO card_machine_rates (tenant_id, modality, rate_basis_points)
      VALUES (${OTHER_TENANT_ID}, 'debit', 999)
    `);

    // A mesma chave natural (metodo 'pix', modalidade 'debit') no tenant 1: se o
    // filtro por tenant faltasse em qualquer ponto, o upsert e o 409 de duplicata
    // atingiriam a linha do vizinho.
    expect((await putDiscount('pix', { descontoBasisPoints: 700 })).status).toBe(200);
    expect((await postRate({ modalidade: 'debit', taxaBasisPoints: 199 })).status).toBe(201);

    const vizinho = (
      await db.execute(sql`
        SELECT
          (SELECT discount_basis_points FROM payment_method_discounts
            WHERE tenant_id = ${OTHER_TENANT_ID} AND method = 'pix') AS desconto,
          (SELECT rate_basis_points FROM card_machine_rates
            WHERE tenant_id = ${OTHER_TENANT_ID} AND modality = 'debit') AS taxa
      `)
    ).rows[0] as { desconto: number; taxa: number };

    expect(vizinho.desconto).toBe(1_500);
    expect(vizinho.taxa).toBe(999);

    // E o tenant 1 gravou a propria.
    expect(await getDiscountBasisPoints('pix')).toBe(700);
    expect(await getCardMachineRate('debit')).toBe(199);
  });
});

// ============================================================================
// A promessa da secao 4-B.6: o seed NAO come a configuracao do dono
// ============================================================================

describe('S5 o seed nao sobrescreve a configuracao financeira', () => {
  it('S5.1 semeia o desconto inicial quando nao existe', async () => {
    await seedTenant();
    expect(await getDiscountBasisPoints('pix')).toBe(SEED_PIX_DISCOUNT_BASIS_POINTS);
  });

  it('S5.2 NAO desfaz o valor que o dono configurou — a razao de nao morar em settings', async () => {
    await seedTenant();
    // O dono renegocia com o Asaas e baixa o desconto para 5%.
    await putDiscount('pix', { descontoBasisPoints: 500 });

    // Alguem roda o seed por outro motivo (deploy, catalogo novo, a futura rota
    // POST /api/admin/seed). Em `settings` isso devolveria o valor ao do template,
    // sem erro e sem log (secao 19). Aqui a insercao e INSERT-ONLY.
    await seedTenant();
    await seedTenant();

    expect(await getDiscountBasisPoints('pix')).toBe(500);
  });

  it('S5.3 nao semeia taxa de maquininha: os percentuais reais nao chegaram', async () => {
    await seedTenant();
    // Taxa chutada vira numero errado com aparencia de certo, desmentido so na
    // conferencia com o extrato. Vazio e o estado correto ate o cliente informar.
    expect(await listCardMachineRates()).toEqual([]);
  });
});
