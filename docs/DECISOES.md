# Decisões de arquitetura — Aventix

> Acumula. Registra o porquê e a alternativa descartada, não a regra em si
> (regra permanente mora no CLAUDE.md).
> Entradas abaixo de 2026-07-27 são registro retroativo das decisões tomadas
> até a criação deste arquivo; as datas individuais não foram preservadas.


## 2026-08-03 — Detalhe da reserva é módulo próprio, não mais uma função em lib/calendar.ts

`getReservationDetail` mora em `lib/reservation-detail.ts`, ao lado de `lib/calendar.ts` e não dentro dele. **Por quê:** os dois têm contratos incompatíveis. `calendar.ts` promete UMA query para o PERÍODO inteiro com o mínimo por reserva (seção 11.1); o detalhe é uma reserva completa, sob demanda. Se ele morasse lá, a primeira pessoa a precisar de "detalhe de várias reservas" o chamaria em laço, que é exatamente o N+1 que a 11.1 existe para proibir, e o arquivo passaria a ensinar o contrário do que seu próprio cabeçalho diz. **Alternativa descartada:** uma função a mais em `calendar.ts`, que era o lugar óbvio por proximidade temática. **Segundo motivo, de privacidade:** o detalhe é o único ponto do sistema que devolve CPF e número de documento juntos, e ter isso num arquivo separado permite que a regra de manuseio (corpo nunca URL, nunca log) fique no cabeçalho dele em vez de diluída num módulo que a agenda compartilhada também consulta. **Consequência assumida:** duas funções leem `reservations` com JOIN parecido, e uma coluna nova pode precisar entrar nas duas.

## 2026-08-03 — Detalhe e cancelamento são overlay sobre o calendário, não página própria

Clicar num bloco abre um painel sobreposto; a rota `/admin/reservas/[id]` da seção 14 continua não existindo. **Por quê:** o dono está olhando a agenda de um sábado cheio e a operação é "conferir e voltar" — navegar para outra página o faria perder a posição no dia e, depois de cancelar, voltar para uma grade recarregada em outro ponto. O overlay preserva o contexto, que é o valor da tela. **Alternativa descartada:** página própria, que é o que a árvore da seção 14 previa e o que dá link direto e botão voltar de graça. **O que fica pendente por causa disso:** não há como mandar "olha essa reserva" por mensagem. A página continua fazendo sentido depois, alimentada pela MESMA rota de detalhe, e a árvore da seção 14 foi atualizada para dizer que ela é o caminho de link direto, não o do dia a dia. **Reabrir quando:** aparecer necessidade real de compartilhar uma reserva por URL.

## 2026-08-03 — Cancelar exige digitar CANCELAR, e o 404 é o mesmo para três causas diferentes

Duas decisões de superfície na primeira tela de escrita do admin. **Confirmação digitada, e não um "tem certeza?":** o risco real não é o dono cancelar a reserva errada por engano de julgamento, é o toque acidental em campo, com o celular na mão, no meio do movimento. Um diálogo de sim/não é vencido pelo mesmo toque acidental que ele deveria barrar; digitar oito caracteres em maiúsculas exige uma segunda intenção. **Motivo de cancelamento não é pedido** — foi decisão do Vinicius, fora de escopo. **404 uniforme:** reserva inexistente, reserva de outro tenant e id fora do formato uuid respondem os três a mesma coisa. Um `403` no segundo caso confirmaria a existência do id a quem está sondando, e um `400` no terceiro distinguiria "formato errado" de "não existe", distinção sem uso para o consumidor. **Detalhe que obrigou a checagem de formato:** `WHERE id = 'abc'` numa coluna uuid não devolve zero linhas, o Postgres aborta com `22P02` — sem validar antes, um id digitado errado viraria 500.

## 2026-08-03 — Depois de cancelar, a grade volta do servidor, não é remendada no cliente

