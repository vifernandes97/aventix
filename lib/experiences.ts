// Aventix — CRUD de experiencias do catalogo (CLAUDE.md secoes 4.3, 4.6 e 7.2).
//
// PRIMEIRO MODULO DE ESCRITA DE CATALOGO. Ate aqui o admin so escrevia
// MOVIMENTO (cancelar reserva, via setReservationStatus). Catalogo era
// territorio exclusivo do seed.
//
// >>> POR QUE EDITAR AQUI E SEGURO (e nao era antes) <<<
// A reserva congela duracao, buffer e preco na venda (migration 0001 e
// reservations.total_price_cents). Editar uma experiencia afeta reservas
// FUTURAS e nada mais: reserva ja vendida guarda os proprios numeros, e a vaga
// que ela ocupa vive em reservation_resources.period, tambem congelado. Antes
// do congelamento, mexer na duracao redesenhava retroativamente o calendario.
//
// >>> NAO EXISTE DELETE, DE PROPOSITO <<<
// reservations.experience_id referencia esta tabela. Apagar uma experiencia
// quebraria o historico — ou seria barrado pela FK, o que da no mesmo para quem
// esta na tela. Desativar (`active = false`) tira a experiencia da venda e
// preserva tudo que ja aconteceu. E reversivel: o dono reativa uma trilha
// sazonal sem recadastrar.
//
// SERVER-ONLY pelo mesmo motivo de tenant.ts e calendar.ts: le e escreve no
// Postgres e resolve o tenant sozinho. O tenant NUNCA vem do cliente.

import 'server-only';

import { and, asc, desc, eq } from 'drizzle-orm';

import { db } from './db/client';
import { type PaymentMethodName, getDiscountBasisPoints } from './financial-config';
import { experiences } from './db/schema';
import { getTenantId } from './tenant';

// ============================================================================
// Tipos
// ============================================================================

/**
 * Modos de pagamento que a API aceita. Destravado na Fase B (28/08).
 *
 * `payment_mode` da EXPERIENCIA define o que e OFERECIDO ao cliente (secao
 * 4-B.4): 'full' oferece so o Pix integral; 'deposit' oferece as duas opcoes
 * lado a lado, e quem escolhe e o cliente no wizard. O que ele escolher vai para
 * `reservations.payment_mode`, que e o modo EFETIVO daquela venda.
 */
export const ACCEPTED_PAYMENT_MODES = ['full', 'deposit'] as const;
export type AcceptedPaymentMode = (typeof ACCEPTED_PAYMENT_MODES)[number];

/**
 * Percentual do sinal, em pontos percentuais inteiros.
 *
 * >>> 50% FIXO, E O CRUD NAO EXPOE O CAMPO. <<<
 * A secao 4-B.2 fixou o sinal em 50% para o produto, enquanto as colunas
 * `deposit_percent` / `deposit_fixed_cents` sao POR EXPERIENCIA — a divergencia
 * que a rev 7 registrou e mandou esta fase resolver.
 *
 * A resolucao separa ESCRITA de LEITURA:
 *   - ESCRITA travada aqui. O dono responde "aceita sinal? sim/nao", nunca
 *     digita um percentual. Expor o campo convidaria a mexer numa regra que a
 *     4-B.2 fechou, e cada experiencia com um percentual diferente e uma conta
 *     diferente para conferir com o extrato.
 *   - LEITURA continua saindo da COLUNA em createReservation. Assim o calculo
 *     tem uma fonte so, e uma experiencia gravada com outro percentual (por
 *     migration, por seed antigo) continuaria honrada em vez de silenciosamente
 *     recalculada.
 *
 * Manter as colunas tambem satisfaz `experiences_deposit_mode_check` sem
 * migration: gravar 'deposit' com os dois NULL seria violacao de CHECK, ou seja,
 * um 500.
 *
 * SE O PERCENTUAL VOLTAR A SER POR EXPERIENCIA: este e o ponto unico a mudar.
 */
export const DEPOSIT_PERCENT = 50;

