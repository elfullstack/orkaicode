.PHONY: build clean

# Optional enable flags for script/build.ts (e.g. --sourcemaps, --baseline).
# Embedded web UI is off by default; enable with EMBED_WEB_UI=1.
BUILD_FLAGS ?=
EMBED_WEB_UI ?=

SKIP_EMBED := $(if $(EMBED_WEB_UI),,--skip-embed-web-ui)

# Compile a standalone opencode binary for the current platform and copy it to ./bin/opencode
build:
	bun run --cwd packages/opencode build -- --single $(SKIP_EMBED) $(BUILD_FLAGS)
	mkdir -p bin
	cp "$$(find packages/opencode/dist -path '*/bin/opencode' -type f | head -1)" bin/opencode
	chmod +x bin/opencode
	@echo "Built ./bin/opencode"

clean:
	rm -rf bin/opencode packages/opencode/dist
