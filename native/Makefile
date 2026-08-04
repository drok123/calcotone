CXX ?= c++
CXXFLAGS ?= -std=c++20 -O3 -Wall -Wextra -Wpedantic -Werror
INCLUDES = -Iinclude

.PHONY: test clean
test: build/stack_amp_test build/native_rack_test build/pitch_tracker_test build/native_processor_test build/audio_device_config_test build/elastic_stereo_fifo_test
	./build/stack_amp_test
	./build/native_rack_test
	./build/pitch_tracker_test
	./build/native_processor_test
	./build/audio_device_config_test
	./build/elastic_stereo_fifo_test

build/stack_amp_test: src/stack_amp.cpp tests/stack_amp_test.cpp include/calcotone/stack_amp.hpp include/calcotone/input_router.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) $(INCLUDES) src/stack_amp.cpp tests/stack_amp_test.cpp -o $@

build/native_rack_test: src/native_rack.cpp tests/native_rack_test.cpp include/calcotone/native_rack.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) $(INCLUDES) src/native_rack.cpp tests/native_rack_test.cpp -o $@

build/pitch_tracker_test: tests/pitch_tracker_test.cpp include/calcotone/pitch_tracker.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) $(INCLUDES) tests/pitch_tracker_test.cpp -o $@

build/native_processor_test: src/stack_amp.cpp src/native_rack.cpp src/native_processor.cpp tests/native_processor_test.cpp include/calcotone/native_processor.hpp include/calcotone/input_router.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) $(INCLUDES) src/stack_amp.cpp src/native_rack.cpp src/native_processor.cpp tests/native_processor_test.cpp -o $@

build/audio_device_config_test: src/audio_device_config.cpp tests/audio_device_config_test.cpp include/calcotone/audio_device_config.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) $(INCLUDES) src/audio_device_config.cpp tests/audio_device_config_test.cpp -o $@

build/elastic_stereo_fifo_test: src/elastic_stereo_fifo.cpp tests/elastic_stereo_fifo_test.cpp include/calcotone/elastic_stereo_fifo.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) $(INCLUDES) src/elastic_stereo_fifo.cpp tests/elastic_stereo_fifo_test.cpp -o $@

clean:
	rm -f build/stack_amp_test build/native_rack_test build/pitch_tracker_test build/native_processor_test build/audio_device_config_test build/elastic_stereo_fifo_test