O painel chama `router.refresh()` em vez de remover o bloco da lista que o React já tem em memória. **Por quê:** a página é Server Component com `force-dynamic`, então o refresh re-executa a MESMA query única do período e a grade volta do banco, que é a fonte da verdade. Remover na mão exigiria reimplementar no cliente a regra "só reserva ativa aparece" — uma segunda cópia de um filtro que hoje vive no `WHERE` do SQL — e deixaria a tela divergir de qualquer outra mudança ocorrida no meio tempo: um hold que o cron expirou, um cancelamento feito de outro aparelho. **Alternativa descartada:** atualização otimista, que é instantânea e não custa ida ao servidor. Descartada porque o ganho é imperceptível numa ação que o dono acabou de confirmar digitando, e o custo é uma tela que pode mentir sobre a agenda. **Reabrir se:** o refresh ficar lento a ponto de ser sentido, o que dependeria de um período com muito mais movimento do que o Quadri Club tem.

## 2026-08-03 — Dívida de "não exercitado" se paga construindo o cenário, não relendo o código

O bloco multi-recurso não adjacente estava registrado como "lógica correta por leitura, não por observação", porque o catálogo tem dois recursos adjacentes e o caso era inalcançável. Em vez de reler `contiguousRuns` e declarar correto, o cenário foi CONSTRUÍDO: um terceiro recurso temporário mais um blackout no recurso do meio, o que fez o motor alocar 1 e 3. A grade desenhou dois blocos (`gridColumn` 2 e 4, com a 3 vazia entre eles) e os dois dispararam GET do mesmo id. Tudo removido depois, com o catálogo conferido. **Por que vale o incômodo:** "correto por leitura" é uma afirmação sobre o que se espera do código, não sobre o que ele faz, e este projeto já registrou (27/07) que justificativa não medida vira dívida porque a próxima pessoa a lê como fato. **O que continua não medido, e segue na lista:** os dois blocos não têm vínculo VISUAL entre si. **Método que fica:** quando uma dívida disser "não exercitado contra dado real", a pergunta é o que impede o dado real de existir por dez minutos, não se a leitura do código convence.

## 2026-08-03 — Teste de relógio se ancora em data fixa e o lead vira o delta

Os quatro casos de lead time montavam a grade em HOJE e comparavam contra `Date.now()`. Como o corte do motor (`agora + lead`) andava com o relógio contra um teto fixo de 23:30, passada certa hora nenhum candidato sobrevivia e o caso estourava: 10c a partir das 19:30, 10b e 10d às 21:30, 10a às 22:30. **O que ficou:** uma data ÂNCORA fixa e absoluta (15/06/2027) e o lead derivado dela, `lead = alvo − agora`, de modo que `corte = agora + (alvo − agora) = alvo`. O relógio cancela algebricamente; o resultado observado depende só da âncora. **Por que a âncora é absoluta e não `hoje + N dias`:** a grade depende do dia da semana, e uma data relativa muda de weekday conforme o dia da rodada. **Por que uma terça:** o seed só opera sábado e domingo, então numa terça a grade vem obrigatoriamente da `schedule_exception` do próprio teste; se o INSERT falhar, o dayState sai `closed_weekday` e o teste morre apontando a causa em vez de cair na grade do fim de semana e passar pelo motivo errado. **Por que alvos em HH:17:** fora da malha de 30 min, com 13 min de folga de cada lado, o que absorve o jitter entre a leitura do teste e a do motor e o arredondamento do lead para minuto inteiro. **Alternativa descartada:** pular o teste quando o cenário não fosse construível. Um teste que se auto-desliga passa a nunca rodar e vira falso-verde, pior que flaky. A âncora vencida falha com instrução de trocar a data. **Custo aceito:** o literal `180` sobrevive como diferença entre 10b e 10c (mesma âncora, 180 min a mais de lead, primeiro slot exatamente 3h depois), mas 10a e 10d perderam a metade ponta a ponta — na âncora, `0`, `60` e `NaN` cortam a mesma coisa, ou seja, nada, e a distinção só é observável no parse, por asserção direta sobre `getNumberSetting`. **Método que ficou:** o experimento que valida o conserto precisa primeiro reproduzir a falha na versão antiga; um relógio deslocado que não deixa o teste velho vermelho não prova nada sobre o novo.

