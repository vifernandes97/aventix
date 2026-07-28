# Decisões de arquitetura — Aventix

> Acumula. Registra o porquê e a alternativa descartada, não a regra em si
> (regra permanente mora no CLAUDE.md).
> Entradas abaixo de 2026-07-27 são registro retroativo das decisões tomadas
> até a criação deste arquivo; as datas individuais não foram preservadas.

## 2026-07-28 — server-only resolve dentro do Next e lança fora dele

`lib/tenant.ts` e `lib/availability.ts` declaram `import 'server-only'`. Comportamento MEDIDO em três contextos: dentro do Next (rotas, Server Components, `instrumentation.ts`) o import resolve normalmente; em processo Node cru (`tsx` avulso, Vitest) ele lança "This module cannot be imported from a Client Component module". A explicação provável é a condição de exportação `react-server`, que o Next aplica e o Node cru não; o mecanismo interno não foi aberto para conferência, só o comportamento. **Consequência prática:** `instrumentation.ts` usa import estático sem problema, `scripts/seed.ts` não pode importar `tenant.ts` (declara o tenant id localmente), e o Vitest precisa de tratamento explícito, ainda por decidir. **Alternativa descartada:** import dinâmico no `instrumentation.ts` como precaução. Ela não corrigia nada, porque nada quebrava, e o comentário que a justificava afirmava um perigo inexistente. **Lição de método registrada:** justificativa de código que não foi medida vira dívida, porque a próxima pessoa a lê como fato.

## 2026-07-28 — Seed reconcilia catálogo por nome e nunca apaga

`scripts/seed.ts` casa recursos e experiências por `(tenant_id, name)`, e faixas de horário pela tupla inteira `(weekday, opens, closes)`. **Por quê:** essas tabelas usam `id serial` e não têm chave natural no schema; o nome é o único identificador estável que o template oferece. **Consequência assumida:** renomear um item no template cria um NOVO registro em vez de renomear o antigo, e o antigo é reportado como órfão. É o comportamento seguro, porque o registro antigo pode ter reservas apontando para ele. **O que o seed nunca faz:** apagar. Nem movimento, que ele sequer toca, nem catálogo ausente do template. Sincronizar a grade removendo faixas antigas quebraria FK de reservas gravadas; desativar catálogo obsoleto é operação do admin, com `active = false`.

## 2026-07-28 — /lib é biblioteca, /scripts é executável

Seed e futuros utilitários de linha de comando vivem em `/scripts`, não em `/lib`. **Por quê:** um arquivo em `/lib` pode ser importado por qualquer caminho do app, e o seed chama `main()` ao ser carregado e escreve no banco; um import distraído dispararia escrita. **Alternativa descartada:** `lib/templates/seed.ts`, que ficaria colado ao template que ele aplica. **Custo aceito:** `/scripts` não estava na árvore da seção 14 do CLAUDE.md e foi acrescentado lá. A regra também decide onde entra o job de reconciliação da Fase 2: a lógica em `/lib` (testável, reusável), o entrypoint agendado fora dela.

## 2026-07-28 — Cron de hold via node-cron, não pg_cron

Expiração de hold roda com node-cron no processo Next (instrumentation.ts), não pg_cron. **Por quê:** pg_cron executa SQL dentro do Postgres e não consegue chamar setReservationStatus; SQL cru mexendo em status furaria a regra do FOR UPDATE (seção 4.6) e a proteção contra double-booking. **Alternativa descartada:** rota protegida chamada por agendador externo (Easypanel/serviço) — desacoplada e resistente a restart, mas adiciona infraestrutura e um segredo a gerenciar, sem ganho real num setup de container único. **Reabrir se:** escalar para múltiplos containers ou migrar para serverless, onde o cron in-process roda duplicado ou não roda.

## 2026-07-27 — CLAUDE.md é especificação, docs/ é estado e histórico

CLAUDE.md descreve como o sistema é, no presente, e é lido por inteiro toda sessão. Estado e histórico vão para `docs/`. **Alternativa descartada:** um `sessions.md` acumulando diário de sessões. Logs crescem sem limite, ninguém relê o meio deles e viram uma terceira fonte de verdade que diverge das outras. **Se fosse diferente:** o bloco "Revisão 4/5/5.1/6" no topo do CLAUDE.md é o exemplo vivo do fracasso — histórico dentro da especificação, com uma regra viva (a regra de marca) enterrada no meio.

## 2026-07-27 — Colapso das migrations numa 0000 única

Três migrations (0000, 0001, 0002) viraram uma só, já na forma final da rev 6. **Por quê:** produção nunca havia migrado (verificado: `drizzle.__drizzle_migrations` não existia), então o histórico de idas e vindas do desenvolvimento não tinha valor, e a 0002 tinha um `ADD COLUMN NOT NULL` sem default que abortaria em banco com linhas. **Alternativa descartada:** manter as três e usar `DEFAULT` + `DROP DEFAULT` na 0002. **Consequência:** essa janela fecha assim que produção rodar a primeira migration. Dali em diante, toda mudança é migration nova, nunca reescrita de migration passada.

