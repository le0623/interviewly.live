# Use Node.js 20 LTS as base image
FROM node:20-slim

# Install ffmpeg and required dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy application files
COPY . .

# Build Next.js application
RUN npm run build

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST_NAME=0.0.0.0

# Start the application
CMD ["npm", "start"]
