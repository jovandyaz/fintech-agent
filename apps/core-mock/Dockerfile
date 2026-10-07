FROM node:24-alpine
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/core-mock/package.json apps/core-mock/
COPY data/package.json data/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --prod --filter @fintech-agent/core-mock...
COPY packages/contracts/src packages/contracts/src
COPY data/customers.json data/transactions.json data/
COPY apps/core-mock/src apps/core-mock/src
RUN mkdir -p /var/lib/core-mock && chown node:node /var/lib/core-mock
USER node
WORKDIR /repo/apps/core-mock
ENV DATA_DIR=/repo/data
EXPOSE 3010
CMD ["node", "--import", "tsx", "src/main.ts"]
