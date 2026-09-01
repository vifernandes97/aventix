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
    // >>> TEXTO OFICIAL DO CLIENTE. NAO REESCREVA. <<<
    // Recebido do Quadri Club em 24/08/2026, aprovado em 28/08. Duas
    // modificacoes acordadas COM ELE: o link do Google Maps saiu (o mapa
    // embutido e o botao "Abrir no Maps" ja cobrem, e repetir confunde) e a
    // linha de remarcacao ganhou o WhatsApp, resolvendo a contradicao das 48h
    // registrada na secao 4-C — o texto prometia remarcar sem dizer COMO, e o
    // cliente procurava no sistema um botao que nao existe.
    //
    // Qualquer alteracao aqui — inclusive acento e virgula — passa pelo cliente.
    // E texto de responsabilidade DELE: fala de CNH, idade minima, taxa de
    // colisao e perda do sinal.
    //
    // AS QUEBRAS DE LINHA SAO CONTEUDO, nao formatacao. Elas separam os topicos
    // e precisam sobreviver do template ao banco e a tela; quem renderiza usa
    // `whitespace-pre-line`. Colapsa-las gruda "Check-in" em "Obrigatorio" numa
    // parede de texto que ninguem le.
    //
    // TEXTO, JAMAIS HTML: settings e dado renderizado como texto (mesma razao
    // detalhada em meeting_point_map_url, logo abaixo). Os emoji sao caracteres,
    // nao marcacao.
    meeting_point: `📌 INFORMAÇÕES IMPORTANTES DO PASSEIO

⏰ Check-in: Chegue 20 min antes (para o treinamento e briefing inicial).

📄 Obrigatório: CNH para pilotar (apresentar no dia). Garupa: mín. 6 anos (Trilha da Fazenda) e 12 anos (Trilha da Montanha). Revezamento só nas paradas.

⚠️ Regras: Siga o guia rigorosamente. Proibido álcool, manobras ou práticas que possam danificar o veículo. Fornecimento de capacete e touca higiênica.

💥 Acidentes: Locatário paga consertos e danos no quadriciclo. Colisão: taxa de R$ 200 + peças danificadas.

🔄 Reagendamento e Faltas: Para remarcar, fale com a gente pelo WhatsApp com no mínimo 48h de antecedência — a remarcação não é feita pelo site, e a nova data fica sujeita à disponibilidade. Avisos com menos de 48h implicam perda do valor do sinal. O não comparecimento no dia e horário marcados inviabiliza o reagendamento e a devolução do dinheiro.`,

    // >>> VAZIO DE PROPOSITO, e nao por falta de conteudo. <<<
    // O texto oficial acima ja cobre o assunto (CNH obrigatoria, capacete e
    // touca fornecidos). Manter o placeholder antigo logo abaixo repetiria o
    // mesmo tema com outra redacao, e as duas versoes divergiriam na primeira
    // vez que o cliente atualizasse uma delas.
    //
    // A CHAVE CONTINUA EXISTINDO no tipo e no template: outro tenant do mesmo
    // segmento pode precisar dela, e a tela ja OMITE o bloco quando o valor e
    // vazio (secao 4.2 — vazio e estado valido, nunca rotulo sem conteudo).
    what_to_bring: '',

    // URL de EMBED do Google Maps do ponto de encontro (fornecida pelo cliente
    // em 24/08/2026). Vazia = a tela omite o bloco do mapa inteiro.
    //
    // >>> GUARDA SO A URL, NUNCA HTML <<<
    // settings e DADO, renderizado como texto. Guardar o `<iframe ...>` inteiro
    // obrigaria a renderizar marcacao crua vinda do banco (dangerouslySetInnerHTML),
    // que e injecao de codigo (XSS) esperando acontecer: quem editar a setting
    // passa a poder executar script na tela do cliente final. O iframe e montado
    // no componente, que controla sandbox, loading e referrerpolicy.
    meeting_point_map_url:
      'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d4456.116253815707!2d-46.956300899999995!3d-22.8787841!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x94c8d043d946cc5d%3A0x2c32c5ac4a6ab6e0!2sQuadri%20Club!5e1!3m2!1spt-BR!2sbr!4v1787620105813!5m2!1spt-BR!2sbr',

    // ATENCAO: este e-mail aparece para o CLIENTE FINAL do tenant. Um endereco
    // @aventix.com.br expoe a plataforma onde a regra de marca (rev 5) manda
    // aparecer o tenant. Endereco do proprio Quadri Club, confirmado com o
    // cliente em 17/08/2026 — dominio e .com, NAO .com.br.
    reply_to_email: 'contato@quadriclub.com',

    // Numero de WhatsApp do Quadri Club, informado pelo cliente em 25/08/2026:
    // +55 19 99901-5663. Gravado como SO DIGITOS COM DDI, que e o formato que o
    // link wa.me exige (o componente sanitiza com replace(/\D/g,'') de qualquer
    // forma, mas guardar ja limpo evita depender disso).
    //
    // Canal PRINCIPAL de contato do tenant: ele vende por ManyChat, entao e onde
    // a conversa com o cliente ja acontece. A tela de status omite o bloco de
    // contato inteiro se esta chave estiver vazia.
    //
    // ATENCAO: a casa definitiva do numero e AQUI, no template. seedTenant()
    // SOBRESCREVE a linha de settings sempre que o valor do banco diverge do
    // template (lib/seed.ts), entao um numero digitado direto no Postgres de
    // producao sobrevive aos deploys (o boot so migra, nao semeia) mas seria
    // apagado no dia em que alguem rodar o seed de novo.
    support_whatsapp: '5519999015663',

    // >>> ESTE VALOR NAO E RENDERIZADO EM LUGAR NENHUM. NAO E BUG. <<<
    // O comentario anterior dizia que ele "aparece no termo quando a
    // experiencia for 'deposit'". Isso nunca foi implementado, e desde o Termo
    // v2 (31/08) nao vai ser: a politica do sinal do Quadri Club vive no CORPO
    // do termo (secao 5 de lib/terms/quadriciclo-v2.ts), porque termo e
    // registro VERSIONADO e setting e editavel sem gerar versao — ver a nota
    // longa em SettingKey (lib/tenant.ts) e CLAUDE.md secao 10.
    //
    // O valor fica guardado como PONTO DE PARTIDA para um tenant futuro cuja
    // politica precise variar sem trocar de versao de termo. Duas ressalvas
    // para quem reaproveitar: ele NUNCA foi aprovado pelo cliente (segue
    // marcado PROVISORIO) e descreve a operacao do Quadri Club, nao a de
    // ninguem mais. O texto que VINCULA o cliente hoje e o do termo v2, e e
    // ele que prevalece sobre qualquer coisa escrita aqui.
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
  // >>> priceCents E O VALOR CHEIO. O PIX E DERIVADO DELE. <<<
  // (Mudou na Fase A, 28/08. Ate a rev 6 este campo guardava o preco do Pix, e
  // o comentario aqui PROIBIA a troca — estava certo naquele desenho e passou a
  // estar errado com a rev 7. Se voce veio ate aqui por causa daquele aviso, ele
  // nao existe mais de proposito.)
  //
  // O Quadri Club pratica preco por METODO (secao 4-B.1): a experiencia guarda
  // o CHEIO, o Pix tem desconto configuravel por tenant (7%, em
  // payment_method_discounts) e o cartao paga o cheio, SEM ACRESCIMO. Nao existe
  // taxa somada ao cliente: o cartao nao fica mais caro, o Pix fica mais barato.
  //
  // Quem aplica o desconto e createReservation, via applyDiscount de
  // lib/basis-points.ts, sobre o TOTAL (preco x recursos). O wizard chama a
  // MESMA funcao para exibir. NAO desconte nada aqui.
  //
  // >>> ARMADILHA AO MEXER NESTES NUMEROS — MUDOU EM 01/09 <<<
  // O seed NAO reconcilia mais experiencias: o bloco virou insert-only, porque
  // o dono edita preco, sinal e idade no /admin/experiencias e o seed desfazia.
  // Entao trocar um valor aqui NAO muda mais o preco de um tenant existente —
  // ele so vale para tenant NOVO, e para o tenant vivo o seed apenas RELATA a
  // divergencia.
  //
  // O que continua valendo: template e calculo andam no MESMO commit e no MESMO
  // deploy. Se o preco cheio subisse sem o codigo que aplica o desconto, um
  // tenant novo nasceria cobrando 7% a mais no Pix, sem erro e sem log.
  //
  // E lembre da secao 19: o seed NAO RODA em producao. Mudar isto aqui nao muda
  // o banco de la sozinho — e agora nem rodando o seed mudaria.
  //
  // ==========================================================================
  // >>> ESTES CAMPOS SO VALEM PARA TENANT NOVO. O SEED NAO OS RECONCILIA. <<<
  //
  // O conserto que o remendo do dia anterior anunciava foi feito no mesmo dia: o
  // bloco de experiences em lib/seed.ts virou INSERT-ONLY (01/09). Editar um
  // valor abaixo agora significa "assim nasce o proximo tenant deste segmento",
  // e nada mais — num tenant que ja existe, o seed apenas RELATA que o banco
  // diverge, em `DIVERGEM DO TEMPLATE`.
  //
  // Ate 28/08 nao era assim, e a divergencia que sobrou daquela epoca era
  // perigosa: os dois `paymentMode` diziam 'full' enquanto producao estava em
  // 'deposit', e rodar o seed teria desligado o sinal de 50% das duas trilhas,
  // sem erro e sem log. Os valores abaixo espelham producao desde entao, e vale
  // mante-los assim — nao mais como defesa, e sim para que este arquivo continue
  // sendo documentacao honesta do que o segmento vende.
  //
  // `settings` e `resources`, no MESMO arquivo, CONTINUAM sendo reconciliados:
  // eles nao tem tela, e tirar a reconciliacao sem tela deixaria o valor sem
  // caminho de conserto que nao seja psql em producao (secao 19). O destino
  // deles tambem e insert-only — junto com a tela, nunca antes.
  // ==========================================================================
  //
  // PAGAMENTO: as duas aceitam SINAL. O cliente escolhe no wizard entre Pix
  // integral, Pix com sinal de 50% e cartao (secao 4-B.2); o sinal so existe no
  // Pix. `depositPercent: 50` NAO E OPCIONAL aqui: com `paymentMode: 'deposit'`
  // e os dois campos de sinal nulos, o INSERT viola
  // `experiences_deposit_mode_check` e o seed inteiro estoura.
  //
  // O percentual e travado em 50 para o produto (secao 4-B.2) e o CRUD nem o
  // expoe — `depositColumns()` em lib/experiences.ts grava 50 fixo. Este 50 e o
  // MESMO numero, por outra porta; se o sinal voltar a ser por experiencia, os
  // dois lugares mudam juntos.
  //
  // Para tirar o sinal de uma experiencia: `paymentMode: 'full'` e os dois
  // campos de sinal AUSENTES — o CHECK recusa 'full' com sinal preenchido.
  //
  // O saldo (total menos sinal) e cobrado no dia, presencialmente (secao 1).
  experiences: [
    {
      name: 'Trilha da Montanha',
      durationMinutes: 90,
      bufferMinutes: 15, // confirmado pelo cliente em 2026-07-28
      priceMode: 'per_resource',
      // CHEIO R$ 349,99 por quadriciclo, confirmado pelo cliente em 28/08.
      // No Pix (-7%) o cliente paga R$ 325,49 — o mesmo valor de sempre, agora
      // derivado em vez de digitado.
      priceCents: 34999,
      // Espelha producao desde 28/08 (o template so alinhou em 01/09).
      paymentMode: 'deposit',
      depositPercent: 50,
      // Publicado por escrito pelo cliente em 24/08/2026. Contado na DATA DO
      // PASSEIO, nao na da reserva (ver createReservation).
      minPassengerAge: 12,
      active: true,
    },
    {
      name: 'Trilha da Fazenda',
      durationMinutes: 60,
      bufferMinutes: 15, // confirmado pelo cliente em 2026-07-28
      priceMode: 'per_resource',
      // CHEIO R$ 249,99 por quadriciclo, confirmado pelo cliente em 28/08 —
      // encerra o "a confirmar" da rev 7. No Pix (-7%): R$ 232,49.
      priceCents: 24999,
      // Espelha producao desde 28/08 (o template so alinhou em 01/09).
      paymentMode: 'deposit',
      depositPercent: 50,
      // Publicado por escrito pelo cliente em 24/08/2026 (ver Trilha da Montanha).
      minPassengerAge: 6,
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