## 2026-08-03 — A tela do admin chama a lib, não a própria rota HTTP

`/admin` é Server Component e chama `getCalendarReservations()` direto, embora a seção 11.1 diga que a tela lê de `GET /api/admin/calendar`. **Por quê:** o invariante que a 11.1 protege é "UMA consulta por render, o front nunca busca por reserva ou por recurso", e ele vale integralmente — é a mesma função e a mesma query única. O que se evita é um Server Component fazendo HTTP contra si mesmo e tendo que repassar o próprio cookie de sessão. **Precedente no projeto:** `/api/availability` é camada fina sobre `lib/availability.ts`, e o servidor chama a lib. **Consequência:** a rota existe e cumpre o contrato para consumidores externos ao processo (curl, futuro app, parceiro), não para a própria tela. **Reabrir se:** a tela virar client-side com navegação sem recarga, quando o fetch passa a ser o caminho natural.

## 2026-08-03 — Aritmética de data de calendário em UTC, não com date-fns

`lib/calendar.ts` faz `addDays`, `startOfWeek`, `startOfMonth` sobre `'YYYY-MM-DD'` ancorado em UTC, e os rótulos em português saem de `Intl` nativo. **Por quê:** as funções de calendário do date-fns operam no fuso LOCAL DO PROCESSO, e uma data de calendário não tem fuso — `'2026-08-05'` é a mesma quarta-feira em qualquer servidor. Misturar as duas noções faz o container em UTC e o notebook em São Paulo calcularem semanas diferentes para a mesma URL. **Segundo motivo, específico deste repo:** date-fns está no `node_modules` só transitivamente, via `date-fns-tz`; usá-lo seria depender de resolução acidental sem declarar a dependência. **Alternativa descartada:** `npm i date-fns` e usar `startOfWeek` com âncora ao meio-dia. Funciona para offsets brasileiros e quebra em UTC+13. **Onde o fuso continua entrando:** só na conversão data → instante, que é `localToUtc` em `lib/time.ts`, via date-fns-tz. **Precedente:** `weekdayOf` já usava getters UTC pelo mesmo motivo.

## 2026-08-03 — Filtro do calendário não redimensiona a régua do dia

A view de dia recebe duas listas: `reservations` (filtrada, o que é desenhado) e `axisReservations` (sem filtro, o que dimensiona o eixo vertical). **Por quê:** o eixo se estende para caber reserva fora do horário oficial, e se ele saísse da lista filtrada, desligar um chip encolheria a grade sob o dedo do dono. No caso extremo — dia sem grade cadastrada, cujo eixo só existia por causa das reservas — filtrar todas trocava a grade pela mensagem "o tenant não opera neste dia da semana", uma afirmação falsa produzida por um filtro de visualização. **Regra que fica:** filtrar esconde bloco, nunca mexe na régua nem nas colunas. **Como foi encontrado:** não por teste, por uma pergunta sobre o comportamento esperado dos chips.

## 2026-08-03 — Bloco multi-recurso é contíguo, e a divisória fica por cima

Na view de dia, uma reserva de N recursos vira um bloco por CORRIDA CONTÍGUA de colunas (`contiguousRuns`), não um bloco por recurso nem um bloco atravessando o intervalo inteiro. **Por quê:** reserva nos recursos 1 e 3 com o 2 livre, desenhada como bloco único do 1 ao 3, mentiria dizendo que o 2 está ocupado — o erro na direção oposta ao que se quer evitar. **Decisão de leitura junto:** as divisórias de coluna são desenhadas ACIMA dos blocos. Um bloco multi-recurso é uma peça contígua cuja marcação (borda colorida, nome, trilha) fica toda na primeira coluna, e sem a divisória a coluna seguinte parece VAZIA — a leitura errada exatamente onde o recurso está tomado. **Não exercitado contra dado real:** o catálogo tem 2 recursos adjacentes, então a não-adjacência é inalcançável hoje; a lógica está correta por leitura, não por observação. **Pendência que fica:** dois blocos da mesma reserva não têm vínculo visual entre si.

