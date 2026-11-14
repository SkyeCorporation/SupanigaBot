# Supaniga MX's — Penguin 1.0.0 Pro
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/session", "/app/database"]
CMD ["node", "index.js"]
