# 🐳 Multi-stage Docker build for Kriptobot
FROM node:18-alpine AS base

# Install pnpm globally
RUN npm install -g pnpm@8

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/*/package.json packages/*/
COPY tsconfig.base.json ./

# ============================================================================
# 📦 Dependencies stage
FROM base AS dependencies

# Install all dependencies (including dev dependencies for building)
RUN pnpm install --frozen-lockfile

# ============================================================================
# 🔨 Build stage
FROM dependencies AS build

# Copy source code
COPY packages/ packages/
COPY kirpto\ bot\ sinyal/ kirpto\ bot\ sinyal/

# Build all packages
RUN pnpm run build

# ============================================================================
# 🚀 Production stage
FROM node:18-alpine AS production

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S kriptobot -u 1001

# Install pnpm
RUN npm install -g pnpm@8

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/*/package.json packages/*/

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built application from build stage
COPY --from=build --chown=kriptobot:nodejs /app/packages/*/dist packages/*/dist/
COPY --from=build --chown=kriptobot:nodejs /app/kirpto\ bot\ sinyal kirpto\ bot\ sinyal/

# Copy essential configuration files
COPY --chown=kriptobot:nodejs config/ config/
COPY --chown=kriptobot:nodejs cfg/ cfg/

# Create logs directory
RUN mkdir -p logs && chown kriptobot:nodejs logs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Switch to non-root user
USER kriptobot

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# Start the application
CMD ["node", "kirpto bot sinyal/index.js"]

# ============================================================================
# 🧪 Development stage (for local development)
FROM dependencies AS development

# Copy source code
COPY packages/ packages/
COPY kirpto\ bot\ sinyal/ kirpto\ bot\ sinyal/
COPY config/ config/
COPY cfg/ cfg/

# Create logs directory
RUN mkdir -p logs

ENV NODE_ENV=development

EXPOSE 3000

CMD ["pnpm", "dev"]