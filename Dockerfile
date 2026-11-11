FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
FROM golang:1.24-alpine AS backend
RUN apk add --no-cache gcc musl-dev
WORKDIR /app/backend
COPY backend/go.* ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=1 go build -o /app/kitchen ./cmd/server
FROM alpine:3.21
RUN apk add --no-cache ca-certificates wget && adduser -D -u 10001 kitchen
WORKDIR /app
COPY --from=backend /app/kitchen ./kitchen
COPY --from=frontend /app/frontend/dist ./public
RUN mkdir -p /app/data/uploads && chown -R kitchen:kitchen /app/data
USER kitchen
EXPOSE 8080
ENTRYPOINT ["/app/kitchen", "-config", "/app/config.yaml"]
