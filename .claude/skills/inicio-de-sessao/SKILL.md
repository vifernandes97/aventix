---
name: inicio-de-sessao
description: Inicia uma sessão de trabalho no Aventix carregando o contexto atual. Use no começo de cada sessão do Claude Code para retomar de onde a anterior parou. Invoque com /inicio-de-sessao.
allowed-tools: Read, Bash
---

# Ritual de Início de Sessão — Aventix

Carregue o contexto antes de qualquer trabalho. Não improvise nem refaça o que já foi feito.

## 1. Leia os documentos de estado

- `docs/ESTADO-ATUAL.md` — onde o projeto está e qual o próximo passo.
- `docs/DECISOES.md` — decisões já tomadas. Não reabra decisão fechada sem motivo novo.

O CLAUDE.md você já leu automaticamente ao iniciar; ele é a especificação e vence qualquer divergência.

## 2. Verifique o estado real do repositório e do banco

Não confie só nos documentos. Rode:
- `git status` e `git log --oneline -5` — há trabalho não commitado? Qual foi o último commit?
- `npm run db:generate` — deve responder "No schema changes, nothing to migrate". Se gerar uma migration, `lib/db/schema.ts` e o banco local estão divergentes: APAGUE o arquivo gerado e sinalize antes de qualquer outra coisa.
- O container do Postgres está no ar? (`docker compose -f docker-compose.dev.yml ps`)

Este projeto já perdeu tempo com o repositório numa versão do schema e o banco em outra. A verificação custa trinta segundos.

## 3. Confirme o entendimento

Antes de propor qualquer coisa, resuma em 3-4 linhas:
- Onde o projeto está.
- Qual o próximo passo segundo o ESTADO-ATUAL.md.
- Se há divergência, trabalho não commitado ou pendência que precise de atenção primeiro.

Depois pergunte se seguimos com o próximo passo registrado ou se a prioridade mudou. Não comece a codar antes dessa confirmação.

## Importante

Se os documentos estiverem vazios, ausentes ou visivelmente desatualizados em relação ao git, diga isso e ajude a estabelecer o estado real em vez de assumir.
