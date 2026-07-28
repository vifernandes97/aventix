// Aventix — template de segmento: passeio de quadriciclo (CLAUDE.md secao 11-B).
//
// Aplicado ao tenant 1 (Quadri Club / Terra Trilha) pelo `npm run db:seed`.
//
// >>> VALORES PROVISORIOS <<<
// Tudo marcado com `// PROVISORIO — confirmar com o cliente` ainda nao foi
// confirmado pelo Terra Trilha. Eles ficam TODOS neste arquivo, nunca espalhados
// pelo codigo, para que confirmar com o cliente seja um grep de uma palavra:
//
//     grep -n "PROVISORIO" lib/templates/quadriciclo.ts
//
// Este e o unico template do MVP. Nao criar outros, nem wizard, nem form builder
// (secao 11-B: form builder e PROIBIDO).

import type { SegmentTemplate } from './types';

export const quadricicloTemplate: SegmentTemplate = {
  segment: 'quadriciclo',
  version: '1.0.0',

  // -- settings: labels e textos de UI (secao 4.2) ---------------------------
  // Nenhum destes valores pode aparecer hardcoded na UI (secao 3).
  settings: {
    // A UI publica exibe a marca do TENANT, nunca "Aventix" (regra de marca, rev 5).
    business_name: 'Quadri Club',

    resource_label: 'Quadriciclo',
    resource_label_plural: 'Quadriciclos',
    operator_label: 'Condutor',
    passenger_label: 'Garupa',

    // Confirmado: documento do condutor e exigido, conferido fisicamente no dia.
    operator_document_required: 'true',
    operator_document_label: 'CNH',

    // Confirmado: o Quadri Club opera com exclusividade de experiencia ligada —
    // so uma trilha rodando por vez (secao 1).
    single_experience_per_slot: 'true',

    min_lead_minutes: '60', // PROVISORIO — confirmar com o cliente
    meeting_point:
      'Portaria do Quadri Club. Chegue 20 minutos antes do horario marcado para o briefing.', // PROVISORIO — confirmar com o cliente
    what_to_bring:
      'Documento com foto, calca comprida, tenis fechado, protetor solar e agua.', // PROVISORIO — confirmar com o cliente

    // ATENCAO na confirmacao: este e-mail aparece para o CLIENTE FINAL do tenant.
    // Um endereco @aventix.com.br expoe a plataforma onde a regra de marca (rev 5)
    // manda aparecer o tenant. O natural e um endereco do proprio Quadri Club.
    reply_to_email: 'contato@aventix.com.br', // PROVISORIO — confirmar com o cliente

    // So aparece no termo quando a experiencia for 'deposit' (secao 10). Fica
    // preenchido para nao travar a troca de modo, mesmo com as duas experiencias
    // em 'full' hoje.
    deposit_policy_text:
      'O sinal pago no ato confirma a reserva e nao e reembolsavel em caso de cancelamento pelo cliente. O valor restante e pago no dia do passeio, direto com o guia, antes da saida.', // PROVISORIO — confirmar com o cliente
  },

  // -- recursos: os quadriciclos (secao 1) -----------------------------------
  // 2 recursos, fungiveis, capacity 2 (1 piloto + 1 garupa).
  resources: [
    { name: 'Quadriciclo 1', capacity: 2, active: true }, // PROVISORIO (nome) — confirmar com o cliente
    { name: 'Quadriciclo 2', capacity: 2, active: true }, // PROVISORIO (nome) — confirmar com o cliente
  ],

  // -- experiencias (secao 4.3) ----------------------------------------------
  //
  // PAGAMENTO: as duas nascem em 'full' (cliente paga 100% no ato). O modo
  // 'deposit' esta implementado ponta a ponta, mas ainda NAO foi confirmado se o
  // Quadri Club vai usa-lo no lancamento.
  //
  // Para trocar uma experiencia para sinal, mude `paymentMode` para 'deposit' e
  // preencha EXATAMENTE UM entre `depositPercent` e `depositFixedCents` — o
  // CHECK do schema recusa zero ou os dois:
  //
  //     paymentMode: 'deposit',
  //     depositPercent: 50,          // 50% do total
  //     // OU, em vez do percentual:
  //     depositFixedCents: 5000,     // R$ 50,00 fixos
  //
  // O saldo (total menos sinal) e cobrado no dia, presencialmente (secao 1).
  experiences: [
    {
      name: 'Trilha Curta', // PROVISORIO (nome) — confirmar com o cliente
      durationMinutes: 60, // PROVISORIO — confirmar com o cliente
      bufferMinutes: 15, // PROVISORIO — confirmar com o cliente
      priceMode: 'per_resource',
      priceCents: 12000, // R$ 120,00 por quadriciclo // PROVISORIO — confirmar com o cliente
      paymentMode: 'full', // PROVISORIO — confirmar com o cliente
      active: true,
    },
    {
      name: 'Trilha Longa', // PROVISORIO (nome) — confirmar com o cliente
      durationMinutes: 90, // PROVISORIO — confirmar com o cliente
      bufferMinutes: 15, // PROVISORIO — confirmar com o cliente
      priceMode: 'per_resource',
      priceCents: 18000, // R$ 180,00 por quadriciclo // PROVISORIO — confirmar com o cliente
      paymentMode: 'full', // PROVISORIO — confirmar com o cliente
      active: true,
    },
  ],

  // -- grade recorrente (secao 4.3) ------------------------------------------
  // 0=domingo .. 6=sabado. Horario local de America/Sao_Paulo.
  // Feriados e recessos NAO entram aqui: sao `schedule_exceptions` (secao 6).
  operatingHours: [
    { weekday: 6, opens: '08:00', closes: '18:00' }, // sabado  // PROVISORIO — confirmar com o cliente
    { weekday: 0, opens: '08:00', closes: '18:00' }, // domingo // PROVISORIO — confirmar com o cliente
  ],

  // -- onboarding (DADO para o wizard da v2; nada le isto no MVP) ------------
  // A pergunta fala a lingua do dono do negocio; `mapsTo` diz que campo
  // generico ela alimenta. E aqui que a traducao "quadriciclo -> recurso" fica
  // registrada enquanto esta fresca.
  onboardingQuestions: [
    { question: 'Quantos quadriciclos voce tem disponiveis para aluguel?', mapsTo: 'resources.count' },
    { question: 'Quantas pessoas cabem em cada quadriciclo?', mapsTo: 'resources.capacity' },
    { question: 'Como voce chama quem dirige? E quem vai na garupa?', mapsTo: 'settings.operator_label / settings.passenger_label' },
    { question: 'Voce exige documento de quem vai dirigir? Qual?', mapsTo: 'settings.operator_document_required / settings.operator_document_label' },
    { question: 'Quais passeios voce vende, e quanto tempo dura cada um?', mapsTo: 'experiences[].name / experiences[].durationMinutes' },
    { question: 'Quanto custa cada passeio, por quadriciclo?', mapsTo: 'experiences[].priceCents' },
    { question: 'De quanto tempo voce precisa entre um passeio e o proximo?', mapsTo: 'experiences[].bufferMinutes' },
    { question: 'Em que dias e horarios voce opera?', mapsTo: 'operatingHours[]' },
    { question: 'Com quanta antecedencia minima voce aceita uma reserva?', mapsTo: 'settings.min_lead_minutes' },
    { question: 'Pode ter mais de um tipo de passeio saindo ao mesmo tempo?', mapsTo: 'settings.single_experience_per_slot' },
    { question: 'O cliente paga tudo na reserva, ou so um sinal?', mapsTo: 'experiences[].paymentMode' },
    { question: 'Onde os clientes te encontram, e o que devem levar?', mapsTo: 'settings.meeting_point / settings.what_to_bring' },
  ],
};
