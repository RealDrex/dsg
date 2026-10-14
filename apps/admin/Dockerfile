# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/admin/Dockerfile --build-arg VITE_API_URL=https://api.example.com -t bestprice-admin .
FROM node:22-alpine AS build
WORKDIR /repo
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/admin/package.json apps/admin/
RUN npm ci --workspace=@bestprice/admin --workspace=@bestprice/core --include-workspace-root --ignore-scripts
COPY packages/core packages/core
COPY apps/admin apps/admin
RUN npm run build -w @bestprice/admin

FROM nginx:1.27-alpine
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
