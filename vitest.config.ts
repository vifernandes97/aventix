import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Espelha o alias `@/*` do tsconfig, para os testes importarem do mesmo jeito
  // que o codigo de producao.
  resolve: {
    alias: { '@': path.resolve(process.cwd()) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Carrega .env (DATABASE_URL) antes de qualquer teste.
    setupFiles: ['tests/setup.ts'],
  },
});
