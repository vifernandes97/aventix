'use client';

// Lista + formulario de excecoes de agenda (CLAUDE.md secoes 6 e 7.2).
//
// ============================================================================
// >>> O PROBLEMA DE UX QUE ESTA TELA EXISTE PARA RESOLVER <<<
//
// A precedencia da secao 6 e invisivel: o dono cadastra uma excecao e o efeito
// dela aparece noutra tela (a grade), dias depois. Se ele nao entender que a
// excecao MANDA no dia — que abrir uma terca ignora o horario de terca, e que
// fechar um sabado apaga o sabado inteiro —, ele cria a linha, olha a agenda,
// nao ve o que esperava e conclui que o sistema esta quebrado.
//
// Por isso a tela nao se limita a um formulario. Ela mostra, para a data
// escolhida, o CONTRASTE: o que aquele dia da semana faz hoje, e o que passa a
// valer com a excecao. O texto do contraste e gerado a partir da grade semanal
// real (prop `weeklyGrid`), nao de exemplo fixo.
// ============================================================================
//
// NAO reimplementa a precedencia: so a DESCREVE. Quem decide continua sendo o
// passo 1 de lib/availability.ts (venda) e getDayGrid (desenho). Se um dia as
// tres divergirem, a fonte da verdade e availability.ts.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { WeeklyGrid } from '@/lib/operating-hours';
import type { ScheduleExceptionRow } from '@/lib/schedule-exceptions';

type Props = {
  exceptions: ScheduleExceptionRow[];
  weeklyGrid: WeeklyGrid;
  /** 'YYYY-MM-DD' no fuso do tenant, resolvido no servidor. */
  today: string;
};

type FieldErrors = Record<string, string>;

type FormState = {
  /** null = criando; numero = editando aquela linha. */
  editingId: number | null;
  data: string;
  fechado: boolean;
  abre: string;
  fecha: string;
  motivo: string;
};

const WEEKDAY_NAMES = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];

/**
 * Weekday de 'YYYY-MM-DD', ancorado em UTC.
 *
 * `new Date('2026-08-25')` ja e interpretado como UTC pelo JS, mas
 * `getDay()` (local) devolveria o dia ANTERIOR para quem esta a oeste de
 * Greenwich — que e o caso de todo o Brasil. Mesma regra do asUtc do shared.ts.
 */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function fullDateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

const rangesLabel = (ranges: { opens: string; closes: string }[]) =>
  ranges.map((r) => `${r.opens}–${r.closes}`).join(' e ');

const EMPTY_FORM = (today: string): FormState => ({
  editingId: null,
  data: today,
  fechado: true,
  abre: '09:00',
  fecha: '17:00',
  motivo: '',
});

const formFor = (row: ScheduleExceptionRow): FormState => ({
  editingId: row.id,
  data: row.date,
  fechado: row.closed,
  abre: row.opens ?? '09:00',
  fecha: row.closes ?? '17:00',
  motivo: row.reason ?? '',
});