export type ExperienceRow = {
  id: number;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  priceCents: number;
  paymentMode: 'full' | 'deposit';
  /** idade minima do garupa em anos completos NA DATA DO PASSEIO; 0 = sem minimo */
  minPassengerAge: number;
  active: boolean;
};

export type ExperienceInput = {
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  priceCents: number;
  paymentMode: AcceptedPaymentMode;
  minPassengerAge: number;
};

/** PATCH e parcial: o toggle de active manda `{ active: false }` e nada mais. */
export type ExperiencePatch = Partial<ExperienceInput> & { active?: boolean };

// ============================================================================
// Leitura
// ============================================================================

/**
 * TODAS as experiencias do tenant, ativas e inativas.
 *
 * Inativa nao some da tela (secao 7.2): o dono precisa enxergar a trilha que
 * desativou no inverno para reativa-la na primavera. Uma lista que so mostra
 * ativas transformaria "desativar" em "sumir", e a reativacao viraria
 * recadastro — com id novo, desconectado do historico.
 *
 * Ordem: ativas primeiro, depois as mais curtas. Mesma ordenacao de
 * getActiveExperiences() em lib/calendar.ts, para as duas telas listarem o
 * catalogo na mesma sequencia.
 */
export async function listExperiences(): Promise<ExperienceRow[]> {
  return db
    .select({
      id: experiences.id,
      name: experiences.name,
      durationMinutes: experiences.durationMinutes,
      bufferMinutes: experiences.bufferMinutes,
      priceCents: experiences.priceCents,
      paymentMode: experiences.paymentMode,
      minPassengerAge: experiences.minPassengerAge,
      active: experiences.active,
    })
    .from(experiences)
    .where(eq(experiences.tenantId, getTenantId()))
    .orderBy(desc(experiences.active), asc(experiences.durationMinutes), asc(experiences.id));
}

/**
 * O que o catalogo PUBLICO expoe de uma experiencia (secao 7.1).
 *
 * Deliberadamente menor que ExperienceRow: sem `active` (toda linha daqui e
 * ativa, entao o campo so contaria ao mundo que existe o conceito) e sem os
 * campos de configuracao de sinal.
 */
export type PublicExperience = {
  id: number;
  name: string;
  durationMinutes: number;
  /**
   * >>> O VALOR CHEIO, exatamente como esta em experiences.price_cents. <<<
   *
   * NAO e o que o cliente paga. O que ele paga sai de
   * applyDiscount(priceCents x recursos, discountBasisPoints).
   *
   * O campo mantem o nome E o significado da coluna de propósito: um campo que
   * significa coisa diferente da coluna homonima e a classe de bug que este
   * projeto mais paga. Quem quiser o valor a pagar chama a funcao.
   */
  priceCents: number;
  /**
   * Desconto de CADA metodo, em basis points. Fase E: virou mapa.
   *
   * >>> POR QUE O PERCENTUAL SAI DAQUI, E NAO O PRECO JA CALCULADO <<<
   * O desconto incide sobre o TOTAL (secao 4-B.2), e o total so e conhecido
   * depois que o cliente escolhe quantos recursos quer. Se a API mandasse o
   * preco unitario ja descontado, a tela multiplicaria por N e chegaria a um
   * numero diferente do que o servidor cobra: com preco 33333 e 7%, unitario
   * descontado x2 = 62000, desconto sobre o total = 61999. Um centavo, sempre
   * na direcao de mostrar menos do que a cobranca traz.
   *
   * Mandando o percentual, a tela roda a MESMA applyDiscount do servidor. Uma
   * conta so, nao duas que precisam concordar.
   *
   * `0` quando nao ha desconto configurado — o cliente paga o cheio (secao
   * 4-B.6, default fail-safe). E o caso NORMAL do cartao: ele paga o valor
   * anunciado porque nao tem desconto, JAMAIS porque somamos taxa (secao
   * 4-B.1).
   *
   * >>> O NOME MUDOU JUNTO COM O TIPO, DE PROPOSITO. <<< Era
   * `discountBasisPoints: number` e significava "o desconto do Pix". Trocar o
   * tipo mantendo o nome deixaria todo consumidor antigo compilando com um
   * significado novo — a classe de bug que o comentario de `priceCents` logo
   * acima descreve. Renomear obriga a revisitar cada um.
   */
  discountBasisPointsByMethod: Record<PaymentMethodName, number>;
  paymentMode: 'full' | 'deposit';
  /**
   * Idade minima do garupa. SAI no catalogo publico de proposito: sem ela o
   * wizard nao teria como avisar o cliente ANTES do pagamento, e a recusa so
   * apareceria no POST — depois de ele preencher os seis passos.
   */
  minPassengerAge: number;
};

