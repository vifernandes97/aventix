'use client';

// Lista + formulario de experiencias (CLAUDE.md secoes 4.3, 7.2 e 16).
//
// >>> O QUE ESTA TELA NAO TEM, e por que <<<
// 1. NENHUMA UI de sinal/deposit. O schema tem payment_mode, deposit_percent e
//    deposit_fixed_cents, e o sinal e escopo de MVP no CLAUDE.md rev 6 — mas ele
//    depende da Fase 2 (Asaas), travada nos pre-requisitos do cliente, e da
//    decisao de negocio "lancar com integral ou com sinal?", ainda aberta.
//    Toda experiencia nasce e permanece 'full'; a API recusa 'deposit' com 422.
// 2. NENHUM botao de excluir. Reservas apontam para a experiencia — desativar e
//    o caminho, e ele e reversivel.
//
// >>> DUAS CONFIRMACOES DIFERENTES, DE PROPOSITO <<<
// Cancelar reserva exige digitar CANCELAR (decisao de 03/08) porque e
// IRREVERSIVEL e libera a vaga. Desativar experiencia e reversivel num clique e
// nao toca em nada ja vendido, entao pede so um sim/nao inline. Calibrar as duas
// pelo mesmo peso ensinaria o dono a confirmar no automatico, que e o que faz a
// confirmacao pesada perder o efeito onde ela importa.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ExperienceRow } from '@/lib/experiences';

import { moneyLabel } from '../../_components/shared';
import { centsToReaisInput, parseReaisToCents } from './money';

type Props = { experiences: ExperienceRow[] };

/** Campo em erro -> mensagem, como a API devolve em `fields`. */
type FieldErrors = Record<string, string>;

type FormState = {
  /** null = criando; numero = editando aquele id. */
  editingId: number | null;
  nome: string;
  duracao: string;
  buffer: string;
  preco: string;
  idadeMinima: string;
};

// idadeMinima nasce '0' (sem minimo) em vez de vazio: campo numerico em branco
// viraria NaN no Number() do submit.
const EMPTY_FORM: FormState = {
  editingId: null,
  nome: '',
  duracao: '',
  buffer: '15',
  preco: '',
  idadeMinima: '0',
};

function formFor(experience: ExperienceRow): FormState {
  return {
    editingId: experience.id,
    nome: experience.name,
    duracao: String(experience.durationMinutes),
    buffer: String(experience.bufferMinutes),
    preco: centsToReaisInput(experience.priceCents),
    idadeMinima: String(experience.minPassengerAge),
  };
}

