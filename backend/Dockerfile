# syntax=docker/dockerfile:1

# ---- Build stage: compile TypeScript to dist/ ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: production deps + compiled output ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled server + the SQL migrations (migrate.js resolves ../../migrations).
COPY --from=build /app/dist ./dist
COPY migrations ./migrations

EXPOSE 5000
# Run pending migrations, then start the server.
CMD ["sh", "-c", "npm run db:migrate:prod && node dist/server.js"]
