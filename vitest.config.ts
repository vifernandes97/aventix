import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Espelha o alias `@/*` do tsconfig, para os testes importarem do mesmo
      // jeito que o codigo de producao.
      '@': path.resolve(process.cwd()),
      // `server-only` lanca em Node puro; o stub o neutraliza SO em teste.
      // Ver tests/stubs/server-only.ts para o porque disto nao ser um contorno.
      'server-only': path.resolve(process.cwd(), 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Roda UMA vez por rodada, antes de tudo: migra e semeia o banco. E o que
    // faz `npm test` funcionar a partir de um banco vazio, sem `db:seed` manual.
    globalSetup: ['tests/global-setup.ts'],
    // Carrega .env (DATABASE_URL) antes de cada arquivo de teste.
    setupFiles: ['tests/setup.ts'],
    // OBRIGATORIO: todos os arquivos de teste compartilham o MESMO Postgres e
    // limpam as tabelas de movimento em beforeEach. Rodando em paralelo, um
    // arquivo apagaria as linhas que o outro acabou de criar. Dentro de cada
    // arquivo o Vitest ja roda os testes em sequencia.
    fileParallelism: false,
    // Corridas reais e esperas de commit sao mais lentas que teste unitario.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
