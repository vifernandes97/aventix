'use client';

// Acompanhamento da reserva: os CINCO estados + o polling (CLAUDE.md secao 14).
//
// >>> NENHUM ESTADO PODE CAIR EM TELA BRANCA OU EM "CARREGANDO" ETERNO <<<
// Esta e a tela em que o cliente esta com o dinheiro na mao. Todo caminho —
// inclusive reserva inexistente, provedor fora do ar e internet caindo — termina
// numa frase que diz o que aconteceu e o que fazer agora.
//
// >>> O RELOGIO E O DO SERVIDOR <<<
// A contagem regressiva NUNCA sai de `Date.now()` cru contra `holdExpiresAt`. A
// rota devolve `serverNow` junto, e a diferenca entre os dois vira um OFFSET
// aplicado ao relogio local. Celular adiantado marcaria "expirada" com a reserva
// viva; atrasado, o contrario — e o cliente acreditaria na tela.
//
// >>> O QR VEM DA ROTA, SEMPRE <<<
// Mesmo na primeira carga vinda do wizard (que tem o QR do 201 na memoria). Um
// caminho so, e e o unico que sobrevive a refresh. O QR expira, entao nada disso
// e cacheado nem persistido (secao 7.2).

import { useCallback, useEffect, useRef, useState } from 'react';

import { MeetingPointMap } from '@/app/(public)/_components/meeting-point-map';

import {
  durationLabel,
  fullDateFromInstant,
  moneyLabel,
  timeLabel,
} from '../../../_components/shared';

// ============================================================================
// Contrato com as rotas
// ============================================================================

type ReservationStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';

/** Espelha o payload de GET /api/reservations/{id}/status. Sem dado pessoal. */
type StatusPayload = {
  status: ReservationStatus;
  paymentMode: 'full' | 'deposit';
  paymentState: 'pending' | 'paid' | 'cancelled' | 'refunded' | null;
  amountPaidCents: number;
  balanceCents: number;
  holdExpiresAt: string | null;
  serverNow: string;
  experienceName: string;
  startAt: string;
  durationMinutes: number;
};

/** Espelha GET /api/reservations/{id}/payment. */
type QrPayload = {
  qrCodeBase64: string;
  copyPaste: string;
  expiresAt: string | null;
  dueNowCents: number;
};

/**
 * Textos do TENANT (secao 3: nada hardcoded). Qualquer um pode chegar VAZIO —
 * e a tela omite o bloco correspondente em vez de desenhar rotulo sem valor.
 */
export type StatusLabels = {
  business_name: string;
  meeting_point: string;
  meeting_point_map_url: string;
  what_to_bring: string;
  support_whatsapp: string;
  reply_to_email: string;
};

// ============================================================================
// Ritmo do polling
// ============================================================================

/** Primeiros 2 minutos: e a janela em que o Pix normalmente cai. */
const FAST_INTERVAL_MS = 4_000;
const SLOW_INTERVAL_MS = 8_000;
const FAST_WINDOW_MS = 120_000;

/**
 * Erros de rede consecutivos ate desistir. Passado disso a tela para e oferece
 * o botao manual: insistir sozinha para sempre gasta bateria e dados de quem
 * esta sem sinal, e nao conserta nada.
 */
const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Quanto tempo seguir consultando DEPOIS de o hold vencer.
 *
 * O cron de expiracao roda a cada minuto (secao 12), entao existe uma janela em
 * que o hold ja passou e o banco ainda diz `pending_payment`. Nessa janela a
 * tela mostra "verificando pagamento" e NAO anuncia expiracao — anunciar o que o
 * banco nao confirmou faria o cliente que acabou de pagar ler que perdeu a vaga.
 */
const GRACE_AFTER_HOLD_MS = 120_000;

type StopReason = 'terminal' | 'errors' | 'stale' | 'notfound';

// ============================================================================
// Componente
// ============================================================================

