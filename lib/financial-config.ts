// Aventix — configuracao financeira do tenant (CLAUDE.md secao 4-B.6).
//
// Duas configuracoes DISTINTAS, em duas tabelas, por motivos que valem repetir:
//
//   1. DESCONTO POR METODO  -> afeta o PRECO QUE O CLIENTE PAGA (Pix 7%).
//   2. TAXA DA MAQUININHA   -> afeta QUANTO O TENANT RECEBE. Invisivel ao cliente.
//
// Nao sao a mesma coisa com chaves diferentes: a primeira e POLITICA DE PRECO,
// decidida pelo dono e aplicada na venda; a segunda e FATO DO CONTRATO com a
// adquirente, aplicado no registro e congelado ali (secao 4-B.7). Uma tabela so
// exigiria chave `text` polimorfica (perdendo a garantia do enum) ou colunas
// nulaveis com CHECK XOR no estilo de experiences_deposit_mode_check — as duas
// piores que duas tabelas.
//
// ============================================================================
// >>> ESTA FASE SO FAZ A CONFIGURACAO EXISTIR <<<
// Nada em preco, cobranca, wizard ou reserva le estes valores ainda. Ligar o
// preco ao desconto e Fase A; registrar recebimento de maquininha com liquido
// congelado e Fase D (secao 17). Quem for fazer essas fases: a aritmetica ja
// esta pronta e testada em lib/basis-points.ts — nao escreva outra.
// ============================================================================
//
// SERVER-ONLY pelo mesmo motivo de tenant.ts, experiences.ts e operating-hours.ts.

import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { db } from './db/client';
import { cardMachineModality, cardMachineRates, paymentMethodDiscounts } from './db/schema';
import { getTenantId } from './tenant';

export type PaymentMethodName = 'pix' | 'card';

export type CardMachineModalityName = (typeof cardMachineModality.enumValues)[number];

/** Ordem de exibicao. Nao e alfabetica: e a ordem em que o dono pensa nelas. */
export const CARD_MACHINE_MODALITIES: readonly CardMachineModalityName[] = [
  'debit',
  'credit',
  'credit_installment',
] as const;

/** Metodos que admitem desconto. Fechado pelo enum `payment_method` do schema. */
export const DISCOUNTABLE_METHODS: readonly PaymentMethodName[] = ['pix', 'card'] as const;

export type PaymentDiscountRow = {
  method: PaymentMethodName;
  /** 1 bp = 0,01%. 700 = 7%. */
  discountBasisPoints: number;
  updatedAt: string | null;
};

export type CardMachineRateRow = {
  id: number;
  modality: CardMachineModalityName;
  rateBasisPoints: number;
  updatedAt: string | null;
};

/** `timestamptz` sai do driver como texto cru do Postgres; a API entrega ISO (secao 3). */
const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString());

// ============================================================================
// Descontos por metodo
// ============================================================================

/**
 * Os descontos configurados, SEMPRE com uma entrada por metodo do enum.
 *
 * Metodo sem linha no banco volta com `0` em vez de ausente: a tela precisa
 * desenhar as duas formas de pagamento, e uma chave faltando viraria `undefined`
 * num `.map`. Zero tambem e o valor CORRETO do ponto de vista do negocio —
 * ver getDiscountBasisPoints.
 */
export async function listPaymentDiscounts(): Promise<PaymentDiscountRow[]> {
  const rows = await db
    .select({
      method: paymentMethodDiscounts.method,
      discountBasisPoints: paymentMethodDiscounts.discountBasisPoints,
      updatedAt: paymentMethodDiscounts.updatedAt,
    })
    .from(paymentMethodDiscounts)
    .where(eq(paymentMethodDiscounts.tenantId, getTenantId()));

  const byMethod = new Map(rows.map((r) => [r.method, r]));

  return DISCOUNTABLE_METHODS.map((method) => {
    const row = byMethod.get(method);
    return {
      method,
      discountBasisPoints: row?.discountBasisPoints ?? 0,
      updatedAt: iso(row?.updatedAt ?? null),
    };
  });
}

/**
 * Desconto de UM metodo, em basis points.
 *
 * >>> AUSENTE = 0, E ISSO E FAIL-SAFE, NAO DESCUIDO <<<
 * Configuracao faltando faz o cliente pagar o valor CHEIO. O erro na direcao
 * oposta — assumir um desconto que o dono nunca configurou — daria desconto que
 * ninguem autorizou, em toda venda, sem nada acusar erro. Entre as duas falhas
 * possiveis, esta funcao escolhe a que custa dinheiro a ninguem.
 *
 * Contraste deliberado com a taxa da maquininha, onde ausencia NAO pode virar
 * zero (ver getCardMachineRate).
 */
