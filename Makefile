.PHONY: build clean

# Extra flags passed to packages/opencode/script/build.ts (e.g. --skip-embed-web-ui)
BUILD_FLAGS ?=

# Compile a standalone opencode binary for the current platform and copy it to ./bin/opencode
build:
	bun run --cwd packages/opencode build -- --single $(BUILD_FLAGS)
	mkdir -p bin
	cp "$$(find packages/opencode/dist -path '*/bin/opencode' -type f | head -1)" bin/opencode
	chmod +x bin/opencode
	@echo "Built ./bin/opencode"

clean:
	rm -rf bin/opencode packages/opencode/dist
