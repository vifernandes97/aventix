// GET /api/reservations/{id}/payment — QR Code Pix ATUAL da reserva
// (CLAUDE.md secoes 7.1, 7.2 e 14).
//
// >>> POR QUE ESTA ROTA EXISTE, SE O 201 JA DEVOLVE UM QR <<<
// O 201 de POST /api/reservations entrega o QR uma vez, na memoria do wizard. A
// tela /reserva/[id] sobrevive a refresh, a fechar e reabrir o link, e a voltar
// nele meia hora depois — em todos esses casos aquele QR nao existe mais no
// navegador. Buscar aqui e o unico caminho que funciona sempre, entao e o unico
// caminho, inclusive na primeira carga vinda do wizard.
//
// >>> NUNCA CACHEIA, NUNCA PERSISTE <<<
// O QR Pix EXPIRA (secao 7.2). Guardar no banco ou deixar um CDN guardar
// entrega ao cliente um codigo que o app do banco recusa sem dizer por que — o
// pior modo de falha possivel numa tela de pagamento. Dai o `no-store` em toda
// resposta e o `force-dynamic`.
//
// >>> CHAMA O PROVEDOR — E POR ISSO NAO E A ROTA DO POLLING <<<
// UMA chamada por carga da pagina. O acompanhamento do pagamento e a rota irma
// ../status, que le so o banco e pode ser consultada a cada 4 segundos sem
// tocar em servico de terceiro.
//
// >>> DADO SENSIVEL <<<
// Publica, sem sessao, mesma regra da rota de status: o payload nao carrega
// nome, telefone, e-mail, CPF nem participante. O `chargeId` do provedor
// tambem nao sai daqui — e insumo interno, e expo-lo daria a quem tem o link
// uma referencia utilizavel contra a conta do tenant no provedor.

import { NextResponse } from 'next/server';

import { asaasProvider } from '@/lib/payments/asaas';
import { getDueCharge } from '@/lib/reservation-status';

export const dynamic = 'force-dynamic';

/** Ver o bloco equivalente em ../status/route.ts. QR cacheado = QR vencido. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const due = await getDueCharge(id);

    // Inexistente, id malformado e reserva de OUTRO TENANT: os tres 404, mesma
    // regra da rota de status.
    if (!due) {
      return NextResponse.json({ error: 'reserva nao encontrada' }, { status: 404, headers: NO_STORE });
    }

    // 409 — a reserva existe, mas nao esta num estado em que pagar faca
    // sentido. Confirmada, expirada e cancelada caem aqui, e a tela ja sabe o
    // que dizer em cada uma: ela tem o status pela rota irma e nao depende
    // desta resposta para se desenhar.
    if (due.reservationStatus !== 'pending_payment' || due.state !== 'pending') {
      return NextResponse.json(
        { error: 'reserva nao esta aguardando pagamento', status: due.reservationStatus },
        { status: 409, headers: NO_STORE },
      );
    }

    // Reserva pendente SEM cobranca no provedor. Acontece quando a criacao da
    // cobranca falhou depois da transacao (secao 5.2 passo 5, caso de borda 9):
    // nao ha QR para buscar e nao havera. Tambem 409 — e conflito com o estado,
    // nao ausencia de reserva —, com codigo proprio para a tela distinguir e
    // mandar o cliente falar com o tenant em vez de ficar tentando pagar.
    if (!due.chargeId) {
      return NextResponse.json(
        { error: 'cobranca nao disponivel', code: 'sem_cobranca' },
        { status: 409, headers: NO_STORE },
      );
    }

    const qr = await asaasProvider.getPixQrCode(due.chargeId);

    return NextResponse.json(
      { ...qr, dueNowCents: due.amountCents },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // Falha do provedor (rede, timeout, credencial) nao e erro do cliente e nao
    // pode derrubar a tela: ela continua acompanhando o status e oferece o
    // copia-e-cola da fatura como saida. 502 diz "o problema esta a jusante",
    // que e o que um 500 generico esconderia de quem for ler o log.
    //
    // A mensagem devolvida e generica DE PROPOSITO: os erros tipados do
    // provedor citam comprimento e prefixo da chave de API (ver o cabecalho de
    // lib/payments/asaas.ts), e nada disso pode atravessar uma rota publica.
    if (error instanceof Error && error.name.startsWith('PaymentProvider')) {
      console.error('[GET /api/reservations/{id}/payment] provedor indisponivel:', error.name);
      return NextResponse.json(
        { error: 'nao foi possivel obter o pagamento agora' },
        { status: 502, headers: NO_STORE },
      );
    }

    console.error('[GET /api/reservations/{id}/payment] erro inesperado:', error);
    return NextResponse.json({ error: 'erro interno' }, { status: 500, headers: NO_STORE });
  }
}
