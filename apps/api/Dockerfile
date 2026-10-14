# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/api/Dockerfile -t bestprice-api .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace=@bestprice/api --workspace=@bestprice/core --include-workspace-root --ignore-scripts
COPY packages/core packages/core
COPY apps/api apps/api
RUN npm run build -w @bestprice/api

FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace=@bestprice/api --omit=dev --ignore-scripts

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY apps/api/package.json ./package.json
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/server.js"]
