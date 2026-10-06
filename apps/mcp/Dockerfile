FROM node:24-alpine
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/mcp/package.json apps/mcp/
COPY apps/core-mock/package.json apps/core-mock/
COPY data/package.json data/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --prod --filter @fintech-agent/mcp...
COPY packages/contracts/src packages/contracts/src
COPY apps/mcp/src apps/mcp/src
USER node
WORKDIR /repo/apps/mcp
EXPOSE 3020
CMD ["node", "--import", "tsx", "src/main.ts"]
