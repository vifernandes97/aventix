// PASSO 0 — o unico objetivo deste teste e provar que o import da cadeia de
// producao (que atravessa lib/tenant.ts, com `import 'server-only'`) resolve
// dentro do Vitest.
import { expect, it } from 'vitest';

import { getAvailability } from '@/lib/availability';

it('importa lib/availability sem lancar', () => {
  expect(typeof getAvailability).toBe('function');
  expect(true).toBe(true);
});
