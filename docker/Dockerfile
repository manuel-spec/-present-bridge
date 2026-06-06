# syntax=docker/dockerfile:1

# Production / local Docker Compose image.
# Cursor Cloud agents use the repo-root Dockerfile (or .cursor/Dockerfile) instead.

FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip build-essential \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf python3 /usr/bin/python
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/core/package.json ./apps/core/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tsconfig/package.json ./packages/tsconfig/
RUN pnpm install --frozen-lockfile

FROM deps AS development
COPY . .
ENV DOCKER=1
EXPOSE 3000
EXPOSE 40000-49999/tcp
EXPOSE 40000-49999/udp
CMD ["pnpm", "run", "dev:docker"]

FROM deps AS test
COPY . .
RUN pnpm run lint
RUN pnpm run test:coverage

FROM deps AS build
COPY . .
ENV DOCKER=1
RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM base AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/apps/core/dist ./apps/core/dist
COPY --from=build /app/apps/core/package.json ./apps/core/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
EXPOSE 3000
EXPOSE 40000-49999/tcp
EXPOSE 40000-49999/udp
CMD ["node", "apps/core/dist/index.js"]
