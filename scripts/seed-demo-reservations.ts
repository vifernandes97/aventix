// Aventix — reservas de DEMONSTRACAO para ver o calendario com dados.
//
//     npm run db:seed:demo
//
// >>> ISTO NAO E SEED DE PRODUCAO. <<<
// O seed de catalogo (`npm run db:seed`, scripts/seed.ts) aplica o template do
// tenant e e a unica coisa que roda em producao. ESTE arquivo cria MOVIMENTO
// falso — clientes, reservas, participantes — para a tela do admin ter o que
// desenhar em desenvolvimento. Rodar em producao poluiria a agenda real do dono
// com passeios que nao existem.
//
// TODA reserva criada aqui leva `channel: 'demo'`, e e por esse campo que o
// script apaga o proprio rastro antes de recriar. Nao existe caminho neste
// arquivo que apague reserva de verdade.
//
// POR QUE `--conditions=react-server` NO npm SCRIPT:
// createReservation puxa lib/availability.ts e lib/tenant.ts, que declaram
// `import 'server-only'`. Em processo Node cru esse pacote LANCA (comportamento
// medido, docs/DECISOES.md 27/07). A flag ativa a condicao de exportacao
// `react-server`, que resolve o pacote para o modulo vazio — o mesmo efeito que
// o Next produz por conta propria. Sem ela, o script morre no import.
//
// A ORDEM DOS IMPORTS IMPORTA: `dotenv/config` primeiro, porque lib/db/client.ts
// le DATABASE_URL no momento do import.

import 'dotenv/config';

import { sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { createReservation, setReservationStatus } from '@/lib/reservations';
import { quadricicloTemplate } from '@/lib/templates/quadriciclo';
import { localToUtc, todayLocalDate } from '@/lib/time';

const TENANT_ID = 1;
const DEMO_CHANNEL = 'demo';
const DEMO_REASON = 'DEMO — dia aberto para a demonstracao do calendario';

/** Nome -> id real. O seed reconcilia por NOME, entao id fixo aqui quebraria (ver tests/helpers/db.ts). */
async function experienceIdByName(name: string): Promise<number> {
  const { rows } = await db.execute<{ id: number }>(sql`
    SELECT id FROM experiences WHERE tenant_id = ${TENANT_ID} AND name = ${name} AND active
  `);
  if (!rows[0]) {
    throw new Error(`Experiencia "${name}" nao encontrada. Rode \`npm run db:seed\` antes.`);
  }
  return rows[0].id;
}

/** 'YYYY-MM-DD' do proximo dia com o weekday pedido (0=domingo), a partir de amanha. */
function nextWeekday(weekday: number): string {
  const d = new Date(`${todayLocalDate()}T00:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() !== weekday);
  return d.toISOString().slice(0, 10);
}

type DemoReservation = {
  who: string;
  phone: string;
  experience: 'Trilha da Montanha' | 'Trilha da Fazenda';
  date: string;
  time: string;
  resources: number;
  passengers: number;
  /** true -> confirmada (verde); false -> aguardando pagamento (ambar) */
  confirmed: boolean;
};

async function main() {
  const [montanha, fazenda] = quadricicloTemplate.experiences.map((e) => e.name);

  // Dias desta semana. O template so abre sabado e domingo, entao os dias uteis
  // ganham excecao de agenda — senao a semana inteira sairia vazia e a view de
  // dia nao teria linhas para desenhar.
  const ter = nextWeekday(2);
  const qua = nextWeekday(3);
  const qui = nextWeekday(4);
  const sab = nextWeekday(6);

  // ATENCAO AO MONTAR CENARIO: o Quadri Club opera com
  // `single_experience_per_slot = true` (secao 1), entao duas experiencias
  // DIFERENTES nao podem se sobrepor — a criacao devolveria 409. Mesma
  // experiencia pode, limitada pelos 2 quadriciclos. Os horarios abaixo
  // respeitam isso de proposito.
  const plan: DemoReservation[] = [
    // Terca: duas da MESMA trilha, a segunda ocupando os dois quadriciclos.
    { who: 'Ana Ribeiro', phone: '(19) 98800-0001', experience: montanha as DemoReservation['experience'], date: ter, time: '09:00', resources: 1, passengers: 1, confirmed: true },
    { who: 'Bruno Tavares', phone: '(19) 98800-0002', experience: montanha as DemoReservation['experience'], date: ter, time: '11:00', resources: 2, passengers: 2, confirmed: false },
    // Quarta e quinta: a trilha curta, aguardando e confirmada.
    { who: 'Carla Menezes', phone: '(19) 98800-0003', experience: fazenda as DemoReservation['experience'], date: qua, time: '14:00', resources: 1, passengers: 0, confirmed: true },
    { who: 'Diego Prado', phone: '(19) 98800-0004', experience: fazenda as DemoReservation['experience'], date: qui, time: '10:00', resources: 1, passengers: 1, confirmed: false },
    // Sabado: dia cheio, com as duas trilhas SEM sobreposicao entre elas.
    { who: 'Elisa Continho', phone: '(19) 98800-0005', experience: montanha as DemoReservation['experience'], date: sab, time: '08:00', resources: 2, passengers: 1, confirmed: true },
    { who: 'Fabio Nunes', phone: '(19) 98800-0006', experience: fazenda as DemoReservation['experience'], date: sab, time: '13:00', resources: 1, passengers: 0, confirmed: true },
  ];

  // -- limpeza do rastro anterior -------------------------------------------
  // Escopo fechado: so o que ESTE script criou. As cascatas de
  // reservation_resources / participants / reservation_payments (ON DELETE
  // CASCADE, secao 4.4) levam junto o que pendura na reserva.
  const deleted = await db.execute(
    sql`DELETE FROM reservations WHERE tenant_id = ${TENANT_ID} AND channel = ${DEMO_CHANNEL}`,
  );
  await db.execute(
    sql`DELETE FROM schedule_exceptions WHERE tenant_id = ${TENANT_ID} AND reason = ${DEMO_REASON}`,
  );
  console.log(`  limpeza: ${deleted.rowCount ?? 0} reserva(s) de demo anterior(es) removida(s)`);

  // -- dias uteis abertos para a demo ---------------------------------------
  for (const date of [ter, qua, qui]) {
    await db.execute(sql`
      INSERT INTO schedule_exceptions (tenant_id, date, opens, closes, closed, reason)
      VALUES (${TENANT_ID}, ${date}, '08:00', '18:00', false, ${DEMO_REASON})
      ON CONFLICT (tenant_id, date) DO UPDATE
        SET opens = excluded.opens, closes = excluded.closes, closed = false, reason = excluded.reason
    `);
  }
  console.log(`  grade: ${[ter, qua, qui].join(', ')} abertos 08:00-18:00 (excecao de demo)`);

  // -- as reservas -----------------------------------------------------------
  //
  // Via createReservation, NUNCA por INSERT cru: e ela que valida composicao,
  // recheca disponibilidade dentro da transacao, aloca os recursos e cria as
  // linhas de reservation_payments. Um INSERT a mao produziria reserva sem
  // alocacao — invisivel para a trava anti-overbooking e mentirosa na tela.
  let created = 0;

  for (const item of plan) {
    const experienceId = await experienceIdByName(item.experience);
    const startAt = localToUtc(item.date, item.time).toISOString();

    try {
      const result = await createReservation({
        experienceId,
        startAt,
        resourcesNeeded: item.resources,
        customer: { name: item.who, phone: item.phone },
        participants: [
          ...Array.from({ length: item.resources }, (_, i) => ({
            name: i === 0 ? item.who : `Condutor ${i + 1} (${item.who.split(' ')[0]})`,
            role: 'operator' as const,
            // operator_document_required = 'true' no template: sem documento a
            // criacao recusa por composicao invalida.
            documentNumber: `${900000000 + created * 10 + i}`,
          })),
          ...Array.from({ length: item.passengers }, (_, i) => ({
            name: `Garupa ${i + 1} (${item.who.split(' ')[0]})`,
            role: 'passenger' as const,
          })),
        ],
        termo: { version: 'demo-v1', acceptedAt: new Date().toISOString() },
        channel: DEMO_CHANNEL,
      });

      // Status so muda por setReservationStatus (secao 4.6): e ela que mantem
      // reservation_resources em sincronia sob FOR UPDATE. Um UPDATE cru aqui
      // furaria a trava contra double-booking.
      //
      // NOTA: a reserva fica 'confirmed' com reservation_payments ainda
      // 'pending', porque a Fase 2 nao existe e nada marca cobranca como paga.
      // E o estado honesto de hoje — e serve de lembrete de que `status` e
      // `payment_state` sao campos diferentes.
      if (item.confirmed) await setReservationStatus(result.reservationId, 'confirmed');

      created += 1;
      console.log(
        `  ${item.date} ${item.time}  ${item.experience.padEnd(20)} ` +
          `${item.resources} quadri  ${item.confirmed ? 'confirmada ' : 'aguardando'}  ${item.who}`,
      );
    } catch (error) {
      console.error(
        `  FALHOU ${item.date} ${item.time} ${item.experience} (${item.who}): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(`\n  ${created} de ${plan.length} reserva(s) de demonstracao criada(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
