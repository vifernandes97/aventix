'use client';

// Grade semanal: faixas por dia da semana (CLAUDE.md secoes 4.3 e 6).
//
// ============================================================================
// >>> O AVISO QUE ESTA TELA NAO PODE DEIXAR DE DAR <<<
// Apagar uma faixa NAO cancela reserva ja vendida naquele horario. A reserva ja
// tem recurso alocado em reservation_resources.period, congelado na venda
// (secao 4.6); a grade governa apenas o que ainda PODE SER VENDIDO.
//
// Sem esse aviso, o modo de falha e caro e silencioso: o dono apaga o sabado
// achando que cancelou os passeios de sabado, nao avisa ninguem, e os clientes
// aparecem no ponto de encontro. Por isso o texto aparece DUAS vezes — no topo
// e dentro da confirmacao de exclusao, que e o instante em que ele age.
// ============================================================================
//
// A tela tambem lembra que EXCECAO VENCE HORARIO SEMANAL (secao 6): editar o
// sabado aqui nao muda o sabado que tem excecao cadastrada.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { OperatingHoursRow } from '@/lib/operating-hours';
import type { ScheduleExceptionRow } from '@/lib/schedule-exceptions';

type Props = {
  hours: OperatingHoursRow[];
  upcomingExceptions: ScheduleExceptionRow[];
};

type FieldErrors = Record<string, string>;

type FormState = {
  /** null = criando; numero = editando aquela faixa. */
  editingId: number | null;
  weekday: number;
  abre: string;
  fecha: string;
};

const WEEKDAYS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
];

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

export function WeeklyHoursManager({ hours, upcomingExceptions }: Props) {
  const router = useRouter();

  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function openCreate(weekday: number) {
    setForm({ editingId: null, weekday, abre: '08:00', fecha: '18:00' });
    setFieldErrors({});
    setFormError(null);
  }

  function openEdit(row: OperatingHoursRow) {
    setForm({ editingId: row.id, weekday: row.weekday, abre: row.opens, fecha: row.closes });
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
        editing ? `/api/admin/operating-hours/${form.editingId}` : '/api/admin/operating-hours',
        {
          // PUT na edicao: weekday, abre e fecha sao interdependentes e a
          // checagem de sobreposicao precisa dos tres juntos.
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            diaDaSemana: form.weekday,
            abre: form.abre,
            fecha: form.fecha,
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

        // 409: cruza outra faixa do mesmo dia. A API devolve QUAL — dizer
        // "sobrepõe" sem apontar a culpada obrigaria o dono a caçar na lista.
        if (response.status === 409 && body?.code === 'faixa_sobreposta') {
          const c = body.conflict as { opens: string; closes: string } | undefined;
          setFormError(
            c
              ? `Esse horário se cruza com a faixa ${c.opens}–${c.closes}, já cadastrada neste dia. Ajuste um dos dois.`
              : 'Esse horário se cruza com outra faixa deste dia.',
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

  async function remove(row: OperatingHoursRow) {
    if (deletingId !== null) return;

    setDeletingId(row.id);
    setRowError(null);

    try {
      const response = await fetch(`/api/admin/operating-hours/${row.id}`, { method: 'DELETE' });

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
      {/* Aviso 1 de 2. O segundo vai dentro da confirmacao de exclusao. */}
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">Isto governa o que ainda pode ser vendido.</p>
        <p className="mt-1 text-[13px] leading-relaxed">
          Mudar ou apagar um horário <strong>não cancela reserva que já foi feita</strong> nesse
          dia — ela continua valendo, com o quadriciclo já reservado. Para cancelar um passeio já
          vendido, use a agenda.
        </p>
      </div>

      {rowError && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {rowError}
        </p>
      )}

      {form !== null && (
        <RangeForm
          form={form}
          setForm={(updater) => setForm((f) => (f === null ? null : updater(f)))}
          fieldErrors={fieldErrors}
          formError={formError}
          saving={saving}
          onSave={save}
          onCancel={closeForm}
        />
      )}

      <ul className="flex flex-col gap-2">
        {WEEKDAYS.map((day) => {
          const ranges = hours.filter((h) => h.weekday === day.value);
          const excecoes = upcomingExceptions.filter((e) => weekdayOf(e.date) === day.value);

          return (
            <li key={day.value} className="rounded border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{day.label}</h2>
                <button
                  type="button"
                  onClick={() => openCreate(day.value)}
                  className="rounded border px-2 py-1 text-xs"
                >
                  Adicionar faixa
                </button>
              </div>

              {ranges.length === 0 ? (
                <p className="mt-1.5 text-sm text-neutral-500">Não opera</p>
              ) : (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {ranges.map((range) => (
                    <li key={range.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm">
                        {range.opens}–{range.closes}
                      </span>

                      {confirmingId === range.id ? (
                        <span className="flex flex-wrap items-center gap-1">
                          {/* Aviso 2 de 2: no instante em que o dono age. */}
                          <span className="text-xs text-neutral-500">
                            Some da venda. Não cancela reserva já feita.
                          </span>
                          <button
                            type="button"
                            onClick={() => remove(range)}
                            disabled={deletingId === range.id}
                            className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-60"
                          >
                            {deletingId === range.id ? 'Excluindo…' : 'Confirmar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(null)}
                            className="rounded border px-2 py-0.5 text-xs"
                          >
                            Não
                          </button>
                        </span>
                      ) : (
                        <span className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(range)}
                            className="rounded border px-2 py-0.5 text-xs"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(range.id)}
                            className="rounded border px-2 py-0.5 text-xs text-red-700"
                          >
                            Excluir
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* A precedencia da secao 6, dita onde ela morde: o dono edita o
                  sabado e o sabado do feriado continua diferente. */}
              {excecoes.length > 0 && (
                <p className="mt-2 border-t pt-2 text-xs text-neutral-500">
                  Não vale em{' '}
                  {excecoes.map((e) => `${dateLabel(e.date)} (${e.closed ? 'fechado' : `${e.opens}–${e.closes}`})`).join(', ')}{' '}
                  — essas datas têm exceção, e a exceção manda no dia.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RangeForm({
  form,
  setForm,
  fieldErrors,
  formError,
  saving,
  onSave,
  onCancel,
}: {
  form: FormState;
  setForm: (updater: (f: FormState) => FormState) => void;
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
        {form.editingId === null ? 'Nova faixa' : 'Editar faixa'}
      </h2>

      {formError && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {formError}
        </p>
      )}

      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Dia da semana</span>
        <select
          value={form.weekday}
          onChange={(e) => setForm((f) => ({ ...f, weekday: Number(e.target.value) }))}
          className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
        >
          {WEEKDAYS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        {fieldErrors.diaDaSemana && (
          <span className="mt-0.5 block text-xs text-red-700">{fieldErrors.diaDaSemana}</span>
        )}
      </label>

      <div className="flex gap-3">
        <label className="block flex-1">
          <span className="text-xs font-medium text-neutral-600">Abre</span>
          <input
            type="time"
            value={form.abre}
            onChange={(e) => setForm((f) => ({ ...f, abre: e.target.value }))}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            required
          />
          {fieldErrors.abre && (
            <span className="mt-0.5 block text-xs text-red-700">{fieldErrors.abre}</span>
          )}
        </label>
        <label className="block flex-1">
          <span className="text-xs font-medium text-neutral-600">Fecha</span>
          <input
            type="time"
            value={form.fecha}
            onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            required
          />
          {fieldErrors.fecha && (
            <span className="mt-0.5 block text-xs text-red-700">{fieldErrors.fecha}</span>
          )}
        </label>
      </div>

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