export function ExperienceManager({ experiences }: Props) {
  const router = useRouter();

  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Id aguardando confirmacao de desativacao. */
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
  }

  function openEdit(experience: ExperienceRow) {
    setForm(formFor(experience));
    setFieldErrors({});
    setFormError(null);
  }

  function closeForm() {
    setForm(null);
    setFieldErrors({});
    setFormError(null);
  }

  /** Traduz a resposta da API em erro por campo + erro geral. */
  async function applyError(response: Response): Promise<void> {
    let body: { error?: string; fields?: { param: string; message: string }[] } | null = null;
    try {
      body = await response.json();
    } catch {
      // Resposta sem JSON (proxy, timeout): cai na mensagem generica abaixo.
    }

    if (body?.fields?.length) {
      // A API nomeia o campo em portugues ('precoCentavos'), que e a chave que
      // o formulario usa — ver `FIELD_OF` abaixo.
      const errors: FieldErrors = {};
      for (const field of body.fields) errors[field.param] = field.message;
      setFieldErrors(errors);
      setFormError(null);
      return;
    }

    setFieldErrors({});
    setFormError(
      body?.error === 'experiencia nao encontrada'
        ? 'Esta experiência não existe mais. Recarregue a página.'
        : (body?.error ?? `Não foi possível salvar (HTTP ${response.status}).`),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form || saving) return;

    // Validacao de borda, so para nao gastar uma ida ao servidor com algo que
    // nem chega a ser numero. O SERVIDOR e quem valida de verdade (regra de
    // negocio: preco > 0, duracao > 0); qualquer coisa que passe daqui e
    // reprovada la volta em `fields` e cai no mesmo lugar da tela.
    const precoCentavos = parseReaisToCents(form.preco);
    if (precoCentavos === null) {
      setFieldErrors({ precoCentavos: 'Valor inválido. Use o formato 325,49.' });
      setFormError(null);
      return;
    }

    const payload = {
      nome: form.nome,
      duracaoMinutos: Number(form.duracao),
      bufferMinutos: Number(form.buffer),
      precoCentavos,
      idadeMinimaGarupa: Number(form.idadeMinima),
    };

    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const response = await fetch(
        form.editingId === null
          ? '/api/admin/experiences'
          : `/api/admin/experiences/${form.editingId}`,
        {
          method: form.editingId === null ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        await applyError(response);
        return;
      }

      closeForm();
      // A lista volta do SERVIDOR, nao e remendada aqui. Mesma decisao do
      // cancelamento (03/08): a pagina e Server Component com force-dynamic,
      // entao o refresh re-executa a consulta e a tela nao pode divergir do
      // banco — inclusive de uma edicao feita noutro aparelho.
      router.refresh();
    } catch {
      setFormError('Falha de rede. Verifique a conexão e tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  async function setActive(experience: ExperienceRow, active: boolean) {
    if (togglingId !== null) return;

    setTogglingId(experience.id);
    setRowError(null);

    try {
      const response = await fetch(`/api/admin/experiences/${experience.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: active }),
      });

      if (!response.ok) {
        setRowError(
          response.status === 404
            ? 'Esta experiência não existe mais. Recarregue a página.'
            : `Não foi possível ${active ? 'reativar' : 'desativar'} (HTTP ${response.status}).`,
        );
        return;
      }

      setConfirmingId(null);
      router.refresh();
    } catch {
      setRowError('Falha de rede. Verifique a conexão e tente de novo.');
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {experiences.length === 0
            ? 'Nenhuma experiência cadastrada.'
            : `${experiences.length} experiência${experiences.length > 1 ? 's' : ''} no catálogo.`}
        </p>

        {form === null && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Nova experiência
          </button>
        )}
      </div>

      {form !== null && (
        // `key`: trocar de "nova" para "editar a 2" REMONTA o formulario, entao
        // o autoFocus do primeiro campo dispara de novo. Mesmo padrao que o
        // painel de reserva usa com key={selectedId} — remontar em vez de
        // sincronizar estado na mao.
        <ExperienceForm
          key={form.editingId ?? 'nova'}
          form={form}
          setForm={setForm}
          fieldErrors={fieldErrors}
          formError={formError}
          saving={saving}
          onSubmit={submit}
          onCancel={closeForm}
        />
      )}

      {rowError && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
        >
          {rowError}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {experiences.map((experience) => (
          <li
            key={experience.id}
            className={`rounded border p-3 ${
              experience.active
                ? 'border-neutral-300 dark:border-neutral-700'
                : // Inativa fica ESMAECIDA, nunca escondida: o dono precisa
                  // enxergar a trilha sazonal para reativa-la.
                  'border-dashed border-neutral-300 bg-neutral-50 opacity-60 dark:border-neutral-700 dark:bg-neutral-900/40'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{experience.name}</h2>
                  {!experience.active && (
                    <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      Inativa
                    </span>
                  )}
                </div>

                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {moneyLabel(experience.priceCents)} · {experience.durationMinutes} min
                  {experience.bufferMinutes > 0 && ` + ${experience.bufferMinutes} min de intervalo`}
                  {/* So aparece quando ha regra: "sem idade minima" nao e
                      informacao util na listagem, e poluiria as duas linhas. */}
                  {experience.minPassengerAge > 0 &&
                    ` · garupa a partir de ${experience.minPassengerAge} anos`}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(experience)}
                  className="rounded border px-3 py-1.5 text-sm"
                >
                  Editar
                </button>

                {experience.active ? (
                  confirmingId === experience.id ? (
                    <span className="flex items-center gap-2 text-sm">
                      <span className="text-neutral-600 dark:text-neutral-400">Desativar?</span>
                      <button
                        type="button"
                        disabled={togglingId === experience.id}
                        onClick={() => setActive(experience, false)}
                        className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                      >
                        {togglingId === experience.id ? 'Desativando…' : 'Sim, desativar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="rounded border px-3 py-1.5 text-sm"
                      >
                        Não
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(experience.id);
                        setRowError(null);
                      }}
                      className="rounded border px-3 py-1.5 text-sm"
                    >
                      Desativar
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    disabled={togglingId === experience.id}
                    onClick={() => setActive(experience, true)}
                    className="rounded border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 disabled:opacity-60 dark:text-emerald-400"
                  >
                    {togglingId === experience.id ? 'Reativando…' : 'Reativar'}
                  </button>
                )}
              </div>
            </div>

            {confirmingId === experience.id && experience.active && (
              <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                A experiência sai do agendamento novo. As reservas já feitas não são afetadas, e
                você pode reativar quando quiser.
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// Formulario
// ============================================================================

/** Nome do campo na API -> chave do formulario, para posicionar a mensagem. */
const FIELD_OF: Record<string, keyof FormState> = {
  nome: 'nome',
  duracaoMinutos: 'duracao',
  bufferMinutos: 'buffer',
  precoCentavos: 'preco',
  idadeMinimaGarupa: 'idadeMinima',
};

function ExperienceForm({
  form,
  setForm,
  fieldErrors,
  formError,
  saving,
  onSubmit,
  onCancel,
}: {
  form: FormState;
  setForm: (form: FormState) => void;
  fieldErrors: FieldErrors;
  formError: string | null;
  saving: boolean;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
}) {
  // A API prefixa a mensagem com o nome do parametro ('precoCentavos: precisa
  // ser maior que zero'), o que serve para quem le a resposta crua num log ou
  // no curl. Ao lado de um campo rotulado o prefixo e ruido — e pior, expoe
  // nome de parametro de API para o dono. A mensagem aparece sob o rotulo que
  // ja diz de qual campo se trata.
  const errorFor = (key: keyof FormState) => {
    const message = Object.entries(fieldErrors).find(([param]) => FIELD_OF[param] === key)?.[1];
    return message?.replace(/^[a-zA-Z]+:\s*/, '');
  };

  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });

  return (
    <form
      onSubmit={onSubmit}
      className="rounded border border-neutral-300 p-3 dark:border-neutral-700"
    >
      <h2 className="font-medium">
        {form.editingId === null ? 'Nova experiência' : 'Editar experiência'}
      </h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Nome" error={errorFor('nome')} className="sm:col-span-2">
          <input
            // O dono clicou em "Nova"/"Editar" com a intencao de digitar; sem
            // isto sobra um toque a mais, em campo, no celular.
            autoFocus
            value={form.nome}
            onChange={(e) => set({ nome: e.target.value })}
            placeholder="Trilha da Montanha"
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </Field>

        <Field
          label="Preço por veículo (Pix)"
          hint="O MVP vende só por Pix. Digite em reais: 325,49"
          error={errorFor('preco')}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-500">R$</span>
            <input
              value={form.preco}
              onChange={(e) => set({ preco: e.target.value })}
              // Reescreve o valor formatado ao sair do campo, para o dono VER o
              // que foi entendido antes de salvar — e o que desfaz a ambiguidade
              // entre ponto de milhar e ponto decimal (ver ./money.ts).
              onBlur={() => {
                const cents = parseReaisToCents(form.preco);
                if (cents !== null) set({ preco: centsToReaisInput(cents) });
              }}
              inputMode="decimal"
              placeholder="325,49"
              className="w-full rounded border px-3 py-2 text-sm"
            />
          </div>
        </Field>

        <Field label="Duração (minutos)" error={errorFor('duracao')}>
          <input
            value={form.duracao}
            onChange={(e) => set({ duracao: e.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            placeholder="90"
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </Field>

        <Field
          label="Intervalo entre passeios (minutos)"
          hint="Tempo de preparo antes do próximo. Some da agenda, não aparece para o cliente."
          error={errorFor('buffer')}
          className="sm:col-span-2"
        >
          <input
            value={form.buffer}
            onChange={(e) => set({ buffer: e.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            placeholder="15"
            className="w-full rounded border px-3 py-2 text-sm sm:max-w-[12rem]"
          />
        </Field>

        {/* Regra de SEGURANCA, e por isso ela e visivel e editavel aqui: uma
            constante em codigo faria a proxima trilha herdar o numero da
            anterior, e ninguem perceberia ate alguem aparecer com uma crianca
            no ponto de encontro. */}
        <Field
          label="Idade mínima do garupa (anos)"
          hint="Contada na data do passeio. Use 0 para não exigir idade mínima."
          error={errorFor('idadeMinima')}
          className="sm:col-span-2"
        >
          <input
            value={form.idadeMinima}
            onChange={(e) => set({ idadeMinima: e.target.value.replace(/\D/g, '') })}
            inputMode="numeric"
            placeholder="0"
            className="w-full rounded border px-3 py-2 text-sm sm:max-w-[12rem]"
          />
        </Field>
      </div>

      {formError && (
        <p
          role="alert"
          className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
        >
          {formError}
        </p>
      )}

      <p className="mt-3 text-xs text-neutral-500">
        Alterar preço, duração ou intervalo vale para reservas NOVAS. As já feitas mantêm o que foi
        vendido.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onCancel} className="rounded border px-3 py-2 text-sm">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-neutral-500">{hint}</span>}
      {error && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </span>
      )}
    </label>
  );
}
