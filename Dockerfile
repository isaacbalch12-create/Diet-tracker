# Self-hosted image using the embedded database (mount /app/data to persist it).
# Set DATABASE_URL instead to use an external PostgreSQL.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PGLITE_DIR=/app/data/pglite PORT=3000
COPY --from=build /app ./
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