## 2026-08-01 — Commit órfão se recupera por cherry-pick, não se reescreve

O trabalho descartado pelo `rebase --abort` (globalSetup + testes de preço) foi recuperado com `git cherry-pick d037245`, depois de o `git reflog` mostrar o commit íntegro no object database. **Por quê:** um commit desreferenciado não é um commit perdido, e o Git guarda objetos soltos por semanas antes de coletá-los. **Alternativa descartada:** reescrever as três peças à mão a partir da descrição do que elas faziam, que era o plano inicial da sessão. Descartada porque produziria código *parecido* com o validado, não o validado: 554 linhas, incluindo comentários que registram medições (`docker compose down -v` seguido de `npm test`, contagem de registros semeados) que não teriam como ser reproduzidas de memória. **Se fosse diferente:** o repositório ficaria com uma segunda implementação de globalSetup, sutilmente distinta da que passou pelos testes, e a diferença só apareceria no dia em que ela quebrasse. **Método que ficou:** antes de reescrever qualquer coisa dada como perdida, rodar `git reflog` e `git cat-file -t` no hash. Custa dez segundos e decide entre recuperar e reconstruir.

## 2026-08-01 — Duas fontes de ancoragem de preço nos testes, e elas não se misturam

Os testes têm duas origens legítimas de valor esperado, e confundi-las é o erro a evitar. **Catálogo real** (`TEMPLATE_EXP`, de `lib/templates/quadriciclo.ts`): usado pelos testes de composição e preço, porque ali o que se verifica é que o servidor cobra o que o NEGÓCIO decidiu. **Fixture da suíte** (`DEPOSIT_PCT_FIXTURE`, `DEPOSIT_FIXED_FIXTURE`, de `tests/helpers/db.ts`): usado pelos testes do modo `deposit`, porque as duas experiências reais estão em `payment_mode: 'full'` e o modo `deposit` não teria como ser exercitado contra o catálogo. **Por que não unificar:** apontar os testes de `deposit` para o template exigiria pôr uma experiência `deposit` no catálogo real do Quadri Club só para satisfazer teste, contaminando o produto com dado de teste. **Por que não deixar literais:** eram doze repetições de 34900/17450, e dois deles significavam coisas diferentes (o preço de uma experiência e metade do preço da outra), coincidência numérica que escondia a semântica. **Regra que fica:** o teste faz a própria aritmética a partir do parâmetro (`round(total x percent/100)`, seção 4.6) e confronta com o que o app calculou por outro caminho. Ler o esperado do retorno do app seria circular; ler do banco também, porque o app leu a mesma linha.

## 2026-07-28 — Calendário nativo com CSS Grid puro, sem biblioteca

O calendário de operação é construído com CSS Grid, sem FullCalendar, react-big-calendar ou similar. **Por quê:** libs de calendário são desenhadas para o modelo Google Calendar (timeline vertical, um evento por recurso). O Aventix é uma grade tempo×recurso com reserva multi-recurso (uma reserva ocupa N quadris), buffer visível e estado de pagamento — casos que a lib trata como plugin secundário (resource view costuma ser feature paga) ou não trata. **Alternativa descartada:** FullCalendar com resource-timeline. Descartada por custo (premium), CSS próprio a sobrescrever no tema escuro, e ter que lutar contra o modelo dela para a reserva multi-recurso. **Como o MVP não tem** drag-and-drop, recorrência nem fusos (o difícil de um calendário), sobra layout + leitura de dados, que Grid faz melhor sozinho. date-fns (já no projeto) cobre a matemática de datas.

## 2026-07-28 — Views do calendário: eixo recurso, filtro por experiência, rolagem para escala

