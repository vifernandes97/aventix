// Termo de responsabilidade do template "quadriciclo" — VERSAO 2 (CLAUDE.md
// secoes 10 e 11-B).
//
// ============================================================================
// >>> ESTE ARQUIVO NASCEU PORQUE O v1 NAO PODE SER EDITADO. <<<
// A reserva grava SO a versao (`reservations.termo_version`), nunca o corpo do
// termo. Editar `quadriciclo-v1.ts` mantendo `TERM_VERSION` faria a string
// '2026-08-01' — ja gravada em toda reserva vendida ate aqui — passar a
// resolver para um TEXTO DIFERENTE do que aquelas pessoas leram e aceitaram. O
// registro do que elas concordaram seria sobrescrito em silencio, e o texto
// antigo so existiria no historico do git. Num documento cuja funcao e provar
// o que alguem aceitou, isso e a falha que anula o documento.
//
// Por isso: `quadriciclo-v1.ts` FICA COMO ESTA, para sempre. Reserva anterior a
// 31/08/2026 continua apontando para ele, com o texto dele.
// ============================================================================
//
// O QUE MUDOU EM RELACAO AO v1: uma secao nova (5. PAGAMENTO, CANCELAMENTO E
// REMARCACAO), que fecha a lacuna ativa da secao 10 — as duas trilhas vendem em
// `deposit` e o termo nao dizia que o sinal nao e reembolsavel. Resolve tambem
// a contradicao apontada na secao 4-C: o texto oficial do cliente promete
// remarcacao em 48h sem dizer COMO, e aqui fica dito que e pelo WhatsApp e que
// nao e feita pelo site. As secoes 1 a 4 sao IDENTICAS as do v1, palavra por
// palavra; a antiga "5. CIENCIA" virou "6. CIENCIA", sem alteracao de texto.
//
// >>> UMA FRASE FOI DELIBERADAMENTE REMOVIDA DA REDACAO ORIGINAL <<<
// A minuta trazia "Tambem posso antecipar o pagamento do saldo pelo proprio
// sistema, a qualquer momento antes da data agendada". NAO EXISTE esse caminho:
// `DUE_PAYMENT` (lib/reservation-status.ts) filtra `kind IN ('full','deposit')`
// e nunca seleciona `balance`, e GET /api/reservations/{id}/payment responde 409
// fora de `pending_payment` — que e o estado de toda reserva com sinal pago. A
// cobranca do saldo (Fase C) e disparada pelo DONO, no painel. Um termo que
// promete um caminho de pagamento inexistente e pior que a omissao: o cliente
// procura, nao acha, e conclui que o sistema comeu o dinheiro dele. Se o
// pagamento antecipado do saldo pelo cliente for construido um dia, a frase
// volta — num v3.
//
// {nome}, {data_hora} e {ip} sao marcadores substituidos so na EXIBICAO.

/**
 * Data em que esta redacao passou a ser oferecida. NUNCA reaproveitar uma
 * versao ja usada: e a chave que liga a reserva ao texto que ela aceitou.
 */
export const TERM_VERSION = '2026-08-31';

export const TERM_TEXT = `TERMO DE RESPONSABILIDADE, ASSUNÇÃO DE RISCOS E INDENIZAÇÃO
Quadri Club — Joaquim Egídio / Sousas, Campinas, SP

Eu, {nome}, portador(a) do documento informado no cadastro, declaro:

1. DECLARAÇÃO DE SAÚDE E APTIDÃO
Encontro-me em plenas condições de saúde física e mental para participar do passeio de quadriciclo off-road. Confirmo que não estou sob efeito de álcool, drogas ou medicamentos que alterem meus reflexos e coordenação motora, e declaro não ser gestante nem possuir restrições médicas para esportes de aventura.

2. ASSUNÇÃO DE RISCOS INERENTES
Reconheço e concordo que o passeio de quadriciclo é classificado como esporte de aventura e atividade off-road, ocorrendo em ambiente natural. Estou ciente de que a atividade envolve riscos inerentes à natureza (terrenos irregulares, pedras, lama, galhos, insetos, condições climáticas adversas) e ao manuseio do veículo, podendo resultar em danos materiais, lesões corporais ou acidentes. Assumo voluntariamente todos os riscos associados à participação nesta atividade.

3. REGRAS DE SEGURANÇA E CONDUTA (TOLERÂNCIA ZERO)
Comprometo-me a seguir rigorosamente todas as instruções fornecidas pelos condutores do Quadri Club durante o briefing e ao longo de todo o percurso. Estou ciente de que é terminantemente PROIBIDO:
- Retirar o capacete durante o passeio ou com o veículo em movimento.
- Ultrapassar o condutor líder ou outros quadriciclos do grupo.
- Realizar manobras perigosas: "cavalinho", "cavalo de pau", ziguezague, derrapagens propositais ou saltos.
- Desviar da trilha oficial demarcada pelo condutor.

Isenção de responsabilidade: em caso de acidente decorrente de desobediência às regras acima, imperícia, imprudência ou negligência da minha parte, o Quadri Club estará totalmente isento de responsabilidade civil ou criminal, bem como do custeio de despesas médicas, hospitalares ou de resgate. Os condutores têm autoridade para interromper o passeio sem direito a reembolso caso meu comportamento coloque em risco a segurança do grupo ou a preservação do equipamento.

4. RESPONSABILIDADE POR DANOS AO EQUIPAMENTO
Declaro que recebi o quadriciclo em perfeitas condições. Em caso de colisão, tombamento, capotamento ou quebra de peças causados por mau uso, manobras proibidas ou não cumprimento das ordens do condutor, serei inteiramente responsável pelos custos de resgate, reparo, mão de obra e substituição de peças, conforme tabela da oficina parceira do Quadri Club.

5. PAGAMENTO, CANCELAMENTO E REMARCAÇÃO
Estou ciente de que a reserva é confirmada mediante pagamento antecipado, que pode ser feito integralmente ou por meio de sinal correspondente a 50% do valor, sendo o restante pago no dia do passeio, diretamente com o condutor, antes da saída.

Declaro ter ciência de que os valores pagos, incluindo o sinal, não são restituídos em caso de cancelamento por minha iniciativa, independentemente da antecedência do aviso.

Em caso de não comparecimento no dia e horário agendados, os valores já pagos não serão restituídos, e o saldo eventualmente em aberto não será cobrado, encerrando-se a reserva.

Remarcação: posso solicitar a remarcação do passeio com antecedência mínima de 48 (quarenta e oito) horas do horário agendado, exclusivamente por meio do WhatsApp de atendimento do Quadri Club. A remarcação não é realizada pelo site e fica sujeita à disponibilidade de data, horário e equipamento. Solicitações com antecedência inferior a 48 horas não geram direito a remarcação nem a restituição de valores.

6. CIÊNCIA
Declaro ter lido e compreendido integralmente este termo, aceitando-o de forma livre, consciente e voluntária.

Aceite registrado digitalmente em {data_hora}, a partir do IP {ip}.`;
