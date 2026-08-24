// Lista CONSULTAVEL de reservas (CLAUDE.md secao 11.1 + tarefa de 24/08).
//
// POR QUE EXISTE: ate aqui o dono so achava uma reserva pela agenda, e a agenda
// exige saber a DATA. O cenario da primeira semana e o cliente ligando —
// "reservei pro sabado, esqueci o horario" — sem nome nem telefone para buscar.
// Esta tela resolve isso: busca por nome ou telefone, filtro por status e
// periodo, ordenada da mais recente para a mais antiga.
//
// SOMENTE LEITURA. Nenhuma acao de escrita aqui: cancelar ja vive no painel de
// detalhe (secao 11.1), alcancado pelo link de cada cartao.
//
// Server Component lendo a lib DIRETO (searchReservations), sem HTTP contra si
// mesmo — mesmo padrao da agenda (app/(admin)/admin/page.tsx).
//
// >>> ESTADO DA BUSCA VIVE NA URL <<<
// O formulario e um GET nativo: submeter recarrega a pagina com os filtros em
// searchParams. Assim o dono manda o link de uma busca para si mesmo, recarrega
// sem perder o filtro, e a tela funciona sem JavaScript. Nada de estado de
// cliente.
//
// >>> PRIVACIDADE <<<
// A lista mostra VARIOS clientes de uma vez — um print vazaria dado sensivel de
// todos. Por isso NAO ha CPF, documento nem contato de emergencia aqui; esses
// ficam so no detalhe, que e uma reserva por vez. Telefone entra porque e a
// ferramenta do dono para retornar a ligacao. A garantia de fato esta na query
// (lib/reservation-list.ts), que nao BUSCA os campos sensiveis.

import Link from 'next/link';

import { getCurrentUser } from '@/lib/auth';
import {
  RESERVATION_LIST_LIMIT,
  type ReservationStatus,
  isReservationStatus,
  searchReservations,
} from '@/lib/reservation-list';
import { getSettings } from '@/lib/tenant';
import { isValidCalendarDate } from '@/lib/time';

import { AdminNav } from '../_components/admin-nav';
import {
  DETAIL_STATUS_BADGE,
  DETAIL_STATUS_LABEL,
  dayMonthLabel,
  localDateOf,
  moneyLabel,
  timeLabel,
  weekdayShortLabel,
} from '../_components/shared';

// Sessao em cookie + reservas que mudam a cada venda: render estatico serviria a
// busca de um usuario para o proximo, com dados velhos.
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{
  q?: string | string[];
  status?: string | string[];
  de?: string | string[];
  ate?: string | string[];
}>;

/** Opcoes do filtro de status, na ordem do ciclo de vida da reserva. */
const STATUS_OPTIONS: ReservationStatus[] = [
  'pending_payment',
  'confirmed',
  'cancelled',
  'expired',
];

/** Primeiro valor de um parametro que pode chegar repetido na query string. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** 'Sáb, 30 de ago. de 2026' a partir de um instante ISO, em Sao Paulo. */
function dayLabel(iso: string): string {
  const date = localDateOf(iso);
  return `${capitalize(weekdayShortLabel(date))}, ${dayMonthLabel(date)} de ${date.slice(0, 4)}`;
}

