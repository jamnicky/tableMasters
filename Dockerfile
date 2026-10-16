# Stage 1: Build the React/Vite app
FROM node:18-alpine AS builder
WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Serve static assets with Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
