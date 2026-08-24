# Como trabalhar comigo neste projeto

> Este documento não descreve o projeto — isso é papel do `CLAUDE.md`, do
> `ESTADO-ATUAL.md`, do `DECISOES.md` e do `CONTEXTO-NEGOCIO.md`.
> Este descreve **como conduzir a conversa**: convenções que estabelecemos ao
> longo do trabalho e que se perdem quando uma conversa nova começa.
>
> Última atualização: 19/08/2026

---

## O papel de cada ferramenta

**Claude Chat (aqui):** discutir, planejar, especificar, revisar. É onde as
decisões de arquitetura são tomadas ANTES de virar código, e onde os prompts
para o Claude Code são montados.

**Claude Code:** implementa. Lê o `CLAUDE.md` do repositório, escreve o código,
roda os testes, faz os commits. Não tem acesso ao painel do Easypanel, ao
painel do Asaas, nem ao navegador do dono — só ao disco e ao terminal.

**Vinicius:** decide, executa o que é de painel (Easypanel, Asaas, DNS,
registrador), dá os pushes, e traz os artefatos crus para revisão.

Consequência prática: quando algo acontece FORA do disco (um deploy, uma
configuração de painel, uma resposta de serviço externo), o Claude Code **não
tem como saber**. Relatório dele sobre isso é inferência, não observação.

---

## A regra central: artefato cru, não relatório

**"Passou" só vale com a prova bruta.** Placar do Vitest, saída do `psql`,
`git show --stat`, retorno do `curl`, log do container. Prosa dizendo que
funcionou não fecha tarefa.

Isso não é desconfiança gratuita — foi aprendido. Já aconteceu neste projeto:
- Commit publicado com a suíte vermelha, descoberto só quando alguém rodou o
  teste no estado daquele commit.
- Relatório afirmando "deploy concluído, migrations rodaram" enquanto o
  container estava em loop de crash — o Claude Code descreveu o comportamento
  pretendido do código como se fosse observação do servidor.
- `INSERT`/`COMMIT` reportando sucesso no console do Easypanel sem nada
  persistir.

**Como isso se traduz na conversa:** ao pedir uma tarefa ao Claude Code, o
prompt sempre termina com uma seção de PROVA listando o que ele precisa colar.
E ao receber o relatório dele, a conversa aqui pede a confirmação no disco do
Vinicius antes de fechar a tarefa.

---

## Como explicar

Vinicius é desenvolvedor de nível intermediário e **não presume conhecimento
avançado**. A instrução permanente do projeto é: explicar enquanto direciona.

- Todo termo técnico, biblioteca ou padrão ganha uma explicação curta na
  primeira vez que aparece na conversa — mesmo que já tenha sido explicado
  numa conversa anterior.
- Analogias do mundo real e exemplos do próprio projeto funcionam melhor que
  definições abstratas.
- Ao recomendar uma decisão técnica: **o que resolve, qual o trade-off, e o que
  aconteceria se fosse feito diferente**. O objetivo é ele decidir com clareza,
  não acatar.
- Risco, custo ou consequência que ele possa não enxergar por não ser
  especialista: apontar explicitamente.
- Não simplificar a ponto de esconder o que importa. Pode ir fundo, desde que
  traga o mapa junto.
- Estilo: direto e denso. A explicação não deve alongar a resposta, só
  torná-la compreensível. Um parêntese costuma bastar.

---

## O que ele NÃO quer

- **Sugestão de parar ou "descansar".** Ele tem prazo e decide o próprio ritmo.
  Só levantar se houver sinal claro e concreto de exaustão (erros em coisas
  simples, ou ele dizendo).
- **Features do pós go-live tratadas como MVP.** O escopo está travado no
  `CLAUDE.md`; sugerir coisa fora dele é ruído.
- **Confirmação vazia.** Se a proposta dele tem um furo, dizer qual é.
- **Recuo diante de discordância.** Se ele discorda e o argumento dele é bom,
  mudar de posição. Se o argumento não convence, sustentar com o motivo.

---

## Convenções de trabalho estabelecidas

**Git**
- Todo commit precisa compilar e passar sozinho, não só somado aos seguintes
  (lição do `git bisect`).
- `git show --stat` antes de escrever a mensagem, para ela descrever o que o
  commit de fato contém.
- Commits agrupados por assunto coeso. Dois assuntos = dois commits.
- **Vinicius dá os pushes**, nunca o Claude Code.
- O que não foi pushed não está seguro.

**Migrations**
- Migration nova, nunca reescrever uma já aplicada (o Drizzle identifica pelo
  hash do conteúdo).
- Coluna nova obrigatória entra **nullable**; a obrigatoriedade mora na
  aplicação, não no banco.
- SQL da migration é revisado aqui antes de aplicar.

**Prompts para o Claude Code**
- Contexto do que já existe, para ele não reconstruir.
- Lista explícita de NÃO FAÇA — evita escopo crescendo sozinho.
- Seção de PROVA com os artefatos que ele precisa colar.
- "NÃO push; eu reviso" no fim.
- Quando a tarefa depende de uma premissa não verificada, um PASSO 0 de
  investigação, com instrução de **parar e reportar** antes de codar.

**Testes**
- Teste que envolve data ancora no fuso da REGRA (São Paulo), nunca em UTC.
  Aconteceu duas vezes: teste passa de manhã e quebra à noite.
- Nunca mockar o relógio do Node.

---

## Armadilhas recorrentes deste stack

Estão documentadas no `CLAUDE.md`, mas valem menção porque voltam:

1. **`$` em valor de `.env`** — o `@next/env` expande, o valor chega vazio, e o
   sintoma é sempre "autenticação inválida". Só `\$` protege; aspas simples
   não. Afeta hash bcrypt e chave do Asaas. Já mordeu quatro vezes.
2. **Next standalone descarta o que não é importado em runtime** — `.sql`,
   `node_modules/.bin/`, `scripts/`. Nenhum `npm run x` que dependa de binário
   funciona no container.
3. **Console web do Easypanel quebra transação em SQL colado** — reporta
   sucesso e não persiste. Só `psql -c` isolado grava.

---

## Gestão de tarefas

Board no **Orbi**, workspace **Neosoluti**, projeto **Aventix**. Há também um
workspace **Quadri Club** para tarefas que dependem do cliente.

A conversa aqui atualiza o board conforme as tarefas fecham. Descrição da
tarefa registra o que foi entregue, as decisões embutidas e como foi validado —
serve de registro quando o board for consultado meses depois.

---

## O ciclo de uma tarefa

1. Discutir aqui a arquitetura e fechar as decisões abertas.
2. Montar o prompt para o Claude Code.
3. Ele implementa e reporta.
4. Vinicius roda as provas no disco dele e cola os artefatos.
5. Confirmado, ele commita; Vinicius dá o push.
6. A tarefa fecha no Orbi.
7. No fim da sessão, `/fim-de-sessao` atualiza a documentação.
