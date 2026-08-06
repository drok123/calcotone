#!/usr/bin/env python3
from pathlib import Path

path = Path('scripts/hardware-spice-calibration.mjs')
source = path.read_text(encoding='utf-8')

old_opamp = """  return `if(v(in)>=0,tanh(v(in)*${spiceNumber(positiveDrive)})/tanh(${spiceNumber(positiveDrive)}),tanh(v(in)*${spiceNumber(negativeDrive)})/tanh(${spiceNumber(negativeDrive)}))`;
"""
new_opamp = """  return `(u(v(in))*tanh(v(in)*${spiceNumber(positiveDrive)})/tanh(${spiceNumber(positiveDrive)}))+(u(-v(in))*tanh(v(in)*${spiceNumber(negativeDrive)})/tanh(${spiceNumber(negativeDrive)}))`;
"""
old_transformer = """  return `min(1,max(-1,0.985*tanh((v(in)+${spiceNumber(asym)}*v(in)^2*if(v(in)>=0,1,-0.42))*${spiceNumber(safeDrive)})/tanh(${spiceNumber(safeDrive)})))`;
"""
new_transformer = """  return `min(1,max(-1,0.985*tanh((v(in)+${spiceNumber(asym)}*v(in)^2*(1.42*u(v(in))-0.42))*${spiceNumber(safeDrive)})/tanh(${spiceNumber(safeDrive)})))`;
"""

for old, new, label in [
    (old_opamp, new_opamp, 'op-amp transfer'),
    (old_transformer, new_transformer, 'transformer transfer'),
]:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one {label}, found {count}')
    source = source.replace(old, new, 1)

path.write_text(source, encoding='utf-8', newline='\n')
Path('scripts/agent-fix-ngspice-piecewise.py').unlink(missing_ok=True)
Path('.github/workflows/agent-fix-ngspice-piecewise.yml').unlink(missing_ok=True)
print('replaced unsupported ngspice if() expressions with unit-step piecewise transfers')
