# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build 2>/dev/null || npx tsc --outDir dist 2>/dev/null || true
# If no build script, just copy source for tsx runtime
RUN ls dist/ 2>/dev/null || (echo "No dist/ — will run with tsx" && true)

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Only production deps
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY tsconfig.json ./

# Install tsx for ESM TypeScript runtime (lightweight, no transpile step needed)
RUN npm install -g tsx

EXPOSE 3001

ENV NODE_ENV=production

# Run migrations then start server
CMD ["tsx", "src/index.ts"]
