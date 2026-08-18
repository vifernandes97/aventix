# ---- deps: instala dependências isoladas (cache de camada) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compila o Next em modo standalone ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: imagem final, enxuta, sem ferramentas de build ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=America/Sao_Paulo

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrations aplicadas no boot por instrumentation.ts (CLAUDE.md secoes 2 e 14).
# O trace do Next standalone NAO carrega a pasta drizzle/ (os .sql ficariam de
# fora, medido na investigacao), entao ela e copiada explicitamente. Precisa vir
# com os quatro .sql E o meta/_journal.json — o journal e o que o migrator le
# para saber o que ja rodou.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]