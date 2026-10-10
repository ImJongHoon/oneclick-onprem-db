FROM node:20-bookworm-slim

# Create app user and directory
ENV NODE_ENV=production \
    PORT=8000
WORKDIR /app

# Create non-root user
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --shell /usr/sbin/nologin --create-home app

# Install dependencies deterministically using package-lock.json
# Copy manifest files first to leverage layer caching
COPY --chown=app:app package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source
COPY --chown=app:app . .

# Use non-root user
USER app

# Expose the application's port and run
EXPOSE 8000
CMD ["node", "server.js"]
