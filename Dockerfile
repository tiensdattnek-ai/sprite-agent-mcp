# sprite-agent-mcp — tiny, dependency-light runtime image.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY scripts/generate-manifest.mjs ./scripts/
COPY README.md README.en.md AGENTS.md POLICY.md LICENSE CHANGELOG.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md mcp.json server.json ./
RUN npm run build

FROM node:20-alpine
ENV NODE_ENV=production SPRITE_OUTPUT_DIR=/out
WORKDIR /app
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/integrity ./integrity
COPY LICENSE README.md POLICY.md AGENTS.md ./
VOLUME ["/out"]
# stdio is the default; use `--http` for Streamable HTTP.
EXPOSE 3100
ENTRYPOINT ["node", "dist/index.js"]
