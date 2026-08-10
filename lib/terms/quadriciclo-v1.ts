// Termo de responsabilidade do template "quadriciclo" (CLAUDE.md secao 10 e 11-B).
//
// O texto vive AQUI, no repositorio, nunca no banco. O que a reserva grava e
// TERM_VERSION (reservations.termo_version) — a versao aponta para o arquivo.
// Se o texto mudar, cria-se quadriciclo-v2.ts com nova TERM_VERSION; a reserva
// antiga mantem o registro de que aceitou ESTA versao, com este texto.
//
// {nome}, {data_hora} e {ip} sao marcadores substituidos so na EXIBICAO (passo
// 5 do formulario publico). O texto gravado no aceite e a versao, nunca o
// corpo do termo com os marcadores substituidos.

export const TERM_VERSION = '2026-08-01';

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

5. CIÊNCIA
Declaro ter lido e compreendido integralmente este termo, aceitando-o de forma livre, consciente e voluntária.

Aceite registrado digitalmente em {data_hora}, a partir do IP {ip}.`;