export function ReservationStatusView({
  reservationId,
  labels,
}: {
  reservationId: string;
  labels: StatusLabels;
}) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [stopReason, setStopReason] = useState<StopReason | null>(null);
  const [checking, setChecking] = useState(false);

  const [qr, setQr] = useState<QrPayload | null>(null);
  const [qrError, setQrError] = useState<'sem_cobranca' | 'falhou' | null>(null);

  /**
   * Correcao do relogio: `serverNow - Date.now()` na ultima resposta. Vive em
   * ESTADO, e nao em ref, porque a contagem regressiva o LE durante o render —
   * e ler ref no render devolve valor que o React nao rastreia, entao a tela
   * poderia ficar com um offset velho ate o proximo re-render por outro motivo.
   */
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  /**
   * "Agora" local, atualizado a cada segundo pelo relogio da contagem. Existe
   * para o render nao chamar `Date.now()`: funcao impura durante o render
   * produz resultado que muda sem o React saber, e a regressiva pularia ou
   * congelaria conforme o componente casualmente re-renderizasse.
   */
  const [nowMs, setNowMs] = useState(0);

  /** Chamada de verificacao avulsa, publicada pelo efeito para o botao manual. */
  const manualCheckRef = useRef<(() => void) | null>(null);

  // -- polling ---------------------------------------------------------------
  //
  // Tudo dentro de UM efeito, com setTimeout que se reagenda: `setInterval`
  // dispararia a proxima chamada mesmo com a anterior ainda em voo, e numa rede
  // ruim isso vira uma fila de requisicoes sobrepostas.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let errors = 0;
    let stopped = false;
    // Motivo da ultima parada, em variavel de CLOSURE e nao em ref: o efeito
    // precisa dele e nunca o le durante o render. Mante-lo aqui tambem evita
    // por `stopReason` nas dependencias, o que reinscreveria o efeito a cada
    // parada e reiniciaria o polling do zero (de volta ao ritmo rapido, com a
    // contagem de erros zerada).
    let stopKind: StopReason | null = null;
    const startedAt = Date.now();

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const stop = (reason: StopReason) => {
      stopped = true;
      stopKind = reason;
      clear();
      setStopReason(reason);
    };

    /**
     * Hold vencido ha mais que a tolerancia, com o banco ainda em pending.
     *
     * Compara os DOIS campos da mesma resposta — `serverNow` contra
     * `holdExpiresAt` —, sem tocar no relogio local. Aqui nao ha por que
     * corrigir offset: as duas pontas ja vem do mesmo relogio, o do banco.
     */
    const isStale = (data: StatusPayload): boolean => {
      if (!data.holdExpiresAt) return false;
      const overdueMs =
        new Date(data.serverNow).getTime() - new Date(data.holdExpiresAt).getTime();
      return overdueMs > GRACE_AFTER_HOLD_MS;
    };

    const schedule = () => {
      clear();
      if (cancelled || stopped) return;
      // Aba oculta: nao agenda nada. Quem retoma e o listener de
      // visibilitychange, com uma chamada imediata. Sem isto, uma aba esquecida
      // aberta bateria nesta API a noite inteira.
      if (document.visibilityState === 'hidden') return;
      const delay = Date.now() - startedAt < FAST_WINDOW_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
      timer = setTimeout(() => void tick(), delay);
    };

    async function tick(): Promise<void> {
      if (cancelled) return;
      clear();

      try {
        const response = await fetch(`/api/reservations/${reservationId}/status`, {
          cache: 'no-store',
        });
        if (cancelled) return;

        // 404 cobre inexistente, id malformado e reserva de outro tenant — a
        // rota nao os distingue de proposito, e a tela tambem nao precisa.
        if (response.status === 404) {
          setLoading(false);
          stop('notfound');
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = (await response.json()) as StatusPayload;
        if (cancelled) return;

        errors = 0;
        const localNow = Date.now();
        setClockOffsetMs(new Date(data.serverNow).getTime() - localNow);
        setNowMs(localNow);
        setStatus(data);
        setLoading(false);
        setStopReason(null);
        stopped = false;
        stopKind = null;

        if (data.status !== 'pending_payment') {
          stop('terminal');
          return;
        }
        if (isStale(data)) {
          stop('stale');
          return;
        }
        schedule();
      } catch {
        if (cancelled) return;
        errors += 1;
        setLoading(false);
        if (errors >= MAX_CONSECUTIVE_ERRORS) {
          stop('errors');
          return;
        }
        schedule();
      }
    }

    // Verificacao avulsa: o botao "ja paguei, verificar agora" e a retomada
    // depois de uma sequencia de erros. Reserva em estado terminal nao tem o que
    // reverificar, e id inexistente nao vira existente por insistencia.
    manualCheckRef.current = () => {
      if (cancelled) return;
      // Reserva em estado terminal nao tem o que reverificar, e id inexistente
      // nao vira existente por insistencia. Nos demais casos ('errors',
      // 'stale'), o toque RETOMA o polling.
      if (stopKind === 'terminal' || stopKind === 'notfound') return;

      errors = 0;
      stopped = false;
      setStopReason(null);
      setChecking(true);
      void tick().finally(() => {
        if (!cancelled) setChecking(false);
      });
    };

    const onVisibilityChange = () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') {
        // Volta com chamada IMEDIATA: quem retorna para a aba quer saber agora,
        // nao daqui a 8 segundos. O proprio tick reagenda o ritmo normal.
        if (!stopped) void tick();
      } else {
        clear();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    void tick();

    // Sem esta limpeza o timer sobrevive a navegacao e a pagina continua
    // chamando a API depois de fechada.
    return () => {
      cancelled = true;
      clear();
      manualCheckRef.current = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [reservationId]);

  // -- QR, UMA vez ------------------------------------------------------------
  //
  // Depois da PRIMEIRA resposta de status, e so se ela vier pendente: buscar
  // antes gastaria uma chamada ao provedor em reserva ja confirmada, que e o
  // caso de quem reabre o link no dia seguinte.
  const qrRequestedRef = useRef(false);
  useEffect(() => {
    if (!status || status.status !== 'pending_payment') return;
    if (qrRequestedRef.current) return;
    qrRequestedRef.current = true;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/reservations/${reservationId}/payment`, {
          cache: 'no-store',
        });
        if (cancelled) return;

        if (response.ok) {
          setQr((await response.json()) as QrPayload);
          return;
        }

        const body = (await response.json().catch(() => null)) as { code?: string } | null;
        setQrError(body?.code === 'sem_cobranca' ? 'sem_cobranca' : 'falhou');
      } catch {
        if (!cancelled) setQrError('falhou');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, reservationId]);

  // -- relogio da contagem regressiva ------------------------------------------
  //
  // Uma leitura de `Date.now()` por segundo, SO enquanto ha hold vivo para
  // contar. O callback do interval nao e render, entao chamar `Date.now()` aqui
  // e legitimo — e e o unico lugar do componente que o faz.
  const counting = status?.status === 'pending_payment' && Boolean(status.holdExpiresAt);
  useEffect(() => {
    if (!counting) return;
    const clock = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(clock);
  }, [counting]);

  const onManualCheck = useCallback(() => manualCheckRef.current?.(), []);

  // ==========================================================================
  // Render
  // ==========================================================================

  const contact = <ContactBlock labels={labels} />;

  let body: React.ReactNode;

  if (loading) {
    body = (
      <Card>
        <p className="text-sm text-stone-400">Carregando sua reserva…</p>
      </Card>
    );
  } else if (stopReason === 'notfound' || !status) {
    // Nao encontrada. Nao e um dos cinco estados de reserva, mas e um desfecho
    // possivel de QUALQUER link colado errado — e sem este ramo a tela ficaria
    // em branco, que e o unico resultado proibido.
    body = (
      <Card tone="warn">
        <h1 className="text-lg font-semibold text-amber-200">Não encontramos essa reserva</h1>
        <p className="mt-2 text-sm text-stone-300">
          O link pode estar incompleto ou ter sido digitado errado. Confira se copiou o endereço
          inteiro.
        </p>
      </Card>
    );
  } else if (status.status === 'confirmed') {
    body = <Confirmed status={status} reservationId={reservationId} labels={labels} />;
  } else if (status.status === 'expired') {
    body = (
      <Card tone="warn">
        <h1 className="text-lg font-semibold text-amber-200">O tempo para pagamento acabou</h1>
        <p className="mt-2 text-sm text-stone-300">
          A vaga foi liberada e esta reserva não vale mais. Para ir ao passeio, é preciso fazer um
          novo agendamento.
        </p>
        {/* Pagamento tardio EXISTE (secao 5.1 e 8.3): o Pix pode ter caido depois
            do hold vencer. Quem pagou nao pode sair desta tela achando que perdeu
            o dinheiro — o dono resolve caso a caso, e para isso o cliente precisa
            conseguir falar com ele. */}
        <p className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-sm text-amber-100">
          <strong className="font-semibold">Se você já pagou</strong>, fale com a gente antes de
          agendar de novo: o pagamento pode ter caído depois do prazo e nós resolvemos com você.
        </p>
        <ReservationCode reservationId={reservationId} />
      </Card>
    );
  } else if (status.status === 'cancelled') {
    body = (
      <Card tone="warn">
        <h1 className="text-lg font-semibold text-amber-200">Esta reserva foi cancelada</h1>
        <p className="mt-2 text-sm text-stone-300">
          O cancelamento foi feito pelo {labels.business_name.trim() || 'organizador'}. Se você já
          tinha pago, fale com a gente para acertar a devolução.
        </p>
        <ReservationCode reservationId={reservationId} />
      </Card>
    );
  } else if (stopReason === 'stale') {
    // Pendente, hold vencido ha mais de 2 min, banco ainda nao expirou.
    body = (
      <Card>
        <h1 className="text-lg font-semibold text-stone-100">Verificando pagamento…</h1>
        <p className="mt-2 text-sm text-stone-400">
          O prazo desta reserva terminou, mas ainda estamos confirmando se o pagamento chegou. Se
          você pagou, toque abaixo para verificar de novo.
        </p>
        <ManualCheckButton onClick={onManualCheck} checking={checking} />
        <ReservationCode reservationId={reservationId} />
      </Card>
    );
  } else {
    body = (
      <PendingPayment
        status={status}
        reservationId={reservationId}
        qr={qr}
        qrError={qrError}
        clockOffsetMs={clockOffsetMs}
        nowMs={nowMs}
        onManualCheck={onManualCheck}
        checking={checking}
        networkDown={stopReason === 'errors'}
      />
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-stone-950 text-stone-100">
      {labels.business_name.trim() && (
        <header className="border-b border-stone-800 px-4 py-3">
          <p className="text-sm font-semibold tracking-wide text-orange-200">
            {labels.business_name}
          </p>
        </header>
      )}

      <main className="flex-1 px-4 py-6">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
          {body}
          {contact}
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// Estado 1 e 2 — aguardando pagamento
// ============================================================================

function PendingPayment({
  status,
  reservationId,
  qr,
  qrError,
  clockOffsetMs,
  nowMs,
  onManualCheck,
  checking,
  networkDown,
}: {
  status: StatusPayload;
  reservationId: string;
  qr: QrPayload | null;
  qrError: 'sem_cobranca' | 'falhou' | null;
  clockOffsetMs: number;
  nowMs: number;
  onManualCheck: () => void;
  checking: boolean;
  networkDown: boolean;
}) {
  // `nowMs + clockOffsetMs` = agora segundo o BANCO. Nunca `Date.now()` cru:
  // celular adiantado marcaria "expirada" com a reserva viva (ver o cabecalho).
  const remainingMs = status.holdExpiresAt
    ? new Date(status.holdExpiresAt).getTime() - (nowMs + clockOffsetMs)
    : null;

  // Hold ja vencido, dentro da tolerancia: o cron pode nao ter rodado ainda.
  // A tela para de contar e passa a dizer "verificando", NUNCA "expirou".
  const overdue = remainingMs !== null && remainingMs <= 0;

  return (
    <>
      <Card>
        <h1 className="text-lg font-semibold text-orange-200">
          {overdue ? 'Verificando pagamento…' : 'Falta pagar'}
        </h1>
        <p className="mt-1 text-sm text-stone-400">
          {overdue
            ? 'O prazo terminou, mas ainda estamos confirmando se o seu pagamento chegou.'
            : 'Sua vaga está guardada. Pague o Pix abaixo para confirmar a reserva.'}
        </p>

        {!overdue && remainingMs !== null && (
          <p className="mt-3 text-sm text-stone-300">
            Tempo restante:{' '}
            <strong className="font-mono text-base text-orange-200">
              {countdownLabel(remainingMs)}
            </strong>
          </p>
        )}

        {qr && (
          <div className="mt-4">
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- base64 do provedor, sem host externo para o next/image otimizar */}
              <img
                src={`data:image/png;base64,${qr.qrCodeBase64}`}
                alt="QR Code do Pix para pagar a reserva"
                className="h-56 w-56 rounded-lg bg-white p-2"
              />
            </div>
            <p className="mt-3 text-center text-sm text-stone-300">
              Abra o app do seu banco, escolha <strong className="text-stone-100">Pix</strong> e
              aponte para o código — ou copie o código abaixo.
            </p>
            <CopyPasteBox copyPaste={qr.copyPaste} />
            <p className="mt-3 text-center text-sm font-medium text-stone-200">
              Valor: {moneyLabel(qr.dueNowCents)}
            </p>
          </div>
        )}

        {!qr && qrError === null && (
          <p className="mt-4 text-sm text-stone-400">Gerando o código de pagamento…</p>
        )}

        {qrError && (
          <div className="mt-4 rounded-xl border border-dashed border-amber-700/60 bg-amber-950/20 px-4 py-4 text-center">
            <p className="text-sm font-medium text-amber-200">
              {qrError === 'sem_cobranca'
                ? 'Não há um código de pagamento para esta reserva'
                : 'Não conseguimos carregar o código de pagamento agora'}
            </p>
            <p className="mt-1 text-xs text-amber-200/80">
              {qrError === 'sem_cobranca'
                ? 'Fale com a gente pelo contato abaixo para concluir o pagamento.'
                : 'Atualize a página em instantes. Se já pagou, esta tela avisa assim que o pagamento cair.'}
            </p>
          </div>
        )}

        {/* A promessa que evita o cliente ficar recarregando a pagina na mao. */}
        <p className="mt-4 rounded-lg border border-stone-800 bg-stone-950/60 p-3 text-center text-sm text-stone-300">
          Assim que o pagamento cair, <strong className="text-stone-100">esta tela muda sozinha</strong>.
          Pode deixar aberta.
        </p>

        {networkDown && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-800 bg-red-950/50 px-3 py-2.5 text-sm text-red-100"
          >
            Perdemos a conexão e paramos de verificar. Confira a internet e toque no botão abaixo.
          </p>
        )}

        <ManualCheckButton onClick={onManualCheck} checking={checking} />
      </Card>

      <Card>
        <Row term="Passeio" value={status.experienceName} />
        <Row
          term="Data"
          value={`${fullDateFromInstant(status.startAt)}, ${timeLabel(status.startAt)}`}
        />
        <Row term="Duração" value={durationLabel(status.durationMinutes)} />
        <Row term="Código" value={reservationId.slice(0, 8)} />
      </Card>
    </>
  );
}

// ============================================================================
// Estado 3 — confirmada
// ============================================================================

/**
 * >>> A TELA MAIS IMPORTANTE DAS CINCO <<<
 * Com o e-mail cortado do go-live (decisao de 21/08), este e o UNICO
 * comprovante que o cliente recebe. Ele precisa conseguir, so a partir daqui,
 * saber QUANDO, ONDE, o que levar e com quem falar — e printar a tela.
 *
 * Cada bloco de settings e condicional: chave vazia OMITE o bloco. Renderizar
 * "Ponto de encontro:" seguido de nada e pior do que nao ter a secao, porque
 * parece que a informacao existe e se perdeu.
 */
function Confirmed({
  status,
  reservationId,
  labels,
}: {
  status: StatusPayload;
  reservationId: string;
  labels: StatusLabels;
}) {
  const endAt = new Date(new Date(status.startAt).getTime() + status.durationMinutes * 60_000);
  const meetingPoint = labels.meeting_point.trim();
  const whatToBring = labels.what_to_bring.trim();

  return (
    <>
      <Card tone="ok">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
          Reserva confirmada
        </p>
        <h1 className="mt-1 text-xl font-semibold text-stone-50">{status.experienceName}</h1>

        {/* Data por extenso, com o fuso NOMEADO. "09:00" sozinho e ambiguo para
            quem esta com o celular em outro fuso — e o cliente que erra a hora
            do proprio passeio nao volta. */}
        <p className="mt-3 text-base text-stone-100">
          {fullDateFromInstant(status.startAt)}
        </p>
        <p className="text-2xl font-semibold text-emerald-200">
          {timeLabel(status.startAt)}
          <span className="ml-2 text-sm font-normal text-stone-400">
            até {timeLabel(endAt.toISOString())} · horário de Brasília
          </span>
        </p>

        {/* ====================================================================
            >>> "CONFIRMADA" SOZINHO E AMBIGUO QUANDO SOBROU SALDO <<<
            A vaga esta garantida, e por isso o cabecalho verde continua certo.
            Mas quem pagou o sinal precisa CHEGAR COM DINHEIRO, e essa informacao
            nao pode ficar so numa linha de <dl> entre "Duracao" e "Codigo" —
            esta e a UNICA confirmacao que o cliente recebe (nao ha e-mail,
            secao 9), e ele vai le-la uma vez.

            Mesmo gate de `paymentMode`, nunca `balanceCents > 0`: ver a nota
            longa na lista abaixo.
            ==================================================================== */}
        {status.paymentMode === 'deposit' && status.balanceCents > 0 && (
          <p className="mt-4 rounded-lg border border-orange-800/60 bg-orange-950/40 p-3 text-sm text-orange-100">
            <strong className="font-semibold">
              Faltam {moneyLabel(status.balanceCents)} para o dia do passeio.
            </strong>{' '}
            Sua vaga já está garantida. O restante você paga no local, direto com o guia, antes da
            saída.
          </p>
        )}

        <dl className="mt-4 border-t border-emerald-900/50 pt-3">
          <Row term="Duração" value={durationLabel(status.durationMinutes)} />
          {status.amountPaidCents > 0 && (
            <Row term="Pago" value={moneyLabel(status.amountPaidCents)} />
          )}
          {/* >>> O GATE E `paymentMode`, NUNCA `balanceCents > 0`. <<<
              So o modo `deposit` tem saldo a pagar presencialmente (secao 5.3).
              Numa reserva `full` o `balanceCents` vale o preco inteiro enquanto
              o pagamento nao cai — derivar dele diria ao cliente do Quadri Club
              (onde as duas trilhas sao `full`) que ele deve dinheiro no dia, e a
              mentira so apareceria no ponto de encontro. O `> 0` fica junto para
              nao anunciar saldo de sinal ja quitado. */}
          {status.paymentMode === 'deposit' && status.balanceCents > 0 && (
            <Row
              term="A pagar no dia"
              value={`${moneyLabel(status.balanceCents)} — direto com o guia`}
              strong
            />
          )}
          <Row term="Código" value={reservationId.slice(0, 8)} />
        </dl>

        {/* Sem e-mail de confirmacao, guardar o endereco e responsabilidade do
            cliente — e ele so faz isso se alguem pedir. */}
        <p className="mt-4 rounded-lg border border-emerald-900/50 bg-emerald-950/30 p-3 text-sm text-emerald-100">
          Tire um print desta tela ou guarde este link. É o seu comprovante.
        </p>
      </Card>

      {(meetingPoint || whatToBring) && (
        <Card>
          {meetingPoint && (
            <>
              <h2 className="text-sm font-semibold text-stone-100">Ponto de encontro</h2>
              {/* `whitespace-pre-line` preserva as quebras de linha do texto do
                  banco SEM converter nada em HTML: o texto continua sendo texto,
                  e um `<script>` digitado na setting aparece como caracteres na
                  tela. Renderizar marcacao aqui seria XSS pela mesma porta que o
                  mapa evita ao guardar so a URL. */}
              <p className="mt-1 whitespace-pre-line break-words text-sm text-stone-400">
                {meetingPoint}
              </p>
              <MeetingPointMap url={labels.meeting_point_map_url} title="Mapa do ponto de encontro" />
            </>
          )}
          {whatToBring && (
            <>
              <h2 className={`text-sm font-semibold text-stone-100 ${meetingPoint ? 'mt-4' : ''}`}>
                O que levar
              </h2>
              <p className="mt-1 whitespace-pre-line text-sm text-stone-400">{whatToBring}</p>
            </>
          )}
        </Card>
      )}
    </>
  );
}

// ============================================================================
// Pecas
// ============================================================================

/**
 * Contato do tenant. Some inteiro se nenhum canal estiver configurado — e o que
 * a settings `support_whatsapp` vazia produz hoje, ate o numero do Quadri Club
 * chegar.
 *
 * O WhatsApp vem primeiro de proposito: o tenant vende por ManyChat, entao e o
 * canal onde a conversa com o cliente ja acontece e onde o dono ja responde.
 */
function ContactBlock({ labels }: { labels: StatusLabels }) {
  // wa.me exige so digitos, com DDI. Sanitiza aqui para uma settings gravada
  // como '(11) 99999-8888' nao gerar um link quebrado.
  const whatsapp = labels.support_whatsapp.replace(/\D/g, '');
  const email = labels.reply_to_email.trim();

  if (!whatsapp && !email) return null;

  const who = labels.business_name.trim() || 'a gente';

  return (
    <Card>
      <h2 className="text-sm font-semibold text-stone-100">Precisa falar com {who}?</h2>
      <div className="mt-3 flex flex-col gap-2">
        {whatsapp && (
          <a
            href={`https://wa.me/${whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-center text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
          >
            Chamar no WhatsApp
          </a>
        )}
        {email && (
          <a
            href={`mailto:${email}`}
            className="rounded-lg border border-stone-700 px-4 py-2.5 text-center text-sm font-medium text-stone-300 transition hover:bg-stone-800/60"
          >
            {email}
          </a>
        )}
      </div>
    </Card>
  );
}

