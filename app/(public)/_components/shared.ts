// Pecas compartilhadas pelo formulario publico de agendamento.
//
// Pasta `_components`: o underscore a torna privada no App Router — nao vira
// rota, mesmo dentro do route group (public).

import { applyDiscount } from '@/lib/basis-points';
import type { PublicExperience } from '@/lib/experiences';
import type { PaymentMethodName } from '@/lib/financial-config';
import type { SettingKey } from '@/lib/tenant';

// ============================================================================
// Rotulos do tenant
// ============================================================================
//
// TODO o texto de papel, documento e recurso vem de settings (secao 3 e 11-B),
// nunca hardcoded. O Quadri Club le "Quadriciclo / Condutor / Garupa / CNH"; o
// proximo tenant pode ler "Bote / Guia / Passageiro / RG" sem tocar em codigo.
//
// Resolvidos no Server Component e passados como prop: lib/tenant.ts e
// server-only e o wizard e Client Component.

export type PublicLabels = Pick<
  Record<SettingKey, string>,
  | 'business_name'
  | 'resource_label'
  | 'resource_label_plural'
  | 'operator_label'
  | 'passenger_label'
  | 'operator_document_label'
  | 'meeting_point'
  | 'what_to_bring'
>;

/** Plural do rotulo de PAPEL, que settings guarda so no singular. */
export function pluralizeRole(label: string): string {
  const trimmed = label.trim();
  // 'Condutor' -> 'Condutores'; 'Garupa' -> 'Garupas'. Regra do portugues para
  // as terminacoes que aparecem em rotulo de papel; qualquer outra so ganha 's'.
  if (/r$|z$|s$/i.test(trimmed)) return `${trimmed}es`;
  if (/l$/i.test(trimmed)) return `${trimmed.slice(0, -1)}is`;
  return `${trimmed}s`;
}

// ============================================================================
// Formatacao
// ============================================================================

/**
 * Centavos (inteiro, secao 3) -> 'R$ 325,49'.
 *
 * A divisao por 100 acontece SO AQUI, na borda de exibicao — mesma regra do
 * moneyLabel do admin. Nenhum valor formatado volta para calculo.
 */
const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moneyLabel = (cents: number) => MONEY.format(cents / 100);

/** 90 -> '1h30' | 60 -> '1h' | 45 -> '45min' | 150 -> '2h30'. */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}min`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${String(rest).padStart(2, '0')}`;
}

/**
 * O que o cliente PAGA: (valor cheio x recursos) menos o desconto do metodo.
 *
 * price_mode e 'per_resource' (unico valor do enum hoje, secao 4.1). O servidor
 * refaz esta conta em createReservation e e a dele que vale — aqui e so para
 * exibir. Nunca mandamos valor calculado no cliente para o POST.
 *
 * >>> A MESMA applyDiscount DO SERVIDOR, DE PROPOSITO <<<
 * `lib/basis-points.ts` e modulo PURO (sem `server-only`) exatamente para poder
 * ser chamado dos dois lados. Reimplementar a conta aqui — ou receber da API um
 * preco unitario ja descontado e multiplicar — produz divergencia de um centavo
 * em alguns precos: com 33333 e 7%, unitario descontado x2 da 62000 e desconto
 * sobre o total da 61999. O cliente veria um valor no wizard e outro na
 * cobranca, e ninguem ligaria uma coisa a outra.
 *
 * O desconto incide sobre o TOTAL (secao 4-B.2), nunca sobre o unitario.
 */
export const totalCents = (
  experience: PublicExperience,
  resourcesNeeded: number,
  method: PaymentMethodName = 'pix',
) =>
  applyDiscount(
    experience.priceCents * resourcesNeeded,
    experience.discountBasisPointsByMethod[method],
  ).payableCents;