export async function getDiscountBasisPoints(method: PaymentMethodName): Promise<number> {
  const [row] = await db
    .select({ discountBasisPoints: paymentMethodDiscounts.discountBasisPoints })
    .from(paymentMethodDiscounts)
    .where(
      and(
        eq(paymentMethodDiscounts.tenantId, getTenantId()),
        eq(paymentMethodDiscounts.method, method),
      ),
    );

  return row?.discountBasisPoints ?? 0;
}

/**
 * Grava o desconto do metodo. UPSERT pela chave natural (tenant, metodo).
 *
 * >>> POR QUE UPSERT AQUI, E POST/PUT/DELETE NA MAQUININHA <<<
 * O conjunto de metodos e FECHADO pelo enum e a tela desenha os dois sempre.
 * "Sem linha" e "0 bp" significam a mesma coisa (cliente paga o cheio), entao
 * criar e apagar seriam duas maneiras de dizer o que um unico numero ja diz —
 * e um 409 de "metodo ja cadastrado" seria um obstaculo sobre uma operacao que
 * o dono entende como "mudar o desconto do Pix".
 */
export async function setPaymentDiscount(
  method: PaymentMethodName,
  discountBasisPoints: number,
): Promise<PaymentDiscountRow> {
  const [row] = await db
    .insert(paymentMethodDiscounts)
    .values({ tenantId: getTenantId(), method, discountBasisPoints })
    .onConflictDoUpdate({
      target: [paymentMethodDiscounts.tenantId, paymentMethodDiscounts.method],
      // `now()` do BANCO, nunca `new Date()` do Node. O sistema tem um relogio so
      // de proposito (secao 3 e o veto a vi.useFakeTimers nos testes) — um
      // segundo relogio faria `updated_at` divergir de `created_at` por causa do
      // horario da maquina que rodou o processo, e essa e a coluna que serve
      // para conferir uma taxa antiga contra o extrato.
      set: { discountBasisPoints, updatedAt: sql`now()` },
    })
    .returning({
      method: paymentMethodDiscounts.method,
      discountBasisPoints: paymentMethodDiscounts.discountBasisPoints,
      updatedAt: paymentMethodDiscounts.updatedAt,
    });

  return { ...row, updatedAt: iso(row.updatedAt) };
}

// ============================================================================
// Taxas da maquininha
// ============================================================================

export class CardMachineRateNotFoundError extends Error {
  constructor(public readonly rowId: number) {
    super(`taxa ${rowId} nao encontrada`);
    this.name = 'CardMachineRateNotFoundError';
  }
}

/**
 * Ja existe taxa para essa modalidade.
 *
 * Vira 409, e nao 422, pelo mesmo criterio de `data_ocupada` nas excecoes de
 * agenda: o corpo esta CERTO — o que conflita e o ESTADO. A tela oferece editar
 * a existente em vez de acusar de invalida uma modalidade escolhida corretamente.
 *
 * O 409 tambem evita SOBRESCREVER em silencio um percentual de dinheiro que o
 * dono ja tinha conferido com a adquirente.
 */
export class CardMachineRateDuplicateError extends Error {
  constructor(public readonly conflict: { id: number; modality: CardMachineModalityName }) {
    super(`ja existe taxa para a modalidade ${conflict.modality}`);
    this.name = 'CardMachineRateDuplicateError';
  }
}

/** As taxas cadastradas. Lista VAZIA e o estado inicial esperado — ver o schema. */
export async function listCardMachineRates(): Promise<CardMachineRateRow[]> {
  const rows = await db
    .select({
      id: cardMachineRates.id,
      modality: cardMachineRates.modality,
      rateBasisPoints: cardMachineRates.rateBasisPoints,
      updatedAt: cardMachineRates.updatedAt,
    })
    .from(cardMachineRates)
    .where(eq(cardMachineRates.tenantId, getTenantId()))
    .orderBy(asc(cardMachineRates.id));

  return rows.map((r) => ({ ...r, updatedAt: iso(r.updatedAt) }));
}

