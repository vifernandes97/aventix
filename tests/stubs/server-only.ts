// Stub de `server-only` para o ambiente de teste.
//
// O pacote real resolve para um modulo que LANCA quando a condicao de exportacao
// `react-server` nao esta ativa (medido: "This module cannot be imported from a
// Client Component module"). O Vitest roda em Node puro, entao ele lancaria.
//
// Neutralizar aqui e correto, nao um contorno: o marcador existe para barrar
// import a partir de Client Component, e isso e um conceito de build do Next que
// nao se aplica ao Vitest. A protecao real continua valendo onde importa — no
// build do Next, com o pacote de verdade.
//
// Descartada a alternativa de ativar a condicao `react-server` no Vitest: ela
// mudaria a resolucao de TODOS os pacotes com export react-server (React
// inclusive), afastando o ambiente de teste do de producao em vez de aproximar.
export {};
