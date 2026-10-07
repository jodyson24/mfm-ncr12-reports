FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY shared/package.json ./shared/package.json
COPY server/package.json ./server/package.json
COPY worker/package.json ./worker/package.json
COPY client/package.json ./client/package.json
# Render may set NODE_ENV=production during the image build. The typecheck
# step needs the workspace's dev dependencies (TypeScript and tsx), so install
# them explicitly rather than relying on npm's environment-sensitive default.
RUN npm ci --include=dev
COPY . .
RUN npm run typecheck
RUN npm run build
EXPOSE 3000
CMD ["node","--import","tsx","server/src/index.ts"]
