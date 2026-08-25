// GRUPO R — idade minima do garupa e mapa do ponto de encontro (CLAUDE.md
// secoes 4.3 e 4.6; regra publicada pelo cliente em 24/08/2026).
//
// >>> A CONTA E NA DATA DO PASSEIO, NAO NA DA RESERVA <<<
// E o que separa este grupo da regra do CONDUTOR (grupo D), que corta na data do
// agendamento. A divergencia e deliberada e esta registrada em docs/DECISOES.md:
// recusar uma crianca que completa a idade ANTES de viajar seria recusar dinheiro
// por tecnicismo de calendario.
//
// As datas de nascimento sao derivadas de `todayLocalDate()` e da data do
// passeio, NUNCA de `new Date().toISOString()` — a armadilha registrada em
// DECISOES.md (17/08): o UTC ja virou o dia seguinte depois das 21h em Sao
// Paulo, e o caso da idade exata falharia so no fim da noite.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';
import { safeEmbedUrl } from '@/lib/maps';
import { InvalidCompositionError, createReservation } from '@/lib/reservations';
import { getSettings } from '@/lib/tenant';
import { todayLocalDate } from '@/lib/time';

import {
  EXP,
  TEMPLATE_EXP,
  assertCatalogSeeded,
  birthdateYearsAgo,
  getSettingRaw,
  movementCounts,
  nextSaturday,
  reservationInput,
  restoreSetting,
  setSetting,
  wipeMovement,
} from './helpers/db';

const SAT = nextSaturday();

/**
 * Idades exigidas, LIDAS DO TEMPLATE e nao escritas a mao.
 *
 * O template e a casa definitiva da regra (o seed reconcilia a coluna a partir
 * dele), entao um teste que repetisse "12" continuaria verde se alguem mudasse
 * o template — e a suite deixaria de provar a regra que o cliente publicou.
 */
const MIN_LONGA = TEMPLATE_EXP.longa.minPassengerAge; // Trilha da Montanha: 12
const MIN_CURTA = TEMPLATE_EXP.curta.minPassengerAge; // Trilha da Fazenda: 6

/** Nasceu ha `years` anos EM RELACAO A DATA DO PASSEIO: faz aniversario nela. */
function birthdateTurningOnTripDate(years: number, tripDate: string): string {
  const [year, month, day] = tripDate.split('-');
  return `${Number(year) - years}-${month}-${day}`;
}

async function primeiroSlot(experienceId: number, resourcesNeeded = 1): Promise<string> {
  const { slots } = await getAvailability({ experienceId, date: SAT, resourcesNeeded });
  return slots[0]!.startAt;
}

beforeAll(assertCatalogSeeded);
beforeEach(wipeMovement);