export function ExceptionManager({ exceptions, weeklyGrid, today }: Props) {
  const router = useRouter();

  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const upcoming = exceptions.filter((e) => e.date >= today);
  const past = exceptions.filter((e) => e.date < today);

  function openCreate() {
    setForm(EMPTY_FORM(today));
    setFieldErrors({});
    setFormError(null);
  }

  function openEdit(row: ScheduleExceptionRow) {
    setForm(formFor(row));
    setFieldErrors({});
    setFormError(null);
  }

  function closeForm() {
    setForm(null);
    setFieldErrors({});
    setFormError(null);
  }

  async function save() {
    if (!form || saving) return;

    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const editing = form.editingId !== null;
      const response = await fetch(
        editing
          ? `/api/admin/schedule-exceptions/${form.editingId}`
          : '/api/admin/schedule-exceptions',
        {
          // PUT na edicao: os campos sao interdependentes e a linha vai
          // inteira. Ver o cabecalho da rota.
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: form.data,
            fechado: form.fechado,
            // Dia fechado nao manda horario: o servidor ignora, mas enviar
            // sugeriria que ficam guardados.
            ...(form.fechado ? {} : { abre: form.abre, fecha: form.fecha }),
            motivo: form.motivo,
          }),
        },
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 422 && Array.isArray(body?.fields)) {
          const errors: FieldErrors = {};
          for (const field of body.fields as { param: string; message: string }[]) {
            errors[field.param] = field.message;
          }
          setFieldErrors(errors);
          setFormError('Revise os campos marcados.');
          return;
        }

        // 409: a data ja tem excecao. O corpo do dono esta certo — o que existe
        // e outra linha. Oferecer a edicao dela e a saida util; repetir "dados
        // invalidos" sobre uma data digitada corretamente nao seria.
        if (response.status === 409 && body?.code === 'data_ocupada') {
          setFieldErrors({ data: 'Já existe uma exceção para esta data.' });
          setFormError(
            'Este dia já tem uma exceção cadastrada. Feche este formulário e edite a que já existe — duas regras para o mesmo dia não são possíveis.',
          );
          return;
        }

        setFormError('Não foi possível salvar. Tente de novo em instantes.');
        return;
      }

      closeForm();
      router.refresh();
    } catch {
      setFormError('Falha de conexão. Verifique a internet e tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: ScheduleExceptionRow) {
    if (deletingId !== null) return;

    setDeletingId(row.id);
    setRowError(null);

    try {
      const response = await fetch(`/api/admin/schedule-exceptions/${row.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        setRowError('Não foi possível excluir. Tente de novo em instantes.');
        return;
      }

      setConfirmingId(null);
      router.refresh();
    } catch {
      setRowError('Falha de conexão. Verifique a internet e tente de novo.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <ExplainerCard />

      {form === null && (
        <button
          type="button"
          onClick={openCreate}
          className="self-start rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          Nova exceção
        </button>
      )}

      {form !== null && (
        <ExceptionForm
          form={form}
          // Setter ESTREITADO: o formulario so existe com `form` != null, e
          // deixa-lo enxergar o `null` obrigaria cada onChange a tratar um caso
          // que nao acontece. O `?? f` mantem o estado se o form fechar no meio
          // de uma digitacao.
          setForm={(updater) => setForm((f) => (f === null ? null : updater(f)))}
          weeklyGrid={weeklyGrid}
          today={today}
          fieldErrors={fieldErrors}
          formError={formError}
          saving={saving}
          onSave={save}
          onCancel={closeForm}
        />
      )}

      {rowError && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {rowError}
        </p>
      )}

      <ExceptionList
        title="Próximas"
        rows={upcoming}
        weeklyGrid={weeklyGrid}
        emptyLabel="Nenhuma exceção cadastrada. A agenda segue os horários da semana."
        confirmingId={confirmingId}
        setConfirmingId={setConfirmingId}
        deletingId={deletingId}
        onEdit={openEdit}
        onDelete={remove}
      />

      {past.length > 0 && (
        <ExceptionList
          title="Já passaram"
          rows={past}
          weeklyGrid={weeklyGrid}
          muted
          // Nao somem da tela: sao o registro do que o dono ja fez, e apagar da
          // vista transformaria "o feriado do mes passado" em "eu nunca
          // cadastrei isso?". Nao afetam mais nada — a grade so vende futuro.
          emptyLabel=""
          confirmingId={confirmingId}
          setConfirmingId={setConfirmingId}
          deletingId={deletingId}
          onEdit={openEdit}
          onDelete={remove}
        />
      )}
    </section>
  );
}

// ============================================================================
// A explicacao da precedencia — o coracao desta tela
// ============================================================================

function ExplainerCard() {
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">A exceção manda no dia.</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
        <li>
          <strong>Fechar um dia</strong> tira ele inteiro da venda, mesmo que o horário da semana
          diga que abre.
        </li>
        <li>
          <strong>Abrir um dia</strong> faz valer o horário que você puser aqui, e o horário
          daquele dia da semana é <strong>ignorado</strong>. É assim que se abre num feriado que
          cai numa terça, quando terça normalmente não opera.
        </li>
        <li>Um dia só pode ter uma exceção.</li>
      </ul>
    </div>
  );
}

/**
 * O contraste "hoje x com a excecao", para a data escolhida.
 *
 * E a peca que torna a precedencia concreta: em vez de o dono ler uma regra
 * abstrata, ele ve a frase montada com a grade REAL do tenant e a data que
 * acabou de escolher.
 */
function EffectPreview({
  data,
  fechado,
  abre,
  fecha,
  weeklyGrid,
}: {
  data: string;
  fechado: boolean;
  abre: string;
  fecha: string;
  weeklyGrid: WeeklyGrid;
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;

  const weekday = weekdayOf(data);
  if (Number.isNaN(weekday)) return null;

  const normal = weeklyGrid[weekday] ?? [];
  const nomeDoDia = WEEKDAY_NAMES[weekday];

  return (
    <div className="rounded border bg-neutral-50 p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        O que muda em {fullDateLabel(data)}
      </p>

      <dl className="mt-2 space-y-1">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-neutral-500">Hoje</dt>
          <dd className="text-neutral-700">
            {normal.length > 0
              ? `${nomeDoDia}: ${rangesLabel(normal)}`
              : `${nomeDoDia}: não opera`}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-neutral-500">Com a exceção</dt>
          <dd className="font-medium text-neutral-900">
            {fechado ? (
              'Fechado o dia inteiro'
            ) : (
              <>
                {abre}–{fecha}
                {normal.length > 0 && (
                  <span className="ml-1 font-normal text-neutral-500">
                    (no lugar de {rangesLabel(normal)})
                  </span>
                )}
              </>
            )}
          </dd>
        </div>
      </dl>

      {/* O aviso que evita a confusao mais cara desta tela. */}
      <p className="mt-2 border-t pt-2 text-xs text-neutral-500">
        Isto vale só para o que ainda pode ser vendido. Reserva já feita neste dia continua de pé.
      </p>
    </div>
  );
}

// ============================================================================
// Formulario
// ============================================================================

function ExceptionForm({
  form,
  setForm,
  weeklyGrid,
  today,
  fieldErrors,
  formError,
  saving,
  onSave,
  onCancel,
}: {
  form: FormState;
  setForm: (updater: (f: FormState) => FormState) => void;
  weeklyGrid: WeeklyGrid;
  today: string;
  fieldErrors: FieldErrors;
  formError: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="flex flex-col gap-3 rounded border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h2 className="text-sm font-semibold">
        {form.editingId === null ? 'Nova exceção' : 'Editar exceção'}
      </h2>

      {formError && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {formError}
        </p>
      )}

      <Field label="Data" error={fieldErrors.data}>
        <input
          type="date"
          value={form.data}
          // `min` e conveniencia: a API reaplica a regra e recusa passado com
          // 422. O seletor nativo do celular respeita o min e evita a viagem.
          min={today}
          onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
          className="w-full rounded border px-2 py-1.5 text-sm"
          required
        />
      </Field>

      <fieldset>
        <legend className="text-xs font-medium text-neutral-600">Neste dia</legend>
        <div className="mt-1 flex gap-2">
          <ModeButton
            active={form.fechado}
            onClick={() => setForm((f) => ({ ...f, fechado: true }))}
            label="Fechar o dia"
          />
          <ModeButton
            active={!form.fechado}
            onClick={() => setForm((f) => ({ ...f, fechado: false }))}
            label="Abrir com horário"
          />
        </div>
      </fieldset>

      {/* Os horarios so aparecem quando fazem sentido: campo desabilitado na
          tela e ruido, e campo habilitado e ignorado ensina o dono a desconfiar
          do formulario. */}
      {!form.fechado && (
        <div className="flex gap-3">
          <Field label="Abre" error={fieldErrors.abre}>
            <input
              type="time"
              value={form.abre}
              onChange={(e) => setForm((f) => ({ ...f, abre: e.target.value }))}
              className="w-full rounded border px-2 py-1.5 text-sm"
              required
            />
          </Field>
          <Field label="Fecha" error={fieldErrors.fecha}>
            <input
              type="time"
              value={form.fecha}
              onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
              className="w-full rounded border px-2 py-1.5 text-sm"
              required
            />
          </Field>
        </div>
      )}

      <Field label="Motivo (opcional)" error={fieldErrors.motivo}>
        <input
          type="text"
          value={form.motivo}
          maxLength={200}
          placeholder="Feriado, recesso, manutenção…"
          onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))}
          className="w-full rounded border px-2 py-1.5 text-sm"
        />
      </Field>

      <EffectPreview
        data={form.data}
        fechado={form.fechado}
        abre={form.abre}
        fecha={form.fecha}
        weeklyGrid={weeklyGrid}
      />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onCancel} className="rounded border px-3 py-1.5 text-sm">
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Lista
// ============================================================================

function ExceptionList({
  title,
  rows,
  weeklyGrid,
  emptyLabel,
  muted,
  confirmingId,
  setConfirmingId,
  deletingId,
  onEdit,
  onDelete,
}: {
  title: string;
  rows: ScheduleExceptionRow[];
  weeklyGrid: WeeklyGrid;
  emptyLabel: string;
  muted?: boolean;
  confirmingId: number | null;
  setConfirmingId: (id: number | null) => void;
  deletingId: number | null;
  onEdit: (row: ScheduleExceptionRow) => void;
  onDelete: (row: ScheduleExceptionRow) => void;
}) {
  return (
    <section>
      <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">{title}</h2>

      {rows.length === 0 ? (
        emptyLabel && <p className="mt-2 text-sm text-neutral-500">{emptyLabel}</p>
      ) : (
        <ul className={`mt-2 divide-y rounded border ${muted ? 'opacity-60' : ''}`}>
          {rows.map((row) => {
            const normal = weeklyGrid[weekdayOf(row.date)] ?? [];

            return (
              <li key={row.id} className="flex flex-wrap items-start gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {fullDateLabel(row.date)}
                    <span className="ml-1.5 font-normal text-neutral-500">
                      {WEEKDAY_NAMES[weekdayOf(row.date)]}
                    </span>
                  </p>

                  <p className="mt-0.5 text-sm">
                    {row.closed ? (
                      <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-medium text-neutral-800">
                        Fechado
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-900">
                        Abre {row.opens}–{row.closes}
                      </span>
                    )}
                    {/* Repete a precedencia POR LINHA: quem chega direto na
                        lista, sem passar pelo formulario, precisa entender o que
                        cada uma esta fazendo. */}
                    {normal.length > 0 && (
                      <span className="ml-2 text-xs text-neutral-500">
                        no lugar de {rangesLabel(normal)}
                      </span>
                    )}
                    {normal.length === 0 && !row.closed && (
                      <span className="ml-2 text-xs text-neutral-500">
                        num dia que normalmente não opera
                      </span>
                    )}
                  </p>

                  {row.reason && <p className="mt-0.5 text-xs text-neutral-500">{row.reason}</p>}
                </div>

                {confirmingId === row.id ? (
                  <div className="flex flex-col items-end gap-1">
                    {/* O aviso vai na CONFIRMACAO, e nao so no formulario: e
                        aqui que o dono esta prestes a agir achando que cancela
                        os passeios do dia. */}
                    <p className="max-w-[16rem] text-right text-xs text-neutral-500">
                      Não cancela reservas já feitas neste dia.
                    </p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => onDelete(row)}
                        disabled={deletingId === row.id}
                        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
                      >
                        {deletingId === row.id ? 'Excluindo…' : 'Confirmar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="rounded border px-2 py-1 text-xs"
                      >
                        Não
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(row)}
                      className="rounded border px-2 py-1 text-xs"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(row.id)}
                      className="rounded border px-2 py-1 text-xs text-red-700"
                    >
                      Excluir
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-3 py-1.5 text-sm ${
        active ? 'bg-neutral-900 font-medium text-white' : 'border text-neutral-700'
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block flex-1">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <span className="mt-1 block">{children}</span>
      {error && <span className="mt-0.5 block text-xs text-red-700">{error}</span>}
    </label>
  );
}
