FROM node:20-slim

# Create app directory and use a non-root user
WORKDIR /home/node/app
RUN chown node:node /home/node/app

# Copy package files first to leverage Docker cache and enable deterministic installs
COPY --chown=node:node package.json package-lock.json ./

ENV NODE_ENV=production
ENV PORT=8000

# Install only production dependencies, deterministic install using npm ci
RUN npm ci --omit=dev --no-audit --no-fund

# Copy application source
COPY --chown=node:node . .

# Use non-root user
USER node

# Expose the port the app binds to and ensure server listens on 0.0.0.0 (app uses PORT env)
EXPOSE 8000

CMD ["node", "server.js"]
