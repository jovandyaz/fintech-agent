FROM node:24-alpine
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --prod --filter @fintech-agent/api...
COPY packages/contracts/src packages/contracts/src
COPY apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
COPY apps/api/drizzle apps/api/drizzle
COPY data/bank-holidays.json data/
COPY data/policies data/policies
USER node
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/main.ts"]
