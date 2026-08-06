#!/usr/bin/env python3
from pathlib import Path

path = Path('scripts/hardware-spice-calibration.mjs')
source = path.read_text(encoding='utf-8')
old = "return `min(1,max(-1,v(in)-${spiceNumber(comp)}*v(in)^3+${spiceNumber(asym)}*v(in)^2*(1-abs(v(in)))))`;"
new = "return `min(1,max(-1,v(in)-${spiceNumber(comp)}*v(in)*v(in)*v(in)+${spiceNumber(asym)}*v(in)*v(in)*(1-abs(v(in)))))`;"
if source.count(old) != 1:
    raise RuntimeError(f'expected one signed summing expression, found {source.count(old)}')
source = source.replace(old, new, 1)
path.write_text(source, encoding='utf-8', newline='\n')
Path('scripts/agent-fix-signed-cubic-spice.py').unlink(missing_ok=True)
Path('.github/workflows/agent-fix-signed-cubic-spice.yml').unlink(missing_ok=True)
print('replaced ngspice signed cubic power with explicit multiplication')
