CXX ?= c++
CXXFLAGS ?= -std=c++20 -O3 -Wall -Wextra -Wpedantic -Werror
INCLUDES = -Iinclude

.PHONY: test clean
test: build/stack_amp_test build/native_rack_test
	./build/stack_amp_test
	./build/native_rack_test

build/stack_amp_test: src/stack_amp.cpp tests/stack_amp_test.cpp include/calcotone/stack_amp.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) $(INCLUDES) src/stack_amp.cpp tests/stack_amp_test.cpp -o $@

build/native_rack_test: src/native_rack.cpp tests/native_rack_test.cpp include/calcotone/native_rack.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) $(INCLUDES) src/native_rack.cpp tests/native_rack_test.cpp -o $@

clean:
	rm -f build/stack_amp_test build/native_rack_test
