from pathlib import Path

path = Path('native/tests/core_contract_test.cpp')
text = path.read_text(encoding='utf-8')
old = "  constexpr std::array<float, 4> pressure_defaults{0.F,.78F,1.F,.18F};"
new = "  constexpr std::array<float, 4> pressure_defaults{0.F,.78F,0.F,.18F};"
if old not in text:
    raise SystemExit('Loop native contract default anchor missing')
path.write_text(text.replace(old, new, 1), encoding='utf-8')

audit = Path('scripts/core-contract-parity-audit.mjs')
audit_text = audit.read_text(encoding='utf-8')
old_audit = "check(compact(loopSource).includes('enabled:false,selectedTrack:0,masterLevel:0.78,overdub:1,fade:0.18,'), 'Loop UI defaults');"
new_audit = "check(compact(loopSource).includes('enabled:false,selectedTrack:0,masterLevel:0.78,') && compact(loopSource).includes('overdub:0,') && compact(loopSource).includes('fade:0.18,'), 'Loop UI defaults');"
if old_audit not in audit_text:
    raise SystemExit('Loop JS contract default anchor missing')
audit.write_text(audit_text.replace(old_audit, new_audit, 1), encoding='utf-8')

signal = Path('scripts/signal-lab-audit.mjs')
signal_text = signal.read_text(encoding='utf-8')
old_controls = "requireText(railC, \"['Track', 'Loop', 'Overdub', 'Fade']\", 'Loop normal macro controls');"
new_controls = "requireText(railC, \"['Track', 'Loop', 'RETAIN', 'Fade']\", 'Loop live-replace macro controls');"
if old_controls not in signal_text:
    raise SystemExit('Loop signal macro-label anchor missing')
signal_text = signal_text.replace(old_controls, new_controls, 1)
old_storage = "requireText(loopStore, \"STORAGE_KEY = 'calcotone.loop-state.v1'\", 'Loop settings persistence');"
new_storage = "requireText(loopStore, \"STORAGE_KEY = 'calcotone.loop-state.v2'\", 'Loop live-replace settings persistence');\nrequireText(loopStore, \"LEGACY_STORAGE_KEY = 'calcotone.loop-state.v1'\", 'Loop legacy settings migration');"
if old_storage not in signal_text:
    raise SystemExit('Loop signal storage anchor missing')
signal.write_text(signal_text.replace(old_storage, new_storage, 1), encoding='utf-8')

print('Aligned native/core/signal Loop contracts with RETAIN=0 live replace.')
