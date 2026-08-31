// GRUPO X — versionamento do termo de aceite (CLAUDE.md secoes 10 e 14).
//
// ============================================================================
// >>> O QUE ESTE GRUPO PROTEGE E A PROVA DE QUE ALGUEM ACEITOU ALGO. <<<
// A reserva grava SO a versao (`reservations.termo_version`), nunca o corpo do
// termo. Entao a string '2026-08-01', ja gravada em toda reserva vendida ate
// 31/08/2026, PRECISA continuar resolvendo para o mesmo texto para sempre.
// Editar `quadriciclo-v1.ts` sem trocar a versao sobrescreveria, em silencio, o
// registro do que aquelas pessoas leram e aceitaram — e num documento cuja
// unica funcao e provar isso, essa falha anula o documento.
//
// O v1 nao e importado por codigo nenhum desde que o v2 entrou: ele existe
// exclusivamente como REGISTRO. Arquivo sem importador e candidato natural a
// ser apagado numa limpeza, e e por isso que a garantia mora aqui, num teste
// que falha alto, e nao num comentario que se le depois de ja ter apagado.
// ============================================================================

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import * as v1 from '@/lib/terms/quadriciclo-v1';
import * as v2 from '@/lib/terms/quadriciclo-v2';

/**
 * Impressao digital do texto do v1, tirada em 31/08/2026, quando o v2 nasceu.
 *
 * >>> SE ESTE TESTE FALHAR, NAO ATUALIZE O HASH. <<< A falha significa que
 * alguem editou um termo ja aceito por clientes reais. O conserto e desfazer a
 * edicao e criar uma versao NOVA (quadriciclo-v3.ts), nunca acomodar o hash.
 */
const V1_SHA256 = 'd8a03f0a89471a485ba92e1608c28049fd40958b16e18b567672c124df6dfad5';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

describe('X1 o v1 e imutavel', () => {
  it('X1.1 o texto do v1 nao mudou desde 31/08/2026', () => {
    expect(sha256(v1.TERM_TEXT)).toBe(V1_SHA256);
  });

  it('X1.2 a versao do v1 continua sendo a que as reservas antigas gravaram', () => {
    expect(v1.TERM_VERSION).toBe('2026-08-01');
  });

  it('X1.3 o v1 NAO ganhou a secao de pagamento — ela e do v2', () => {
    // Se isto falhar, o v1 foi editado no lugar em vez de versionado, e toda
    // reserva antiga passou a apontar para um texto que ninguem daqueles
    // clientes leu.
    expect(v1.TERM_TEXT).not.toContain('PAGAMENTO, CANCELAMENTO E REMARCAÇÃO');
    expect(v1.TERM_TEXT).toContain('5. CIÊNCIA');
  });
});

describe('X2 o v2 herda o v1 sem reescreve-lo', () => {
  it('X2.1 versao nova e distinta', () => {
    expect(v2.TERM_VERSION).toBe('2026-08-31');
    expect(v2.TERM_VERSION).not.toBe(v1.TERM_VERSION);
  });

  it('X2.2 as secoes 1 a 4 sao IDENTICAS as do v1, palavra por palavra', () => {
    const ate = (texto: string, marca: string) => texto.slice(0, texto.indexOf(marca));
    expect(ate(v2.TERM_TEXT, '5. PAGAMENTO')).toBe(ate(v1.TERM_TEXT, '5. CIÊNCIA'));
  });

  it('X2.3 a CIENCIA sobreviveu, so renumerada de 5 para 6', () => {
    const depois = (texto: string, marca: string) =>
      texto.slice(texto.indexOf(marca) + marca.length);
    expect(depois(v2.TERM_TEXT, '6. CIÊNCIA')).toBe(depois(v1.TERM_TEXT, '5. CIÊNCIA'));
  });

  it('X2.4 o v2 cobre as tres lacunas que motivaram a versao', () => {
    // Sinal nao reembolsavel — a lacuna ATIVA da secao 10: as duas trilhas
    // vendem em `deposit` e o termo nao dizia isso.
    expect(v2.TERM_TEXT).toContain('não são restituídos');
    // No-show (secao 4-C).
    expect(v2.TERM_TEXT).toContain('não comparecimento');
    // A contradicao das 48h (secao 4-C): o texto oficial do cliente promete
    // remarcacao sem dizer COMO, e o termo precisa dizer que e pelo WhatsApp.
    expect(v2.TERM_TEXT).toContain('48 (quarenta e oito) horas');
    expect(v2.TERM_TEXT).toContain('WhatsApp');
    expect(v2.TERM_TEXT).toContain('não é realizada pelo site');
  });

  it('X2.5 o v2 NAO promete pagamento antecipado do saldo pelo cliente', () => {
    // >>> ESSE CAMINHO NAO EXISTE. <<< `DUE_PAYMENT` (lib/reservation-status.ts)
    // filtra kind IN ('full','deposit') e nunca seleciona `balance`; e
    // GET /api/reservations/{id}/payment responde 409 fora de pending_payment,
    // que e o estado de toda reserva com sinal pago. A cobranca do saldo (Fase
    // C) e disparada pelo DONO, no painel.
    //
    // Um termo que promete caminho de pagamento inexistente e pior que a
    // omissao: o cliente procura, nao acha, e conclui que o sistema comeu o
    // dinheiro dele. Se a funcionalidade for construida, a frase volta num v3.
    expect(v2.TERM_TEXT).not.toContain('antecipar o pagamento');
    expect(v2.TERM_TEXT).not.toContain('pelo próprio sistema');
  });

  it('X2.6 os marcadores de exibicao continuam presentes', () => {
    // Substituidos so na EXIBICAO; o que a reserva grava e a versao.
    for (const marcador of ['{nome}', '{data_hora}', '{ip}']) {
      expect(v2.TERM_TEXT).toContain(marcador);
    }
  });
});