describe('R — idade minima do garupa', () => {
  it('R1. o template define idades diferentes por experiencia (nao e constante global)', () => {
    // Guarda a premissa do grupo inteiro: se as duas ficarem iguais, os casos R5
    // e R6 passam a provar nada, e passariam em silencio.
    expect(MIN_LONGA).toBeGreaterThan(MIN_CURTA);
    expect(MIN_CURTA).toBeGreaterThan(0);
  });

  it('R2. garupa abaixo da idade minima e recusado, e a mensagem diz a idade exigida', async () => {
    const startAt = await primeiroSlot(EXP.longa);
    const antes = await movementCounts();

    const input = reservationInput({
      experienceId: EXP.longa,
      startAt,
      resourcesNeeded: 1,
      passengers: 1,
      // Dois anos abaixo do minimo: longe da borda, para o caso nao depender de
      // aniversario nenhum.
      passengerBirthdate: birthdateYearsAgo(MIN_LONGA - 2),
    });

    await expect(createReservation(input)).rejects.toThrow(InvalidCompositionError);

    // A idade EXIGIDA aparece na mensagem: e o que a tela mostra ao cliente, e
    // sem ela ele nao sabe contra o que errou.
    await expect(createReservation(input)).rejects.toThrow(new RegExp(String(MIN_LONGA)));

    // Nada foi gravado: a recusa acontece antes de qualquer escrita.
    expect(await movementCounts()).toEqual(antes);
  });

  it('R3. garupa exatamente na idade minima e aceito', async () => {
    const startAt = await primeiroSlot(EXP.longa);

    const { reservationId } = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt,
        resourcesNeeded: 1,
        passengers: 1,
        // Completou a idade minima HOJE: ja a tem na data do passeio.
        passengerBirthdate: birthdateYearsAgo(MIN_LONGA),
      }),
    );

    expect(reservationId).toBeTruthy();
  });

  it('R4. crianca que completa a idade ENTRE a reserva e o passeio e aceita', async () => {
    const startAt = await primeiroSlot(EXP.longa);

    // Faz aniversario exatamente NA DATA DO PASSEIO: hoje tem um ano a menos.
    const birthdate = birthdateTurningOnTripDate(MIN_LONGA, SAT);

    // Prova que o cenario e o pretendido: se a conta fosse na data da RESERVA,
    // esta reserva seria recusada. Sem esta assercao o teste passaria mesmo com
    // a regra ancorada em hoje, e nao provaria nada.
    const [ty, tm, td] = todayLocalDate().split('-').map(Number);
    const [by, bm, bd] = birthdate.split('-').map(Number);
    const idadeHoje = ty - by - (tm * 100 + td < bm * 100 + bd ? 1 : 0);
    expect(idadeHoje).toBe(MIN_LONGA - 1);

    const { reservationId } = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt,
        resourcesNeeded: 1,
        passengers: 1,
        passengerBirthdate: birthdate,
      }),
    );

    expect(reservationId).toBeTruthy();
  });

  it('R5. a MESMA idade recusada na Montanha e aceita na Fazenda', async () => {
    // Idade entre os dois minimos: passa na curta, nao passa na longa. E o caso
    // que prova que a regra e POR EXPERIENCIA e nao do tenant.
    const idade = MIN_CURTA + 1;
    expect(idade).toBeLessThan(MIN_LONGA);
    const passengerBirthdate = birthdateYearsAgo(idade);

    await expect(
      createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt: await primeiroSlot(EXP.longa),
          resourcesNeeded: 1,
          passengers: 1,
          passengerBirthdate,
        }),
      ),
    ).rejects.toThrow(InvalidCompositionError);

    await wipeMovement();

    const { reservationId } = await createReservation(
      reservationInput({
        experienceId: EXP.curta,
        startAt: await primeiroSlot(EXP.curta),
        resourcesNeeded: 1,
        passengers: 1,
        passengerBirthdate,
      }),
    );

    expect(reservationId).toBeTruthy();
  });

  it('R6. reserva SEM garupa (so condutor) nao e afetada pela regra', async () => {
    const startAt = await primeiroSlot(EXP.longa);

    const { reservationId } = await createReservation(
      reservationInput({
        experienceId: EXP.longa,
        startAt,
        resourcesNeeded: 1,
        passengers: 0,
      }),
    );

    expect(reservationId).toBeTruthy();
  });

  it('R7. garupa SEM data de nascimento e recusado quando a experiencia exige idade', async () => {
    const startAt = await primeiroSlot(EXP.longa);

    // Sem birthdate nao ha como verificar. Recusar e a mesma escolha ja feita
    // para o condutor: deixar passar seria confiar no que ninguem afirmou.
    await expect(
      createReservation(
        reservationInput({
          experienceId: EXP.longa,
          startAt,
          resourcesNeeded: 1,
          passengers: 1,
          passengerBirthdate: null,
        }),
      ),
    ).rejects.toThrow(InvalidCompositionError);
  });
});

describe('R — mapa do ponto de encontro', () => {
  it('R8. setting ausente ou vazia nao rende bloco de mapa, e nao quebra', async () => {
    // `null` = chave ausente do banco; '' = presente e em branco. Os dois sao
    // estado VALIDO e produzem o mesmo resultado: bloco omitido.
    expect(safeEmbedUrl(null)).toBeNull();
    expect(safeEmbedUrl(undefined)).toBeNull();
    expect(safeEmbedUrl('')).toBeNull();
    expect(safeEmbedUrl('   ')).toBeNull();

    // E o caminho de verdade: chave apagada do banco -> getSettings devolve '',
    // que e o que chega ao componente e faz o bloco sumir.
    const previous = await getSettingRaw('meeting_point_map_url');
    try {
      await setSetting('meeting_point_map_url', '');
      const settings = await getSettings();
      expect(settings.meeting_point_map_url).toBe('');
      expect(safeEmbedUrl(settings.meeting_point_map_url)).toBeNull();
    } finally {
      await restoreSetting('meeting_point_map_url', previous);
    }
  });

  it('R9. URL de embed valida passa; esquema perigoso e recusado', async () => {
    const previous = await getSettingRaw('meeting_point_map_url');
    try {
      // A URL semeada pelo template e utilizavel como src.
      const settings = await getSettings();
      const semeada = settings.meeting_point_map_url;
      expect(semeada).toContain('google.com/maps/embed');
      expect(safeEmbedUrl(semeada)).toBe(semeada);
    } finally {
      await restoreSetting('meeting_point_map_url', previous);
    }

    // >>> A PORTA ESTREITA QUE SOBRA AO GUARDAR URL EM VEZ DE HTML <<<
    // Guardar so a URL impede injecao de marcacao, mas um esquema executavel
    // ainda viraria execucao ao virar `src`/`href`. Lista de PERMISSAO: so
    // http(s).
    expect(safeEmbedUrl('javascript:alert(1)')).toBeNull();
    expect(safeEmbedUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeEmbedUrl('nao-e-url')).toBeNull();
    expect(safeEmbedUrl('https://www.google.com/maps/embed?pb=x')).toBe(
      'https://www.google.com/maps/embed?pb=x',
    );
  });
});
