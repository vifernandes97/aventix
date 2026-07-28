// GRUPO C — motor de disponibilidade (CLAUDE.md secao 6).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { localToUtc } from '@/lib/time';

import {
  EXP_CURTA,
  TENANT_ID,
  assertCatalogSeeded,
  getSettingRaw,
  nextSaturday,
  nextSunday,
  nextTuesday,
  occupy,
  restoreSetting,
  setSetting,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();
const SUN = nextSunday();
const TUE = nextTuesday();

const labels = (r: { slots: { label: string }[] }) => r.slots.map((s) => s.label);

beforeAll(assertCatalogSeeded);
beforeEach(wipeMovement);

describe('C — disponibilidade', () => {
  it('6. adjacencia: os limites [) apenas se tocam, nas duas pontas', async () => {
    // A grade do seed abre 08:00, entao 11:45 nao cai no grid de 30 min. Uma
    // excecao de agenda abrindo 08:15 poe 11:45 entre os candidatos.
    await db.execute(sql`
      INSERT INTO schedule_exceptions (tenant_id, date, opens, closes, closed, reason)
      VALUES (${TENANT_ID}, ${SUN}, '08:15', '18:00', false, 'grade deslocada p/ testar 11:45')
    `);

    // Ambos os recursos ocupados em [10:00, 11:45).
    await occupy({ date: SUN, startLocal: '10:00', minutes: 105, resourceId: 1 });
    await occupy({ date: SUN, startLocal: '10:00', minutes: 105, resourceId: 2 });

    const l = labels(
      await getAvailability({ experienceId: EXP_CURTA, date: SUN, resourcesNeeded: 1 }),
    );

    // Ponta FINAL: a reserva termina 11:45 e o candidato comeca 11:45. Tocam,
    // nao sobrepoem. Se isto sumir, a logica virou <= onde devia ser <.
    expect(l, 'slot 11:45 (encosta no fim da reserva)').toContain('11:45');

    // Ponta INICIAL: 08:15 + 75 min = 09:30, que encosta em 10:00 sem alcancar.
    expect(l, 'slot 08:15 (termina antes do inicio da reserva)').toContain('08:15');

    // Controles: estes DEVEM sumir, senao o teste passaria por acaso.
    expect(l, 'slot 11:15 sobrepoe').not.toContain('11:15');
    expect(l, 'slot 09:45 sobrepoe').not.toContain('09:45');
  });

  it('7. schedule_exception closed=true zera o dia', async () => {
    await db.execute(sql`
      INSERT INTO schedule_exceptions (tenant_id, date, closed, reason)
      VALUES (${TENANT_ID}, ${SAT}, true, 'recesso')
    `);

    const r = await getAvailability({ experienceId: EXP_CURTA, date: SAT, resourcesNeeded: 1 });

    expect(r.dayState).toBe('closed_exception');
    expect(r.slots).toEqual([]);
  });

  it('8. schedule_exception closed=false abre uma terca, ignorando o weekday', async () => {
    // Sem excecao a terca nao opera (o seed so tem sabado e domingo).
    const fechada = await getAvailability({
      experienceId: EXP_CURTA,
      date: TUE,
      resourcesNeeded: 1,
    });
    expect(fechada.dayState).toBe('closed_weekday');
    expect(fechada.slots).toEqual([]);

    await db.execute(sql`
      INSERT INTO schedule_exceptions (tenant_id, date, opens, closes, closed, reason)
      VALUES (${TENANT_ID}, ${TUE}, '09:00', '15:00', false, 'feriado - abre')
    `);

    const aberta = await getAvailability({
      experienceId: EXP_CURTA,
      date: TUE,
      resourcesNeeded: 1,
    });
    expect(aberta.dayState).toBe('open');
    expect(labels(aberta)[0]).toBe('09:00');
    // 14:00 + 60 = 15:00 cabe; 14:30 + 60 = 15:30 estoura.
    expect(labels(aberta).at(-1)).toBe('14:00');
  });

  it('9. blackout remove so os slots que ele cobre', async () => {
    const inicio = localToUtc(SAT, '12:00').toISOString();
    const fim = localToUtc(SAT, '14:00').toISOString();
    await db.execute(sql`
      INSERT INTO blackouts (tenant_id, resource_id, period, reason)
      VALUES (${TENANT_ID}, NULL, tstzrange(${inicio}::timestamptz, ${fim}::timestamptz), 'manutencao')
    `);

    const l = labels(
      await getAvailability({ experienceId: EXP_CURTA, date: SAT, resourcesNeeded: 1 }),
    );

    // 11:30 + 75 = 12:45, invade o blackout.
    expect(l, '11:30 invade o blackout').not.toContain('11:30');
    expect(l, '13:30 esta dentro do blackout').not.toContain('13:30');
    // 11:00 + 75 = 12:15 tambem invade; 10:45 nao existe no grid. O ultimo antes
    // do bloqueio e 10:30 (10:30 + 75 = 11:45 < 12:00).
    expect(l, '10:30 termina antes do blackout').toContain('10:30');
    // 14:00 encosta no fim do blackout sem sobrepor.
    expect(l, '14:00 encosta no fim do blackout').toContain('14:00');
    expect(l, '08:00 fora do blackout').toContain('08:00');
  });

  it('11. o ultimo slot respeita a DURACAO contra closes, nao duracao + buffer', async () => {
    const l = labels(
      await getAvailability({ experienceId: EXP_CURTA, date: SAT, resourcesNeeded: 1 }),
    );

    // Experiencia 1: 60 min de duracao, 15 de buffer, grade fecha 18:00.
    // 17:00 + 60 = 18:00 cabe, mesmo com o buffer levando o period ate 18:15 —
    // o buffer e tempo de limpeza e PODE extrapolar o fechamento.
    expect(l.at(-1), 'ultimo slot').toBe('17:00');
    // Se o motor descontasse o buffer, o ultimo seria 16:00 (16:00+75=17:15).
    expect(l, '17:30 estouraria o fechamento pela duracao').not.toContain('17:30');
  });
});

describe('C — lead time configuravel', () => {
  const HOJE = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  let leadOriginal: string | null = null;

  beforeAll(async () => {
    leadOriginal = await getSettingRaw('min_lead_minutes');
  });

  afterAll(async () => {
    await restoreSetting('min_lead_minutes', leadOriginal);
    await db.execute(sql`DELETE FROM schedule_exceptions WHERE tenant_id = ${TENANT_ID}`);
  });

  beforeEach(async () => {
    await wipeMovement();
    // Grade larga HOJE, para que "agora" caia dentro dela. Sem mockar relogio:
    // e um dado inserido, nao um tempo falso.
    await db.execute(sql`
      INSERT INTO schedule_exceptions (tenant_id, date, opens, closes, closed, reason)
      VALUES (${TENANT_ID}, ${HOJE}, '00:00', '23:30', false, 'grade larga p/ testar lead time')
      ON CONFLICT (tenant_id, date) DO UPDATE SET opens = excluded.opens, closes = excluded.closes
    `);
  });

  /** Primeiro slot da grade de hoje, em ms. */
  async function primeiroSlot(): Promise<number | null> {
    const r = await getAvailability({ experienceId: EXP_CURTA, date: HOJE, resourcesNeeded: 1 });
    return r.slots[0] ? new Date(r.slots[0].startAt).getTime() : null;
  }

  it('10a. min_lead_minutes "0" aceita o proximo slot da grade', async () => {
    await setSetting('min_lead_minutes', '0');
    const agora = Date.now();
    const primeiro = await primeiroSlot();

    expect(primeiro).not.toBeNull();
    expect(primeiro!).toBeGreaterThanOrEqual(agora);
    // O candidato anterior (30 min antes) ja teria passado: prova que o corte
    // esta no lugar certo, e nao que a grade simplesmente comeca ali.
    expect(primeiro! - 30 * 60_000).toBeLessThan(agora);
  });

  it('10b. min_lead_minutes "60" empurra o primeiro slot em uma hora', async () => {
    await setSetting('min_lead_minutes', '60');
    const corte = Date.now() + 60 * 60_000;
    const primeiro = await primeiroSlot();

    expect(primeiro!).toBeGreaterThanOrEqual(corte);
    expect(primeiro! - 30 * 60_000).toBeLessThan(corte);
  });

  it('10c. min_lead_minutes "180" empurra tres horas', async () => {
    await setSetting('min_lead_minutes', '180');
    const corte = Date.now() + 180 * 60_000;
    const primeiro = await primeiroSlot();

    expect(primeiro!).toBeGreaterThanOrEqual(corte);
    expect(primeiro! - 30 * 60_000).toBeLessThan(corte);
  });

  it('10d. valor invalido ("abc") cai no default 60 e NAO vira NaN', async () => {
    await setSetting('min_lead_minutes', 'abc');
    const corte = Date.now() + 60 * 60_000;

    const r = await getAvailability({ experienceId: EXP_CURTA, date: HOJE, resourcesNeeded: 1 });
    const primeiro = new Date(r.slots[0]!.startAt).getTime();

    // NaN faria a comparacao ser sempre falsa e a grade sairia inteira (ou vazia).
    expect(r.slots.length).toBeGreaterThan(0);
    expect(primeiro).toBeGreaterThanOrEqual(corte);
    expect(primeiro - 30 * 60_000).toBeLessThan(corte);
  });
});
