// POST /api/admin/reservations/{id}/balance/charge — gera (ou reaproveita) a
// cobranca Pix do saldo (CLAUDE.md secao 17, Fase C; secoes 7.2 e 11.1).
//
// >>> APERTAR DUAS VEZES NAO PODE GERAR DUAS COBRANCAS. <<<
// E a exigencia que define a fase, e ela NAO mora aqui: mora em
// lib/payments/balance-charge.ts, em tres camadas (caminho rapido local, trava
// de serializacao, pergunta ao provedor). Esta rota so traduz os erros tipados
// daquele modulo em HTTP. Nao reimplemente regra nenhuma aqui — duas copias da
// mesma regra divergem com o tempo, e a que diverge sobre dinheiro cobra
// errado.
//
// >>> POR QUE POST, E POR QUE NUMA SUB-ROTA <<<
// Cria estado que envolve dinheiro no provedor, entao nao pode viver atras de
// um GET (ver o cabecalho da rota irma). E fica em `/balance/charge`, e nao em
// `/balance` com verbo diferente, porque o GET de `/balance` e chamado pelo
// painel a cada abertura de reserva: enderecos distintos deixam obvio, na
// aba de rede e no log, qual chamada foi leitura e qual foi cobranca.
//
// >>> ERRO DO PROVEDOR SAI COM DETALHE, AO CONTRARIO DA ROTA PUBLICA. <<<
// Aqui quem le e o dono, autenticado, com o cliente na frente. "Nao foi
// possivel" o deixaria sem acao; "valor abaixo do minimo" ou "CPF do cliente
// invalido" ele resolve na hora. O detalhe ja passou por `redactDocuments` na
// borda do provedor.

import { NextResponse } from 'next/server';

import {
  BalanceChargeInProgressError,
  BalanceNotChargeableError,
  BalanceQrUnavailableError,
  BalanceReservationNotFoundError,
  chargeReservationBalance,
} from '@/lib/payments/balance-charge';
import { PaymentProviderApiError } from '@/lib/payments/provider';

export const dynamic = 'force-dynamic';

/** QR expira — ver a rota irma. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const result = await chargeReservationBalance(id);

    // 200, nao 201: a segunda chamada nao cria nada e responder "Created" nela
    // seria mentir sobre o que aconteceu. `origin` conta a verdade — e e o
    // campo que os testes usam para provar que o duplo toque nao criou nada.
    return NextResponse.json(
      {
        amountCents: result.amountCents,
        payment: {
          method: 'pix' as const,
          qrCodeBase64: result.qrCodeBase64,
          copyPaste: result.copyPaste,
          expiresAt: result.expiresAt,
        },
        invoiceUrl: result.invoiceUrl,
        origin: result.origin,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // Inexistente, id malformado, outro tenant, e tambem reserva vendida no
    // modo `full` (nunca teve linha de saldo). Todos 404: o endereco
    // `/{id}/balance` nao existe para nenhum deles, e distinguir confirmaria
    // ids a quem sonda.
    if (error instanceof BalanceReservationNotFoundError) {
      return NextResponse.json(
        { error: 'reserva sem saldo a cobrar' },
        { status: 404, headers: NO_STORE },
      );
    }

    // 409 — ha saldo, mas nao e cobravel AGORA. O `code` e o que a tela usa
    // para dizer a coisa certa: "ja foi pago" e "a reserva foi cancelada" pedem
    // reacoes opostas do dono.
    if (error instanceof BalanceNotChargeableError) {
      return NextResponse.json(
        { error: 'saldo nao cobravel', code: error.reason, detail: error.message },
        { status: 409, headers: NO_STORE },
      );
    }

    // 409 — O DUPLO TOQUE. O primeiro pedido esta criando a cobranca neste
    // instante. Nao e falha: e a trava funcionando. A tela mostra "gerando…" e
    // o dono tenta de novo em um segundo, quando o caminho rapido ja devolve a
    // cobranca criada pelo primeiro.
    if (error instanceof BalanceChargeInProgressError) {
      return NextResponse.json(
        {
          error: 'cobranca em andamento',
          code: 'cobranca_em_andamento',
          detail: 'a cobranca deste saldo esta sendo gerada; tente de novo em instantes',
        },
        { status: 409, headers: NO_STORE },
      );
    }

    // A cobranca EXISTE e so o QR nao veio. NAO e recusa — e a distincao mais
    // importante deste bloco. Medido: duas leituras concorrentes do mesmo QR
    // fazem o Asaas responder 400, e chamar isso de "recusou" mandaria o dono
    // refazer uma cobranca que ja esta de pe. A fatura vai junto porque resolve
    // o problema dele agora: mostra o mesmo Pix sem depender desta chamada.
    if (error instanceof BalanceQrUnavailableError) {
      console.error('[POST .../balance/charge] QR indisponivel:', error.cause);
      return NextResponse.json(
        {
          error: 'QR indisponivel',
          code: 'qr_indisponivel',
          detail:
            'A cobranca do saldo EXISTE e nada foi duplicado; o QR nao veio agora. ' +
            'Tente de novo, ou abra a fatura.',
          invoiceUrl: error.invoiceUrl,
        },
        { status: 502, headers: NO_STORE },
      );
    }

    // O provedor respondeu recusando por regra de negocio. Ver o cabecalho.
    if (error instanceof PaymentProviderApiError) {
      console.error('[POST .../balance/charge] provedor recusou:', error.status, error.detail);
      return NextResponse.json(
        { error: 'o provedor recusou a cobranca', code: 'provedor_recusou', detail: error.detail },
        { status: 422, headers: NO_STORE },
      );
    }

    // Rede, timeout, credencial. 502 diz "o problema esta a jusante" — e aqui
    // inclui a falha da consulta da camada 3, que e FAIL-CLOSED de proposito:
    // nao dando para perguntar se a cobranca ja existe, nao se cria.
    if (error instanceof Error && error.name.startsWith('PaymentProvider')) {
      console.error('[POST .../balance/charge] provedor indisponivel:', error.name, error.message);
      return NextResponse.json(
        {
          error: 'nao foi possivel falar com o provedor agora',
          code: 'provedor_indisponivel',
          detail: 'a cobranca NAO foi criada; tente de novo em instantes',
        },
        { status: 502, headers: NO_STORE },
      );
    }

    console.error('[POST .../balance/charge] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500, headers: NO_STORE });
  }
}
