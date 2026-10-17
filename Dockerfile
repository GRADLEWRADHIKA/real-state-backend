# EstateFlow API. Build from this folder:  docker build -t estateflow-api .
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared shared
RUN npm ci --omit=dev --no-audit --no-fund
COPY src src
COPY assets assets
COPY tsconfig.json ./
# SQLite database + uploaded documents live here: mount a persistent volume at /data.
ENV DATABASE_FILE=/data/estateflow.db \
    DEMO_DATABASE_FILE=/data/estateflow-demo.db \
    UPLOAD_DIR=/data/uploads \
    PORT=7341
VOLUME ["/data"]
EXPOSE 7341
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7341)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# tsx runs the TypeScript sources directly (no build step); SIGTERM triggers a graceful shutdown.
CMD ["node", "--import", "tsx", "src/index.ts"]
