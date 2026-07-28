---
name: fim-de-sessao
description: Encerra a sessão de trabalho no Aventix atualizando a documentação de estado. Use ao terminar uma tarefa ou antes de fechar o Claude Code, para que a próxima sessão retome sem perda de contexto. Invoque com /fim-de-sessao.
allowed-tools: Read, Edit, Write, Bash
---

# Ritual de Fim de Sessão — Aventix

Encerrando uma sessão de trabalho no Aventix. O objetivo é que a próxima sessão, que começa limpa e sem esta conversa, retome sem perda.

## Divisão de responsabilidade entre os documentos

Entenda isto antes de escrever qualquer coisa:

- **CLAUDE.md** é a ESPECIFICAÇÃO. Presente do indicativo, "como o sistema é". Histórico NUNCA entra aqui. É lido por inteiro no início de toda sessão, então cada linha inútil custa contexto.
- **docs/ESTADO-ATUAL.md** é o ESTADO. Sobrescrito a cada sessão, nunca acumula. Tem sempre mais ou menos o mesmo tamanho.
- **docs/DECISOES.md** é o HISTÓRICO DE DECISÕES. Acumula. Guarda o porquê e as alternativas descartadas.

Se uma decisão desta sessão mudou a especificação (modelo de dados, contrato de API, escopo, invariante), o CLAUDE.md PRECISA ser atualizado nesta mesma sessão. Documento desatualizado é a principal fonte de retrabalho neste projeto.

Se uma decisão virou regra permanente, ela mora no CLAUDE.md e o DECISOES guarda só a justificativa, sem duplicar a regra.

## 1. Revise o que aconteceu

Releia a sessão e identifique, de forma factual:
- O que foi efetivamente feito (arquivos, funções, migrations).
- O que ficou pela metade.
- Decisões de arquitetura ou trade-offs, e o porquê.
- Problemas ou limitações descobertos e não resolvidos.

## 2. Verifique se repositório e banco estão em acordo

Este projeto já teve o schema divergindo das migrations. Antes de registrar qualquer estado, confirme:
- `npm run db:generate` responde "No schema changes, nothing to migrate"? Se gerar migration, há divergência entre `lib/db/schema.ts` e o banco local. Apague o arquivo gerado e registre a divergência como pendência.
- Quantas migrations existem em `drizzle/*.sql` e quantas linhas há em `drizzle.__drizzle_migrations` no banco local.

## 3. Atualize os documentos

**docs/ESTADO-ATUAL.md** — reescreva por completo, com esta estrutura:
- Fase atual e progresso (ex.: "Fase 1, 6 de 9 tarefas").
- O que está pronto (lista curta, só o essencial).
- O que está em andamento e o que falta nele.
- PRÓXIMO PASSO, explícito e acionável.
- Estado de migrations: quantas existem, qual a última aplicada em local, e se produção já migrou.
- Pendências e dívidas conhecidas.

Substitua o conteúdo velho. Não acumule histórico aqui.

**docs/DECISOES.md** — se houve decisão nesta sessão, acrescente ao final no formato:
`## AAAA-MM-DD — Título curto da decisão`
seguido de: o que foi decidido, por quê, qual alternativa foi descartada e o que aconteceria se fosse feito diferente.

Não registre escolha trivial de implementação. Registre o que alguém poderia querer reabrir depois.

Se os arquivos não existirem (primeira execução), crie-os.

## 4. Commit

- `git status` e `git diff` para revisar.
- Commits pequenos e coerentes; separe o commit de código do commit de docs. Formato `tipo(escopo): descrição`.
- NÃO faça push automaticamente. Mostre o que foi commitado e pergunte.

## 5. Resumo final

Em 3-4 linhas: o que foi commitado, o estado registrado, o próximo passo escrito no ESTADO-ATUAL.md, e — se houver — quais tarefas do board do Orbi mudaram de status e precisam ser atualizadas manualmente (a skill não tem acesso ao Orbi).

## Regras de escrita

Português brasileiro, denso e direto, sem travessão. Não invente o que não foi feito. Se algo ficou incerto, registre como incerto.

## Importante

Nunca conclua sem atualizar o ESTADO-ATUAL.md. Se a sessão não teve trabalho real, diga isso em vez de editar à toa.
