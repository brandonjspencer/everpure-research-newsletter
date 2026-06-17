# Everpure Research Newsletter Builder — dev workflow entry points.
# `make check` runs the same gates as CI; `make fmt` auto-fixes formatting.

VENV ?= .venv
PY   := $(VENV)/bin/python
PIP  := $(VENV)/bin/pip
RUFF := $(VENV)/bin/ruff
PYRIGHT := $(VENV)/bin/pyright

.PHONY: help install-dev fmt check check-py check-js lint typecheck test build

help:
	@echo "make install-dev   Install Python + Node dev tooling"
	@echo "make check         Run all gates (lint + typecheck + tests, Python & JS)"
	@echo "make fmt           Auto-format and auto-fix (ruff + prettier + eslint)"
	@echo "make build         Run the full static-site build (netlify/build.sh)"

install-dev:
	$(PIP) install -r requirements.txt
	$(PIP) install -r requirements-dev.txt
	npm install
	$(VENV)/bin/pre-commit install

fmt:
	$(RUFF) format .
	$(RUFF) check --fix .
	npm run format
	npm run lint:fix

check: check-py check-js

check-py:
	$(RUFF) check .
	$(RUFF) format --check .
	$(PYRIGHT)
	$(PY) -m pytest

check-js:
	npm run lint
	npm run format:check
	npm run typecheck
	npm test

build:
	bash netlify/build.sh
