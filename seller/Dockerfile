# SpendSeal seller API — production image (Fly.io / Render / any Docker host)
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
# Puppeteer downloads its pinned Chrome into the image at build time.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npx puppeteer browsers install chrome --install-deps \
 && npm cache clean --force

COPY src ./src

# The seller keeps issued invoices in memory only — run exactly ONE instance.
EXPOSE 8787
CMD ["node", "src/server.js"]
