# Human convenience shortcuts — agents should use the direct commands in AGENTS.md.
#
# These delegate to the `album` CLI, which is the front door. The granular npm
# scripts in src/package.json remain the implementation layer beneath it.
.PHONY: dev build deploy doctor init lint test test-e2e test-index index publish

dev:
	./album dev

build:
	./album generate

deploy:
	./album deploy

doctor:
	./album doctor --indexing

init:
	./album init

index:
	./album index

publish:
	./album publish

lint:
	cd src && npm run lint

test:
	cd src && npx jest

test-e2e:
	cd src && npm run test:e2e

test-index:
	cd index && ./do-test-index.sh
