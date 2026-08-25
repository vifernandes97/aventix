# Contexto de negócio — Aventix / Quadri Club

> Este documento registra o lado NÃO-técnico do projeto: quem é o cliente, o que
> foi combinado com ele, quais valores pratica, e o que ainda está pendente de
> resposta. O `CLAUDE.md` cobre a especificação técnica; o `docs/DECISOES.md`
> cobre o porquê das escolhas de arquitetura. Este cobre o negócio.
>
> Última atualização: 25/08/2026 (escopo do pagamento redesenhado; lançamento adiado)

---

## 1. As partes

**Neosoluti** — desenvolve e vende o Aventix por assinatura. Vinicius é o
desenvolvedor (solo, ~2h/dia).

**Aventix** — a plataforma. Nome do produto, do repositório, do painel admin e da
infraestrutura. **Nunca aparece na interface pública do cliente final** — regra
de marca da rev 5 do CLAUDE.md.

**Quadri Club** — cliente 1 e único no MVP. Passeios de quadriciclo off-road em
Joaquim Egídio / Sousas, Campinas–SP.
É a marca que aparece para o cliente final (`settings.business_name`).

**@grandecampinas** — influenciador. Publica no **início de outubro de 2026** um
vídeo recomendando o passeio. **É o marco de negócio que define o prazo do
projeto:** todos os leads do vídeo caem na plataforma **de uma vez**, e esse é o
primeiro volume real que o sistema vai ver.

**Aventurando** — parceiro de compra coletiva, mesmo segmento e ticket. Vende
passeios de terceiros. Reportou que clientes abandonam o checkout por receio de
golpe ao pagar o valor integral antecipado — foi o que motivou a modelagem de
pagamento com sinal (implementada, mas **desligada no MVP**).

---

## 2. Operação do Quadri Club

### Recursos físicos
- **2 quadriciclos**, fungíveis (o cliente não escolhe qual).
- Capacidade **2 pessoas por quadriciclo**: 1 piloto + 1 garupa.
- Dois condutores podem alugar um quadriciclo só e revezar a direção.

### Experiências (trilhas)

| | Trilha da Montanha | Trilha da Fazenda |
|---|---|---|
| Duração | 90 min (1h30) | 60 min (1h) |
| Buffer entre passeios | 15 min | 15 min |
| **Valor CHEIO** (o que a experiência cadastra) | **R$ 349,99** | **R$ 249,99** ⚠️ |
| Pix integral (−7%) | R$ 325,49 | R$ 232,49 |
| Pix sinal 50% (−7%) | R$ 162,75 + R$ 162,74 no dia | R$ 116,25 + R$ 116,24 no dia |
| Cartão integral (sem acréscimo) | R$ 349,99 | R$ 249,99 ⚠️ |

**>>> MODELO REDESENHADO EM 25/08 (CLAUDE.md seção 4-B). <<<** A experiência passa
a cadastrar o **valor cheio**; o **Pix tem desconto** de 7% (configurável por
tenant) e o **cartão paga o cheio, sem acréscimo**. Não existe taxa somada ao
cliente: o cartão não fica mais caro, o Pix fica mais barato.

⚠️ **O cheio da Fazenda (249,99) precisa de confirmação do cliente.** O indício é
aritmético: 249,99 − 7% = **232,49 exatos**, que é o valor que ele citou. Com
249,00 daria 231,57 e não bateria. Enquanto não confirmar, o número fica marcado
como provisório.

O sinal é **50% fixo** e existe **somente no Pix**, com o desconto incidindo
também sobre ele (50% de 325,49, nunca de 349,99).

Descrições de marketing das trilhas (adrenalina, mirante etc.) **não estão no
sistema** — o schema não tem campo `description`. Decisão consciente de 03/08:
adicionar quando fizer falta.

### Grade de funcionamento
- **Sábado e domingo, 08:00–18:00.**
- Antecedência mínima para reservar: 60 min (`min_lead_minutes`, provisório).

### Regras de negócio confirmadas com o cliente
- **Não pode haver duas trilhas diferentes no mesmo horário.** Só uma trilha
  "rodando" por vez. Implementado como `single_experience_per_slot = true`.
  A mesma trilha pode ter reservas simultâneas, limitada pelos quadriciclos.
- **Condutor precisa de CNH.** Documento coletado no agendamento e conferido
  fisicamente no dia.
- ~~**Sem pagamento com sinal no MVP.**~~ **MUDOU EM 25/08:** o sinal de **50% via Pix** entra no escopo de lançamento (CLAUDE.md seção 4-B), junto com Pix integral com desconto e cartão.
- **Agenda compartilhada por link secreto** pode sair do MVP se o prazo apertar.

