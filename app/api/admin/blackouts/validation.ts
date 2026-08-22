// Validacao compartilhada por POST /api/admin/blackouts e PUT /{id}.
// Regra de BORDA, ao lado das rotas — mesmo lugar e motivo dos outros dois CRUDs.

import { z } from 'zod';

import { isValidCalendarDate } from '@/lib/time';

/**
 * 'YYYY-MM-DDTHH:MM' em horario LOCAL do tenant — o que
 * `<input type="datetime-local">` produz.
 *
 * NAO aceita sufixo de fuso de proposito. Se um cliente mandasse '...T14:00Z', o
 * valor seria lido como 14h UTC = 11h de Brasilia, e o bloqueio nasceria tres
 * horas fora do lugar sem erro nenhum aparecendo. Recusar a forma e o que
 * impede a ambiguidade de existir.
 */
const localDateTime = (param: string) =>
  z
    .string({ message: `${param}: obrigatório` })
    .regex(
      /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/,
      `${param}: use o formato AAAA-MM-DDTHH:MM (horário local, sem fuso)`,
    )
    .refine((v) => isValidCalendarDate(v.slice(0, 10)), `${param}: essa data não existe`);

/** `null` = todos os recursos. A tela manda null quando o bloqueio e geral. */
const resourceId = z
  .number({ message: 'recursoId: esperado número ou null' })
  .int('recursoId: precisa ser um número inteiro')
  .positive('recursoId: precisa ser um número inteiro positivo')
  .nullable();

const reason = z
  .string()
  .max(200, 'motivo: no máximo 200 caracteres')
  .transform((v) => v.trim())
  .transform((v) => (v.length === 0 ? null : v))
  .nullish()
  .transform((v) => v ?? null);

export const blackoutSchema = z
  .object({
    recursoId: resourceId.default(null),
    inicio: localDateTime('inicio'),
    fim: localDateTime('fim'),
    motivo: reason,
  })
  .superRefine((value, ctx) => {
    // Comparacao de string funciona: 'YYYY-MM-DDTHH:MM' zero-padded e
    // lexicograficamente ordenado. Range vazio ou invertido nao bloqueia nada —
    // `tstzrange` com fim <= inicio produz range VAZIO, que nunca da `&&` com
    // coisa nenhuma. Ou seja, o banco aceitaria em silencio e o dono teria um
    // bloqueio que nao bloqueia. E o pior desfecho possivel desta tela.
    if (value.fim <= value.inicio) {
      ctx.addIssue({ code: 'custom', path: ['fim'], message: 'fim: precisa ser depois do início' });
    }
  });

export function validationErrorBody(error: z.ZodError) {
  return {
    error: 'dados invalidos',
    fields: error.issues.map((issue) => ({
      param: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
