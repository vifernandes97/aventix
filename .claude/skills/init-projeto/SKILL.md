---
name: init-projeto
description: Cria a estrutura de documentação de contexto de um projeto novo (CLAUDE.md e docs/). Use uma única vez, no início de um projeto, antes de escrever código. Invoque com /init-projeto.
allowed-tools: Read, Write, Bash
---

# Ritual de Início de Projeto

Você está criando a estrutura de documentação de contexto de um projeto. Esses
arquivos são o que permite que cada sessão futura retome sem perda, porque a
conversa anterior não existe mais na sessão seguinte — só o que ficou escrito.

## 0. Antes de tudo: descubra onde você está

Rode e leia:

```
pwd
ls -la
cat package.json 2>/dev/null | head -20
git remote -v 2>/dev/null
ls docs/ 2>/dev/null
```

**Derive o nome do projeto** nesta ordem de preferência: `name` do
`package.json` → nome do repositório no git remote → nome do diretório atual.
Nunca invente e nunca use um nome de outro projeto.

**Se já existir `CLAUDE.md` ou `docs/` com conteúdo, PARE.** Este ritual é para
projeto novo. Mostre o que encontrou e pergunte se é para complementar o que
existe ou se foi engano.

## 1. Crie os quatro documentos

A estrutura padrão é sempre esta. Crie todos os quatro, mesmo que algum pareça
desnecessário agora — um arquivo com esqueleto é convite a preencher; um
arquivo ausente é convite a esquecer.

### `CLAUDE.md` (raiz do projeto)

O documento-fonte: especificação técnica, escopo e regras invioláveis. É o que
vence quando algo conflita. Crie com este esqueleto, preenchendo o nome do
projeto derivado no passo 0 e deixando o resto como marcador:

```markdown
# CLAUDE.md — <NOME DO PROJETO>

> Documento-fonte do projeto. Leia por completo antes de escrever qualquer código.
> Se algo neste documento conflitar com uma sugestão sua, este documento vence.
> Escopo travado: implemente apenas o que está na seção de escopo.

## 1. Contexto do projeto
<!-- O que o sistema faz, para quem, e qual problema resolve. -->

## 2. Stack
<!-- Runtime, framework, banco, serviços externos, deploy. -->

## 3. Convenções
<!-- Regras que valem em todo o código: timezone, dinheiro, nomenclatura,
     tratamento de segredos, formato de entrega de código. -->

## 4. Modelo de dados
<!-- Tabelas, enums, invariantes. Se ainda não existe, escreva "a definir". -->

## 5. Contrato de API
<!-- Rotas, o que recebem e devolvem. -->

## 6. Casos de borda que DEVEM ser tratados
<!-- A lista de situações que o sistema não pode errar. -->

## 7. Escopo
### MVP (construir agora)
### Pós go-live (NÃO construir agora)

## 8. Ordem de implementação
<!-- Fases, com o marco de cada uma. -->
```

### `docs/ESTADO-ATUAL.md`

Sobrescrito a cada sessão. É o primeiro arquivo que a próxima sessão lê.

```markdown
# Estado atual: <NOME DO PROJETO>

> Sobrescrito a cada sessão pelo /fim-de-sessao. Não acumular histórico aqui.
> Última atualização: <DATA>

## Onde estamos
<!-- Uma ou duas frases: em que fase o projeto está, o que funciona hoje. -->

## Pronto
<!-- O que está concluído e verificado. -->

## O que esta sessão fez
<!-- Preenchido pelo /fim-de-sessao. -->

## PRÓXIMO PASSO
<!-- Explícito e acionável. A próxima sessão começa por aqui. -->

## Pendências e dívidas conhecidas
<!-- Agrupadas por área. O que se sabe que está incompleto ou frágil. -->
```

### `docs/DECISOES.md`

Acumula. Registra o **porquê** e a **alternativa descartada**, não a regra em si
(regra permanente mora no `CLAUDE.md`).

```markdown
# Decisões de arquitetura — <NOME DO PROJETO>

> Acumula. Registra o porquê e a alternativa descartada, não a regra em si
> (regra permanente mora no CLAUDE.md).
> Ordem: mais recente no topo.

<!-- Formato de cada entrada:

## AAAA-MM-DD — Título curto da decisão

O que foi decidido, em uma frase. **Por quê:** o motivo real, não o genérico.
**Alternativa descartada:** o que se considerou e por que não foi.
**Consequência assumida:** o custo que se aceitou junto.
**Reabrir se:** a condição que mudaria a decisão.
-->
```

### `docs/CONTEXTO-NEGOCIO.md`

O lado **não técnico**: quem é o cliente, o que foi combinado, valores
praticados, credenciais e acessos, pendências que dependem de terceiros.

```markdown
# Contexto de negócio — <NOME DO PROJETO>

> Registra o lado NÃO-técnico: cliente, combinados, valores, acessos e o que
> depende de terceiros. O CLAUDE.md cobre a especificação técnica; o
> docs/DECISOES.md cobre o porquê das escolhas. Este cobre o negócio.
>
> Última atualização: <DATA>

## 1. As partes
<!-- Quem desenvolve, quem é o cliente, quem mais está envolvido. -->

## 2. Operação
<!-- Como o negócio funciona na prática: recursos, produtos, preços, horários,
     regras confirmadas com o cliente. -->

## 3. Prazo e escopo
<!-- Data alvo, o que é inegociável, o que pode ser cortado, acordos sobre atraso. -->

## 4. Pendências de terceiros
<!-- O que está travado esperando o cliente ou um fornecedor. Com data. -->

## 5. Infraestrutura e acessos
<!-- Onde roda, como se acessa, quais credenciais existem e onde vivem.
     NUNCA o valor de um segredo, só onde ele está e qual seu estado. -->
```

## 2. Explique o sistema ao dono

Depois de criar os arquivos, mostre em poucas linhas:

- Quais arquivos foram criados e o papel de cada um.
- Que `/inicio-de-sessao` e `/fim-de-sessao` operam sobre eles.
- Que o `CLAUDE.md` precisa ser preenchido por ele (ou junto com ele) antes de
  o código começar — os outros três se preenchem sozinhos ao longo do trabalho.

## 3. Commit

Commit único: `docs: estrutura inicial de contexto do projeto`. **Não faça
push** — mostre o que foi commitado e pare.

## Importante

- Nunca escreva o nome de outro projeto nestes arquivos. Se você não conseguiu
  derivar o nome com confiança no passo 0, **pergunte** antes de criar.
- Não invente conteúdo para o `CLAUDE.md`. Esqueleto com marcadores é melhor
  que especificação inventada, que vira mentira que a próxima sessão acredita.
