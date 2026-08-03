// GRUPO C — motor de disponibilidade (CLAUDE.md secao 6).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { getAvailability } from '@/lib/availability';
import { db } from '@/lib/db/client';
import { getNumberSetting } from '@/lib/tenant';
import { localToUtc } from '@/lib/time';

import {
  EXP,
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
      await getAvailability({ experienceId: EXP.curta, date: SUN, resourcesNeeded: 1 }),
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

    const r = await getAvailability({ experienceId: EXP.curta, date: SAT, resourcesNeeded: 1 });

    expect(r.dayState).toBe('closed_exception');
    expect(r.slots).toEqual([]);
  });

  it('8. schedule_exception closed=false abre uma terca, ignorando o weekday', async () => {
    // Sem excecao a terca nao opera (o seed so tem sabado e domingo).
    const fechada = await getAvailability({
      experienceId: EXP.curta,
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
      experienceId: EXP.curta,
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
      await getAvailability({ experienceId: EXP.curta, date: SAT, resourcesNeeded: 1 }),
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
      await getAvailability({ experienceId: EXP.curta, date: SAT, resourcesNeeded: 1 }),
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
  // ==========================================================================
  // DATA ANCORA: 15/06/2027 — uma TERCA-FEIRA.
  //
  // A versao anterior deste bloco usava HOJE (`new Date()`) com uma grade que
  // fechava 23:30, e o corte do motor (agora + lead) andava com o relogio
  // contra esse teto fixo: passadas as 19:30 o lead de 180 min nao deixava
  // nenhum candidato de pe, `slots[0]` vinha undefined e o caso estourava. Era
  // teste dependente do relogio da maquina — o que o projeto decidiu nao ter.
  //
  // Por que a ancora e FIXA e ABSOLUTA, e nao `hoje + N dias`: a grade depende
  // do DIA-DA-SEMANA, e uma data relativa muda de weekday conforme o dia em que
  // a suite roda. O cenario tem que ser o mesmo em toda rodada, sempre.
  //
  // Por que TERCA: o seed do Quadri Club opera sabado e domingo apenas, entao
  // numa terca nao existe operating_hours nenhum. A grade deste bloco vem
  // OBRIGATORIAMENTE da schedule_exception abaixo. Se o INSERT dela falhar, o
  // dayState sai 'closed_weekday' e o teste morre apontando a causa, em vez de
  // cair de volta na grade 08:00-18:00 do fim de semana e produzir assercoes
  // que passam pelo motivo errado.
  //
  // Por que JUNHO: fora de qualquer janela historica de horario de verao
  // brasileiro (outubro a fevereiro). Se o pais voltar a ter DST, a ancora nao
  // cai em cima de uma transicao de offset.
  // ==========================================================================
  const ANCORA = '2027-06-15';

  /** Grade da ancora: 00:00 as 23:30. EXP.curta dura 60 min -> ultimo candidato 22:30. */
  const ANCORA_ABRE = '00:00';
  const ANCORA_FECHA = '23:30';

  let leadOriginal: string | null = null;

  beforeAll(async () => {
    leadOriginal = await getSettingRaw('min_lead_minutes');
  });

  afterAll(async () => {
    await restoreSetting('min_lead_minutes', leadOriginal);
    await db.execute(sql`DELETE FROM schedule_exceptions WHERE tenant_id = ${TENANT_ID}`);
  });

  beforeEach(async () => {
    // wipeMovement zera schedule_exceptions, entao a excecao entra DEPOIS dele.
    await wipeMovement();
    await db.execute(sql`
      INSERT INTO schedule_exceptions (tenant_id, date, opens, closes, closed, reason)
      VALUES (${TENANT_ID}, ${ANCORA}, ${ANCORA_ABRE}, ${ANCORA_FECHA}, false,
              'grade ancora p/ testar lead time')
      ON CONFLICT (tenant_id, date) DO UPDATE
        SET opens = excluded.opens, closes = excluded.closes, closed = false
    `);
  });

  /**
   * Minutos de lead que fazem o corte do motor pousar EXATAMENTE em `hora` da
   * data ancora.
   *
   * -------------------------------------------------------------------------
   * POR QUE ISTO NAO E DEPENDER DO RELOGIO
   *
   * O motor (lib/availability.ts) corta em `Date.now() + lead`. Esse Date.now()
   * e codigo de PRODUCAO e nao se mocka (regra do projeto). Logo o corte tem o
   * relogio dentro dele por construcao, e a unica alavanca que o teste tem e o
   * proprio `lead`.
   *
   * Fazendo lead = alvo - agora, o corte vira:
   *
   *     corte = agora + (alvo - agora) = alvo
   *
   * O `agora` CANCELA. Quais slots sobrevivem passa a depender so de `alvo`,
   * que e constante absoluta. Rodar as 14h ou as 23h59 muda o numero gravado em
   * min_lead_minutes e nao muda um unico slot da resposta.
   *
   * A diferenca para a versao antiga esta aqui: la o relogio era PRE-CONDICAO
   * do cenario (precisava sobrar dia depois de agora+lead); aqui ele e um TERMO
   * ALGEBRICO que se anula.
   *
   * A folga que absorve o resto: `agora` e lido nesta funcao e de novo dentro
   * do motor alguns milissegundos depois, e o lead e arredondado para minuto
   * inteiro — o corte real pousa em `alvo` +/- ~1 min. Por isso os alvos deste
   * bloco sao HH:17, fora da malha de 30 min, com ~13 min de folga de cada
   * lado. Nenhum jitter plausivel muda qual candidato e o primeiro sobrevivente.
   * -------------------------------------------------------------------------
   */
  function leadQueCortaEm(hora: string): number {
    const alvo = localToUtc(ANCORA, hora).getTime();
    const minutos = Math.round((alvo - Date.now()) / 60_000);

    // Nao e skip: e falha com instrucao. Um teste que se auto-desliga quando o
    // cenario nao da passa a nunca rodar, e vira falso-verde.
    if (minutos <= 0) {
      throw new Error(
        `A data ancora ${ANCORA} ja passou. Este bloco precisa de uma ancora no futuro: ` +
          'escolha outra terca-feira de junho e atualize a constante ANCORA.',
      );
    }
    return minutos;
  }

  /**
   * Helper unico dos quatro casos. Aplica o lead, le a grade da ancora e afirma
   * as DUAS metades do contrato de lead time — nunca so uma:
   *
   *   MANTEM fora da janela -> `primeiroMantido` e o primeiro slot da grade;
   *   CORTA dentro da janela -> `ultimoCortado` (o candidato imediatamente
   *                             anterior, 30 min antes) sumiu.
   *
   * A segunda e a que da valor a primeira. Sozinha, "o primeiro slot e tarde"
   * passaria com o motor cortando tres dias em vez de tres horas.
   */
  async function assertGradeDaAncora(params: {
    /**
     * Valor CRU gravado em min_lead_minutes. Aceita string de proposito: o 10d
     * precisa exercitar a grade com um valor invalido de verdade ('abc'), e nao
     * com o default ja resolvido — senao a metade ponta a ponta dele testaria
     * outro cenario que nao o do seu nome.
     */
    lead: number | string;
    primeiroMantido: string;
    /** null quando o lead nao corta nada: ai a grade sai inteira desde o opens. */
    ultimoCortado: string | null;
  }): Promise<void> {
    const { lead, primeiroMantido, ultimoCortado } = params;

    await setSetting('min_lead_minutes', String(lead));
    const r = await getAvailability({ experienceId: EXP.curta, date: ANCORA, resourcesNeeded: 1 });
    const l = labels(r);

    // Guarda: sem a excecao no banco a terca sai fechada e todo o resto deste
    // helper afirmaria sobre uma grade vazia.
    expect(r.dayState, 'a excecao da ancora precisa estar no banco').toBe('open');

    expect(l[0], `primeiro slot mantido (lead ${lead} min)`).toBe(primeiroMantido);

    if (ultimoCortado === null) {
      expect(l, 'lead que nao corta: a grade sai inteira desde o opens').toContain(ANCORA_ABRE);
    } else {
      expect(l, `${ultimoCortado} esta dentro da janela e deve ter sumido`).not.toContain(
        ultimoCortado,
      );
      // Controle: se a grade tivesse saido inteira, a assercao de cima passaria
      // por acaso em qualquer horario que nao fosse o primeiro.
      expect(l, 'a grade nao pode ter sobrado inteira').not.toContain(ANCORA_ABRE);
    }
  }

  it('10a. min_lead_minutes "0" e lido como zero e nao corta nada da grade', async () => {
    await setSetting('min_lead_minutes', '0');

    // "0" e falsy em JS: um `||` no lugar do parse devolveria o default 60 sem
    // erro nenhum. Esta e a assercao que pega isso — e a unica que consegue,
    // porque na ancora (a mais de um ano de distancia) lead 0 e lead 60 cortam
    // a mesma coisa, ou seja, nada. Distinguir os dois pelo fim exigiria o
    // corte caindo dentro da grade, que e justamente o que amarrava o teste ao
    // relogio.
    expect(await getNumberSetting('min_lead_minutes')).toBe(0);

    await assertGradeDaAncora({ lead: 0, primeiroMantido: ANCORA_ABRE, ultimoCortado: null });
  });

  it('10b. o corte pousa exatamente onde min_lead_minutes manda', async () => {
    // Alvo 12:17 -> o candidato 12:00 esta dentro da janela e cai; 12:30 e o
    // primeiro de fora. Se o lead fosse ignorado, o primeiro seria 00:00.
    await assertGradeDaAncora({
      lead: leadQueCortaEm('12:17'),
      primeiroMantido: '12:30',
      ultimoCortado: '12:00',
    });
  });

  it('10c. 180 minutos a mais de lead empurram o primeiro slot em exatamente tres horas', async () => {
    // Mesma grade e mesmo alvo do 10b, deslocados por 180 minutos de lead:
    // corte 15:17, primeiro slot 15:30 — exatamente 3h depois do 12:30 do 10b.
    // Se o motor aplicasse o valor com outro fator, outro sinal ou outra
    // unidade (segundos, ms), o primeiro sobrevivente nao seria este.
    await assertGradeDaAncora({
      lead: leadQueCortaEm('12:17') + 180,
      primeiroMantido: '15:30',
      ultimoCortado: '15:00',
    });
  });

  it('10d. valor invalido ("abc") cai no default 60 e NAO vira NaN', async () => {
    await setSetting('min_lead_minutes', 'abc');

    // NaN e 60 sao indistinguiveis na ancora (nenhum dos dois corta nada a mais
    // de um ano de distancia), entao a prova de que nao virou NaN mora no
    // parse. E o teste mais forte de qualquer forma: mede o valor, em vez de
    // inferi-lo do formato da grade.
    expect(await getNumberSetting('min_lead_minutes')).toBe(60);

    // E ponta a ponta, com o 'abc' ainda gravado: valor invalido nao pode zerar
    // a grade nem quebrar o motor.
    await assertGradeDaAncora({ lead: 'abc', primeiroMantido: ANCORA_ABRE, ultimoCortado: null });
  });
});
