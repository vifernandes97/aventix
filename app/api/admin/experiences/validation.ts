// Validacao compartilhada por POST /api/admin/experiences e PATCH /{id}.
//
// Mora ao lado das rotas, e nao em lib/experiences.ts, porque e regra de BORDA:
// traduz corpo JSON desconhecido em tipos do dominio. O modulo de dominio recebe
// valores ja validados e nao precisa saber que existe HTTP.
//
// >>> A VALIDACAO E DO SERVIDOR, nao da tela <<<
// A tela repete parte disso para dar retorno imediato, mas o que vale e aqui: um
// POST de curl nao passa pelo React.

import { z } from 'zod';

import { ACCEPTED_PAYMENT_MODES } from '@/lib/experiences';

/**
 * Inteiro de verdade. `z.number().int()` sozinho aceitaria `1e21`; o `.finite()`
 * e o teto barram valor que o `integer` do Postgres nao guarda (limite 2^31-1) e
 * que viraria erro do driver em vez de 422.
 */
const PG_INT_MAX = 2_147_483_647;
const boundedInt = (param: string) =>
  z
    .number({ message: `${param}: obrigatório, número inteiro` })
    .int(`${param}: precisa ser um número inteiro`)
    .finite(`${param}: número inválido`)
    .max(PG_INT_MAX, `${param}: valor alto demais`);

const name = z
  .string({ message: 'nome: obrigatório' })
  .transform((v) => v.trim())
  // O trim vem ANTES da checagem: '   ' e nome vazio, e sem transformar antes
  // ele passaria por ter comprimento 3.
  .refine((v) => v.length > 0, 'nome: não pode ficar em branco')
  .refine((v) => v.length <= 120, 'nome: no máximo 120 caracteres');

/**
 * Preco em centavos, SEMPRE maior que zero.
 *
 * O CHECK do schema permite `>= 0`, mas experiencia gratuita nao e suportada no
 * MVP (secao 4.6) e a diferenca importa: com total zero, a criacao da cobranca
 * violaria `CHECK (amount_cents > 0)` em reservation_payments e a venda cairia
 * com 500; se passasse, recalcReservationPayment classificaria a reserva como
 * 'pending' para sempre, e ela nunca confirmaria. Barrar aqui e mais barato que
 * apertar o CHECK do schema, que exigiria migration.
 */
const priceCents = boundedInt('precoCentavos').positive(
  'precoCentavos: precisa ser maior que zero — experiência gratuita não é suportada',
);

const durationMinutes = boundedInt('duracaoMinutos').positive(
  'duracaoMinutos: precisa ser maior que zero',
);

const bufferMinutes = boundedInt('bufferMinutos').min(0, 'bufferMinutos: não pode ser negativo');

/**
 * 'full' ou 'deposit' — ver ACCEPTED_PAYMENT_MODES em lib/experiences.ts.
 *
 * O percentual do sinal NAO entra no corpo: e 50% fixo (secao 4-B.2), gravado
 * pelo servidor. O dono decide se a experiencia ACEITA sinal, nunca quanto ele e.
 */
const paymentMode = z.enum(ACCEPTED_PAYMENT_MODES, {
  message: 'modoPagamento: use `full` (só Pix integral) ou `deposit` (também aceita sinal de 50%)',
});

/**
 * Idade minima do garupa, em anos completos NA DATA DO PASSEIO. `0` = sem
 * minimo.
 *
 * O teto de 120 espelha o CHECK experiences_min_passenger_age_check: sem ele um
 * digito a mais ('60' virando '600') gravaria uma experiencia que ninguem
 * consegue comprar, e o erro chegaria como falha do driver em vez de 422.
 */
const minPassengerAge = boundedInt('idadeMinimaGarupa')
  .min(0, 'idadeMinimaGarupa: não pode ser negativa')
  .max(120, 'idadeMinimaGarupa: valor implausível (máximo 120)');

export const createSchema = z.object({
  nome: name,
  duracaoMinutos: durationMinutes,
  bufferMinutos: bufferMinutes,
  precoCentavos: priceCents,
  // Ausente vira 'full': o unico valor valido hoje, e a tela nao envia o campo.
  modoPagamento: paymentMode.default('full'),
  // Ausente vira 0 (sem idade minima) em vez de obrigar o campo: manter o
  // corpo compativel evita quebrar chamador existente. Quem cria pela TELA ve o
  // campo e escolhe — e e la que a regra de seguranca fica visivel.
  idadeMinimaGarupa: minPassengerAge.default(0),
});

/**
 * PATCH e parcial de proposito: o botao "Desativar" manda `{ ativo: false }` e
 * nada mais, sem precisar reenviar o cadastro inteiro.
 */
export const patchSchema = z.object({
  nome: name.optional(),
  duracaoMinutos: durationMinutes.optional(),
  bufferMinutos: bufferMinutes.optional(),
  precoCentavos: priceCents.optional(),
  modoPagamento: paymentMode.optional(),
  idadeMinimaGarupa: minPassengerAge.optional(),
  ativo: z.boolean({ message: 'ativo: esperado true ou false' }).optional(),
});

/**
 * Corpo invalido responde 422, e nao 400.
 *
 * DIFERENCA DELIBERADA para /api/admin/calendar, que responde 400: la o que
 * falha e a SINTAXE de um parametro de query ('2026-13-01' nao e data). Aqui o
 * corpo e JSON bem formado e do tipo certo — o que falha e a REGRA de negocio
 * (preco zero, sinal fora do MVP). 422 e o que distingue "nao entendi o pedido"
 * de "entendi e ele nao vale", e e o codigo que a tarefa pediu para o preco zero.
 */
export function validationErrorBody(error: z.ZodError) {
  return {
    error: 'dados invalidos',
    fields: error.issues.map((issue) => ({
      param: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