function ManualCheckButton({ onClick, checking }: { onClick: () => void; checking: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={checking}
      className="mt-3 w-full rounded-lg border border-stone-700 px-4 py-2.5 text-sm font-medium text-stone-200 transition hover:bg-stone-800/60 disabled:opacity-60"
    >
      {checking ? 'Verificando…' : 'Já paguei, verificar agora'}
    </button>
  );
}

/**
 * Copia-e-cola do Pix com confirmacao visual.
 *
 * O feedback nao e enfeite: o cliente esta prestes a sair para o app do banco e
 * precisa saber que o codigo FOI para a area de transferencia antes de trocar
 * de tela. `navigator.clipboard` exige contexto seguro (https ou localhost) — o
 * fallback marca a falha em vez de fingir que copiou.
 */
function CopyPasteBox({ copyPaste }: { copyPaste: string }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    if (copied === 'idle') return;
    const timer = setTimeout(() => setCopied('idle'), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyPaste);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  }

  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-stone-400">Pix copia e cola</p>
      <p className="mt-1 max-h-20 overflow-y-auto break-all rounded-lg border border-stone-800 bg-stone-950/60 p-2 font-mono text-[11px] leading-relaxed text-stone-400">
        {copyPaste}
      </p>
      <button
        type="button"
        onClick={copy}
        className="mt-2 w-full rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-2.5 text-sm font-semibold text-orange-200 transition hover:bg-orange-500/20 active:scale-[0.99]"
      >
        {copied === 'ok' ? 'Código copiado!' : copied === 'fail' ? 'Não deu — copie na mão' : 'Copiar código'}
      </button>
    </div>
  );
}

function ReservationCode({ reservationId }: { reservationId: string }) {
  return (
    <p className="mt-3 text-xs text-stone-500">
      Código da reserva: <span className="font-mono text-stone-400">{reservationId.slice(0, 8)}</span>
    </p>
  );
}

function Card({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  const border =
    tone === 'ok'
      ? 'border-emerald-800/70 bg-emerald-950/20'
      : tone === 'warn'
        ? 'border-amber-800/60 bg-amber-950/15'
        : 'border-stone-800 bg-stone-900/60';

  return <section className={`rounded-xl border p-4 ${border}`}>{children}</section>;
}

function Row({ term, value, strong }: { term: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <dt className="shrink-0 text-stone-400">{term}</dt>
      <dd className={`text-right ${strong ? 'font-semibold text-orange-200' : 'text-stone-200'}`}>
        {value}
      </dd>
    </div>
  );
}

/** ms -> 'MM:SS'. Nunca negativo: o chamador ja tratou o caso de hold vencido. */
function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
