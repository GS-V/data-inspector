# ─── Stage 1: Build ───────────────────────────────────────────────────────────
# Use Node 20 Alpine (lightweight) to compile the React/TypeScript source.
# Alpine images are ~5MB vs ~900MB for full Debian-based Node images.
FROM node:20-alpine AS builder

# Set working directory inside the container
WORKDIR /app

# Copy dependency manifests first (separate layer from source).
# Docker caches layers — if package.json hasn't changed, npm install
# is skipped on rebuild, making subsequent builds much faster.
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies needed for the build)
RUN npm ci

# Copy the rest of the source code
COPY . .

# Build the production bundle — produces /app/dist/
RUN npm run build

# ─── Stage 2: Serve ───────────────────────────────────────────────────────────
# Use Nginx Alpine to serve the static files.
# The final image contains ONLY Nginx + the built files (~25MB total).
# Node is not present at runtime — nothing to maintain or patch.
FROM nginx:1.27-alpine AS production

# Copy our custom Nginx config (handles SPA client-side routing)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the compiled app from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx listens on 80 by default; expose it for documentation
EXPOSE 80

# Nginx starts automatically as the container entrypoint
CMD ["nginx", "-g", "daemon off;"]
