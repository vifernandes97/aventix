'use client';

// Painel de DETALHES + CANCELAMENTO (CLAUDE.md secao 11.1).
//
// Overlay sobre o calendario, nunca navegacao: o dono esta olhando a agenda do
// dia e quer ver uma reserva sem perder o contexto — e, depois de cancelar, quer
// continuar exatamente onde estava. Uma rota /admin/reservas/{id} (secao 14)
// continua fazendo sentido como pagina propria, para link direto; nao e o que
// esta tarefa pede.
//
// DADOS SOB DEMANDA: a grade ja veio do servidor com o minimo por reserva
// (secao 11.1). O detalhe completo — participantes, documentos, CPF, pagamentos
// — so e buscado quando o dono CLICA. Isso nao fura o "uma query por render":
// aquilo governa o RENDER do periodo, e o que acontece aqui e um pedido por
// interacao explicita, de UMA reserva.
//
// >>> DADO SENSIVEL <<<
// Este componente recebe CPF e numero de documento. Eles chegam pelo CORPO da
// resposta (nunca por URL) e sao exibidos porque isto e o painel do dono, atras
// do login, olhando os proprios clientes. Nao logue o payload; nao o coloque em
// querystring ao acrescentar qualquer funcionalidade aqui.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReservationDetail } from '@/lib/reservation-detail';
import {
  DETAIL_STATUS_BADGE,
  DETAIL_STATUS_LABEL,
  fullDateLabelOf,
  moneyLabel,
  stampLabel,
  timeLabel,
} from './shared';

/** Rotulos do tenant (secao 3: texto de UI vem de settings, nunca hardcoded). */
export type PanelLabels = {
  operator: string;
  passenger: string;
  document: string;
  resourcePlural: string;
};

type Props = {
  reservationId: string;
  labels: PanelLabels;
  onClose: () => void;
  /** Chamado depois de um cancelamento bem-sucedido, para a grade se atualizar. */
  onCancelled: () => void;
};

/** O que o dono precisa digitar para confirmar. Maiusculas, exato. */
const CONFIRM_WORD = 'CANCELAR';

/** Status em que cancelar faz sentido (secao 5.1). O servidor revalida. */
const CANCELLABLE: readonly string[] = ['pending_payment', 'confirmed'];

