FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY shared/package.json server/package.json worker/package.json client/package.json ./
RUN npm ci
COPY . .
RUN npm run typecheck
EXPOSE 3000
CMD ["node","--import","tsx","server/src/index.ts"]