## 2026-07-27 — Todo caminho de escrita de status passa por setReservationStatus

`setReservationStatus` faz `SELECT ... FOR UPDATE` na reserva antes de decidir. **Por quê:** o cron de expiração e o webhook de pagamento podem tocar a mesma reserva no mesmo instante (Pix caindo exatamente quando o hold vence). Sem a trava, os dois leem `pending_payment` e um sobrescreve o outro. **Consequência:** a garantia só existe enquanto ninguém escrever `UPDATE reservations SET status` fora da função. Um único desvio fura a proteção contra double-booking silenciosamente.

## 2026-07-27 — Sobreposição de período sempre em SQL, nunca em JavaScript

Toda comparação de intervalo usa o operador `&&` sobre `tstzrange`. **Por quê:** `tstzrange` usa limites `[)` — uma reserva que termina 11:45 não conflita com uma que começa 11:45. Reimplementar isso em JS abre espaço para um `<=` no lugar de `<`. **Se fosse diferente:** o motor divergiria da exclusion constraint, e o sintoma seria horários vendáveis sumindo da grade, ou o cliente escolhendo um slot que o POST recusa com 409.

## 2026-07-27 — O recheck da criação reutiliza getAvailability

`createReservation` chama `getAvailability` com o próprio `tx` em vez de ter lógica própria de disponibilidade. **Por quê:** duas implementações da mesma regra divergem com o tempo. **De brinde:** o recheck cobre lead time, blackouts, exceções de agenda e exclusividade de experiência sem duplicar nada.

## 2026-07-27 — Enums de pagamento são do domínio, não espelham o Asaas

`payment_state`, `payment_kind`, `payment_mode` e `reservation_payment_state` são vocabulário do Aventix. **Por quê:** três deles nem existem no Asaas (`kind`, `mode` e o agregado da reserva são conceitos nossos), e o Asaas distingue `RECEIVED` de `CONFIRMED` de um jeito que só importa no cartão. **Alternativa descartada:** copiar os status do Asaas. **Se fosse diferente:** a abstração `PaymentProvider` seria furada e o banco inteiro estaria "falando Asaas". A tradução mora num ponto único: `lib/payments/process.ts` (Fase 2).

## 2026-07-27 — schedule_exceptions cobre liberar e bloquear numa peça só

Uma tabela com booleano `closed` + CHECK, em vez de duas tabelas. **Por quê:** liberar feriado numa terça e bloquear recesso de fim de ano são a mesma operação — exceção à grade recorrente para uma data. **Se fosse diferente:** duas tabelas dobrariam o trabalho e criariam a chance de uma data estar liberada numa e bloqueada na outra. Distinta de `blackouts`, que é por recurso específico e intervalo de timestamp.

## 2026-07-27 — Exclusividade de experiência via advisory lock

`single_experience_per_slot` (configurável por tenant, ligado no Quadri Club) é garantido com `pg_advisory_xact_lock(tenant_id)` na criação. **Por quê:** a exclusion constraint enxerga conflito por recurso, não entre experiências diferentes — ela não consegue expressar essa regra. **Alternativa descartada:** uma segunda exclusion constraint. Não é expressável no modelo atual.

## 2026-07-27 — Acessores tipados para settings (booleano e numérico)

`getBooleanSetting` e `getNumberSetting` em vez de ler `settings.value` direto. **Por quê:** a coluna é `text`, então `"false"` é uma string — e em JS toda string não-vazia é verdadeira. Um `if (settings.single_experience_per_slot)` ligaria a exclusividade mesmo desligada, sem erro nenhum. O numérico protege do mesmo tipo de falha: `"60" + 30` é `"6030"`, e valor corrompido vira `NaN` silencioso.

## 2026-07-27 — Telefone normalizado é a chave de identificação do cliente

`normalizePhone` reduz a dígitos e remove `55` de país só quando o total é 12 ou 13. **Por quê:** `UNIQUE (tenant_id, phone)` só funciona se o mesmo número sempre virar a mesma string. **Detalhe que exigiu cuidado:** 55 também é DDD válido (Santa Maria/RS) — remover incondicionalmente quebraria esses números. A regra por comprimento é completa: nenhum número nacional brasileiro tem 12 ou 13 dígitos.

## 2026-07-27 — Cast ::int no SUM de pagamentos

`coalesce(sum(amount_cents), 0)::int`. **Por quê:** `SUM(integer)` retorna `bigint`, que o node-postgres entrega como string. Sem o cast, `"0" === 0` é falso e a classificação pularia `pending` para `partial`. **Se fosse diferente:** reserva sem nenhum pagamento apareceria como paga parcialmente, com o saldo exibido correto — número certo, rótulo mentindo.

## 2026-07-27 — Sinal limitado ao total, com piso de 1 centavo

Se `deposit >= total`, o sinal vira o total e não se cria linha de saldo. **Por quê:** `deposit_fixed_cents` maior que o preço geraria saldo zero ou negativo, e o `CHECK (amount_cents > 0)` derrubaria a venda por erro de configuração da experiência. O piso cobre o percentual que arredonda para zero.

