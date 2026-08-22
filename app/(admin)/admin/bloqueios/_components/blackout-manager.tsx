'use client';

// Bloqueios pontuais: tira um intervalo da venda (CLAUDE.md secoes 4.3 e 6).
//
// >>> O QUE ESTA TELA PRECISA DEIXAR CLARO <<<
// 1. Bloqueio vence TUDO, inclusive dia aberto por excecao. E o ultimo corte.
// 2. Bloquear NAO cancela reserva que ja existe no intervalo — ela continua de
//    pe, com o recurso alocado. O bloqueio so impede vendas NOVAS. Sem o aviso,
//    o dono bloqueia a tarde de sabado achando que limpou a agenda da tarde.
// 3. Bloqueio SEM recurso vale para todos; com recurso, so aquele. A diferenca
//    e a que separa "estrada interditada" de "um quadriciclo na oficina", e
//    errar aqui tira da venda o dobro (ou a metade) do pretendido.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { BlackoutRow } from '@/lib/blackouts';
import type { ActiveResource } from '@/lib/resources';

type Props = {
  blackouts: BlackoutRow[];
  resources: ActiveResource[];
  /** 'YYYY-MM-DD' no fuso do tenant, resolvido no servidor. */
  today: string;
  resourceLabel: string;
  resourceLabelPlural: string;
};

type FieldErrors = Record<string, string>;

type FormState = {
  editingId: number | null;
  /** '' = todos os recursos. Select devolve string. */
  recursoId: string;
  inicio: string;
  fim: string;
  motivo: string;
};

/**
 * Instante ISO -> 'AAAA-MM-DDTHH:MM' no fuso do tenant.
 *
 * E o formato que `<input type="datetime-local">` consome e que a API espera de
 * volta. A conversao passa por Intl com timeZone fixo: usar o fuso do APARELHO
 * mostraria outro horario para o dono que estiver viajando, e ele reenviaria
 * esse horario errado ao salvar.
 */
const LOCAL_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function toLocalInput(iso: string): string {
  const parts = Object.fromEntries(
    LOCAL_PARTS.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  // 'en-CA' com hour12:false pode devolver '24' na meia-noite; normaliza.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

const RANGE_LABEL = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const stamp = (iso: string) => RANGE_LABEL.format(new Date(iso));

export function BlackoutManager({
  blackouts,
  resources,
  today,
  resourceLabel,
  resourceLabelPlural,
}: Props) {
  const router = useRouter();

  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function openCreate() {
    setForm({
      editingId: null,
      recursoId: '',
      inicio: `${today}T08:00`,
      fim: `${today}T12:00`,
      motivo: '',
    });
    setFieldErrors({});
    setFormError(null);
  }

  function openEdit(row: BlackoutRow) {
    setForm({
      editingId: row.id,
      recursoId: row.resourceId === null ? '' : String(row.resourceId),
      inicio: toLocalInput(row.startAt),
      fim: toLocalInput(row.endAt),
      motivo: row.reason ?? '',
    });
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
        editing ? `/api/admin/blackouts/${form.editingId}` : '/api/admin/blackouts',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // '' vira null: bloqueio de TODOS os recursos.
            recursoId: form.recursoId === '' ? null : Number(form.recursoId),
            inicio: form.inicio,
            fim: form.fim,
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

  async function remove(row: BlackoutRow) {
    if (deletingId !== null) return;

    setDeletingId(row.id);
    setRowError(null);

    try {
      const response = await fetch(`/api/admin/blackouts/${row.id}`, { method: 'DELETE' });

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
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">O bloqueio é o último corte.</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
          <li>
            Vale por cima do horário da semana <strong>e</strong> das exceções: se o dia estiver
            aberto, o bloqueio tira esse pedaço mesmo assim.
          </li>
          <li>
            Sem escolher {resourceLabel.toLowerCase()}, bloqueia{' '}
            <strong>todos os {resourceLabelPlural.toLowerCase()}</strong>.
          </li>
          <li>
            <strong>Não cancela reserva que já existe</strong> nesse intervalo — só impede novas.
            Para cancelar um passeio já vendido, use a agenda.
          </li>
        </ul>
      </div>

      {rowError && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {rowError}
        </p>
      )}

      {form === null ? (
        <button
          type="button"
          onClick={openCreate}
          className="self-start rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          Novo bloqueio
        </button>
      ) : (
        <form
          className="flex flex-col gap-3 rounded border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <h2 className="text-sm font-semibold">
            {form.editingId === null ? 'Novo bloqueio' : 'Editar bloqueio'}
          </h2>

          {formError && (
            <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {formError}
            </p>
          )}

          <label className="block">
            <span className="text-xs font-medium text-neutral-600">O que bloquear</span>
            <select
              value={form.recursoId}
              onChange={(e) =>
                setForm((f) => (f === null ? null : { ...f, recursoId: e.target.value }))
              }
              className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            >
              <option value="">Todos os {resourceLabelPlural.toLowerCase()}</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  Só {r.name}
                </option>
              ))}
            </select>
            {fieldErrors.recursoId && (
              <span className="mt-0.5 block text-xs text-red-700">{fieldErrors.recursoId}</span>
            )}
          </label>

          <div className="flex flex-wrap gap-3">
            <label className="block flex-1">
              <span className="text-xs font-medium text-neutral-600">Início</span>
              <input
                type="datetime-local"
                value={form.inicio}
                onChange={(e) =>
                  setForm((f) => (f === null ? null : { ...f, inicio: e.target.value }))
                }
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                required
              />
              {fieldErrors.inicio && (
                <span className="mt-0.5 block text-xs text-red-700">{fieldErrors.inicio}</span>
              )}
            </label>
            <label className="block flex-1">
              <span className="text-xs font-medium text-neutral-600">Fim</span>
              <input
                type="datetime-local"
                value={form.fim}
                onChange={(e) => setForm((f) => (f === null ? null : { ...f, fim: e.target.value }))}
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                required
              />
              {fieldErrors.fim && (
                <span className="mt-0.5 block text-xs text-red-700">{fieldErrors.fim}</span>
              )}
            </label>
          </div>

          <p className="text-xs text-neutral-500">Horários de Brasília.</p>

          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Motivo (opcional)</span>
            <input
              type="text"
              value={form.motivo}
              maxLength={200}
              placeholder="Manutenção, evento fechado, folga…"
              onChange={(e) =>
                setForm((f) => (f === null ? null : { ...f, motivo: e.target.value }))
              }
              className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <button type="button" onClick={closeForm} className="rounded border px-3 py-1.5 text-sm">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {blackouts.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum bloqueio cadastrado.</p>
      ) : (
        <ul className="divide-y rounded border">
          {blackouts.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {stamp(row.startAt)} → {stamp(row.endAt)}
                </p>
                <p className="mt-0.5 text-sm">
                  {row.resourceName ? (
                    <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-medium text-neutral-800">
                      Só {row.resourceName}
                    </span>
                  ) : (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-900">
                      Todos os {resourceLabelPlural.toLowerCase()}
                    </span>
                  )}
                </p>
                {row.reason && <p className="mt-0.5 text-xs text-neutral-500">{row.reason}</p>}
              </div>

              {confirmingId === row.id ? (
                <div className="flex flex-col items-end gap-1">
                  <p className="max-w-[16rem] text-right text-xs text-neutral-500">
                    Libera o horário para venda. Não mexe em reserva existente.
                  </p>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => remove(row)}
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
                    onClick={() => openEdit(row)}
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
          ))}
        </ul>
      )}
    </section>
  );
}
