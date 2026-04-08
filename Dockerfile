# Next.js Standalone Production Dockerfile
# Optimized for smaller image size using standalone output

# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency files first (for better caching)
COPY package*.json ./
COPY .npmrc ./

# Install dependencies (mount NPM_TOKEN as a secret to avoid leaking into image layers)
RUN --mount=type=secret,id=NPM_TOKEN \
    NPM_TOKEN=$(cat /run/secrets/NPM_TOKEN) npm ci

# Copy source code
COPY . .

# Ensure public exists even if empty
RUN mkdir -p public

# Build arg for API URL (baked into client bundle at build time)
ARG NEXT_PUBLIC_MONITOR_API_URL
ENV NEXT_PUBLIC_MONITOR_API_URL=$NEXT_PUBLIC_MONITOR_API_URL

# Build the application with standalone output
RUN --mount=type=secret,id=MONITOR_API_KEY \
    MONITOR_API_KEY=$(cat /run/secrets/MONITOR_API_KEY) npm run build

# ---- Runtime Stage ----
FROM node:20-alpine AS runner

# Add curl for health checks
RUN apk add --no-cache curl && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy standalone output (much smaller than full node_modules)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Create cache directory and set permissions
RUN mkdir -p .next/cache && \
    chown -R nextjs:nodejs /app

USER nextjs

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Next.js standalone server
CMD ["node", "server.js"]
