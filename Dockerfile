# Production Dockerfile for Google Cloud Run
FROM node:20-slim

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --include=dev || npm install

# Copy application source
COPY . .

# Build client assets for production
RUN npm run build

# Expose port (Cloud Run overrides PORT at runtime)
EXPOSE 3000

# Start server using tsx
CMD ["npm", "start"]
