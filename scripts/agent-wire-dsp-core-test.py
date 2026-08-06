#!/usr/bin/env python3
from pathlib import Path

path = Path('native/CMakeLists.txt')
source = path.read_text(encoding='utf-8')

replacements = [
    (
        'add_executable(core_contract_test tests/core_contract_test.cpp)\n'
        'target_link_libraries(core_contract_test PRIVATE calcotone_dsp)\n',
        'add_executable(core_contract_test tests/core_contract_test.cpp)\n'
        'target_link_libraries(core_contract_test PRIVATE calcotone_dsp)\n'
        'add_executable(dsp_core_test tests/dsp_core_test.cpp)\n'
        'target_link_libraries(dsp_core_test PRIVATE calcotone_dsp)\n',
        'DSP core executable registration',
    ),
    (
        'add_test(NAME core_contract_test COMMAND core_contract_test)\n',
        'add_test(NAME core_contract_test COMMAND core_contract_test)\n'
        'add_test(NAME dsp_core_test COMMAND dsp_core_test)\n',
        'DSP core CTest registration',
    ),
]

for old, new, label in replacements:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one {label}, found {count}')
    source = source.replace(old, new, 1)

path.write_text(source, encoding='utf-8', newline='\n')
Path('scripts/agent-wire-dsp-core-test.py').unlink(missing_ok=True)
Path('.github/workflows/agent-wire-dsp-core-test.yml').unlink(missing_ok=True)
print('registered dsp_core_test in native CMake')
