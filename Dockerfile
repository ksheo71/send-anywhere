# build stage
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY web ./web
RUN npm run build   # dist/ (server) + web/dist (frontend)

# runtime stage
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# better-sqlite3는 네이티브 모듈이라 여기서 npm ci --omit=dev 시 재빌드된다.
# slim 이미지에는 빌드 툴이 없으므로 먼저 설치한다.
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
EXPOSE 4500
CMD ["node", "dist/server.js"]
