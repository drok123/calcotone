cmake_minimum_required(VERSION 3.24)
project(calcotone_native LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Python3 COMPONENTS Interpreter REQUIRED)
set(CALCOTONE_GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
set(CALCOTONE_GENERATED_NATIVE_RACK "${CALCOTONE_GENERATED_DIR}/native_rack.cpp")
file(MAKE_DIRECTORY "${CALCOTONE_GENERATED_DIR}")
execute_process(
  COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tools/apply_atmos_parity.py"
          "${CMAKE_CURRENT_SOURCE_DIR}/src/native_rack.cpp"
          "${CALCOTONE_GENERATED_NATIVE_RACK}"
  RESULT_VARIABLE CALCOTONE_PARITY_PATCH_RESULT
  OUTPUT_VARIABLE CALCOTONE_PARITY_PATCH_OUTPUT
  ERROR_VARIABLE CALCOTONE_PARITY_PATCH_ERROR
)
if(NOT CALCOTONE_PARITY_PATCH_RESULT EQUAL 0)
  message(FATAL_ERROR "Failed to generate live parity rack: ${CALCOTONE_PARITY_PATCH_ERROR}")
endif()
message(STATUS "${CALCOTONE_PARITY_PATCH_OUTPUT}")

add_library(calcotone_dsp STATIC
  src/stack_amp.cpp
  "${CALCOTONE_GENERATED_NATIVE_RACK}"
  src/atmos_parity_processor.cpp
  src/ember_parity_processor.cpp
  src/drift_parity_processor.cpp
  src/halo_parity_processor.cpp
  src/artifact_chain_processor.cpp
  src/native_processor.cpp
  src/audio_device_config.cpp
  src/elastic_stereo_fifo.cpp
)
target_include_directories(calcotone_dsp PUBLIC include)

add_executable(stack_amp_test tests/stack_amp_test.cpp)
target_link_libraries(stack_amp_test PRIVATE calcotone_dsp)
add_executable(native_rack_test tests/native_rack_test.cpp)
target_link_libraries(native_rack_test PRIVATE calcotone_dsp)
add_executable(pitch_tracker_test tests/pitch_tracker_test.cpp)
target_link_libraries(pitch_tracker_test PRIVATE calcotone_dsp)
add_executable(native_processor_test tests/native_processor_test.cpp)
target_link_libraries(native_processor_test PRIVATE calcotone_dsp)
add_executable(audio_device_config_test tests/audio_device_config_test.cpp)
target_link_libraries(audio_device_config_test PRIVATE calcotone_dsp)
add_executable(elastic_stereo_fifo_test tests/elastic_stereo_fifo_test.cpp)
target_link_libraries(elastic_stereo_fifo_test PRIVATE calcotone_dsp)
add_executable(atmos_parity_profile_test tests/atmos_parity_profile_test.cpp)
target_link_libraries(atmos_parity_profile_test PRIVATE calcotone_dsp)
add_executable(atmos_parity_processor_test tests/atmos_parity_processor_test.cpp)
target_link_libraries(atmos_parity_processor_test PRIVATE calcotone_dsp)
add_executable(native_atmos_live_parity_test tests/native_atmos_live_parity_test.cpp)
target_link_libraries(native_atmos_live_parity_test PRIVATE calcotone_dsp)
add_executable(ember_parity_profile_test tests/ember_parity_profile_test.cpp)
target_link_libraries(ember_parity_profile_test PRIVATE calcotone_dsp)
add_executable(ember_parity_processor_test tests/ember_parity_processor_test.cpp)
target_link_libraries(ember_parity_processor_test PRIVATE calcotone_dsp)
add_executable(native_ember_live_parity_test tests/native_ember_live_parity_test.cpp)
target_link_libraries(native_ember_live_parity_test PRIVATE calcotone_dsp)
add_executable(drift_parity_processor_test tests/drift_parity_processor_test.cpp)
target_link_libraries(drift_parity_processor_test PRIVATE calcotone_dsp)
add_executable(halo_parity_processor_test tests/halo_parity_processor_test.cpp)
target_link_libraries(halo_parity_processor_test PRIVATE calcotone_dsp)
add_executable(artifact_chain_profile_test tests/artifact_chain_profile_test.cpp)
target_link_libraries(artifact_chain_profile_test PRIVATE calcotone_dsp)
add_executable(artifact_chain_processor_test tests/artifact_chain_processor_test.cpp)
target_link_libraries(artifact_chain_processor_test PRIVATE calcotone_dsp)
add_executable(native_artifact_chain_live_test tests/native_artifact_chain_live_test.cpp)
target_link_libraries(native_artifact_chain_live_test PRIVATE calcotone_dsp)

enable_testing()
add_test(NAME stack_amp_test COMMAND stack_amp_test)
add_test(NAME native_rack_test COMMAND native_rack_test)
add_test(NAME pitch_tracker_test COMMAND pitch_tracker_test)
add_test(NAME native_processor_test COMMAND native_processor_test)
add_test(NAME audio_device_config_test COMMAND audio_device_config_test)
add_test(NAME elastic_stereo_fifo_test COMMAND elastic_stereo_fifo_test)
add_test(NAME atmos_parity_profile_test COMMAND atmos_parity_profile_test)
add_test(NAME atmos_parity_processor_test COMMAND atmos_parity_processor_test)
add_test(NAME native_atmos_live_parity_test COMMAND native_atmos_live_parity_test)
add_test(NAME ember_parity_profile_test COMMAND ember_parity_profile_test)
add_test(NAME ember_parity_processor_test COMMAND ember_parity_processor_test)
add_test(NAME native_ember_live_parity_test COMMAND native_ember_live_parity_test)
add_test(NAME drift_parity_processor_test COMMAND drift_parity_processor_test)
add_test(NAME halo_parity_processor_test COMMAND halo_parity_processor_test)
add_test(NAME artifact_chain_profile_test COMMAND artifact_chain_profile_test)
add_test(NAME artifact_chain_processor_test COMMAND artifact_chain_processor_test)
add_test(NAME native_artifact_chain_live_test COMMAND native_artifact_chain_live_test)

if(WIN32)
  set(CALCOTONE_WEBVIEW2_ROOT "" CACHE PATH "Extracted Microsoft.Web.WebView2 NuGet package")
  if(NOT CALCOTONE_WEBVIEW2_ROOT)
    file(GLOB WEBVIEW2_PACKAGE_CANDIDATES
      "${CMAKE_CURRENT_SOURCE_DIR}/packages/Microsoft.Web.WebView2.*")
    list(SORT WEBVIEW2_PACKAGE_CANDIDATES COMPARE NATURAL ORDER DESCENDING)
    if(WEBVIEW2_PACKAGE_CANDIDATES)
      list(GET WEBVIEW2_PACKAGE_CANDIDATES 0 CALCOTONE_WEBVIEW2_ROOT)
    endif()
  endif()
  set(WEBVIEW2_INCLUDE "${CALCOTONE_WEBVIEW2_ROOT}/build/native/include")
  set(WEBVIEW2_LOADER "${CALCOTONE_WEBVIEW2_ROOT}/build/native/x64/WebView2LoaderStatic.lib")
  if(NOT EXISTS "${WEBVIEW2_INCLUDE}/WebView2.h" OR NOT EXISTS "${WEBVIEW2_LOADER}")
    message(FATAL_ERROR "Microsoft.Web.WebView2 is missing. Restore the pinned NuGet package into native/packages first.")
  endif()
  add_executable(calcotone_host src/wasapi_host.cpp src/control_server.cpp src/desktop_shell.cpp src/ks_wavert_probe.cpp)
  target_include_directories(calcotone_host PRIVATE "${WEBVIEW2_INCLUDE}")
  target_link_libraries(calcotone_host PRIVATE calcotone_dsp ole32 avrt uuid ws2_32 shell32 version setupapi "${WEBVIEW2_LOADER}")
endif()
