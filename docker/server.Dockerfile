# syntax=docker/dockerfile:1

# ---------- 构建阶段 ----------
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /app

# 先拷贝清单文件，利用缓存安装依赖
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/server apps/server

RUN pnpm --filter @lunar/shared build \
 && pnpm --filter @lunar/server exec prisma generate \
 && pnpm --filter @lunar/server build

# ---------- 运行阶段 ----------
FROM node:20-alpine AS runner
ENV NODE_ENV=production
# Prisma 在 alpine 上依赖 openssl
RUN apk add --no-cache openssl
WORKDIR /app

# 直接复制整个工作区，保留 pnpm 的符号链接结构
COPY --from=builder /app ./
COPY docker/server-entrypoint.sh /usr/local/bin/server-entrypoint.sh
RUN chmod +x /usr/local/bin/server-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/server-entrypoint.sh"]
CMD ["node", "dist/main.js"]
