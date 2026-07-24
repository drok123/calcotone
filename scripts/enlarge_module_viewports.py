from pathlib import Path

path = Path('src/components/motion/UiPolish.css')
text = path.read_text()

replacements = [
    (
        "height: clamp(220px, 16vw, 270px);\n  min-height: 220px;",
        "height: clamp(300px, 20vw, 340px);\n  min-height: 300px;",
    ),
    (
        "height: 270px;\n    min-height: 270px;",
        "height: 340px;\n    min-height: 340px;",
    ),
    (
        "height: 205px;\n    min-height: 205px;",
        "height: 300px;\n    min-height: 300px;",
    ),
    (
        "height: 220px;\n    min-height: 220px;",
        "height: 260px;\n    min-height: 260px;",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one match for {old!r}, found {count}')
    text = text.replace(old, new, 1)

path.write_text(text)
