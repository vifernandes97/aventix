// Validacao compartilhada por POST /api/admin/operating-hours e PUT /{id}.
//
// Regra de BORDA, ao lado das rotas — mesmo lugar e mesmo motivo do
// validation.ts de experiences e do de schedule-exceptions.
//
// Cada regra daqui evita um 500: os CHECKs `operating_hours_weekday_check` e
// `operating_hours_range_check` recusariam no banco, e violacao de CHECK chega
// como erro do driver.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { OperatingHoursOverlapError } from '@/lib/operating-hours';

const weekday = z
  .number({ message: 'diaDaSemana: obrigatório' })
  .int('diaDaSemana: precisa ser um número inteiro')
  .min(0, 'diaDaSemana: use 0 (domingo) a 6 (sábado)')
  .max(6, 'diaDaSemana: use 0 (domingo) a 6 (sábado)');

/** Aceita 'HH:MM' e 'HH:MM:SS' — o Postgres devolve com segundos e a tela reenvia. */
const clockTime = (param: string) =>
  z
    .string({ message: `${param}: obrigatório` })
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, `${param}: use o formato HH:MM`)
    .transform((v) => v.slice(0, 5));

export const rangeSchema = z
  .object({
    diaDaSemana: weekday,
    abre: clockTime('abre'),
    fecha: clockTime('fecha'),
  })
  .superRefine((value, ctx) => {
    // Espelha o CHECK `closes > opens`. Faixa que atravessa a meia-noite NAO e
    // suportada pelo schema (seria closes < opens), e nenhum tenant do MVP
    // opera de madrugada — se um dia precisar, e migration, nao validacao.
    if (value.fecha <= value.abre) {
      ctx.addIssue({
        code: 'custom',
        path: ['fecha'],
        message: 'fecha: precisa ser depois de abre',
      });
    }
  });

/** Mesmo formato de erro das outras telas do admin — ver validation.ts de experiences. */
export function validationErrorBody(error: z.ZodError) {
  return {
    error: 'dados invalidos',
    fields: error.issues.map((issue) => ({
      param: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

/**
 * 409 de faixa sobreposta, compartilhado pelas duas rotas.
 *
 * Mora AQUI, e nao num `route.ts`: o Next valida os exports de arquivos de rota
 * e so aceita metodos HTTP e chaves de configuracao — exportar um helper de la
 * quebra o build. O modulo de validacao ja e o lugar comum das duas rotas.
 *
 * 409 e nao 422 porque o corpo esta correto: o que conflita e o ESTADO. O
 * `conflict` volta no payload para a tela dizer QUAL faixa atrapalha, em vez de
 * um "invalido" generico sobre um horario digitado certo.
 */
export function overlapResponse(error: OperatingHoursOverlapError) {
  return NextResponse.json(
    {
      error: 'essa faixa se sobrepoe a outra do mesmo dia',
      code: 'faixa_sobreposta',
      conflict: error.conflict,
    },
    { status: 409 },
  );
}