## 2026-07-27 — Capacidade é a soma dos recursos alocados

Validação usa a soma real das `capacity` dos recursos alocados, não `capacity × resourcesNeeded`. **Por quê:** o schema permite capacidade diferente por recurso. Dá o mesmo resultado no caso uniforme do Quadri Club e continua correto se um dia houver um quadriciclo de capacidade diferente.

## 2026-07-27 — Datas saem de lib/ em ISO 8601

Toda função que devolve `timestamptz` para a API converte com `toISOString()`. **Por quê:** o schema usa `mode:'string'` e o driver devolve o texto cru do Postgres (espaço no lugar do `T`, offset sem minutos, microssegundos). O V8 tolera, outros motores devolvem `NaN`. **Se fosse diferente:** o contador de 15 minutos da tela de pagamento quebraria em alguns navegadores e funcionaria no seu.

## 2026-07-27 — server-only em lib/tenant.ts

Instalado o pacote `server-only` em vez de guarda em runtime. **Por quê:** o pacote falha no build, a guarda falhava só no carregamento. **Consequência conhecida:** qualquer processo Node puro que importe `lib/tenant.ts` (ou `lib/reservations.ts`, que o importa) quebra no import. Afeta o cron e o job de reconciliação se rodarem fora do Next — precisa de `node --conditions=react-server` ou mover `getTenantId()` para módulo sem a marca.

## 2026-07-27 — Deploy via Easypanel, não docker-compose manual

A VPS roda Easypanel, que gerencia Traefik, domínio e SSL. O `docker-compose.yml` de produção não existe; o `docker-compose.dev.yml` serve só para o Postgres local. **Descoberta operacional:** o Easypanel injeta sua própria variável `PORT` em runtime, sobrescrevendo o Dockerfile — as rotas de domínio devem apontar para a porta do log de boot, não para a do Dockerfile. Isso custou uma sessão de debug.

## 2026-07-27 — Split de pagamento fica fora do MVP

Repasse automático ao Aventurando via `walletId` do Asaas vai para a v2. **Por quê:** depende de o parceiro ter conta Asaas e fornecer o walletId — dependência externa que pode travar o go-live. O modelo atual (venda pelo parceiro com `?canal=aventurando`, comissão acertada por fora) já resolve o caso comercial. **Reabrir se:** o Aventurando exigir repasse automático como condição para vender.

## 2026-07-27 — Conversão de timezone em JS com date-fns-tz, não no Postgres

`lib/time.ts` usa `date-fns-tz` (base IANA) para converter America/Sao_Paulo ↔ UTC. **Alternativa descartada:** fazer tudo no Postgres com `AT TIME ZONE`, que seria zero dependência e usaria a mesma tzdata do banco. **Por quê assim:** a geração de candidatos da grade é aritmética de calendário e fica mais legível em JS; o SQL guarda o que é dele, que é sobreposição. **Consequência:** duas bases de tzdata no sistema (Node e Postgres). Os instantes trafegam como `timestamptz`, então uma divergência de regra de DST entre elas só apareceria numa data futura já convertida. **Reabrir se:** aparecer tenant fora de SP ou o Brasil voltar a ter horário de verão. `lib/time.ts` é o único arquivo a trocar.

## 2026-07-27 — A query de disponibilidade devolve índice, não timestamp

A query dos passos 2/2b usa `unnest(...) WITH ORDINALITY` e retorna a posição do candidato; o JS mapeia de volta para o `Date` que ele mesmo calculou. **Por quê:** o Drizzle sobrescreve o parser de `timestamptz` do node-postgres e entrega texto cru em `db.execute`. Reparsear esse texto para `Date` introduziria uma chance de divergir do instante original, e uma divergência de fuso é silenciosa. **Consequência:** o SQL decide quais candidatos passam, nunca o valor deles.

## 2026-07-27 — xmax = 0 distingue insert de update no upsert de cliente

`findOrCreateCustomer` devolve `created` lendo `(xmax = 0)` no mesmo `RETURNING`. **Alternativa descartada:** `SELECT` prévio dentro da transação. **Por quê:** o `SELECT` custa uma query a mais e abre janela entre leitura e escrita. Validado sob concorrência real: duas chamadas simultâneas com o mesmo telefone retornaram o mesmo id, uma com `created=true` e outra com `false`. **Limitação conhecida:** se a mesma transação chamar a função duas vezes para o mesmo telefone, a segunda reporta `created=false`, correto para a linha mas não para a transação.

## 2026-07-27 — Faturas do cliente vêm do banco local, não do Asaas ao vivo

A tela de cliente no admin mostra status de pagamento do banco local (mantido pelo webhook) e um link para a fatura no Asaas (`invoiceUrl` persistido na criação). **Por quê:** o webhook já mantém o status sincronizado; buscar ao vivo seria redundante e acoplaria a tela admin à disponibilidade do Asaas.
