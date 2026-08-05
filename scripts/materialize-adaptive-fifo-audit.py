from pathlib import Path

path = Path("scripts/latency-path-audit.mjs")
source = path.read_text(encoding="utf-8")
old = "requireText(nativeHost, '2U * std::max(capture.period_frames, render.buffer_frames)', 'Native two-period FIFO safety target');\n"
new = (
    "requireText(nativeHost, 'const auto fifo_period_frames = static_cast<std::uint64_t>', 'Native device-period FIFO baseline');\n"
    "requireText(nativeHost, 'const auto fifo_target_frames = 2U * fifo_period_frames', 'Native two-period FIFO safety baseline');\n"
)
if old not in source:
    raise RuntimeError("missing stale two-period FIFO audit assertion")
path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("Migrated the two-period latency audit to the named adaptive baseline.")
