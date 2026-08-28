// Navegacao entre as telas do admin.
//
// >>> POR QUE ISTO EXISTE <<<
// Ate 22/08 a tela /admin/experiencias nao era alcancavel por link nenhum:
// `grep` por "/admin/experiencias" fora da propria pasta nao achava nada, e so
// se chegava nela digitando a URL. Com as telas de grade entrando, seriam
// quatro paginas invisiveis — e o objetivo delas e exatamente o contrario,
// tirar o dono da dependencia do desenvolvedor para mudar a propria agenda.
//
// Server Component: nao tem estado nem interacao alem dos links. A pagina atual
// vem por prop, e nao de usePathname, para nao arrastar este componente (e as
// telas que o usam) para o cliente so por causa de um destaque visual. A UNICA
// parte interativa e o toggle da sidebar (SidebarToggle), um client component a
// parte.
//
// >>> DUAS FORMAS, UM SO COMPONENTE (24/08) <<<
// Mobile (< lg): a navbar horizontal de sempre — inalterada, so com `lg:hidden`
//   somado, que e inerte abaixo de lg (quem usa o admin no celular nao ve
//   diferenca).
// Desktop (>= lg): sidebar vertical fixa a esquerda, com dois estados (recolhido
//   = so icone; expandido = icone + rotulo). O estado recolhido/expandido nao
//   mora aqui: vem do atributo `data-collapsed` no shell (layout.tsx, a partir do
//   cookie), e o CSS em globals.css reage a ele (largura, rotulos, deslocamento
//   do conteudo). A ativa continua vindo por `current`, nos dois estados.
//
// Acessibilidade do estado recolhido: so icone nao diz o que e. Cada item leva
// `aria-label` e `title` com o rotulo (leitor de tela + tooltip do navegador).

import Link from 'next/link';
import type { ReactNode } from 'react';

import { SidebarToggle } from './sidebar-toggle';

const LINKS = [
  { key: 'agenda', href: '/admin', label: 'Agenda', icon: <CalendarIcon /> },
  { key: 'agendamentos', href: '/admin/agendamentos', label: 'Agendamentos', icon: <ListIcon /> },
  { key: 'excecoes', href: '/admin/excecoes', label: 'Exceções', icon: <CalendarXIcon /> },
  { key: 'horarios', href: '/admin/horarios', label: 'Horários', icon: <ClockIcon /> },
  { key: 'bloqueios', href: '/admin/bloqueios', label: 'Bloqueios', icon: <BanIcon /> },
  { key: 'experiencias', href: '/admin/experiencias', label: 'Experiências', icon: <MountainIcon /> },
  { key: 'financeiro', href: '/admin/financeiro', label: 'Financeiro', icon: <PercentIcon /> },
] as const;

export type AdminNavKey = (typeof LINKS)[number]['key'];

export function AdminNav({ current }: { current: AdminNavKey }) {
  return (
    <>
      {/* MOBILE (< lg): navbar horizontal. Rola na horizontal no celular: a tela
          do admin e usada EM CAMPO (secao 11.1), e os links quebrariam em duas
          linhas num aparelho estreito, comendo altura util da agenda. `lg:hidden`
          e a UNICA adicao — inerte abaixo de lg. */}
      <nav
        aria-label="Seções do painel"
        className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0 lg:hidden"
      >
        {LINKS.map((link) => {
          const active = link.key === current;
          return (
            <Link
              key={link.key}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={`shrink-0 rounded px-3 py-1.5 text-sm ${
                active
                  ? 'bg-neutral-900 font-medium text-white'
                  : 'border text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* DESKTOP (>= lg): sidebar vertical fixa. A largura e a visibilidade dos
          rotulos sao governadas por CSS via `data-collapsed` no shell ancestral
          (globals.css) — este componente nao le o cookie, so desenha a marcacao
          estavel (`data-admin-sidebar`, `.admin-nav-item`, `.admin-nav-label`)
          que aquele CSS enxerga. */}
      <aside
        data-admin-sidebar
        aria-label="Seções do painel"
        className="fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden border-r bg-white lg:flex"
      >
        <div className="flex items-center border-b p-2">
          <SidebarToggle />
        </div>

        <nav className="flex flex-col gap-1 overflow-y-auto p-2">
          {LINKS.map((link) => {
            const active = link.key === current;
            return (
              <Link
                key={link.key}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                aria-label={link.label}
                title={link.label}
                className={`admin-nav-item flex items-center gap-3 rounded px-3 py-2 text-sm ${
                  active
                    ? 'bg-neutral-900 font-medium text-white'
                    : 'text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <span className="shrink-0" aria-hidden="true">
                  {link.icon}
                </span>
                <span className="admin-nav-label whitespace-nowrap">{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

// -- icones (SVG inline, sem dependencia; secao 14 do CLAUDE.md preza deps enxutas) --
// 24x24, traco em currentColor, herdam a cor do item (branco quando ativo).

function iconProps() {
  return {
    viewBox: '0 0 24 24',
    className: 'h-5 w-5',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

function CalendarIcon(): ReactNode {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v3M16 3v3" />
    </svg>
  );
}

function ListIcon(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

function CalendarXIcon(): ReactNode {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v3M16 3v3M10 13.5l4 4M14 13.5l-4 4" />
    </svg>
  );
}

function ClockIcon(): ReactNode {
  return (
    <svg {...iconProps()}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function BanIcon(): ReactNode {
  return (
    <svg {...iconProps()}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function PercentIcon(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M18 6L6 18" />
      <circle cx="8" cy="8" r="2" />
      <circle cx="16" cy="16" r="2" />
    </svg>
  );
}

function MountainIcon(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M3 19.5h18L13.5 6l-4 7-2-3z" />
    </svg>
  );
}
