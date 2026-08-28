// Validacao compartilhada pelas rotas de /api/admin/financial-config
// (CLAUDE.md secao 4-B.6).
//
// Regra de BORDA, ao lado das rotas — mesmo lugar e mesmo motivo do
// validation.ts de experiences, operating-hours e schedule-exceptions.
//
// Cada regra daqui evita um 500: os CHECKs `payment_method_discounts_range_check`
// e `card_machine_rates_range_check` recusariam no banco, e violacao de CHECK
// chega como erro do driver, nao como 422.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { BASIS_POINTS_SCALE } from '@/lib/basis-points';
import type { CardMachineRateDuplicateError } from '@/lib/financial-config';
import { CARD_MACHINE_MODALITIES, DISCOUNTABLE_METHODS } from '@/lib/financial-config';

/**
 * Percentual em BASIS POINTS (1 bp = 0,01%; 7% = 700).
 *
 * A API fala em basis points, e nao em "7" ou "7.5", de proposito: um numero
 * decimal no corpo JSON reintroduz o ponto flutuante binario exatamente na
 * fronteira que lib/basis-points.ts existe para proteger. A TELA aceita virgula
 * e converte com `parseBasisPoints` antes de enviar — a conversao acontece uma
 * vez so, num algoritmo so.
 */
const basisPoints = (param: string, max: number, maxMessage: string) =>
  z
    .number({ message: `${param}: obrigatório, percentual em basis points` })
    .int(`${param}: precisa ser um número inteiro de basis points (7% = 700)`)
    .finite(`${param}: número inválido`)
    .min(0, `${param}: não pode ser negativo`)
    .max(max, maxMessage);

/**
 * Teto EXCLUSIVO de 100%: desconto integral zera o preco, e experiencia gratuita
 * nao e suportada no MVP (secao 4.6) — com total zero a cobranca violaria
 * `CHECK (amount_cents > 0)` em reservation_payments e a venda cairia com 500.
 */
const discountBasisPoints = basisPoints(
  'descontoBasisPoints',
  BASIS_POINTS_SCALE - 1,
  'descontoBasisPoints: precisa ser menor que 100% — desconto integral zeraria o preço, e experiência gratuita não é suportada',
);

/** Teto INCLUSIVO de 100%: barra dígito extra sem julgar o contrato da adquirente. */
const rateBasisPoints = basisPoints(
  'taxaBasisPoints',
  BASIS_POINTS_SCALE,
  'taxaBasisPoints: não pode passar de 100%',
);

const modality = z.enum(CARD_MACHINE_MODALITIES, {
  message: 'modalidade: use debit, credit ou credit_installment',
});

export const methodSchema = z.enum(DISCOUNTABLE_METHODS, {
  message: 'metodo: use pix ou card',
});

export const discountSchema = z.object({
  descontoBasisPoints: discountBasisPoints,
});

export const rateSchema = z.object({
  modalidade: modality,
  taxaBasisPoints: rateBasisPoints,
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
 * 409 de modalidade ja cadastrada, compartilhado pelas rotas de POST e PUT.
 *
 * Mora AQUI, e nao num `route.ts`: o Next valida os exports de arquivos de rota
 * e so aceita metodos HTTP e chaves de configuracao — exportar um helper de la
 * quebra o build. Mesmo motivo do `overlapResponse` em operating-hours.
 *
 * 409 e nao 422 porque o corpo esta correto: o que conflita e o ESTADO. E, ao
 * contrario de um upsert silencioso, o 409 impede que um percentual de dinheiro
 * ja conferido com a adquirente seja sobrescrito sem o dono perceber.
 */
export function duplicateRateResponse(error: CardMachineRateDuplicateError) {
  return NextResponse.json(
    {
      error: 'ja existe taxa cadastrada para essa modalidade',
      code: 'modalidade_ocupada',
      conflict: error.conflict,
    },
    { status: 409 },
  );
}
