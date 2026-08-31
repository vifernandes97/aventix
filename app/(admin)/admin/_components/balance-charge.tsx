'use client';

// Cobranca do SALDO no painel de detalhe (CLAUDE.md secao 11.1, Fase C).
//
// >>> ESTA TELA E USADA NO CELULAR, EM CAMPO, COM O CLIENTE ESPERANDO. <<<
// Tres consequencias que governam o desenho:
//
// 1. O botao se desabilita no instante do toque. E a PRIMEIRA barreira contra o
//    duplo toque, nao a garantia — a garantia e o servidor (tres camadas em
//    lib/payments/balance-charge.ts). Barreira de tela some com um refresh, uma
//    aba duplicada ou um toque que o navegador entrega duas vezes; ela existe
//    para o caso comum ser rapido, nao para ser confiavel.
//
// 2. O VALOR aparece sempre, mesmo quando o QR falha. E o numero que o dono
//    cobra na maquininha, e ele sai do nosso banco — nao pode sumir da tela
//    porque o provedor esta fora.
//
// 3. O copia-e-cola vem junto do QR. O cliente pode estar sem camera livre, com
//    o app do banco ja aberto, ou pedindo por WhatsApp de longe.
//
// O QR NUNCA e persistido (secao 7.2): ele expira. Toda exibicao busca o atual.

import { useCallback, useEffect, useState } from 'react';

import { ReceiveInCash, type CardMachineRate } from './receive-in-cash';
import { moneyLabel } from './shared';

type Props = {
  reservationId: string;
  /** Saldo em aberto, do detalhe ja carregado. Fonte do numero exibido. */
  balanceCents: number;
  /** Fase D: registro na maquininha concluido — o painel rele o detalhe. */
  onRegistered: () => void;
};

type Qr = { qrCodeBase64: string; copyPaste: string; expiresAt: string | null };

type BalanceState = {
  hasCharge: boolean;
  chargeable: boolean;
  code?: string;
  detail?: string;
  payment: Qr | null;
  /** Fase D: taxas vigentes, para a previa dos tres numeros. Pode vir vazia. */
  cardMachineRates: CardMachineRate[];
};

/** Mensagens por `code` do servidor. O dono precisa saber O QUE fazer. */
const CODE_MESSAGE: Record<string, string> = {
  saldo_quitado: 'Este saldo já foi pago.',
  reserva_inativa: 'A reserva foi cancelada ou expirou — não há o que cobrar.',
  sinal_pendente: 'A reserva ainda aguarda o pagamento do sinal.',
  sem_saldo: 'Esta reserva não tem saldo a cobrar.',
  cobranca_em_andamento: 'A cobrança está sendo gerada. Aguarde um instante e tente de novo.',
  provedor_indisponivel: 'Não foi possível falar com o Asaas. A cobrança NÃO foi criada.',
  provedor_recusou: 'O Asaas recusou a cobrança.',
  qr_indisponivel:
    'A cobrança existe e nada foi duplicado — só o QR não veio agora. Tente de novo ou abra a fatura.',
};

export function BalanceCharge({ reservationId, balanceCents, onRegistered }: Props) {
  const [state, setState] = useState<BalanceState | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [charging, setCharging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fallbackInvoice, setFallbackInvoice] = useState<string | null>(null);

  // Leitura ao abrir. NAO cria nada — e por isso que o GET e uma rota separada
  // do POST (ver o cabecalho da rota).
  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/admin/reservations/${reservationId}/balance`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as BalanceState;
        setState(body);
        if (body.payment) setQr(body.payment);
      })
      .catch(() => {
        // Silencioso de proposito: o valor do saldo ja esta na tela vindo do
        // detalhe, e um erro aqui so significa "ainda nao sei se ha cobranca".
      });

    return () => controller.abort();
  }, [reservationId]);

  const cobrar = useCallback(async () => {
    // Guarda de reentrada. Ver a nota 1 do cabecalho: primeira barreira, nao a
    // garantia.
    if (charging) return;

    setCharging(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/reservations/${reservationId}/balance/charge`, {
        method: 'POST',
      });
      const body = (await response.json()) as {
        payment?: Qr;
        code?: string;
        detail?: string;
        invoiceUrl?: string | null;
      };

      if (!response.ok) {
        setError(
          (body.code && CODE_MESSAGE[body.code]) ??
            body.detail ??
            `Não foi possível gerar a cobrança (HTTP ${response.status}).`,
        );
        // Saida imediata quando a cobranca existe e so o QR falhou: a fatura
        // mostra o mesmo Pix sem depender da chamada que acabou de falhar.
        if (body.invoiceUrl) setFallbackInvoice(body.invoiceUrl);
        return;
      }

      if (body.payment) {
        setQr(body.payment);
        setState((prev) => (prev ? { ...prev, hasCharge: true } : prev));
      }
    } catch {
      setError('Falha de rede ao gerar a cobrança.');
    } finally {
      setCharging(false);
    }
  }, [charging, reservationId]);

  const copiar = useCallback(async () => {
    if (!qr) return;
    try {
      await navigator.clipboard.writeText(qr.copyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Não foi possível copiar. Segure o código para copiar à mão.');
    }
  }, [qr]);

  // Saldo nao cobravel: diz por que, e nao oferece botao que o servidor vai
  // recusar. A razao vem do MESMO lugar que a rota usa para recusar.
  if (state && !state.chargeable) {
    return (
      <p className="mt-2 rounded bg-neutral-100 px-2 py-1.5 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
        {(state.code && CODE_MESSAGE[state.code]) ?? 'Saldo não cobrável no momento.'}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {!qr && (
        <button
          type="button"
          onClick={cobrar}
          disabled={charging}
          className="w-full rounded-md bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {charging ? 'Gerando cobrança…' : `Cobrar saldo (${moneyLabel(balanceCents)})`}
        </button>
      )}

      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
        >
          {error}
        </p>
      )}

      {fallbackInvoice && !qr && (
        <a
          href={fallbackInvoice}
          target="_blank"
          rel="noreferrer"
          className="w-full rounded border px-3 py-2 text-center text-sm dark:border-neutral-700"
        >
          Abrir fatura no Asaas
        </a>
      )}

      {/*
        OS DOIS CAMINHOS DE QUITACAO, lado a lado (secao 1): cobranca online e
        recebimento por fora. O segundo NAO desaparece quando o QR aparece — o
        guia pode ter gerado o QR e o cliente ter preferido a maquininha, e
        esconder a opcao deixaria o saldo fora do sistema, que e o que a secao 1
        proibe em voz alta.
      */}
      <ReceiveInCash
        reservationId={reservationId}
        balanceCents={balanceCents}
        rates={state?.cardMachineRates ?? []}
        onRegistered={onRegistered}
      />

      {qr && (
        <div className="flex flex-col items-center gap-2 rounded border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            Pix de {moneyLabel(balanceCents)} — mostre ao cliente
          </p>

          {/* eslint-disable-next-line @next/next/no-img-element -- base64 do
              provedor, sem URL para o next/image otimizar */}
          <img
            src={`data:image/png;base64,${qr.qrCodeBase64}`}
            alt={`QR Code Pix de ${moneyLabel(balanceCents)}`}
            className="h-44 w-44"
          />

          <button
            type="button"
            onClick={copiar}
            className="w-full rounded border px-3 py-2 text-sm dark:border-neutral-700"
          >
            {copied ? 'Copiado!' : 'Copiar código Pix'}
          </button>
        </div>
      )}
    </div>
  );
}