export default async function AgendamentosPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, settings, sp] = await Promise.all([getCurrentUser(), getSettings(), searchParams]);

  // Entrada de usuario: valores invalidos caem no "sem filtro" em vez de quebrar
  // a tela. Isto e navegacao, nao API — uma busca digitada errado nao merece uma
  // pagina de erro.
  const rawQuery = first(sp.q)?.trim();
  const query = rawQuery || undefined;

  const rawStatus = first(sp.status);
  const status = rawStatus && isReservationStatus(rawStatus) ? rawStatus : undefined;

  const rawFrom = first(sp.de);
  const from = rawFrom && isValidCalendarDate(rawFrom) ? rawFrom : undefined;

  const rawTo = first(sp.ate);
  const to = rawTo && isValidCalendarDate(rawTo) ? rawTo : undefined;

  const { items, limited } = await searchReservations({ query, status, from, to });

  const hasFilters = Boolean(query || status || from || to);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* Regra de marca (rev 5): a UI exibe a marca do TENANT, nunca "Aventix". */}
          <h1 className="text-lg font-semibold">{settings.business_name || 'Agendamentos'}</h1>
          <p className="text-xs text-neutral-500">{user?.email}</p>
        </div>

        <form action="/api/admin/logout" method="post">
          <button type="submit" className="rounded border px-3 py-1.5 text-sm">
            Sair
          </button>
        </form>
      </header>

      <AdminNav current="agendamentos" />

      {/* -- busca (GET nativo: estado vai para a URL) ------------------------- */}
      <form method="GET" className="flex flex-col gap-2 rounded-lg border p-3 dark:border-neutral-800">
        <input
          type="search"
          name="q"
          defaultValue={query ?? ''}
          placeholder="Buscar por nome ou telefone"
          aria-label="Buscar por nome ou telefone"
          className="w-full rounded border px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />

        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-xs text-neutral-500">
            Status
            <select
              name="status"
              defaultValue={status ?? ''}
              className="rounded border px-2 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {DETAIL_STATUS_LABEL[option]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            De
            <input
              type="date"
              name="de"
              defaultValue={from ?? ''}
              className="rounded border px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Até
            <input
              type="date"
              name="ate"
              defaultValue={to ?? ''}
              className="rounded border px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Buscar
          </button>
          {hasFilters && (
            // Link, nao reset: volta para a URL limpa, que e o estado "sem filtro".
            <Link href="/admin/agendamentos" className="rounded-md border px-4 py-2 text-sm">
              Limpar
            </Link>
          )}
        </div>
      </form>

      {/* -- resultado -------------------------------------------------------- */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-neutral-500">
          {items.length} agendamento{items.length === 1 ? '' : 's'}
          {hasFilters ? ' no filtro' : ''}
        </p>
      </div>

      {limited && (
        <p className="rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Mostrando os {RESERVATION_LIST_LIMIT} mais recentes. Refine por nome, telefone ou período
          para encontrar os demais.
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-neutral-500 dark:border-neutral-800">
          {hasFilters
            ? 'Nenhum agendamento encontrado com esses filtros.'
            : 'Nenhum agendamento ainda.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const day = localDateOf(item.startAt);
            // Leva ao DIA do passeio no calendario e ja pede para abrir o painel
            // de detalhe daquela reserva (parametro aditivo — secao 2-B / calendar).
            const detailHref = `/admin?view=day&date=${day}&reserva=${item.id}`;

            return (
              <li
                key={item.id}
                className="overflow-hidden rounded-lg border dark:border-neutral-800"
              >
                {/* O cartao inteiro leva ao detalhe. O telefone (rodape) e um link
                    IRMAO, nunca aninhado, para nao ter <a> dentro de <a>. */}
                <Link
                  href={detailHref}
                  className="block p-3 transition hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-base font-semibold tabular-nums">
                          {timeLabel(item.startAt)}
                        </span>
                        <span className="truncate text-sm text-neutral-600 dark:text-neutral-300">
                          {item.experienceName}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-500">{dayLabel(item.startAt)}</p>
                      <p className="mt-1 truncate text-sm font-medium">{item.customerName}</p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${DETAIL_STATUS_BADGE[item.status]}`}
                      >
                        {DETAIL_STATUS_LABEL[item.status]}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">
                        {moneyLabel(item.totalPriceCents)}
                      </span>
                    </div>
                  </div>
                </Link>

                <div className="border-t px-3 py-2 dark:border-neutral-800">
                  <a
                    href={`tel:${item.customerPhone}`}
                    className="inline-flex items-center gap-1.5 text-sm text-neutral-600 underline underline-offset-2 dark:text-neutral-300"
                  >
                    <span aria-hidden>📞</span>
                    {item.customerPhone}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
