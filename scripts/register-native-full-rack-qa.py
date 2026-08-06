#!/usr/bin/env python3
"""Register the recovery branch's whole-rack DSP QA test in CMake."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CMAKE = ROOT / "native/CMakeLists.txt"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


text = CMAKE.read_text(encoding="utf-8")
text = replace_once(
    text,
    "add_executable(native_processor_test tests/native_processor_test.cpp)\ntarget_link_libraries(native_processor_test PRIVATE calcotone_dsp)",
    "add_executable(native_processor_test tests/native_processor_test.cpp)\ntarget_link_libraries(native_processor_test PRIVATE calcotone_dsp)\nadd_executable(native_full_rack_qa_test tests/native_full_rack_qa_test.cpp)\ntarget_link_libraries(native_full_rack_qa_test PRIVATE calcotone_dsp)",
    "full-rack QA executable",
)
text = replace_once(
    text,
    "add_test(NAME native_processor_test COMMAND native_processor_test)",
    "add_test(NAME native_processor_test COMMAND native_processor_test)\nadd_test(NAME native_full_rack_qa_test COMMAND native_full_rack_qa_test)",
    "full-rack QA CTest",
)
CMAKE.write_text(text, encoding="utf-8", newline="\n")

for token in (
    "add_executable(native_full_rack_qa_test tests/native_full_rack_qa_test.cpp)",
    "add_test(NAME native_full_rack_qa_test COMMAND native_full_rack_qa_test)",
):
    if text.count(token) != 1:
        raise RuntimeError(f"CMake full-rack QA contract invalid: {token}")

print("Registered native_full_rack_qa_test as CTest #39.")