/**
 * O que o cliente paga por UM recurso — o numero do cartao da experiencia.
 *
 * Passa pela mesma funcao, e nao por `totalCents(exp, 1)` reescrito a mao, pelo
 * motivo acima. Com um recurso so as duas contas coincidem por definicao; a
 * funcao existe para o rotulo nao virar o lugar onde alguem reintroduz `* 0.93`.
 *
 * >>> "A PARTIR DE": o cartao da experiencia mostra o MENOR preco. <<< Com o
 * cartao de credito na Fase E existem dois precos possiveis, e o cartao da
 * experiencia aparece ANTES de o cliente escolher como pagar. Mostrar o maior
 * faria a lista parecer mais cara do que e; o Pix e o preco que o tenant quer
 * anunciar, e e o que a comparacao do passo de pagamento depois detalha.
 */
export const unitPayableCents = (experience: PublicExperience) => totalCents(experience, 1, 'pix');

// ============================================================================
// Datas
// ============================================================================

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});
const FULL_DATE = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  timeZone: 'UTC',
});

// `timeZone: 'UTC'` e obrigatorio: sao datas de CALENDARIO ancoradas em UTC
// ('YYYY-MM-DD'), e deixar o Intl usar o fuso do aparelho mostraria o dia
// anterior para quem estiver a oeste. Mesma regra do shared.ts do admin.
const asUtc = (date: string) => new Date(`${date}T00:00:00Z`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const weekdayLabel = (date: string) => capitalize(WEEKDAY.format(asUtc(date)).replace('.', ''));
export const dayMonthLabel = (date: string) => DAY_MONTH.format(asUtc(date));
export const dayNumber = (date: string) => String(asUtc(date).getUTCDate());
export const fullDateLabel = (date: string) => capitalize(FULL_DATE.format(asUtc(date)));

/** 'YYYY-MM-DD' + n dias. Aritmetica de calendario em UTC (decisao de 03/08). */
export function addDays(date: string, n: number): string {
  const d = asUtc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Hoje em America/Sao_Paulo, como data de calendario.
 *
 * Nunca `new Date().toISOString().slice(0,10)`: as 22:00 de Sao Paulo ja sao o
 * dia seguinte em UTC, e a faixa de dias comecaria em amanha. 'en-CA' porque e
 * o locale cujo formato numerico ja e ISO.
 */
const LOCAL_TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
export const todayLocal = () => LOCAL_TODAY.format(new Date());

/**
 * Instante ISO -> 'Sabado, 23 de agosto de 2026', no fuso do tenant.
 *
 * Diferente de `fullDateLabel`, que formata uma data de CALENDARIO
 * ('YYYY-MM-DD') ancorada em UTC. Aqui a entrada e um INSTANTE, e o fuso tem de
 * ser America/Sao_Paulo explicitamente: deixar o Intl usar o do aparelho faria
 * um cliente viajando (ou com o fuso errado no celular) ler outro dia no
 * comprovante do proprio passeio.
 */
const FULL_DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});
export const fullDateFromInstant = (iso: string) =>
  capitalize(FULL_DATE_TIME.format(new Date(iso)));

/** 'HH:mm' em Sao Paulo a partir de um instante ISO. */
const TIME = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
export const timeLabel = (iso: string) => TIME.format(new Date(iso));

/**
 * Idade em anos completos na data de hoje, a partir de 'YYYY-MM-DD'.
 *
 * @returns `null` se a data for vazia ou nao for uma data de calendario valida.
 *
 * Guardamos birthdate e nao idade porque idade muda com o tempo: uma reserva
 * gravada com "19 anos" mente um ano depois.
 */
export function ageFromBirthdate(birthdate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return null;

  const born = asUtc(birthdate);
  if (Number.isNaN(born.getTime())) return null;
  // Rejeita '2026-02-30', que o Date aceita rolando para 02/03.
  if (born.toISOString().slice(0, 10) !== birthdate) return null;

  const today = asUtc(todayLocal());
  let age = today.getUTCFullYear() - born.getUTCFullYear();

  // Ainda nao fez aniversario este ano: compara mes/dia diretamente.
  const monthDay = (d: Date) => d.getUTCMonth() * 100 + d.getUTCDate();
  if (monthDay(today) < monthDay(born)) age -= 1;

  return age;
}
