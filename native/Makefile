BUILD_DIR ?= build-portable
CMAKE ?= cmake
CTEST ?= ctest

.PHONY: test clean

test:
	$(CMAKE) -S . -B $(BUILD_DIR) -DCMAKE_BUILD_TYPE=Release
	$(CMAKE) --build $(BUILD_DIR) --config Release --parallel
	$(CTEST) --test-dir $(BUILD_DIR) -C Release --output-on-failure

clean:
	$(CMAKE) -E remove_directory $(BUILD_DIR)
