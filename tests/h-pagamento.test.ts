// GRUPO H — borda do provedor de pagamento (CLAUDE.md secoes 2 e 8).
//
// Estes testes NAO tocam a rede: exercitam as duas traducoes puras que separam o
// dominio do provedor — dinheiro (centavos -> reais) e status (vocabulario do
// Asaas -> `payment_state`). Sao justamente as duas que falham em silencio: um
// centavo perdido so aparece na conciliacao, e um status mal traduzido confirma
// (ou deixa de confirmar) reserva sem erro nenhum no log.

import { describe, expect, it } from 'vitest';

import { toPaymentState } from '@/lib/payments/asaas';
import { centsToReais, centsToReaisNumber } from '@/lib/payments/money';

import { TEMPLATE_EXP } from './helpers/db';

describe('H — conversao de dinheiro para o provedor', () => {
  it('17. centavos viram reais com duas casas, sem perder zero nem ganhar residuo', () => {
    // Precos reais do catalogo
    expect(centsToReais(32549)).toBe('325.49'); // Trilha da Montanha
    expect(centsToReais(23249)).toBe('232.49'); // Trilha da Fazenda
    expect(centsToReais(65098)).toBe('650.98'); // 2 quadris da Montanha

    // O zero final NAO pode sumir: "325" seria cobrado como R$ 325,00 por
    // coincidencia, e "32.5" seria cobrado errado. O formato e fixo.
    expect(centsToReais(32500)).toBe('325.00');
    expect(centsToReais(100)).toBe('1.00');

    // Abaixo de um real, onde a divisao solta erra o padding
    expect(centsToReais(50)).toBe('0.50');
    expect(centsToReais(5)).toBe('0.05');

    // Valor grande
    expect(centsToReais(999999)).toBe('9999.99');
  });

  it('18. a conversao fecha o round-trip: reais x 100 volta ao centavo original', () => {
    // ANCORA NO TEMPLATE (mesma regra do teste 15): o que importa e que o valor
    // ENVIADO ao provedor corresponda exatamente ao que o banco diz que a
    // reserva custa. Uma divergencia de 1 centavo aqui e dinheiro cobrado a
    // menor, descoberto so na conciliacao.
    const doCatalogo = [
      TEMPLATE_EXP.curta.priceCents,
      TEMPLATE_EXP.longa.priceCents,
      TEMPLATE_EXP.curta.priceCents * 2,
      TEMPLATE_EXP.longa.priceCents * 2,
    ];

    for (const cents of doCatalogo) {
      expect(Math.round(centsToReaisNumber(cents) * 100)).toBe(cents);
      // E o numero serializa para JSON exatamente como a string canonica —
      // e a string que descreve o que o provedor recebe.
      expect(JSON.stringify(centsToReaisNumber(cents))).toBe(centsToReais(cents));
    }
  });

  it('19. centavo fracionado e recusado em vez de arredondado em silencio', () => {
    // Arredondar aqui esconderia o bug la atras, em quem produziu o valor.
    expect(() => centsToReais(325.5)).toThrow(RangeError);
    expect(() => centsToReais(Number.NaN)).toThrow(RangeError);
  });
});

describe('H — traducao de status do provedor', () => {
  it('20. status do Asaas viram payment_state do Aventix', () => {
    // Pix liquida na hora: CONFIRMED e RECEIVED sao ambos "pago". A distincao
    // so passa a importar no cartao (v2), onde RECEIVED chega ~32 dias depois.
    expect(toPaymentState('RECEIVED')).toBe('paid');
    expect(toPaymentState('CONFIRMED')).toBe('paid');
    expect(toPaymentState('RECEIVED_IN_CASH')).toBe('paid');

    // Vencido continua DEVIDO, nao e estado terminal.
    expect(toPaymentState('PENDING')).toBe('pending');
    expect(toPaymentState('OVERDUE')).toBe('pending');

    expect(toPaymentState('REFUNDED')).toBe('refunded');
    expect(toPaymentState('CHARGEBACK_REQUESTED')).toBe('refunded');
    expect(toPaymentState('DELETED')).toBe('cancelled');

    // Regra 5 da secao 8.1: o Asaas adiciona valores sem aviso. Novidade cai em
    // `pending` — no pior caso a reconciliacao insiste; nunca confirma a toa.
    expect(toPaymentState('UM_STATUS_QUE_AINDA_NAO_EXISTE')).toBe('pending');
  });
});
