FROM node:20-alpine AS builder
WORKDIR /app
# Root workspace manifest + lockfile
COPY package.json package-lock.json ./
# Copy all workspace package.json files (needed for npm ci to resolve all workspaces)
COPY packages/ ./packages/
COPY Gateway/package.json ./Gateway/package.json
COPY Alice/package.json ./Alice/package.json
COPY tenant-client/package.json ./tenant-client/package.json
COPY tests/package.json ./tests/package.json
# Install all workspace dependencies from lockfile
RUN npm ci --ignore-scripts
# Build shared-types first (Alice runtime depends on compiled JS)
RUN npm run build --workspace=packages/shared-types
# Copy full Alice source and build
COPY Alice/ ./Alice/
RUN npm run build --workspace=Alice

FROM node:20-alpine
RUN apk add --no-cache ffmpeg
# Set WORKDIR to mirror builder structure so Node.js finds both root and workspace node_modules
WORKDIR /app/Alice
COPY --from=builder /app/Alice/dist ./dist
COPY --from=builder /app/Alice/package.json .
# Root node_modules (hoisted shared packages)
COPY --from=builder /app/node_modules /app/node_modules
# Workspace-specific node_modules (not hoisted)
COPY --from=builder /app/Alice/node_modules ./node_modules
# shared-types compiled output (dereferenced from symlink)
COPY --from=builder /app/packages/shared-types/dist /app/packages/shared-types/dist
COPY --from=builder /app/packages/shared-types/package.json /app/packages/shared-types/package.json
# Copy agents/SOUL.md if it exists (required for persona system prompts)
COPY --from=builder /app/Alice/agents ./agents
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
