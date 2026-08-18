# Contexto de negócio — Aventix / Quadri Club

> Este documento registra o lado NÃO-técnico do projeto: quem é o cliente, o que
> foi combinado com ele, quais valores pratica, e o que ainda está pendente de
> resposta. O `CLAUDE.md` cobre a especificação técnica; o `docs/DECISOES.md`
> cobre o porquê das escolhas de arquitetura. Este cobre o negócio.
>
> Última atualização: 17/08/2026 (fim da Fase 2)

---

## 1. As partes

**Neosoluti** — desenvolve e vende o Aventix por assinatura. Vinicius é o
desenvolvedor (solo, ~2h/dia).

**Aventix** — a plataforma. Nome do produto, do repositório, do painel admin e da
infraestrutura. **Nunca aparece na interface pública do cliente final** — regra
de marca da rev 5 do CLAUDE.md.

**Quadri Club** — cliente 1 e único no MVP. Operado pela **Terra Trilha**.
Passeios de quadriciclo off-road em Joaquim Egídio / Sousas, Campinas–SP.
É a marca que aparece para o cliente final (`settings.business_name`).

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
| **Preço Pix** (o que o sistema usa) | **R$ 325,49** | **R$ 232,49** |
| Preço cartão (não usado no MVP) | R$ 349,99 | R$ 249,99 |
| Modo de pagamento | integral (`full`) | integral (`full`) |

O Quadri Club pratica **preço por método**: cartão é ~7% mais caro que Pix.
Como o MVP só aceita Pix, `price_cents` guarda **o preço Pix**. O preço de
cartão não é armazenado — entra na v2 junto com a modalidade cartão.

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
- **Sem pagamento com sinal no MVP.** Cliente paga 100% no ato.
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

- **Somente Pix no MVP.** Cartão é v2.
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
- **Produção:** ainda **não gerada**. Criar na Fase 4 com as mesmas
  configurações. Entra como variável de ambiente no Easypanel, nunca em arquivo.

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
- **Produção:** cadastro próprio, com token próprio, na Fase 4. A URL definitiva
  é `https://aventix.com.br/api/webhooks/asaas`, **exata, sem barra final**:
  medido que a variante com barra responde 308, e o Asaas não segue redirect.
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

**Go-live: 24/08/2026.**

### O que é inegociável para lançar
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
Se o Asaas atrasar por dependência do cliente, o Terra Trilha aceita prazo maior.
Registrado em 03/08.

---

## 6. Pendências de resposta do cliente

Valores ainda **provisórios** no seed (`lib/templates/quadriciclo.ts`), marcados
com `// PROVISÓRIO`:

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
- **Banco de produção nunca foi migrado.** Está vazio. As **quatro** migrations
  (`0000`, `0001`, `0002`, `0003`) rodam pela primeira vez no deploy.
- **E-mail:** Resend (Fase 4, ainda não integrado).
