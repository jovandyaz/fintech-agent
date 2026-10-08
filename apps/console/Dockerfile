FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/console/package.json apps/console/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter @fintech-agent/console...
COPY packages/contracts/src packages/contracts/src
COPY apps/console apps/console
RUN pnpm --filter @fintech-agent/console build

FROM nginxinc/nginx-unprivileged:1.30-alpine
COPY apps/console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/console/dist /usr/share/nginx/html
EXPOSE 8080