---

## 3. Termo de responsabilidade

O Quadri Club já usava um termo **assinado presencialmente** antes do passeio.
Ele foi adaptado para aceite digital e vive em `lib/terms/quadriciclo-v1.ts`
(versão `2026-08-01`).

**O que mudou do presencial para o digital:**
- Campos em branco (nome, CPF, RG, telefone) sumiram — os dados já vêm do
  cadastro feito no wizard.
- A assinatura manuscrita foi substituída pelo registro técnico: timestamp, IP,
  user-agent e a versão do texto aceito.
- "Sousas Trilha Club" foi corrigido para **Quadri Club** (nome correto).
- "Guias" virou "condutores", derivado dos labels de settings.
- O direito de imagem virou **checkbox opcional separado**, fora do texto corrido.
- **Contato de emergência** foi adicionado como campo obrigatório no passo 5.

**Conteúdo jurídico preservado:** declaração de saúde e aptidão, assunção de
riscos inerentes, regras de segurança (tolerância zero — capacete, não
ultrapassar, sem manobras perigosas, não sair da trilha), e responsabilidade
por danos ao equipamento conforme tabela da oficina parceira.

Base legal citada: MP 2.200-2/2001 e Lei 14.063/2020. **Texto ainda não validado
por jurídico.**

---

## 4. Pagamento

- **TRÊS formas de pagar** a partir da rev 7 (25/08): **Pix integral com desconto
  de 7%**, **sinal de 50% via Pix**, e **cartão pelo valor cheio, sem acréscimo**.
  Detalhe completo no CLAUDE.md seção 4-B. O cartão sai via `invoiceUrl` do Asaas
  (Fase E) — o cliente digita o cartão numa página do Asaas, nunca no wizard.
- **Cancelamento:** sinal **não devolve**, no-show não devolve e não cobra o
  saldo, estorno é **manual** no painel do Asaas, reagendamento é **por WhatsApp**
  (CLAUDE.md seção 4-C).
- **O dinheiro nunca passa pelo Aventix.** Cai direto na conta do Quadri Club no
  Asaas. O sistema não é intermediário de recebíveis.
- **Conta Asaas:** aberta com o CNPJ do cliente. O desenvolvedor tem acesso à
  conta para fazer a integração.
- **Estorno é manual** — feito pelo dono no painel do Asaas. O Aventix só
  registra o cancelamento e sinaliza "estorno pendente".

### Chaves de API (estado em 17/08/2026)
- **Sandbox:** gerada, nome "aventix", **sem data de expiração**, **sem permissão
  de saque**. Em `ASAAS_API_KEY` no `.env` local, **com escape `\$`**.
  `ASAAS_BASE_URL=https://sandbox.asaas.com/api/v3`. **Funcionando**: cobrança
  criada, QR gerado e pagamento confirmado ponta a ponta.
- **Produção: GERADA e EM USO desde 24/08.** Está no Easypanel como variável de
  ambiente (**sem** o escape `\$` — a regra do escape vale para o `.env` local e
  **não** para o painel; ver CLAUDE.md seção 19). **O ciclo do dinheiro foi
  validado com dinheiro real em 24/08**: cobrança criada, paga pelo app do banco,
  webhook entregue, sistema confirmou sozinho.

**Deploy em produção com chaves de sandbox (19/08).** Enquanto as chaves de
produção não são geradas pelo cliente, o sistema roda no domínio real
(`https://aventix.com.br`) apontando para sandbox. Funcional para teste — QR
gerado, webhook recebido, reserva confirma — **sem cobrar dinheiro real**.
Trocar `ASAAS_API_KEY` e `ASAAS_BASE_URL` no Easypanel quando as credenciais de
produção chegarem, e cadastrar novo webhook apontando para o domínio (não para
o ngrok, que era do sandbox).

**O escape `\$` não é detalhe.** A chave começa com `$aact_`, e o carregador de
ambiente do Next expande `$`. Sem a barra invertida a chave chega **vazia**
dentro do Next (medido) — e aspas simples não protegem. No Easypanel vale a
mesma regra. O sintoma seria "chave inválida", que manda olhar o painel do Asaas
em vez do `.env`.

Razão de não usar expiração: chave que vence em produção derruba o sistema sem
aviso. O Asaas já desabilita chaves sem uso por 3 meses. Rotação se faz por
suspeita de vazamento, não por calendário.

Razão de não permitir saque: o Aventix só precisa criar cobranças, consultar
status e receber webhooks. Sem permissão de saque, uma chave vazada não move
dinheiro da conta do cliente.

