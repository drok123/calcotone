from pathlib import Path


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing {label}")
    return source.replace(old, new, 1)


path = Path("native/src/atmos_parity_processor.cpp")
source = path.read_text(encoding="utf-8")
source = replace_required(
    source,
    '#include "calcotone/atmos_parity_processor.hpp"\n#include "calcotone/atmos_parity_profiles.hpp"\n',
    '#include "calcotone/atmos_parity_processor.hpp"\n'
    '#include "calcotone/atmos_parity_profiles.hpp"\n'
    '#include "calcotone/atmos_lexicon224_converter.hpp"\n',
    "Lexicon converter include",
)
source = replace_required(
    source,
    "  AtmosNetwork(float rate, std::size_t model)\n"
    "      : rate_(rate), model_(std::min<std::size_t>(11U, model)) {\n",
    "  AtmosNetwork(float rate, std::size_t model)\n"
    "      : rate_(rate),\n"
    "        model_(std::min<std::size_t>(11U, model)),\n"
    "        lexicon_input_(rate_, Lexicon224ConverterRole::Input),\n"
    "        lexicon_output_(rate_, Lexicon224ConverterRole::Output) {\n",
    "Lexicon converter construction",
)
source = replace_required(
    source,
    "    early_bus_state_.fill(0.F); late_converter_state_.fill(0.F); compressor_state_.fill({});\n"
    "  }\n",
    "    early_bus_state_.fill(0.F); late_converter_state_.fill(0.F); compressor_state_.fill({});\n"
    "    lexicon_input_.reset();\n"
    "    lexicon_output_.reset();\n"
    "  }\n",
    "Lexicon converter reset",
)
source = replace_required(
    source,
    "    std::array<float, 2> converted{};\n"
    "    for (unsigned channel = 0; channel < 2; ++channel) {\n"
    "      converted[channel] = converter_texture(input[channel] * profile.input_trim, profile.converter_bits);\n"
    "    }\n",
    "    std::array<float, 2> converted{};\n"
    "    for (unsigned channel = 0; channel < 2; ++channel) {\n"
    "      converted[channel] = converter_texture(input[channel] * profile.input_trim, profile.converter_bits);\n"
    "    }\n"
    "    if (model_ == 11U) converted = lexicon_input_.process(converted[0], converted[1]);\n",
    "Lexicon input converter route",
)
source = replace_required(
    source,
    "    for (unsigned channel = 0; channel < 2; ++channel) {\n"
    "      late[channel] = one_pole(late[channel], late_converter_state_[channel],\n"
    "                               filter_coefficient(converter_cutoff, rate_));\n"
    "      late[channel] = converter_texture(late[channel], profile.converter_bits);\n"
    "    }\n\n"
    "    const float early_presence",
    "    for (unsigned channel = 0; channel < 2; ++channel) {\n"
    "      late[channel] = one_pole(late[channel], late_converter_state_[channel],\n"
    "                               filter_coefficient(converter_cutoff, rate_));\n"
    "      late[channel] = converter_texture(late[channel], profile.converter_bits);\n"
    "    }\n"
    "    if (model_ == 11U) late = lexicon_output_.process(late[0], late[1]);\n\n"
    "    const float early_presence",
    "Lexicon output converter route",
)
source = replace_required(
    source,
    "  std::array<float, 2> late_converter_state_{};\n"
    "  std::array<CompressorState, 2> compressor_state_{};\n",
    "  std::array<float, 2> late_converter_state_{};\n"
    "  std::array<CompressorState, 2> compressor_state_{};\n"
    "  AtmosLexicon224Converter lexicon_input_;\n"
    "  AtmosLexicon224Converter lexicon_output_;\n",
    "Lexicon converter members",
)
path.write_text(source, encoding="utf-8")

cmake_path = Path("native/CMakeLists.txt")
cmake = cmake_path.read_text(encoding="utf-8")
cmake = replace_required(
    cmake,
    "  src/atmos_parity_processor.cpp\n",
    "  src/atmos_parity_processor.cpp\n  src/atmos_lexicon224_converter.cpp\n",
    "Lexicon converter library source",
)
cmake = replace_required(
    cmake,
    "add_executable(atmos_parity_processor_test tests/atmos_parity_processor_test.cpp)\n"
    "target_link_libraries(atmos_parity_processor_test PRIVATE calcotone_dsp)\n",
    "add_executable(atmos_parity_processor_test tests/atmos_parity_processor_test.cpp)\n"
    "target_link_libraries(atmos_parity_processor_test PRIVATE calcotone_dsp)\n"
    "add_executable(atmos_lexicon224_converter_test tests/atmos_lexicon224_converter_test.cpp)\n"
    "target_link_libraries(atmos_lexicon224_converter_test PRIVATE calcotone_dsp)\n",
    "Lexicon converter test target",
)
cmake = replace_required(
    cmake,
    "add_test(NAME atmos_parity_processor_test COMMAND atmos_parity_processor_test)\n",
    "add_test(NAME atmos_parity_processor_test COMMAND atmos_parity_processor_test)\n"
    "add_test(NAME atmos_lexicon224_converter_test COMMAND atmos_lexicon224_converter_test)\n",
    "Lexicon converter CTest registration",
)
cmake_path.write_text(cmake, encoding="utf-8")

print("Routed native Atmos Lexicon 224 through exact stateful input/output converters.")