Três modos (dia/semana/mês), eixo primário = recurso. Filtro por experiência via chips é FILTRO (esconde o que não bate), não reagrupamento do eixo. **Escala:** quando os recursos não couberem, a grade rola horizontalmente (largura mínima por coluna), sem esconder recurso nem exigir configuração do dono. **Por quê filtro e não agrupar por trilha:** decisão do Vinicius; agrupar por trilha (coluna = experiência) resolveria muitos recursos mas esconde qual recurso está alocado — fica como possível v2. **Contrato de dados:** GET /api/admin/calendar devolve o período em UMA query (reservas ativas + recursos + cliente só-nome + estado de pagamento), granularidade acompanha a view (mês traz resumo). Registrado na seção 11.1 do CLAUDE.md. **Reabrir se:** um tenant real precisar de agrupamento por trilha por ter recursos demais.

## 2026-07-28 — Painel de detalhes/cancelamento separado da grade

O calendário foi fatiado em duas tarefas: primeiro a grade de visualização (leitura), depois o painel de detalhes + cancelamento (escrita). **Por quê:** a grade já é densa (três views, filtro, layout); o painel mexe em escrita (cancelar chama setReservationStatus, dispara e-mail na Fase 4, tem confirmação). Juntar viraria um prompt difícil de revisar. Mesmo princípio de fatiar que vem sendo usado.

## 2026-07-28 — Higiene de git: operação pela metade é limbo

Três categorias de problema de git apareceram nesta semana, todas com a mesma raiz — operação deixada pela metade no fim do expediente: (1) mensagens de commit que não batem com o conteúdo (commits montados às pressas — 8f14f98, ce3e4c6); (2) trabalho commitado mas não pushed, que "existe" na sessão mas some na seguinte; (3) rebase interativo iniciado e não terminado, que deixa o repositório num estado congelado e fez um `--abort` descartar correções já validadas (globalSetup + testes de preço), recuperadas depois porque parte estava no origin. **Convenções adotadas:** rodar `git show --stat` antes de escrever a mensagem do commit; se `git status` mencionar "rebasing", resolver (`--continue`/`--abort`) antes de qualquer outra coisa e nunca iniciar rebase sem terminar na mesma sessão; o que não foi pushed não está seguro — push ao fim de cada bloco de trabalho.

## 2026-07-28 — Auth: login unico encapsulado, pronto para escalar sem refazer

MVP tem um usuario (o dono), credencial em `.env`, sessao iron-session, hash bcrypt. **Por que nao construir multiusuario agora:** papeis/convites/revogacao sao semanas de trabalho para um lancamento de um usuario, com prazo apertado. **Como evitar refazer na escala:** toda auth passa por `lib/auth.ts`; `getCurrentUser()` e o ponto unico que a v2 reescreve para ler `admin_users` e retornar papel — consumidores nao mudam. **bcrypt e nao argon2:** argon2 e superior sob ataque de quebra em massa (vazamento de banco com muitas senhas), cenario que nao existe com um usuario; bcrypt tem instalacao mais simples e mais exemplos. Encapsulado, trocar para argon2 na escala e mudar uma funcao. **iron-session e nao sessao com estado no servidor:** sessao em tabela permite revogacao imediata (expulsar sessao/demitir), requisito real na escala mas inexistente com um usuario; iron-session guarda o estado no cookie e e a opcao de menor codigo. Encapsulado atras de `getCurrentUser()`, migrar para sessao com estado na v2 nao toca os consumidores. **Reabrir quando:** entrar o segundo usuario — ai `admin_users`, papeis e provavelmente sessao com estado (para revogacao) entram juntos.

**Correcao de premissa, medida na implementacao:** a justificativa original dizia que bcrypt evita "dependencia nativa problematica em Docker". Isso esta errado pela metade — `bcrypt` E um modulo nativo (o puro-JS e o `bcryptjs`). O que salva e outra coisa: `bcrypt@6` publica **prebuilds musl** (`prebuilds/linux-x64/bcrypt.musl.node` e arm64), entao o `node:22-alpine` do Dockerfile usa binario pronto e **nao precisa de toolchain de build**. A conclusao continua valendo, o motivo e outro. Se um dia o bcrypt parar de publicar prebuild musl, as saidas sao `bcryptjs` (uma linha, gracas ao encapsulamento) ou `apk add python3 make g++` no estagio de build.

