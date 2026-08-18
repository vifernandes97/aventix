'use client';

// Formulario publico de agendamento (CLAUDE.md secoes 5.2, 6, 7.1, 11-B e 14).
//
// >>> NADA VAI PARA O BANCO ATE O ULTIMO PASSO <<<
// Todo o estado vive aqui, no cliente. Quem abandona no meio nao deixa linha
// nenhuma para tras — nem cliente, nem reserva pendente, nem vaga travada. A
// reserva nasce de UM POST /api/reservations, no passo 5, e so entao o hold de
// 15 minutos comeca a correr. E o que permite alguem levar dez minutos
// preenchendo participantes sem segurar um horario que talvez nao compre.
//
// >>> O SERVIDOR E QUEM VALIDA <<<
// As checagens deste arquivo servem para o cliente errar cedo e barato. A
// defesa e createReservation, que refaz tudo dentro da transacao (secao 5.2) e
// devolve 422/409. Ver a nota em types.ts sobre a UNICA regra sem espelho no
// servidor: a maioridade do condutor.
//
// >>> ROTULOS <<<
// Nenhum texto de papel, recurso ou documento e hardcoded (secao 11-B): tudo
// vem de `labels`, resolvido de settings no Server Component. Trocar o tenant
// para "Bote / Guia / Passageiro / RG" nao toca em codigo.

import { useCallback, useMemo, useState } from 'react';

import type { PublicExperience } from '@/lib/experiences';
import { TERM_VERSION } from '@/lib/terms/quadriciclo-v1';

import {
  StepDone,
  StepExperience,
  StepPeople,
  StepResources,
  StepSchedule,
  StepTerms,
} from './steps';
import { type PublicLabels, moneyLabel, durationLabel, totalCents } from './shared';
import {
  type WizardState,
  emptyEmergencyContact,
  emptyPerson,
  hasValidEmergencyContact,
  validatePeople,
} from './types';

export type CreatedReservation = {
  reservationId: string;
  status: string;
  holdExpiresAt: string | null;
  totalCents: number;
  dueNowCents: number;
  balanceCents: number;
  paymentMode: string;
  /** bloco `payment` do 201 (secao 7.1). Ausente so em resposta antiga/inesperada. */
  payment?: {
    method: string;
    qrCodeBase64: string;
    copyPaste: string;
    expiresAt: string | null;
  } | null;
};

type StepId = 'experience' | 'resources' | 'schedule' | 'people' | 'terms' | 'done';

type Props = {
  experiences: PublicExperience[];
  /** Numero de recursos ATIVOS: teto do passo 2 (secao 6). */
  activeResourceCount: number;
  /** Capacidade de UM recurso, para o texto e o teto de participantes. */
  capacityPerResource: number;
  documentRequired: boolean;
  labels: PublicLabels;
  /** `?canal=` da URL. O servidor sanitiza; aqui so trafega (secao 4.4). */
  channel: string | null;
};

