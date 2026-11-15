# Copyright (c) 2026 Christopher Guindon
#
# This program and the accompanying materials are made available
# under the terms of the Eclipse Public License 2.0,
# which is available at https://www.eclipse.org/legal/epl-2.0/.
#
# SPDX-License-Identifier: EPL-2.0

# Shortcuts for common tasks. Everything here is also available through npm (see package.json), so
# `make` is optional: Windows users can run the npm commands shown in each target.
#
# Releases (maintainers), in two steps that fit squash-merged pull requests:
#   make release-status
#   make release-prepare VERSION=0.2.0   checks, sets the version, rolls the changelog, runs the full
#                                        release check, opens a "chore(release): 0.2.0" pull request
#   make release-publish VERSION=0.2.0   after merging it: tags, builds the artefacts, creates the
#                                        GitHub release (asks before anything permanent)
# Add DRY_RUN=1 to see every step without changing anything, or YES=1 to skip the questions.
# See docs/development/releasing.md.

.PHONY: help install dev test ci build release-status release-check release-prepare release-publish

RELEASE_FLAGS := $(if $(DRY_RUN),--dry-run,) $(if $(YES),--yes,)

help:
	@sed -n 's/^#   make /  make /p; s/^#                                        /                                        /p' Makefile
	@echo "  make install | dev | test | ci | build"

install:          ## npm ci && npm run lint:setup
	npm ci
	npm run lint:setup

dev:              ## npm run dev
	npm run dev

test:             ## npm test
	npm test

ci:               ## npm run ci
	npm run ci

build:            ## npm run build
	npm run build

release-status:   ## npm run release -- status
	node scripts/release.mjs status

release-check:    ## npm run release:check
	npm run release:check

release-prepare:  ## npm run release -- prepare <version>
	@test -n "$(VERSION)" || (echo "usage: make release-prepare VERSION=x.y.z" && exit 2)
	node scripts/release.mjs prepare $(VERSION) $(RELEASE_FLAGS)

release-publish:  ## npm run release -- publish <version>
	@test -n "$(VERSION)" || (echo "usage: make release-publish VERSION=x.y.z" && exit 2)
	node scripts/release.mjs publish $(VERSION) $(RELEASE_FLAGS)
