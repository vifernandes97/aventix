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
import { experiences } from './db/schema';
import { getTenantId } from './tenant';

// ============================================================================
// Tipos
// ============================================================================

/**
 * Modos de pagamento que a API aceita HOJE.
 *
 * O schema (secao 4.3) conhece 'full' e 'deposit', e o sinal e escopo de MVP no
 * CLAUDE.md rev 6 — mas ele depende inteiro da Fase 2 (Asaas), que esta travada
 * nos pre-requisitos do cliente, e da decisao de negocio "lancar com integral ou
 * com sinal?", ainda em aberto. Ate isso resolver, o CRUD trabalha so com
 * 'full': a tela nao oferece a opcao e a API recusa 'deposit' com 422 em vez de
 * gravar uma experiencia que ninguem consegue vender.
 *
 * QUANDO O SINAL ENTRAR: acrescente 'deposit' aqui e exija exatamente um de
 * deposit_percent / deposit_fixed_cents — o CHECK experiences_deposit_mode_check
 * ja cobra isso no banco, e sem a validacao antes ele viraria um 500.
 */
export const ACCEPTED_PAYMENT_MODES = ['full'] as const;
export type AcceptedPaymentMode = (typeof ACCEPTED_PAYMENT_MODES)[number];

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
  priceCents: number;
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
 * SINAL (secao 7.1): quando `paymentMode` for 'deposit', o contrato preve
 * `depositCents` e `balanceCents` JA CALCULADOS aqui — o valor do sinal nunca se
 * calcula no cliente (secao 4.6). Nao existem hoje porque o modo depende do
 * total (preco x resourcesNeeded), que so e conhecido depois do passo 2, e
 * porque nenhuma experiencia pode ser 'deposit' no MVP. Entram na Fase 2, junto
 * com a decisao de negocio sobre o sinal.
 */
export async function listPublicExperiences(): Promise<PublicExperience[]> {
  return db
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
    .orderBy(asc(experiences.durationMinutes), asc(experiences.id));
}

// ============================================================================
// Escrita
// ============================================================================

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
      minPassengerAge: input.minPassengerAge,
      // price_mode fica no default 'per_resource' (unico valor do enum hoje), e
      // deposit_percent / deposit_fixed_cents ficam NULL — que e o que o CHECK
      // experiences_deposit_mode_check exige quando payment_mode = 'full'.
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
  if (patch.paymentMode !== undefined) values.paymentMode = patch.paymentMode;
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
