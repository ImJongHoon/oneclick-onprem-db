FROM node:20-bookworm-slim

# Set working directory
WORKDIR /usr/src/app

# Use production Node env
ENV NODE_ENV=production
ENV PORT=8000

# Copy dependency manifests first for deterministic installs
COPY package.json package-lock.json ./

# Install production dependencies deterministically
RUN npm ci --omit=dev --prefer-offline --no-audit

# Copy application source
COPY --chown=node:node . .

# Use non-root user provided by official image when possible
USER node

# Expose the port the app listens on
EXPOSE 8000

# Start the app
CMD ["node", "server.js"]
