// Aventix — resolucao do tenant pelo SLUG DA URL (CLAUDE.md secao 2-B).
//
// ============================================================================
// >>> ESTE MODULO E METADE DE UMA MIGRACAO, E A OUTRA METADE NAO EXISTE. <<<
//
// A URL /agendamento/{slug} ja resolve o tenant DE VERDADE: o slug vira uma
// consulta em `tenants` e um slug desconhecido vira 404. Mas `getTenantId()`
// (lib/tenant.ts) continua devolvendo 1 FIXO, e e ele que governa TODAS as
// consultas de negocio — catalogo, disponibilidade, settings, reservas.
//
// Com UM tenant os dois concordam e nada disso importa. Com DOIS eles divergem
// da pior maneira possivel: /agendamento/outro-cliente renderizaria a pagina
// certa, com o nome certo no topo, e por baixo serviria o catalogo, os horarios
// e as reservas do Quadri Club. Nada quebraria. Nada apareceria no log.
//
// `assertResolvedTenantIsCurrent()` existe para transformar esse silencio em
// barulho. Ver a barreira em tests/o-barreira-multi-tenant.test.ts.
//
// >>> ETAPA 2: quando getTenantId() passar a resolver o tenant da requisicao,
// >>> a divergencia deixa de ser possivel e ESTA FUNCAO PODE MORRER. Poder
// >>> apagar assertResolvedTenantIsCurrent() e o criterio de conclusao da
// >>> Etapa 2 — enquanto ela precisar existir, a Etapa 2 nao terminou.
// ============================================================================
//
// SERVER-ONLY pela mesma razao de lib/tenant.ts: le do Postgres.

import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from './db/client';
import { tenants } from './db/schema';
import { getTenantId } from './tenant';

export type ResolvedTenant = {
  id: number;
  name: string;
  slug: string;
};

/**
 * Formato aceito de slug: minusculas, digitos e hifen interno.
 *
 * A validacao acontece ANTES da consulta, e nao e cosmetica. O segmento de URL
 * e entrada de terceiro: barrar o que nao pode ser slug evita ida ao banco para
 * cada varredura de bot ('wp-login.php', '.env', '../../etc/passwd') e mantem o
 * espaco de endereco fechado — o dia em que o slug for escolhido pelo cliente no
 * onboarding, e esta regex que impede um tenant reivindicar 'admin' ou 'api'.
 *
 * Nao substitui a parametrizacao da query (o drizzle ja parametriza); e teto,
 * nao unica defesa.
 */
const SLUG_FORMAT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Erguido quando a URL resolve um tenant que o resto do sistema nao serve. */
export class MultiTenantNotReadyError extends Error {
  constructor(
    readonly resolvedTenantId: number,
    readonly currentTenantId: number,
    readonly slug: string,
  ) {
    super(
      `A URL /agendamento/${slug} resolveu o tenant ${resolvedTenantId}, mas ` +
        `getTenantId() devolveu ${currentTenantId}. A resolucao por slug (Etapa 1) ` +
        'entrou; a resolucao do tenant NAS CONSULTAS (Etapa 2) nao. Servir esta ' +
        'pagina mostraria o catalogo, os horarios e as reservas do tenant ' +
        `${currentTenantId} sob a marca do tenant ${resolvedTenantId}. ` +
        'Faca a Etapa 2 (lib/tenant.ts: getTenantId() resolvendo o tenant da ' +
        'requisicao) ANTES de cadastrar um segundo tenant.',
    );
    this.name = 'MultiTenantNotReadyError';
  }
}

/**
 * Tenant dono do slug, ou `null` se nenhum.
 *
 * `null` e o caso NORMAL, nao excepcional: e o que o 404 de
 * /agendamento/qualquer-coisa consome. Por isso nao lanca.
 */
export async function findTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  const normalized = slug.trim().toLowerCase();
  if (!SLUG_FORMAT.test(normalized)) return null;

  const [row] = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.slug, normalized));

  return row ?? null;
}

/**
 * Recusa servir uma pagina cujo tenant o resto do sistema nao vai respeitar.
 *
 * LANCA de proposito, em vez de devolver 404 ou renderizar mesmo assim:
 *
 *   - 404 MENTIRIA. O tenant existe, o slug esta certo, e o problema e do
 *     sistema, nao do endereco. Um 404 mandaria quem cadastrou o tenant 2
 *     procurar erro de digitacao por horas.
 *   - Renderizar mesmo assim e o bug que este modulo inteiro existe para
 *     impedir: pagina plausivel servindo dados de outro cliente.
 *
 * Um 500 com esta mensagem no log e o resultado desejado. Ele e ALTO, aponta a
 * causa e diz o que fazer — e so acontece se alguem inserir um segundo tenant,
 * que hoje e uma operacao deliberada, nunca acidental.
 */
export function assertResolvedTenantIsCurrent(tenant: ResolvedTenant): void {
  const current = getTenantId();
  if (tenant.id !== current) {
    throw new MultiTenantNotReadyError(tenant.id, current, tenant.slug);
  }
}
