# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
# npm ci installs exactly what package-lock.json pins, so a given commit always builds the same image
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- run ----
# The build is a single bundled file plus static assets: no node_modules needed at runtime.
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
