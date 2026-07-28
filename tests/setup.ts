// Carrega DATABASE_URL do .env antes dos testes (Vitest nao le .env sozinho).
import 'dotenv/config';

import { afterAll } from 'vitest';

import { wipeMovement } from './helpers/db';

// setupFiles roda no MESMO contexto de cada arquivo de teste, entao registrar o
// hook aqui vale para todos, num lugar so.
//
// O `beforeEach` de cada arquivo garante que o teste COMECE limpo (inclusive se
// a rodada anterior morreu no meio). Este afterAll garante que a suite TERMINE
// limpa, sem deixar o rastro do ultimo teste no banco de desenvolvimento.
afterAll(wipeMovement);