/**
 * Experiencias ATIVAS, para o formulario de agendamento.
 *
 * `buffer_minutes` NAO sai daqui: e tempo de preparo do tenant entre um passeio
 * e o proximo, nao faz parte do que o cliente compra, e o fim que ele enxerga e
 * `start + duracao` (secao 4.6). Expo-lo faria a tela mostrar um passeio mais
 * longo do que o vendido.
 *
 * SINAL: o contrato da secao 7.1 previa `depositCents`/`balanceCents` prontos
 * aqui. Nao existem e nao vao existir neste payload — eles dependem do TOTAL
 * (preco x recursos), que so e conhecido depois do passo 2. O wizard os obtem
 * rodando a MESMA `splitByBasisPoints` do servidor sobre o total ja com
 * desconto (secao 4-B.5), que e uma funcao pura e compartilhada; nao e conta
 * paralela no cliente.
 */
export async function listPublicExperiences(): Promise<PublicExperience[]> {
  // Uma leitura do desconto para o catalogo inteiro: e configuracao do TENANT,
  // nao da experiencia, entao consultar por linha seria N vezes a mesma resposta.
  const [rows, pix, card] = await Promise.all([
    db
      .select({
        id: experiences.id,
        name: experiences.name,
        durationMinutes: experiences.durationMinutes,
        priceCents: experiences.priceCents,
        paymentMode: experiences.paymentMode,
        minPassengerAge: experiences.minPassengerAge,
      })
      .from(experiences)
      .where(and(eq(experiences.tenantId, getTenantId()), eq(experiences.active, true)))
      .orderBy(asc(experiences.durationMinutes), asc(experiences.id)),
    getDiscountBasisPoints('pix'),
    getDiscountBasisPoints('card'),
  ]);

  return rows.map((row) => ({ ...row, discountBasisPointsByMethod: { pix, card } }));
}

// ============================================================================
// Escrita
// ============================================================================

/**
 * As duas colunas de sinal, coerentes com o modo — o que o CHECK exige.
 *
 * Existe como funcao, e nao inline nos dois lugares, porque create e update
 * precisam gravar a MESMA combinacao: trocar uma experiencia de 'deposit' para
 * 'full' sem zerar `deposit_percent` deixaria a linha violando o CHECK.
 */
function depositColumns(paymentMode: AcceptedPaymentMode) {
  return paymentMode === 'deposit'
    ? { depositPercent: DEPOSIT_PERCENT, depositFixedCents: null }
    : { depositPercent: null, depositFixedCents: null };
}

/** Erro de dominio: a rota traduz em 404 sem precisar conhecer a query. */
export class ExperienceNotFoundError extends Error {
  constructor(public readonly experienceId: number) {
    super(`experiencia ${experienceId} nao encontrada`);
    this.name = 'ExperienceNotFoundError';
  }
}