## 2026-07-28 — Sessao sem revogacao: trocar SESSION_SECRET e a unica saida

O estado da sessao vive dentro do cookie (iron-session), nao no banco. **Consequencia operacional que precisa estar escrita:** nao existe "encerrar a sessao daquele dispositivo". Um cookie roubado vale ate expirar (8h). A unica forma de invalidar sessoes abertas e **trocar `SESSION_SECRET`**, o que derruba todas de uma vez. **Por que se aceita isso no MVP:** ha um unico usuario, e "derrubar todas as sessoes" e exatamente o que ele quereria fazer num incidente. **Por que 8h e nao 30 dias:** o teto de exposicao de um cookie roubado e a validade dele; 8h cobre um dia de operacao e limita o estrago. **Reabrir quando:** entrar o segundo usuario — demitir alguem exige revogacao seletiva, e ai a sessao vai para o banco.

## 2026-07-28 — Fail-fast de auth no boot (instrumentation), nao no import do modulo

`lib/auth.ts` valida ambiente de forma PREGUICOSA (na primeira leitura), e `instrumentation.ts` forca essa leitura no boot para o erro aparecer cedo. **Alternativa descartada:** validar no topo de `lib/auth.ts`, que e o fail-fast mais obvio. Ela quebra o `next build` dentro do Docker: o Easypanel injeta variaveis em **runtime**, nao no build (secao 2), entao `ADMIN_*` legitimamente nao existem durante o `npm run build` e a imagem nem sairia. **Segunda decisao junto:** o boot **avisa e segue**, nao mata o processo. O site publico de reservas nao depende de auth nenhuma; derrubar o container por causa de uma variavel do painel tiraria a venda do ar para consertar um problema que so afeta o dono. O log grita, o admin responde 500 no login, o resto funciona. **Se fosse diferente:** uma variavel esquecida num deploy de sexta derrubaria o site inteiro em vez de so o painel.

## 2026-07-28 — Cifroes do hash bcrypt precisam de escape no .env

