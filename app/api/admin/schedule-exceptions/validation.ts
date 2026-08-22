// Validacao compartilhada por POST /api/admin/schedule-exceptions e PUT /{id}.
//
// Mora ao lado das rotas, e nao em lib/schedule-exceptions.ts, pelo mesmo motivo
// do validation.ts de experiences: e regra de BORDA, que traduz corpo JSON
// desconhecido em tipos do dominio. O modulo de dominio recebe valores ja
// validados e nao precisa saber que existe HTTP.
//
// >>> A VALIDACAO E DO SERVIDOR, nao da tela <<<
// A tela repete parte disso para dar retorno imediato, mas o que vale e aqui: um
// POST de curl nao passa pelo React.
//
// >>> CADA REGRA DAQUI EVITA UM 500 <<<
// Os CHECKs de schedule_exceptions (secao 4.3) recusam no banco o que passar
// batido — e violacao de CHECK chega como erro do driver, ou seja, 500 numa tela
// em que o dono digitou algo compreensivel e corrigivel. As regras abaixo
// espelham os CHECKs para que a resposta seja 422 com o campo nomeado.

import { z } from 'zod';

import { isValidCalendarDate, todayLocalDate } from '@/lib/time';

/**
 * 'YYYY-MM-DD' que EXISTE no calendario.
 *
 * A regex sozinha aceita '2026-02-31'; `isValidCalendarDate` (o mesmo helper que
 * o motor de disponibilidade usa) rejeita. Sem ele o Postgres aborta com 22008 e
 * o dono ve 500 por ter digitado um dia que nao existe.
 */
const calendarDate = z
  .string({ message: 'data: obrigatória' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'data: use o formato AAAA-MM-DD')
  .refine(isValidCalendarDate, 'data: essa data não existe no calendário');

/**
 * 'HH:MM' (24h). Aceita tambem 'HH:MM:SS', que e o que o Postgres devolve — a
 * tela reenvia o valor que recebeu ao editar, e recusa-lo faria a edicao de uma
 * excecao existente falhar sem o dono ter mudado nada.
 */
const clockTime = (param: string) =>
  z
    .string({ message: `${param}: obrigatório quando o dia abre` })
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, `${param}: use o formato HH:MM`)
    .transform((v) => v.slice(0, 5));

/** Texto livre opcional. Vazio e `null`: string em branco no banco e ruido. */
const reason = z
  .string()
  .max(200, 'motivo: no máximo 200 caracteres')
  .transform((v) => v.trim())
  .transform((v) => (v.length === 0 ? null : v))
  .nullish()
  .transform((v) => v ?? null);

/**
 * Corpo de criacao e de substituicao — o MESMO nos dois.
 *
 * Nao ha versao parcial (ao contrario do PATCH de experiencias) porque os campos
 * sao INTERDEPENDENTES: `schedule_exceptions_closed_check` exige que um dia
 * aberto tenha opens e closes, com closes > opens. Um patch que mandasse
 * `{ closed: false }` sozinho sobre uma linha de dia fechado (horarios em NULL)
 * seria um corpo aparentemente valido que o banco recusa. Exigindo a linha
 * inteira, esta validacao consegue julgar sozinha se o resultado e legal.
 */
export const exceptionSchema = z
  .object({
    data: calendarDate,
    fechado: z.boolean({ message: 'fechado: esperado true ou false' }),
    abre: clockTime('abre').optional(),
    fecha: clockTime('fecha').optional(),
    motivo: reason,
  })
  .superRefine((value, ctx) => {
    if (value.fechado) {
      // Dia fechado nao carrega horario. Nao e erro mandar — a tela pode ter os
      // campos preenchidos quando o dono marca "fechado" —, entao ignoramos em
      // silencio na camada de dominio em vez de reprovar o corpo.
      return;
    }

    for (const campo of ['abre', 'fecha'] as const) {
      if (!value[campo]) {
        ctx.addIssue({
          code: 'custom',
          path: [campo],
          message: `${campo}: obrigatório quando o dia abre`,
        });
      }
    }

    if (value.abre && value.fecha && value.fecha <= value.abre) {
      // Comparacao de string funciona porque 'HH:MM' zero-padded e
      // lexicograficamente ordenado. Espelha o CHECK `closes > opens`.
      ctx.addIssue({
        code: 'custom',
        path: ['fecha'],
        message: 'fecha: precisa ser depois de abre',
      });
    }
  })
  /**
   * Data passada e recusada.
   *
   * Nao e capricho: a grade so oferece horario no FUTURO (o passo 1 de
   * availability.ts descarta candidato anterior a `now() + antecedencia`), entao
   * uma excecao em data passada nao muda absolutamente nada. Aceitar em silencio
   * faria o dono acreditar que resolveu alguma coisa. HOJE e permitido — mudar a
   * grade do dia corrente e uso legitimo.
   *
   * "Hoje" e o de America/Sao_Paulo, nunca `new Date()` do servidor: as 21h de
   * Brasilia ja e amanha em UTC, e a regra recusaria o dia seguinte por engano.
   */
  .superRefine((value, ctx) => {
    if (value.data < todayLocalDate()) {
      ctx.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'data: não dá para criar exceção para um dia que já passou',
      });
    }
  });

/**
 * Corpo invalido responde 422, e nao 400 — mesma distincao do validation.ts de
 * experiences: 400 fica para JSON malformado ("nao entendi o pedido"), 422 para
 * corpo compreendido cuja regra nao passa ("entendi e ele nao vale").
 *
 * Formato identico ao de experiences, de proposito: as telas do admin tratam
 * `fields` do mesmo jeito, e um segundo formato exigiria um segundo tratamento.
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

/** Corpo validado -> entrada do dominio (a uniao discriminada de lib/). */
export function toDomainInput(parsed: z.infer<typeof exceptionSchema>) {
  return parsed.fechado
    ? ({ date: parsed.data, closed: true, reason: parsed.motivo } as const)
    : ({
        date: parsed.data,
        closed: false,
        // O superRefine acima ja garantiu os dois presentes quando aberto.
        opens: parsed.abre!,
        closes: parsed.fecha!,
        reason: parsed.motivo,
      } as const);
}