/**
 * Taxa de UMA modalidade, ou `null` se nao configurada.
 *
 * >>> `null` NAO E ZERO, E QUEM CHAMAR PRECISA TRATAR OS DOIS <<<
 * A Fase D deve RECUSAR o registro de um recebimento cuja modalidade nao tenha
 * taxa cadastrada. Assumir zero produziria um liquido igual ao bruto — um numero
 * com aparencia de certo, que so seria desmentido na conferencia com o extrato,
 * semanas depois. O tipo de retorno e `| null` exatamente para que o compilador
 * obrigue essa decisao a ser tomada no ponto de uso.
 */
export async function getCardMachineRate(
  modality: CardMachineModalityName,
): Promise<number | null> {
  const [row] = await db
    .select({ rateBasisPoints: cardMachineRates.rateBasisPoints })
    .from(cardMachineRates)
    .where(
      and(eq(cardMachineRates.tenantId, getTenantId()), eq(cardMachineRates.modality, modality)),
    );

  return row?.rateBasisPoints ?? null;
}

/** @throws {CardMachineRateDuplicateError} */
export async function createCardMachineRate(input: {
  modality: CardMachineModalityName;
  rateBasisPoints: number;
}): Promise<CardMachineRateRow> {
  const existing = await findRateByModality(input.modality);
  if (existing) {
    throw new CardMachineRateDuplicateError({ id: existing.id, modality: existing.modality });
  }

  const [row] = await db
    .insert(cardMachineRates)
    .values({
      tenantId: getTenantId(),
      modality: input.modality,
      rateBasisPoints: input.rateBasisPoints,
    })
    .returning({
      id: cardMachineRates.id,
      modality: cardMachineRates.modality,
      rateBasisPoints: cardMachineRates.rateBasisPoints,
      updatedAt: cardMachineRates.updatedAt,
    });

  return { ...row, updatedAt: iso(row.updatedAt) };
}

/**
 * Substitui a taxa inteira (PUT, nao PATCH): modalidade e percentual sao a
 * identidade da linha, e trocar so um dos dois num corpo parcial deixaria o
 * chamador sem saber contra qual modalidade o percentual foi gravado.
 *
 * @throws {CardMachineRateNotFoundError} inexistente ou de outro tenant.
 * @throws {CardMachineRateDuplicateError} outra linha ja tem essa modalidade.
 */
export async function updateCardMachineRate(
  rowId: number,
  input: { modality: CardMachineModalityName; rateBasisPoints: number },
): Promise<CardMachineRateRow> {
  const existing = await findRateByModality(input.modality);
  // `existing.id !== rowId` e o que permite salvar a propria linha sem trocar de
  // modalidade: sem isso, toda edicao de percentual responderia 409 contra si mesma.
  if (existing && existing.id !== rowId) {
    throw new CardMachineRateDuplicateError({ id: existing.id, modality: existing.modality });
  }

  const [row] = await db
    .update(cardMachineRates)
    .set({
      modality: input.modality,
      rateBasisPoints: input.rateBasisPoints,
      updatedAt: sql`now()`, // relogio do BANCO — ver setPaymentDiscount
    })
    .where(and(eq(cardMachineRates.id, rowId), eq(cardMachineRates.tenantId, getTenantId())))
    .returning({
      id: cardMachineRates.id,
      modality: cardMachineRates.modality,
      rateBasisPoints: cardMachineRates.rateBasisPoints,
      updatedAt: cardMachineRates.updatedAt,
    });

  if (!row) throw new CardMachineRateNotFoundError(rowId);
  return { ...row, updatedAt: iso(row.updatedAt) };
}

/**
 * Apaga a taxa, devolvendo a modalidade ao estado "nao configurado".
 *
 * NAO altera recebimento ja registrado: o percentual aplicado e o liquido sao
 * congelados na linha do pagamento (secao 4-B.7). Esta tabela governa so o
 * PROXIMO registro. A tela precisa dizer isso em voz alta.
 *
 * @throws {CardMachineRateNotFoundError} inexistente ou de outro tenant.
 */
export async function deleteCardMachineRate(rowId: number): Promise<void> {
  const [row] = await db
    .delete(cardMachineRates)
    .where(and(eq(cardMachineRates.id, rowId), eq(cardMachineRates.tenantId, getTenantId())))
    .returning({ id: cardMachineRates.id });

  if (!row) throw new CardMachineRateNotFoundError(rowId);
}

async function findRateByModality(modality: CardMachineModalityName) {
  const [row] = await db
    .select({ id: cardMachineRates.id, modality: cardMachineRates.modality })
    .from(cardMachineRates)
    .where(
      and(eq(cardMachineRates.tenantId, getTenantId()), eq(cardMachineRates.modality, modality)),
    );

  return row ?? null;
}
