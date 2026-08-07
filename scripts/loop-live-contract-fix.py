from pathlib import Path

path = Path('native/tests/core_contract_test.cpp')
text = path.read_text(encoding='utf-8')
old = "  constexpr std::array<float, 4> pressure_defaults{0.F,.78F,1.F,.18F};"
new = "  constexpr std::array<float, 4> pressure_defaults{0.F,.78F,0.F,.18F};"
if old not in text:
    raise SystemExit('Loop contract default anchor missing')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Aligned generated Loop contract default with RETAIN=0 live replace.')
