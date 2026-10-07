FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY shared/package.json server/package.json worker/package.json client/package.json ./
# Render may set NODE_ENV=production during the image build. The typecheck
# step needs the workspace's dev dependencies (TypeScript and tsx), so install
# them explicitly rather than relying on npm's environment-sensitive default.
RUN npm ci --include=dev
COPY . .
RUN npm run typecheck
EXPOSE 3000
CMD ["node","--import","tsx","server/src/index.ts"]