export function ReservationPanel({ reservationId, labels, onClose, onCancelled }: Props) {
  const [detail, setDetail] = useState<ReservationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  // -- carga -----------------------------------------------------------------
  //
  // Sem reset de estado no corpo do efeito: o pai monta este componente com
  // `key={selectedId}`, entao trocar de reserva REMONTA e todo o estado ja nasce
  // limpo. Zerar a mao aqui seria uma segunda fonte de verdade para a mesma
  // regra — e a versao que o React desaconselha explicitamente.
  useEffect(() => {
    // AbortController: se o painel fechar antes de a resposta chegar, o setState
    // tardio cairia num componente desmontado.
    const controller = new AbortController();

    fetch(`/api/admin/reservations/${reservationId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? 'Reserva não encontrada.'
              : `Não foi possível carregar a reserva (HTTP ${response.status}).`,
          );
        }
        const body = (await response.json()) as { reservation: ReservationDetail };
        setDetail(body.reservation);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'Falha ao carregar.');
      });

    return () => controller.abort();
  }, [reservationId]);

  // -- fechar por Esc --------------------------------------------------------
  //
  // No documento e nao no painel: o foco pode estar em qualquer lugar (o dono
  // acabou de clicar num bloco atras do overlay), e um handler preso ao painel
  // so responderia com o foco dentro dele.
  const handleClose = useCallback(() => {
    if (cancelling) return; // requisicao em voo: nao feche por baixo dela
    onClose();
  }, [cancelling, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  // Foco entra no painel ao abrir: sem isso, o leitor de tela continua no bloco
  // do calendario e o Esc so funciona por causa do listener de documento acima.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Trava a rolagem do documento enquanto o painel esta aberto.
  //
  // OBSERVADO no navegador, nao teorizado: com o painel aberto, rolar sobre ele
  // (ou o gesto de rolagem do celular) arrastava a PAGINA atras. Numa tela de
  // campo, isso significa fechar o painel e reencontrar a agenda em outro ponto
  // do dia. O overflow original e restaurado no cleanup, e nao fixado em
  // 'auto', para nao apagar um valor que a folha de estilo tenha definido.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // -- cancelamento ----------------------------------------------------------
  async function submitCancel() {
    if (typed !== CONFIRM_WORD || cancelling) return;

    setCancelling(true);
    setCancelError(null);

    try {
      const response = await fetch(`/api/admin/reservations/${reservationId}/cancel`, {
        method: 'POST',
      });

      const body = (await response.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
        detail?: string;
      };

      if (!response.ok) {
        // 409 = a reserva mudou de estado por outro caminho (o cron expirou o
        // hold, outro dispositivo cancelou). Nao e erro do dono; e informacao.
        setCancelError(
          response.status === 409
            ? 'Esta reserva não está mais em um estado que permita cancelamento. Feche e abra de novo para ver o estado atual.'
            : (body.error ?? `Falha ao cancelar (HTTP ${response.status}).`),
        );
        return;
      }

      // Reflete no proprio painel ANTES de avisar a grade: o dono acabou de
      // digitar CANCELAR e precisa ver a confirmacao do que aconteceu, nao um
      // painel que se fecha sozinho.
      setDetail((current) => (current ? { ...current, status: 'cancelled' } : current));
      setConfirming(false);
      setTyped('');
      onCancelled();
    } catch {
      setCancelError('Falha de rede ao cancelar. A reserva pode não ter sido alterada — confira.');
    } finally {
      setCancelling(false);
    }
  }

  const canCancel = detail !== null && CANCELLABLE.includes(detail.status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Clique FORA fecha. Elemento proprio, irmao do painel — um onClick no
          container com checagem de target erraria em clique que comeca dentro
          do painel e termina fora (selecao de texto arrastada). */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={handleClose}
        aria-hidden
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Detalhe da reserva"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl outline-none dark:bg-neutral-950 sm:max-w-lg"
      >
        {/* -- cabecalho ------------------------------------------------------ */}
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-white p-4 dark:bg-neutral-950">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              {detail ? detail.experience.name : 'Carregando…'}
            </h2>
            {detail && (
              <p className="mt-0.5 text-xs text-neutral-500">
                {fullDateLabelOf(detail.startAt)} · {timeLabel(detail.startAt)}–
                {timeLabel(detail.endAt)}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label="Fechar"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xl leading-none transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ×
          </button>
        </header>

        {loadError && (
          <p className="m-4 rounded border border-red-500/50 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-100">
            {loadError}
          </p>
        )}

        {!detail && !loadError && (
          <p className="p-4 text-sm text-neutral-500">Carregando detalhe…</p>
        )}

        {detail && (
          <div className="flex flex-col gap-5 p-4">
            {/* -- status ---------------------------------------------------- */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${DETAIL_STATUS_BADGE[detail.status]}`}
              >
                {DETAIL_STATUS_LABEL[detail.status]}
              </span>

              {detail.status === 'pending_payment' && detail.holdExpiresAt && (
                <span className="text-xs text-neutral-500">
                  Reserva segurada até {stampLabel(detail.holdExpiresAt)}
                </span>
              )}

              {detail.channel && (
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  Origem: {detail.channel}
                </span>
              )}
            </div>

            {/* -- passeio --------------------------------------------------- */}
            <Section title="Passeio">
              <Field label="Início">{timeLabel(detail.startAt)}</Field>
              <Field label="Fim">
                {timeLabel(detail.endAt)}{' '}
                <span className="text-neutral-500">
                  ({detail.durationMinutes} min
                  {detail.bufferMinutes > 0 && ` + ${detail.bufferMinutes} min de intervalo`})
                </span>
              </Field>
              <Field label={labels.resourcePlural}>
                {detail.resources.length > 0
                  ? detail.resources.map((r) => r.name).join(', ')
                  : '—'}
                {/* resources_needed x linhas realmente alocadas: se divergirem, o
                    dado esta corrompido e o dono precisa enxergar isso. */}
                {detail.resources.length !== detail.resourcesNeeded && (
                  <span className="ml-1 text-amber-700 dark:text-amber-300">
                    (pedidos: {detail.resourcesNeeded})
                  </span>
                )}
              </Field>
              <Field label="Criada em">{stampLabel(detail.createdAt)}</Field>
              {detail.cancelledAt && (
                <Field label="Cancelada em">{stampLabel(detail.cancelledAt)}</Field>
              )}
            </Section>

            {/* -- cliente --------------------------------------------------- */}
            <Section title="Cliente">
              <Field label="Nome">{detail.customer.name}</Field>
              <Field label="Telefone">
                {/* tel: com os digitos ja normalizados — e a tela que o dono usa
                    em campo, com o telefone na mao. */}
                <a href={`tel:${detail.customer.phone}`} className="underline underline-offset-2">
                  {detail.customer.phone}
                </a>
              </Field>
              <Field label="E-mail">{detail.customer.email ?? '—'}</Field>
              <Field label="CPF">{detail.customer.cpf ?? '—'}</Field>
              <Field label="Nascimento">{dateBr(detail.customer.birthdate)}</Field>
            </Section>

            {/* -- participantes --------------------------------------------- */}
            <Section title={`Participantes (${detail.participants.length})`}>
              {detail.participants.length === 0 && <p className="text-sm text-neutral-500">—</p>}

              <ul className="flex flex-col gap-2">
                {detail.participants.map((participant) => (
                  <li
                    key={participant.id}
                    className="rounded border p-2.5 text-sm dark:border-neutral-800"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{participant.name}</span>
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        {/* Rotulo do TENANT (secao 3), nunca "Condutor" hardcoded. */}
                        {participant.role === 'operator' ? labels.operator : labels.passenger}
                      </span>
                    </div>

                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-neutral-600 dark:text-neutral-400">
                      {participant.role === 'operator' && (
                        <>
                          <dt>{labels.document}:</dt>
                          <dd className="tabular-nums">{participant.documentNumber ?? '—'}</dd>
                        </>
                      )}
                      <dt>Nascimento:</dt>
                      <dd className="tabular-nums">{dateBr(participant.birthdate)}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </Section>

            {/* -- pagamento -------------------------------------------------- */}
            <Section title="Pagamento">
              <Field label="Total">{moneyLabel(detail.totalPriceCents)}</Field>
              <Field label="Pago">{moneyLabel(detail.payment.amountPaidCents)}</Field>
              <Field label="Em aberto">{moneyLabel(detail.payment.balanceCents)}</Field>

              <ul className="mt-1 flex flex-col gap-1 text-xs">
                {detail.payment.rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-baseline justify-between gap-2 rounded bg-neutral-50 px-2 py-1.5 dark:bg-neutral-900"
                  >
                    <span>
                      {PAYMENT_KIND_LABEL[row.kind]}
                      {row.receivedInCash && ' (recebido por fora)'}
                    </span>
                    <span className="shrink-0 tabular-nums text-neutral-600 dark:text-neutral-400">
                      {moneyLabel(row.amountCents)} · {PAYMENT_STATE_LABEL[row.state]}
                    </span>
                  </li>
                ))}
              </ul>

              {/*
                A cobranca do saldo (QR na hora / "Recebi por fora", secao 11.1)
                entra AQUI na costura da Fase 2. Hoje nenhuma cobranca existe no
                Asaas, entao um botao de cobrar so poderia mentir.
              */}
              <p className="mt-1 text-[11px] text-neutral-400">
                Cobrança de saldo entra com a integração de pagamento.
              </p>
            </Section>

            {/* -- cancelamento ---------------------------------------------- */}
            {canCancel && (
              <section className="mt-1 border-t pt-4 dark:border-neutral-800">
                {!confirming ? (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="w-full rounded-md border border-red-600/60 px-3 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                  >
                    Cancelar reserva
                  </button>
                ) : (
                  <div className="flex flex-col gap-2 rounded-md border border-red-600/60 p-3">
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">
                      Esta ação é irreversível.
                    </p>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400">
                      A reserva sai da agenda e os horários dos{' '}
                      {labels.resourcePlural.toLowerCase()} são liberados para outros clientes. Não
                      há como desfazer — seria preciso criar uma reserva nova, e o horário pode já
                      ter sido vendido.
                      {detail.payment.amountPaidCents > 0 && (
                        <>
                          {' '}
                          <strong>
                            O valor já pago não é estornado automaticamente: o estorno é feito por
                            você no painel do Asaas.
                          </strong>
                        </>
                      )}
                    </p>

                    <label className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                      Digite <span className="font-mono font-semibold">{CONFIRM_WORD}</span> para
                      confirmar:
                      <input
                        type="text"
                        value={typed}
                        onChange={(event) => setTyped(event.target.value)}
                        // Teclado de celular: o dono digita isso com o dedo, no
                        // sabado, em campo. Correcao automatica trocaria a
                        // palavra e a capitalizacao automatica mascararia o
                        // proprio ponto do teste (exato, em maiusculas).
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        autoComplete="off"
                        autoFocus
                        className="mt-1 w-full rounded border px-2 py-2 font-mono text-sm tracking-widest dark:border-neutral-700 dark:bg-neutral-900"
                      />
                    </label>

                    {cancelError && (
                      <p className="text-xs text-red-700 dark:text-red-300">{cancelError}</p>
                    )}

                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        onClick={submitCancel}
                        disabled={typed !== CONFIRM_WORD || cancelling}
                        className="flex-1 rounded-md bg-red-600 px-3 py-2.5 text-sm font-medium text-white transition enabled:hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {cancelling ? 'Cancelando…' : 'Confirmar cancelamento'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirming(false);
                          setTyped('');
                          setCancelError(null);
                        }}
                        disabled={cancelling}
                        className="rounded-md border px-3 py-2.5 text-sm transition hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
                      >
                        Voltar
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {!canCancel && (
              <p className="border-t pt-4 text-xs text-neutral-500 dark:border-neutral-800">
                {/* Estado terminal: nada a cancelar. Dizer o porque evita o dono
                    procurar um botao que nao existe. */}
                Reserva {DETAIL_STATUS_LABEL[detail.status].toLowerCase()} — não há o que cancelar.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// -- pecas de layout ---------------------------------------------------------

const PAYMENT_KIND_LABEL: Record<'full' | 'deposit' | 'balance', string> = {
  full: 'Valor integral',
  deposit: 'Sinal',
  balance: 'Saldo',
};

const PAYMENT_STATE_LABEL: Record<'pending' | 'paid' | 'cancelled' | 'refunded', string> = {
  pending: 'aguardando',
  paid: 'pago',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY'. Coluna `date`: NAO passa por new Date() (secao 3). */
function dateBr(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="flex flex-wrap gap-x-2 text-sm">
      <span className="text-neutral-500">{label}:</span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}
