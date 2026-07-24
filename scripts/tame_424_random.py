from pathlib import Path

path = Path('src/App.tsx')
text = path.read_text()
old = """  'media:tascam424': [
    { name: 'ELASTIC DI', parameters: { wear:[0.54,0.70], wow:[0.14,0.19], noise:[0.09,0.13], tone:[0.52,0.68], mix:[0.22,0.36] } },
    { name: 'PUSHED PREAMP', parameters: { wear:[0.68,0.82], wow:[0.13,0.18], noise:[0.08,0.13], tone:[0.68,0.82], mix:[0.24,0.38] } },
  ],"""
new = """  'media:tascam424': [
    { name: 'ELASTIC DI', parameters: { wear:[0.28,0.42], wow:[0.14,0.19], noise:[0.09,0.13], tone:[0.30,0.44], mix:[0.22,0.36] } },
    { name: 'PUSHED PREAMP', parameters: { wear:[0.40,0.54], wow:[0.13,0.18], noise:[0.08,0.13], tone:[0.46,0.58], mix:[0.24,0.38] } },
  ],"""
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected one TASCAM 424 sweet-spot block, found {count}')
path.write_text(text.replace(old, new, 1))
