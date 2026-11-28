# Production-capable Node.js image; runtime validation is performed by backend-compose-acceptance.yml.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY migrations ./migrations
RUN mkdir -p /var/lib/inone/files && chown -R node:node /var/lib/inone
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/readyz || exit 1
CMD ["node", "src/main.js"]
