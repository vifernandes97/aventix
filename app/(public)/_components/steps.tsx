'use client';

// Os seis passos do formulario publico. A maquina de estados vive em
// booking-wizard.tsx; aqui e so o corpo de cada passo.

import { useEffect, useState } from 'react';

import type { PublicExperience } from '@/lib/experiences';

import type { CreatedReservation } from './booking-wizard';
import {
  type PublicLabels,
  addDays,
  dayMonthLabel,
  dayNumber,
  durationLabel,
  fullDateLabel,
  moneyLabel,
  pluralizeRole,
  timeLabel,
  todayLocal,
  totalCents,
  weekdayLabel,
} from './shared';
import {
  type PeopleValidation,
  type PersonForm,
  type WizardState,
  emptyPerson,
} from './types';

// ============================================================================
// 1 — passeio
// ============================================================================

export function StepExperience({
  experiences,
  labels,
  onSelect,
}: {
  experiences: PublicExperience[];
  labels: PublicLabels;
  onSelect: (experience: PublicExperience) => void;
}) {
  return (
    <section>
      <h1 className="text-xl font-semibold">Escolha o passeio</h1>
      <p className="mt-1 text-sm text-stone-400">{labels.meeting_point}</p>

      {experiences.length === 0 && (
        <p className="mt-6 rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-6 text-center text-sm text-stone-400">
          Nenhum passeio disponível no momento.
        </p>
      )}

      <ul className="mt-5 flex flex-col gap-3">
        {experiences.map((experience) => (
          <li key={experience.id}>
            {/* O card INTEIRO e o alvo de toque: no celular, area grande vale
                mais que um botao pequeno no canto. */}
            <button
              type="button"
              onClick={() => onSelect(experience)}
              className="w-full rounded-xl border border-stone-800 bg-stone-900/60 p-4 text-left active:border-orange-600"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-medium">{experience.name}</h2>
                <span className="shrink-0 text-sm text-stone-400">
                  {durationLabel(experience.durationMinutes)}
                </span>
              </div>
              {/* Sem descricao: o schema nao tem o campo (secao 4.3). */}
              <p className="mt-2 text-lg font-semibold text-orange-200">
                {moneyLabel(experience.priceCents)}
                <span className="ml-1.5 text-xs font-normal uppercase tracking-wide text-stone-500">
                  por {labels.resource_label.toLowerCase()}
                </span>
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================================================
// 2 — quantos recursos
// ============================================================================

export function StepResources({
  experience,
  activeResourceCount,
  capacityPerResource,
  selected,
  labels,
  onSelect,
}: {
  experience: PublicExperience;
  activeResourceCount: number;
  capacityPerResource: number;
  selected: number;
  labels: PublicLabels;
  onSelect: (resourcesNeeded: number) => void;
}) {
  return (
    <section>
      <h1 className="text-xl font-semibold">
        Quantos {labels.resource_label_plural.toLowerCase()}?
      </h1>
      <p className="mt-1 text-sm text-stone-400">
        Cada {labels.resource_label.toLowerCase()} leva até {capacityPerResource} pessoas:{' '}
        {labels.operator_label.toLowerCase()} + {labels.passenger_label.toLowerCase()}. Dois{' '}
        {pluralizeRole(labels.operator_label).toLowerCase()} podem alugar um só e revezar.
      </p>

      <ul className="mt-5 flex flex-col gap-3">
        {Array.from({ length: activeResourceCount }, (_, i) => i + 1).map((n) => (
          <li key={n}>
            <button
              type="button"
              onClick={() => onSelect(n)}
              className={`w-full rounded-xl border p-4 text-left ${
                n === selected
                  ? 'border-orange-600 bg-orange-950/30'
                  : 'border-stone-800 bg-stone-900/60'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">
                  {n}{' '}
                  {n === 1
                    ? labels.resource_label.toLowerCase()
                    : labels.resource_label_plural.toLowerCase()}
                </span>
                <strong className="shrink-0 text-orange-200">
                  {moneyLabel(totalCents(experience, n))}
                </strong>
              </div>
              <p className="mt-1 text-sm text-stone-400">
                até {n * capacityPerResource} pessoas
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================================================
// 3 — data e horario
// ============================================================================

/** Quantos dias a faixa mostra de uma vez. */
const DAY_WINDOW = 7;

type AvailabilityResponse = {
  slots: { startAt: string; label: string }[];
  dayState: 'open' | 'closed_exception' | 'closed_weekday';
};

export function StepSchedule({
  experience,
  resourcesNeeded,
  date,
  startAt,
  labels,
  onPickDate,
  onPickSlot,
}: {
  experience: PublicExperience;
  resourcesNeeded: number;
  date: string | null;
  startAt: string | null;
  labels: PublicLabels;
  onPickDate: (date: string) => void;
  onPickSlot: (startAt: string) => void;
}) {
  const today = todayLocal();
  const [windowStart, setWindowStart] = useState(today);

  // A resposta guarda a CHAVE da consulta que a produziu. Sem isso, seria
  // preciso limpar o estado ao trocar de dia — e limpar dentro do efeito
  // dispara render em cascata. Comparando a chave, a resposta de uma consulta
  // antiga simplesmente deixa de casar e nao e desenhada; `loading` e `error`
  // saem daqui por derivacao, em vez de virarem dois estados a sincronizar.
  const queryKey = date ? `${experience.id}|${date}|${resourcesNeeded}` : null;

  const [result, setResult] = useState<{
    key: string;
    data?: AvailabilityResponse;
    error?: string;
  } | null>(null);

  const days = Array.from({ length: DAY_WINDOW }, (_, i) => addDays(windowStart, i));

  useEffect(() => {
    if (!date || !queryKey) return;

    // Se a data mudar antes da resposta chegar, a requisicao antiga e abortada
    // — e, mesmo que escape, a chave nao casa e ela e ignorada.
    const controller = new AbortController();

    const query = new URLSearchParams({
      experienceId: String(experience.id),
      date,
      // O numero de recursos vai na consulta (secao 6, passo 3): a grade
      // depende dele, e pedir sem ele devolveria horarios que o POST recusa.
      resourcesNeeded: String(resourcesNeeded),
    });

    fetch(`/api/availability?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        setResult({ key: queryKey, data: (await response.json()) as AvailabilityResponse });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error('[agendar] falha ao buscar disponibilidade:', err);
        setResult({ key: queryKey, error: 'Não foi possível carregar os horários. Tente de novo.' });
      });

    return () => controller.abort();
  }, [experience.id, date, resourcesNeeded, queryKey]);

  const current = result && result.key === queryKey ? result : null;
  const availability = current?.data ?? null;
  const error = current?.error ?? null;
  const loading = date !== null && current === null;

  const resourceWord =
    resourcesNeeded === 1
      ? labels.resource_label.toLowerCase()
      : labels.resource_label_plural.toLowerCase();

  return (
    <section>
      <h1 className="text-xl font-semibold">Escolha data e horário</h1>
      <p className="mt-1 text-sm text-stone-400">
        Horários com {resourcesNeeded} {resourceWord} livres.
      </p>

      {/* Navegacao em cima, dias embaixo ocupando a LARGURA INTEIRA.
          Setas na mesma linha dos dias custavam ~90px dos 375px do celular, e a
          semana transbordava numa rolagem horizontal sem sinalizacao — o
          sabado e o domingo, unicos dias em que este tenant opera, ficavam
          fora da tela. */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setWindowStart(addDays(windowStart, -DAY_WINDOW))}
          // Nao volta para antes de hoje: passado nao e agendavel, e o motor
          // descartaria tudo de qualquer forma (secao 6).
          disabled={windowStart <= today}
          className="rounded-lg border border-stone-700 px-4 py-2 text-sm disabled:opacity-30"
          aria-label="Semana anterior"
        >
          ‹
        </button>
        <span className="text-xs uppercase tracking-wide text-stone-500">
          {dayMonthLabel(windowStart)} – {dayMonthLabel(addDays(windowStart, DAY_WINDOW - 1))}
        </span>
        <button
          type="button"
          onClick={() => setWindowStart(addDays(windowStart, DAY_WINDOW))}
          className="rounded-lg border border-stone-700 px-4 py-2 text-sm"
          aria-label="Próxima semana"
        >
          ›
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1">
        {days.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => onPickDate(day)}
            className={`flex flex-col items-center rounded-lg border py-2 ${
              day === date
                ? 'border-orange-600 bg-orange-950/40'
                : 'border-stone-800 bg-stone-900/60'
            }`}
          >
            <span className="text-[0.6rem] uppercase tracking-wide text-stone-500">
              {weekdayLabel(day)}
            </span>
            <span className="text-sm font-medium">{dayNumber(day)}</span>
          </button>
        ))}
      </div>

      <div className="mt-5">
        {!date && <p className="text-sm text-stone-500">Escolha um dia acima.</p>}

        {date && loading && <p className="text-sm text-stone-500">Carregando horários…</p>}

        {date && error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}

        {date && !loading && !error && availability && (
          <>
            <p className="mb-3 text-sm font-medium">{fullDateLabel(date)}</p>

            {/* dayState distingue tres situacoes que uma lista vazia
                colapsaria (secao 7.1). Sem ele, "o tenant nao opera nesse dia"
                e "opera, mas lotou" mostrariam a mesma mensagem — e uma delas
                estaria mentindo. */}
            {availability.dayState === 'closed_weekday' && (
              <p className="rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-6 text-center text-sm text-stone-400">
                Fechado neste dia da semana.
              </p>
            )}

            {availability.dayState === 'closed_exception' && (
              <p className="rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-6 text-center text-sm text-stone-400">
                Fechado nesta data.
              </p>
            )}

            {availability.dayState === 'open' && availability.slots.length === 0 && (
              <p className="rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-6 text-center text-sm text-stone-400">
                Nenhum horário com {resourcesNeeded} {resourceWord} livres neste dia.
                {resourcesNeeded > 1 && ' Tente com menos, ou escolha outro dia.'}
              </p>
            )}

            {availability.dayState === 'open' && availability.slots.length > 0 && (
              // >>> SO OS HORARIOS VIAVEIS APARECEM <<<
              // GET /api/availability devolve { startAt, label } e ja filtra
              // pelo resourcesNeeded pedido — nao informa QUANTOS recursos
              // sobram num horario. Sem esse dado nao da para escrever "so 1
              // livre neste horario" sem inventar, entao o horario insuficiente
              // simplesmente nao e oferecido. Melhoria futura: o motor devolver
              // `freeResources` por slot, e ai o horario aparece desabilitado
              // com o motivo. Fora do escopo desta tarefa, que nao altera a
              // rota de disponibilidade.
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {availability.slots.map((slot) => (
                  <li key={slot.startAt}>
                    <button
                      type="button"
                      onClick={() => onPickSlot(slot.startAt)}
                      className={`w-full rounded-lg border py-3 text-sm font-medium ${
                        slot.startAt === startAt
                          ? 'border-orange-600 bg-orange-950/40'
                          : 'border-stone-800 bg-stone-900/60'
                      }`}
                    >
                      {slot.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ============================================================================
// 4 — responsavel e participantes
// ============================================================================

export function StepPeople({
  state,
  setState,
  validation,
  showErrors,
  documentRequired,
  labels,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  validation: PeopleValidation;
  showErrors: boolean;
  documentRequired: boolean;
  labels: PublicLabels;
}) {
  const full = validation.everyone.length >= validation.capacity;

  const patchResponsible = (patch: Partial<WizardState['responsible']>) =>
    setState((s) => ({ ...s, responsible: { ...s.responsible, ...patch } }));

  const patchOther = (key: string, patch: Partial<PersonForm>) =>
    setState((s) => ({
      ...s,
      others: s.others.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    }));

  return (
    <section>
      <h1 className="text-xl font-semibold">Quem vai?</h1>
      <p className="mt-1 text-sm text-stone-400">
        {validation.everyone.length} de {validation.capacity} pessoas.
      </p>

      <PersonCard
        title="Responsável pela reserva"
        person={state.responsible}
        errors={showErrors ? (validation.perPerson[state.responsible.key] ?? []) : []}
        documentRequired={documentRequired}
        labels={labels}
        onChange={patchResponsible}
      >
        <Field label="Telefone / WhatsApp">
          <input
            value={state.responsible.phone}
            onChange={(e) => patchResponsible({ phone: e.target.value })}
            inputMode="tel"
            placeholder="(11) 90000-0000"
            className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2.5 text-sm"
          />
        </Field>
        <Field label="E-mail">
          <input
            value={state.responsible.email}
            onChange={(e) => patchResponsible({ email: e.target.value })}
            inputMode="email"
            placeholder="voce@email.com"
            className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2.5 text-sm"
          />
        </Field>
      </PersonCard>

      {state.others.map((person, index) => (
        <PersonCard
          key={person.key}
          title={`Participante ${index + 2}`}
          person={person}
          errors={showErrors ? (validation.perPerson[person.key] ?? []) : []}
          documentRequired={documentRequired}
          labels={labels}
          onChange={(patch) => patchOther(person.key, patch)}
          onRemove={() =>
            setState((s) => ({ ...s, others: s.others.filter((p) => p.key !== person.key) }))
          }
        />
      ))}

      <button
        type="button"
        disabled={full}
        onClick={() =>
          setState((s) => ({
            ...s,
            // Chave estavel derivada de um contador que so cresce: o indice
            // quebraria ao remover alguem do meio, e o React reaproveitaria o
            // estado do campo errado.
            others: [...s.others, emptyPerson(`p-${Date.now()}-${s.others.length}`)],
          }))
        }
        className="mt-3 w-full rounded-lg border border-dashed border-stone-700 px-4 py-3 text-sm text-stone-300 disabled:opacity-50"
      >
        {full
          ? `Limite de ${validation.capacity} pessoas atingido`
          : '+ Adicionar participante'}
      </button>

      {showErrors && validation.errors.length > 0 && (
        <ul role="alert" className="mt-4 flex flex-col gap-1.5">
          {validation.errors.map((message) => (
            <li
              key={message}
              className="rounded-lg border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-100"
            >
              {message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PersonCard({
  title,
  person,
  errors,
  documentRequired,
  labels,
  onChange,
  onRemove,
  children,
}: {
  title: string;
  person: PersonForm;
  errors: string[];
  documentRequired: boolean;
  labels: PublicLabels;
  onChange: (patch: Partial<PersonForm>) => void;
  onRemove?: () => void;
  children?: React.ReactNode;
}) {
  // O campo de documento so existe se o papel for operador E o tenant exigir
  // (secao 11-B: o formulario DERIVA da configuracao). Tenant que nao pede
  // documento simplesmente nao ve o campo.
  const needsDocument = person.role === 'operator' && documentRequired;

  return (
    <div
      className={`mt-4 rounded-xl border p-4 ${
        errors.length > 0 ? 'border-red-800 bg-red-950/20' : 'border-stone-800 bg-stone-900/60'
      }`}
    >
      {/* O titulo da secao precisa se separar do rotulo do primeiro campo:
          ambos sao pequenos e acinzentados, e com pouco espaco entre eles o
          titulo deixa de ler como cabecalho e parece parte do campo. Borda
          inferior + folga resolvem sem mexer no conteudo. */}
      <div className="flex items-center justify-between gap-3 border-b border-stone-800 pb-3">
        <h2 className="text-sm font-semibold text-stone-200">{title}</h2>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-stone-400 underline underline-offset-2"
          >
            Remover
          </button>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3">
        <Field label="Nome completo">
          <input
            value={person.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2.5 text-sm"
          />
        </Field>

        {children}

        <Field label="Data de nascimento">
          {/* birthdate, nunca idade: idade muda com o tempo e a reserva
              gravada mentiria um ano depois. */}
          <input
            type="date"
            value={person.birthdate}
            onChange={(e) => onChange({ birthdate: e.target.value })}
            className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2.5 text-sm"
          />
        </Field>

        <Field label="Função">
          <div className="flex gap-2">
            {(['operator', 'passenger'] as const).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => onChange({ role })}
                className={`flex-1 rounded-lg border py-2.5 text-sm font-medium ${
                  person.role === role
                    ? 'border-orange-600 bg-orange-950/40 text-orange-100'
                    : 'border-stone-700 text-stone-300'
                }`}
              >
                {role === 'operator' ? labels.operator_label : labels.passenger_label}
              </button>
            ))}
          </div>
        </Field>

        {needsDocument && (
          <Field label={labels.operator_document_label}>
            <input
              value={person.documentNumber}
              onChange={(e) => onChange({ documentNumber: e.target.value })}
              placeholder={`Obrigatório para ${labels.operator_label.toLowerCase()}`}
              className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2.5 text-sm"
            />
          </Field>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {errors.map((message) => (
            <li key={message} className="text-xs text-red-300">
              {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      {children}
    </label>
  );
}

// ============================================================================
// 5 — termo (PLACEHOLDER)
// ============================================================================

export function StepTerms({
  state,
  labels,
  onToggle,
}: {
  state: WizardState;
  labels: PublicLabels;
  onToggle: (accepted: boolean) => void;
}) {
  return (
    <section>
      <h1 className="text-xl font-semibold">Confirme e aceite</h1>

      <dl className="mt-4 rounded-xl border border-stone-800 bg-stone-900/60 p-4 text-sm">
        <Row term="Passeio" value={state.experience!.name} />
        <Row term="Quando" value={`${fullDateLabel(state.date!)}, ${timeLabel(state.startAt!)}`} />
        <Row
          term={labels.resource_label_plural}
          value={String(state.resourcesNeeded)}
        />
        <Row term="Pessoas" value={String(1 + state.others.length)} />
        <Row
          term="Total"
          value={moneyLabel(totalCents(state.experience!, state.resourcesNeeded))}
          strong
        />
      </dl>

      <div className="mt-4 rounded-xl border border-stone-800 bg-stone-900/60 p-4">
        <h2 className="text-sm font-semibold">O que levar</h2>
        <p className="mt-1 text-sm text-stone-400">{labels.what_to_bring}</p>
        <h2 className="mt-3 text-sm font-semibold">Ponto de encontro</h2>
        <p className="mt-1 text-sm text-stone-400">{labels.meeting_point}</p>
      </div>

      {/* ====================================================================
          PLACEHOLDER — o termo de verdade e TAREFA SEPARADA (secao 10).
          Ela substitui este bloco pelo texto versionado com rolagem ate o fim
          (o botao so habilita depois), e passa a enviar a versao VIGENTE em vez
          de "PROVISORIO". O IP e o user-agent ja sao capturados pela rota, que
          e quem os enxerga. NAO tratar este checkbox como aceite valido.
          ==================================================================== */}
      <label className="mt-4 flex items-start gap-3 rounded-xl border border-stone-800 bg-stone-900/60 p-4">
        <input
          type="checkbox"
          checked={state.termoAccepted}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-orange-600"
        />
        <span className="text-sm text-stone-300">
          Li e aceito os termos de responsabilidade.
        </span>
      </label>
    </section>
  );
}

function Row({ term, value, strong }: { term: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-stone-800 py-2 last:border-0">
      <dt className="text-stone-500">{term}</dt>
      <dd className={`text-right ${strong ? 'text-base font-semibold text-orange-200' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

// ============================================================================
// 6 — pagamento (PLACEHOLDER — Fase 2)
// ============================================================================

export function StepDone({
  reservation,
  experience,
  labels,
}: {
  reservation: CreatedReservation;
  experience: PublicExperience;
  labels: PublicLabels;
}) {
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!reservation.holdExpiresAt) return;

    const tick = () => {
      const ms = new Date(reservation.holdExpiresAt!).getTime() - Date.now();
      setMinutesLeft(Math.max(0, Math.ceil(ms / 60_000)));
    };

    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [reservation.holdExpiresAt]);

  return (
    <section>
      <h1 className="text-xl font-semibold text-orange-200">Reserva criada!</h1>
      <p className="mt-1 text-sm text-stone-400">
        Ela fica guardada enquanto o pagamento não é confirmado.
      </p>

      {/* ====================================================================
          PLACEHOLDER — PAGAMENTO E FASE 2 (secoes 7.1 e 8).

          Aqui entram, quando o Asaas existir:
            1. o QR Code Pix e o copia-e-cola, vindos de `payment` no corpo do
               201 de POST /api/reservations (a rota ja preve o campo);
            2. o polling de GET /api/reservations/{id}/status, que troca esta
               tela pela confirmacao quando o webhook marcar o pagamento;
            3. no modo `deposit`, a frase obrigatoria da secao 7.1: "Voce paga
               agora R$X e o restante (R$Y) no dia, direto com o guia."

          NAO ha QR falso nem simulacao de pagamento: uma tela que finge cobrar
          e pior que uma que assume nao cobrar ainda.
          ==================================================================== */}
      <div className="mt-5 rounded-xl border border-dashed border-stone-700 bg-stone-900/60 px-4 py-8 text-center">
        <p className="text-sm font-medium text-stone-300">Pagamento via Pix em breve</p>
        <p className="mt-1 text-xs text-stone-500">
          O QR Code aparece aqui quando o pagamento entrar no ar.
        </p>
      </div>

      <dl className="mt-4 rounded-xl border border-stone-800 bg-stone-900/60 p-4 text-sm">
        <Row term="Passeio" value={experience.name} />
        <Row term="Valor" value={moneyLabel(reservation.totalCents)} strong />
        {reservation.dueNowCents !== reservation.totalCents && (
          <Row term="A pagar agora" value={moneyLabel(reservation.dueNowCents)} />
        )}
        {minutesLeft !== null && (
          <Row
            term="Reserva expira em"
            value={minutesLeft > 0 ? `${minutesLeft} min` : 'expirada'}
          />
        )}
        <Row term="Código" value={reservation.reservationId.slice(0, 8)} />
      </dl>

      <div className="mt-4 rounded-xl border border-stone-800 bg-stone-900/60 p-4">
        <h2 className="text-sm font-semibold">Ponto de encontro</h2>
        <p className="mt-1 text-sm text-stone-400">{labels.meeting_point}</p>
        <h2 className="mt-3 text-sm font-semibold">O que levar</h2>
        <p className="mt-1 text-sm text-stone-400">{labels.what_to_bring}</p>
      </div>
    </section>
  );
}
