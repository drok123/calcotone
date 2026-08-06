from pathlib import Path

path = Path("scripts/materialize-audio-restart-supervisor.py")
source = path.read_text(encoding="utf-8")
old = r'"The launcher will restart the native host.\r\n",'
new = r'"The launcher will restart the native host.\\r\\n",'
if old not in source:
    raise RuntimeError("restart log newline escape anchor missing")
path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("Escaped restart supervisor C++ log newline.")