export async function createExperience(input: ExperienceInput): Promise<ExperienceRow> {
  const [row] = await db
    .insert(experiences)
    .values({
      tenantId: getTenantId(),
      name: input.name,
      durationMinutes: input.durationMinutes,
      bufferMinutes: input.bufferMinutes,
      priceCents: input.priceCents,
      paymentMode: input.paymentMode,
      // O CHECK experiences_deposit_mode_check exige os dois NULL em 'full' e
      // EXATAMENTE UM preenchido em 'deposit'. `deposit_fixed_cents` fica sempre
      // NULL: sinal em valor fixo nao e oferecido pelo produto (secao 4-B.2).
      ...depositColumns(input.paymentMode),
      minPassengerAge: input.minPassengerAge,
      // price_mode fica no default 'per_resource' (unico valor do enum hoje).
      active: true,
    })
    .returning({
      id: experiences.id,
      name: experiences.name,
      durationMinutes: experiences.durationMinutes,
      bufferMinutes: experiences.bufferMinutes,
      priceCents: experiences.priceCents,
      paymentMode: experiences.paymentMode,
      minPassengerAge: experiences.minPassengerAge,
      active: experiences.active,
    });

  return row;
}

/**
 * Edita campos informados. Campo ausente fica como esta.
 *
 * O `WHERE` filtra por tenant junto do id: sem isso, um id de outro tenant
 * seria editavel por quem descobrisse o numero — e os ids desta tabela sao
 * `serial`, ou seja, adivinhaveis por contagem.
 *
 * @throws {ExperienceNotFoundError} id inexistente OU de outro tenant. Os dois
 *         casos sao indistinguiveis de proposito, pelo mesmo motivo do 404
 *         uniforme das rotas de reserva (decisao de 03/08).
 */
export async function updateExperience(
  experienceId: number,
  patch: ExperiencePatch,
): Promise<ExperienceRow> {
  const values: Record<string, unknown> = {};

  if (patch.name !== undefined) values.name = patch.name;
  if (patch.durationMinutes !== undefined) values.durationMinutes = patch.durationMinutes;
  if (patch.bufferMinutes !== undefined) values.bufferMinutes = patch.bufferMinutes;
  if (patch.priceCents !== undefined) values.priceCents = patch.priceCents;
  if (patch.paymentMode !== undefined) {
    values.paymentMode = patch.paymentMode;
    // As colunas de sinal acompanham o modo OBRIGATORIAMENTE. Trocar para 'full'
    // sem zerar deposit_percent deixaria a linha violando
    // experiences_deposit_mode_check — erro do driver, 500 na cara do dono.
    Object.assign(values, depositColumns(patch.paymentMode));
  }
  if (patch.minPassengerAge !== undefined) values.minPassengerAge = patch.minPassengerAge;
  if (patch.active !== undefined) values.active = patch.active;

  // PATCH vazio nao vira UPDATE sem SET (que e erro de sintaxe no Postgres).
  // Devolve o estado atual, que e o resultado correto de "nao mude nada".
  if (Object.keys(values).length === 0) {
    const current = await findExperience(experienceId);
    if (!current) throw new ExperienceNotFoundError(experienceId);
    return current;
  }

  const [row] = await db
    .update(experiences)
    .set(values)
    .where(and(eq(experiences.id, experienceId), eq(experiences.tenantId, getTenantId())))
    .returning({
      id: experiences.id,
      name: experiences.name,
      durationMinutes: experiences.durationMinutes,
      bufferMinutes: experiences.bufferMinutes,
      priceCents: experiences.priceCents,
      paymentMode: experiences.paymentMode,
      minPassengerAge: experiences.minPassengerAge,
      active: experiences.active,
    });

  if (!row) throw new ExperienceNotFoundError(experienceId);
  return row;
}

async function findExperience(experienceId: number): Promise<ExperienceRow | null> {
  const [row] = await db
    .select({
      id: experiences.id,
      name: experiences.name,
      durationMinutes: experiences.durationMinutes,
      bufferMinutes: experiences.bufferMinutes,
      priceCents: experiences.priceCents,
      paymentMode: experiences.paymentMode,
      minPassengerAge: experiences.minPassengerAge,
      active: experiences.active,
    })
    .from(experiences)
    .where(and(eq(experiences.id, experienceId), eq(experiences.tenantId, getTenantId())));

  return row ?? null;
}