`ADMIN_PASSWORD_HASH` vai no `.env` com `\` antes de cada `$` (`\$2b\$12\$...`). **Por que:** o carregador de ambiente do Next (`@next/env`) expande variaveis, e o hash bcrypt tem tres cifroes; sem escape, `$2b$12$GaW` e lido como variavel inexistente e some — o valor chega com **50 caracteres em vez de 60**. **MEDIDO nas cinco formas:** sem aspas, com aspas simples e com aspas duplas todas quebram; so o escape com `\` funciona (com ou sem aspas). **O que torna isso traicoeiro:** o `dotenv` puro que os scripts e os testes usam le certo MESMO SEM escape, entao `npm run auth:hash` e a suite nao acusam nada — o sintoma aparece so dentro do Next, e com cara de "senha errada", que manda o dono trocar a senha em vez de olhar o `.env`. **Defesa em tres camadas:** o script ja imprime a linha escapada, o `.env.example` documenta as cinco formas medidas, e `lib/auth.ts` valida o prefixo do hash no boot com mensagem que cita esta causa e o comprimento recebido.

## 2026-07-28 — MVP so Pix: price_cents e o preco Pix

O Quadri Club pratica preco por metodo (Pix cerca de 7% mais barato que cartao). Como o MVP so tem Pix, `price_cents` das experiencias = preco Pix (Montanha 32549, Fazenda 23249). O preco de cartao (34999 / 24999) nao e armazenado agora. **Alternativa descartada:** guardar preco por metodo ja, em coluna extra ou tabela de precos. Descartada porque adiciona modelagem para um metodo que nao existe no MVP. **Se fosse diferente:** ou o sistema carregaria uma dimensao morta, ou alguem semearia o preco de cartao por engano e todo cliente Pix pagaria 7% acima do anunciado, sem erro nenhum aparecendo. **Reabrir quando:** cartao entrar na v2. Ai preco por metodo vira necessario e a modelagem (coluna versus tabela) se decide junto.

## 2026-07-28 — Inversao da ordem Fase 2 / Fase 3: telas de admin antes do pagamento

Os pre-requisitos do Asaas (conta aprovada, chave Pix, API keys) atrasaram e travam a Fase 2 inteira. Em vez de esperar parado, a ordem foi invertida: construir agora as telas de ADMIN da Fase 3 que nao dependem de pagamento (auth, calendario nativo, CRUDs de catalogo, configuracoes, clientes sem a parte de faturas, agenda compartilhada), e deixar para depois a Fase 2 (PaymentProvider, webhook, reconciliacao) e o miolo do fluxo publico de compra (tela de pagamento Pix, criacao de cobranca no formulario). **Alternativa descartada:** esperar o Asaas antes de tocar a Fase 3. Descartada porque desperdica dias num cronograma apertado (go-live 24/08) e as telas de admin sao trabalho necessario de qualquer forma. **Bonus:** com o admin pronto, o cliente pode comecar a configurar o Quadri Club de verdade enquanto o Asaas nao chega, o que tambem antecipa a confirmacao dos valores que seguem PROVISORIOS no template. **Custo aceito:** Fase 2 e Fase 3 serao costuradas no fim em vez de sequenciais, com mais troca de contexto. **Reverter se:** o Asaas chegar antes de terminarmos as telas de admin, quando volta a fazer sentido fechar a Fase 2 primeiro.

## 2026-07-28 — server-only aliasado para stub vazio no Vitest

O Vitest resolve `server-only` para `tests/stubs/server-only.ts`, um modulo vazio. **Por quê:** o Vitest roda em Node puro e o pacote real lanca ali. O marcador existe para barrar import a partir de Client Component, conceito de build do Next que nao se aplica ao Vitest, entao neutraliza-lo em teste nao afrouxa nenhuma protecao real: ela continua valendo no build, com o pacote de verdade. **Alternativa descartada:** ativar a condicao de exportacao `react-server` na config do Vitest. Ela resolveria, mas e global: qualquer pacote com export `react-server` (React inclusive) passaria a resolver por outro caminho nos testes, afastando o ambiente de teste do de producao em vez de aproximar. **Se fosse diferente:** um bug de resolucao de modulo apareceria so em producao, ou pior, um teste passaria contra uma versao de biblioteca que o app nunca carrega.

## 2026-07-28 — Testes de integracao contra o Postgres real, com catalogo como pre-condicao

A suite nao mocka banco: roda contra o Postgres local, com o catalogo do seed como pre-condicao que ela nunca apaga, e zera so as tabelas de movimento. **Por quê:** o nucleo do Aventix E o banco. Exclusion constraint, `tstzrange` com limites `[)`, `FOR UPDATE`, advisory lock e transacao com rollback nao existem fora dele; testar contra mock provaria que o mock funciona. **Consequencias assumidas:** `fileParallelism: false` na config, porque os arquivos compartilham o mesmo banco e se apagariam entre si; `schedule_exceptions` e `blackouts` entram na limpeza, ja que o seed as deixa vazias e os testes criam linhas nelas; e a suite exige `npm run db:seed` rodado antes. **Alternativa descartada:** banco efemero por arquivo de teste (container ou schema por worker). Daria paralelismo e isolamento total, ao custo de subir infraestrutura por rodada; com uma suite de 2 segundos, nao se paga.

## 2026-07-28 — Cenario de teste montado por SQL cru, nao por createReservation

Os helpers inserem reservas e alocacoes direto por SQL (`occupy()`), em vez de chamar `createReservation`. **Por quê:** se o cenario fosse montado pela funcao de criacao, um bug nela derrubaria tambem os testes de disponibilidade, e a suite apontaria para o lugar errado. Montando por fora, cada grupo falha pelo proprio motivo. **Custo:** os helpers conhecem o schema e precisam acompanhar mudancas de coluna, o que o typecheck nao pega porque e SQL cru em template string.

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
