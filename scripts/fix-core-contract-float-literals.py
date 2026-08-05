from pathlib import Path

path = Path("native/tools/generate_core_contract.py")
source = path.read_text(encoding="utf-8")

anchor = '''def cpp_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)
'''
replacement = '''def cpp_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def cpp_float(value: object) -> str:
    literal = f"{float(value):.9g}"
    if "." not in literal and "e" not in literal.lower():
        literal += ".0"
    return literal + "F"
'''
if anchor not in source:
    raise RuntimeError("missing cpp_string helper")
source = source.replace(anchor, replacement, 1)

old = '''        control_rows = [
            f"  {{{cpp_string(control['id'])}, {float(control['defaultUi']):.9g}F}},"
            for control in controls
        ]
'''
new = '''        control_rows = [
            f"  {{{cpp_string(control['id'])}, {cpp_float(control['defaultUi'])}}},"
            for control in controls
        ]
'''
if old not in source:
    raise RuntimeError("missing control literal generator")
source = source.replace(old, new, 1)
path.write_text(source, encoding="utf-8")
print("Core contract generator now emits valid C++ float literals for integer defaults.")
