// Aventix — leitura de recursos (CLAUDE.md secao 4.3).
//
// POR QUE NAO REUSA getActiveResources DE lib/calendar.ts: aquele devolve
// { id, name } porque e o que a GRADE precisa — as colunas do calendario. O
// formulario publico precisa tambem da `capacity`, para dizer quantas pessoas
// cabem e para o teto de participantes. Acrescentar o campo la mudaria um
// contrato de calendario por necessidade de outra tela, e o proximo consumidor
// herdaria um campo que nao usa.
//
// Este modulo e o lugar natural do CRUD de recursos da Fase 3, que vem a
// seguir; hoje ele so le.
//
// SERVER-ONLY pelo mesmo motivo de tenant.ts: le do Postgres e resolve o tenant.

import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from './db/client';
import { resources } from './db/schema';
import { getTenantId } from './tenant';

export type ActiveResource = {
  id: number;
  name: string;
  /** Pessoas por recurso: 1 operador + (capacity - 1) passageiros. */
  capacity: number;
};

/**
 * Recursos ATIVOS do tenant.
 *
 * A CONTAGEM e o teto de `resourcesNeeded` no formulario (secao 6): o cliente
 * escolhe de 1 ate o numero de recursos ativos. O motor de disponibilidade
 * refaz essa checagem, e `createReservation` de novo dentro da transacao — aqui
 * e so para nao oferecer uma opcao que o servidor recusaria.
 */
export async function listActiveResources(): Promise<ActiveResource[]> {
  return db
    .select({ id: resources.id, name: resources.name, capacity: resources.capacity })
    .from(resources)
    .where(and(eq(resources.tenantId, getTenantId()), eq(resources.active, true)))
    .orderBy(asc(resources.id));
}
