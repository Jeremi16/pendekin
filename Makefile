dev-api:
	cd backend && go run .

dev-web:
	cd frontend && bun run dev

dev:
	@echo "Run dev-api and dev-web in two terminals"

build-web:
	cd frontend && bun run build

build-api:
	cd backend && go build -o ../tmp/server ./main.go

lint-web:
	cd frontend && bun run lint
