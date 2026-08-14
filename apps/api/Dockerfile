FROM node:20-alpine

ARG RELEASE_GIT_SHA
LABEL org.opencontainers.image.revision=$RELEASE_GIT_SHA

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @ipeasy/db generate
RUN pnpm --filter @ipeasy/api... build

WORKDIR /app/apps/api

ENV NODE_ENV=production
ENV RELEASE_GIT_SHA=$RELEASE_GIT_SHA
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/main"]