**Sandbox e produção são contas separadas.** A chave de produção não serve para
desenvolver: no Asaas o ambiente é propriedade da conta, então uma cobrança de
teste com ela geraria Pix real na conta do Quadri Club, entraria na conciliação
do cliente e, se paga, exigiria estorno manual com taxa que não volta.

### Webhook (estado em 17/08/2026)
- **Sandbox: cadastrado e ATIVO.** Eventos assinados: `PAYMENT_RECEIVED`,
  `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`. Autenticado por `ASAAS_WEBHOOK_TOKEN`,
  segredo **próprio do webhook** — não é a API key (aquela autoriza a cobrar;
  esta só prova que quem chamou é o Asaas).
- **A URL aponta para o ngrok e é TEMPORÁRIA**: muda a cada reinício do túnel.
  Depois de reiniciar o ngrok é preciso atualizar a URL no painel do Asaas (ou
  por `PUT /v3/webhooks/{id}`), senão as entregas falham em silêncio — e 15
  falhas consecutivas **interrompem a fila**.
- **Produção:** o webhook de sandbox continua ativo apontando para o ngrok
  temporário, inclusive com o deploy no ar. Quando a chave de produção for
  gerada, cadastrar **novo** webhook na conta de produção do Asaas apontando
  para `https://app.aventix.com.br/api/webhooks/asaas`, **exata, sem barra
  final**: medido que a variante com barra responde 308, e o Asaas não segue
  redirect. (Host mudado em 20/08 — ver seção 2-B do CLAUDE.md; cadastrar já no
  subdomínio evita remexer a URL com dinheiro real em trânsito.)
- Configurar o **e-mail de alerta** do Asaas para avisar interrupção de fila.

### Pendências operacionais do Asaas
- **Chave Pix do Quadri Club (produção): PENDENTE.** Tarefas criadas no board do
  cliente. Sem chave cadastrada, o Asaas usa chave temporária de instituição
  parceira e o QR só é pagável até 23:59 do mesmo dia.
- **O nome exibido no Pix hoje é da conta sandbox.** O copia-e-cola gerado traz
  `NEOSOLUTI COMERCIO E SERV`. Em produção **precisa ser o Quadri Club** — é o
  nome que o cliente vê no app do banco na hora de pagar, e um nome desconhecido
  ali agrava exatamente o receio de golpe que motivou a modelagem de sinal.
  Depende da conta de produção do cliente, não de código.
- **Régua de cobrança do Asaas:** desligar as notificações automáticas na
  cobrança de saldo (só importa se o modo sinal for ativado).

---

## 5. Prazo e escopo

**>>> PRAZO REDEFINIDO EM 25/08. O go-live de 24/08 NÃO aconteceu. <<<**

- **Sistema pronto: setembro/2026.**
- **Uso real: início de outubro/2026**, quando sai o vídeo do **@grandecampinas**.

**O que mudou e por quê:** o combinado era lançar com **Pix integral apenas**,
porque ~90% dos pagamentos do Quadri Club são Pix. Em 25/08, depois de ver o
sistema apresentado, o cliente **voltou atrás**: só quer lançar quando **todas as
formas de pagamento** estiverem prontas e integradas.

**O marco deixou de ser data e passou a ser evento.** O vídeo despeja os leads de
uma vez, e é o primeiro volume real que o sistema vai ver — daí a exigência de
**testes com clientes reais antes dele** (CLAUDE.md seção 17).

**Situação de fato em 25/08:** o sistema está **em produção e funcionando**, com
o **ciclo do dinheiro validado com dinheiro real em 24/08** (cobrança criada,
paga pelo app do banco, webhook entregue, sistema confirmou sozinho). O que falta
não é estabilidade — é escopo de pagamento.

### O que é inegociável para lançar (revisado em 25/08)
- As **três formas de pagar** funcionando: Pix integral com desconto, sinal de
  50% via Pix, e cartão via `invoiceUrl` (CLAUDE.md seção 4-B)
- **Configuração financeira** do tenant (Fase 0): desconto do Pix e taxas da
  maquininha por modalidade
- **Termo v2**, com a política de cancelamento e a regra de remarcação
- Testes com clientes reais **antes** do vídeo

### O que era inegociável para o go-live antigo (tudo entregue)
- Formulário público de agendamento (pronto)
- Termo de aceite (pronto)
- **Pagamento Pix funcionando** (Fase 2 — **concluída em sandbox**: cobrança,
  QR, webhook e reconciliação verificados ponta a ponta)
- Deploy em produção com as migrations aplicadas

### O que pode ficar para depois do go-live
- Lista de clientes + histórico + faturas
- Agenda compartilhada por link secreto
- CRUD de recursos (o dono raramente muda nome/capacidade dos quadriciclos)
- Tela de configurações (settings) — o dev ajusta no banco na largada

