# Human convenience shortcuts — agents should use the direct commands in AGENTS.md.
.PHONY: dev build deploy lint test test-e2e test-index index publish

dev:
	cd src && npm run dev

build:
	cd src && npm run build

deploy:
	cd src && npm run deploy:vercel

lint:
	cd src && npm run lint

test:
	cd src && npx jest

test-e2e:
	cd src && npm run test:e2e

test-index:
	cd index && ./do-test-index.sh

index:
	cd index && ./do-full-index.sh

publish:
	cd src && npm run publish:wizard
