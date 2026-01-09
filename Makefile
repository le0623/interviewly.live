.PHONY: help build up down restart logs ps shell-app shell-nginx clean

# Default target
help:
	@echo "Available commands:"
	@echo "  make build      - Build Docker images"
	@echo "  make up         - Start all services"
	@echo "  make down       - Stop all services"
	@echo "  make restart    - Restart all services"
	@echo "  make logs       - Show logs from all services"
	@echo "  make logs-app   - Show logs from app service"
	@echo "  make logs-nginx - Show logs from nginx service"
	@echo "  make ps         - Show running containers"
	@echo "  make shell-app  - Open shell in app container"
	@echo "  make shell-nginx - Open shell in nginx container"
	@echo "  make clean      - Stop services and remove containers, networks, and volumes"
	@echo "  make rebuild    - Rebuild and restart services"

# Build Docker images
build:
	docker-compose build

# Start all services
up:
	docker-compose up -d

# Start services and show logs
up-logs:
	docker-compose up

# Stop all services
down:
	docker-compose down

# Restart all services
restart:
	docker-compose restart

# Show logs from all services
logs:
	docker-compose logs -f

# Show logs from app service
logs-app:
	docker-compose logs -f app

# Show logs from nginx service
logs-nginx:
	docker-compose logs -f nginx

# Show running containers
ps:
	docker-compose ps

# Open shell in app container
shell-app:
	docker-compose exec app /bin/bash

# Open shell in nginx container
shell-nginx:
	docker-compose exec nginx /bin/sh

# Clean up: stop services and remove containers, networks, and volumes
clean:
	docker-compose down -v
	docker-compose rm -f

# Rebuild and restart services
rebuild:
	docker-compose down
	docker-compose build --no-cache
	docker-compose up -d

# Stop services
stop:
	docker-compose stop

# Start stopped services
start:
	docker-compose start