### Acordo sobre atraso
Se o Asaas atrasar por dependência do cliente, o **Quadri Club** aceita prazo
maior. Registrado em 03/08. (O registro original nomeava o cliente errado; nome
corrigido em 25/08 — o acordo é exatamente o mesmo.)

---

## 6. Pendências de resposta do cliente

### >>> PENDENTE DO CLIENTE — bloqueia a Fase 0 e a Fase D <<<

| Item | Situação | Por que bloqueia |
|---|---|---|
| **Percentuais reais da maquininha, POR MODALIDADE** (débito, crédito à vista, crédito parcelado) | **NÃO ENVIADO** | Sem eles a Fase D registra líquido errado. **Não inventar**: taxa chutada vira número com aparência de certo, e o erro só aparece na conferência com o extrato. A tabela de configuração (Fase 0) pode ser construída sem os valores; o registro de pagamento não. |
| **Preço cheio da Trilha da Fazenda: 249,99 ou 249,00?** | **NÃO CONFIRMADO** | 249,99 − 7% = 232,49 exatos, que é o valor que o cliente citou; 249,00 daria 231,57. O indício é forte, mas é indício. Erra o preço de venda se estiver errado. |

### Resolvido em 25/08

| Item | Valor |
|---|---|
| `support_whatsapp` | **+55 19 99901-5663** — chegou em 25/08. **AINDA NÃO ESTÁ NO BANCO**: a chave existe em `settings` com valor **vazio**, e a tela omite o bloco de contato enquanto assim for. Precisa entrar **nas duas casas** (template `lib/templates/quadriciclo.ts` **e** banco), pela regra da seção 19 — só no banco, some no próximo seed. Formato: só dígitos com DDI (`5519999015663`), que é o que o link `wa.me` exige. |

### Valores provisórios no seed

Ainda **provisórios** em `lib/templates/quadriciclo.ts`, marcados com
`// PROVISÓRIO`:

| Item | Valor atual | Precisa confirmar |
|---|---|---|
| `meeting_point` | "Portaria do Quadri Club. Chegue 20 minutos antes..." | endereço real |
| `what_to_bring` | "Documento com foto, calça comprida, tênis fechado..." | lista real |
| ~~`reply_to_email`~~ | ~~`contato@aventix.com.br`~~ | **RESOLVIDO 17/08:** agora `contato@quadriclub.com` (domínio `.com`), confirmado com o cliente |
| `min_lead_minutes` | 60 | antecedência mínima desejada |
| Nomes dos quadriciclos | "Quadriciclo 1" / "Quadriciclo 2" | apelido ou placa, se houver |
| `deposit_policy_text` | texto genérico | só importa se ativar sinal |

### Decisões de negócio em aberto
1. ~~**Regra dos 18 anos para condutor.**~~ **RESOLVIDO 17/08:** a regra entrou em
   `createReservation` — condutor precisa ter 18 anos completos **na data do
   agendamento** (não na data do passeio), e condutor sem data de nascimento é
   recusado. POST direto com menor responde 422. Continua valendo confirmar com
   o cliente se a regra é mesmo 18 (CNH), mas o servidor não está mais aberto.
2. **Exclusividade de trilha:** o cliente disse "não pode duas trilhas no mesmo
   horário". Implementado como qualquer sobreposição bloqueia. Pode ser
   restritivo demais na prática — vale confirmar se a intenção era "mesma janela
   de saída" em vez de "qualquer sobreposição".
3. **Descrições das trilhas** para exibir no formulário público (hoje o card
   mostra só nome, duração e preço).
4. **CPF passou a ser obrigatório no agendamento** (17/08). Não foi escolha de
   produto: o Asaas recusa criar a cobrança sem CPF do pagador. Vale avisar o
   cliente, porque é um campo a mais no formulário e ele pode ouvir reclamação.

---

## 7. Infraestrutura e acessos

- **VPS Hostinger** gerenciado por **Easypanel** (Traefik, SSL e domínio
  automáticos). Domínio: `aventix.com.br`.
- **Acesso ao servidor:** hoje por **usuário root + senha** (guardada com o dev).
  Chave SSH ainda **não configurada** — tarefa do hardening da Fase 4.
- **Banco de produção migrado e semeado em 19/08.** As quatro migrations
  rodaram no boot pelo `instrumentation.ts` (migration-no-boot); catálogo
  semeado manualmente via console do container do Postgres (a solução
  permanente — rota admin de seed — fica pós go-live). Estado: 2 experiências,
  2 recursos, 2 horários operacionais, 13 settings, 1 tenant.
- **E-mail:** Resend (Fase 4, ainda não integrado).