export function BookingWizard({
  experiences,
  activeResourceCount,
  capacityPerResource,
  documentRequired,
  labels,
  channel,
}: Props) {
  const [state, setState] = useState<WizardState>({
    experience: null,
    resourcesNeeded: 1,
    date: null,
    startAt: null,
    responsible: { ...emptyPerson('responsavel', 'operator'), phone: '', email: '', cpf: '' },
    others: [],
    emergencyContact: emptyEmergencyContact(),
    termoAccepted: false,
    imageConsent: false,
  });

  const [stepId, setStepId] = useState<StepId>('experience');
  const [created, setCreated] = useState<CreatedReservation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPeopleErrors, setShowPeopleErrors] = useState(false);

  // -- passos ----------------------------------------------------------------
  //
  // O passo de recursos SOME quando o tenant tem um recurso so: perguntar
  // "quantos?" com uma opcao unica e trabalho sem escolha (secao 11-B — o
  // formulario DERIVA da configuracao). A numeracao acompanha: some o passo,
  // some do "PASSO N DE M".
  const steps = useMemo<StepId[]>(
    () =>
      (
        ['experience', 'resources', 'schedule', 'people', 'terms', 'done'] as StepId[]
      ).filter((id) => id !== 'resources' || activeResourceCount > 1),
    [activeResourceCount],
  );

  const stepIndex = steps.indexOf(stepId);

  // Rotulo do passo tambem sai de settings: num tenant de bote isto le "BOTES".
  const stepLabels: Record<StepId, string> = {
    experience: 'PASSEIO',
    resources: labels.resource_label_plural.toUpperCase(),
    schedule: 'HORÁRIO',
    people: 'DADOS',
    terms: 'TERMO',
    done: 'PAGAMENTO',
  };

  const goTo = (id: StepId) => {
    setStepId(id);
    setSubmitError(null);
    // Passo novo comeca no topo: no celular, avancar sem isto deixa o cliente
    // no meio do conteudo seguinte.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };

  const back = () => {
    if (stepIndex > 0) goTo(steps[stepIndex - 1]!);
  };

  const forward = () => {
    if (stepIndex < steps.length - 1) goTo(steps[stepIndex + 1]!);
  };

  // -- validacao do passo de participantes -----------------------------------

  const people = useMemo(
    () =>
      validatePeople({
        state,
        capacityPerResource,
        documentRequired,
        labels: {
          operator: labels.operator_label,
          passenger: labels.passenger_label,
          document: labels.operator_document_label,
          resource: labels.resource_label,
        },
      }),
    [state, capacityPerResource, documentRequired, labels],
  );

  // -- criacao da reserva ----------------------------------------------------

  const submit = useCallback(async () => {
    if (submitting || !state.experience || !state.startAt) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experienceId: state.experience.id,
          startAt: state.startAt,
          resourcesNeeded: state.resourcesNeeded,
          // O preco NAO vai no corpo: quem calcula e o servidor (secao 4.6).
          customer: {
            name: state.responsible.name.trim(),
            phone: state.responsible.phone.trim(),
            email: state.responsible.email.trim() || null,
            // So digitos: o estado ja guarda normalizado (a formatacao com
            // pontos e do campo, nao do dado).
            cpf: state.responsible.cpf,
            birthdate: state.responsible.birthdate || null,
          },
          // O responsavel E um participante, e vai primeiro.
          participants: people.everyone.map((p) => ({
            name: p.name.trim(),
            birthdate: p.birthdate || null,
            role: p.role,
            documentNumber: p.documentNumber.trim() || null,
          })),
          termo: { version: TERM_VERSION, acceptedAt: new Date().toISOString() },
          emergencyContact: {
            name: state.emergencyContact.name.trim(),
            phone: state.emergencyContact.phone.trim(),
          },
          channel,
        }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        // 409 — a grade mudou enquanto o cliente preenchia. E o caso mais
        // provavel de todos, e o unico que tem conserto na propria tela: manda
        // de volta ao passo de horario, que recarrega a disponibilidade.
        if (response.status === 409) {
          setState((s) => ({ ...s, startAt: null }));
          setSubmitError(
            'Esse horário acabou de ser reservado por outra pessoa. Escolha outro horário.',
          );
          goTo('schedule');
          return;
        }

        // 422 — composicao (condutores, capacidade, documento). O `detail` vem
        // do erro tipado do dominio e ja nomeia o que esta errado.
        if (response.status === 422) {
          setSubmitError(body?.detail ?? 'A composição do grupo não é válida.');
          goTo('people');
          return;
        }

        if (response.status === 400) {
          const fieldMessage = body?.fields?.[0]?.message as string | undefined;
          setSubmitError(body?.detail ?? fieldMessage ?? 'Confira os dados informados.');
          goTo('people');
          return;
        }

        if (response.status === 404) {
          setSubmitError('Este passeio não está mais disponível. Recomece a escolha.');
          goTo('experience');
          return;
        }

        setSubmitError('Não foi possível criar a reserva. Tente de novo em instantes.');
        return;
      }

      setCreated(body as CreatedReservation);
      goTo('done');
    } catch {
      setSubmitError('Falha de conexão. Verifique a internet e tente de novo.');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, state, people.everyone, channel]);

  // -- barra de total --------------------------------------------------------
  //
  // Aparece a partir do passo 2 e some no passo final, onde o valor ja esta no
  // resumo da reserva criada — repetir ali seria dizer duas vezes a mesma coisa
  // e roubar espaco no celular.
  const showTotalBar = state.experience !== null && stepId !== 'experience' && stepId !== 'done';

  return (
    <div className="flex min-h-dvh flex-col bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-4 py-3">
        <p className="text-sm font-semibold tracking-wide text-orange-200">
          {labels.business_name}
        </p>
      </header>

      {stepId !== 'done' && (
        <ProgressBar
          current={stepIndex}
          total={steps.length}
          label={stepLabels[stepId]}
        />
      )}

      <main className={`flex-1 px-4 py-5 ${showTotalBar ? 'pb-32' : 'pb-8'}`}>
        <div className="mx-auto w-full max-w-lg">
          {submitError && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-red-800 bg-red-950/60 px-3 py-2.5 text-sm text-red-100"
            >
              {submitError}
            </p>
          )}

          {stepId === 'experience' && (
            <StepExperience
              experiences={experiences}
              labels={labels}
              onSelect={(experience) => {
                setState((s) => ({
                  ...s,
                  experience,
                  // Trocar de passeio invalida o horario: a grade depende da
                  // duracao, e um slot da trilha de 90 min pode nao existir na
                  // de 60. Deixar o startAt para tras produziria um POST com
                  // horario que a nova experiencia nunca ofereceu.
                  startAt: null,
                }));
                forward();
              }}
            />
          )}

          {stepId === 'resources' && state.experience && (
            <StepResources
              experience={state.experience}
              activeResourceCount={activeResourceCount}
              capacityPerResource={capacityPerResource}
              selected={state.resourcesNeeded}
              labels={labels}
              onSelect={(resourcesNeeded) => {
                // Mesma razao de cima: a disponibilidade e por numero de
                // recursos, entao trocar a quantidade invalida o slot.
                setState((s) => ({ ...s, resourcesNeeded, startAt: null }));
                forward();
              }}
            />
          )}

          {stepId === 'schedule' && state.experience && (
            <StepSchedule
              experience={state.experience}
              resourcesNeeded={state.resourcesNeeded}
              date={state.date}
              startAt={state.startAt}
              labels={labels}
              onPickDate={(date) => setState((s) => ({ ...s, date, startAt: null }))}
              onPickSlot={(startAt) => {
                setState((s) => ({ ...s, startAt }));
                forward();
              }}
            />
          )}

          {stepId === 'people' && (
            <StepPeople
              state={state}
              setState={setState}
              validation={people}
              showErrors={showPeopleErrors}
              documentRequired={documentRequired}
              labels={labels}
            />
          )}

          {stepId === 'terms' && state.experience && state.startAt && (
            <StepTerms
              state={state}
              labels={labels}
              onChangeEmergencyContact={(patch) =>
                setState((s) => ({ ...s, emergencyContact: { ...s.emergencyContact, ...patch } }))
              }
              onToggleTermo={(termoAccepted) => setState((s) => ({ ...s, termoAccepted }))}
              onToggleImageConsent={(imageConsent) => setState((s) => ({ ...s, imageConsent }))}
            />
          )}

          {stepId === 'done' && created && state.experience && (
            <StepDone reservation={created} experience={state.experience} labels={labels} />
          )}
        </div>
      </main>

      {/* Navegacao e total ficam FIXOS no rodape: no celular, o botao de avancar
          precisa estar sob o polegar, nao no fim de uma lista de participantes. */}
      {stepId !== 'done' && (
        <footer className="sticky bottom-0 border-t border-stone-800 bg-stone-950/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto w-full max-w-lg">
            {showTotalBar && state.experience && (
              <div className="mb-2.5 flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-stone-400">
                  {state.experience.name} · {state.resourcesNeeded}{' '}
                  {state.resourcesNeeded === 1
                    ? labels.resource_label.toLowerCase()
                    : labels.resource_label_plural.toLowerCase()}{' '}
                  · {durationLabel(state.experience.durationMinutes)}
                </span>
                <strong className="shrink-0 text-base text-orange-200">
                  {moneyLabel(totalCents(state.experience, state.resourcesNeeded))}
                </strong>
              </div>
            )}

            <div className="flex gap-2">
              {stepIndex > 0 && (
                <button
                  type="button"
                  onClick={back}
                  disabled={submitting}
                  className="rounded-lg border border-stone-700 px-4 py-3 text-sm font-medium text-stone-300 disabled:opacity-50"
                >
                  Voltar
                </button>
              )}

              {stepId === 'people' && (
                <button
                  type="button"
                  onClick={() => {
                    setShowPeopleErrors(true);
                    if (people.errors.length === 0) forward();
                  }}
                  className="flex-1 rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white"
                >
                  Continuar
                </button>
              )}

              {stepId === 'terms' && (
                <button
                  type="button"
                  onClick={submit}
                  // Desabilitar durante o envio E a defesa contra duplo clique
                  // que a rota do POST pede no proprio cabecalho: sem isto, dois
                  // toques criam DUAS reservas quando ha recurso sobrando.
                  // Checkbox 2 (imagem) NAO entra aqui: e opcional (secao 10).
                  disabled={
                    !state.termoAccepted ||
                    !hasValidEmergencyContact(state.emergencyContact) ||
                    submitting
                  }
                  className="flex-1 rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {submitting ? 'Criando reserva…' : 'Confirmar e ir para o pagamento'}
                </button>
              )}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function ProgressBar({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <div className="px-4 pt-4">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-medium tracking-widest text-stone-500">
            PASSO {current + 1} DE {total}
          </span>
          <span className="text-xs font-semibold tracking-widest text-orange-300">{label}</span>
        </div>
        <div className="flex gap-1" role="presentation">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= current ? 'bg-orange-500' : 'bg-stone-800'}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
