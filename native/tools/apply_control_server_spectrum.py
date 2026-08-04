#!/usr/bin/env python3
from __future__ import annotations
import pathlib
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print('usage: apply_control_server_spectrum.py INPUT OUTPUT', file=sys.stderr)
        return 2
    source = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
    old = '    } else if (request.starts_with("GET /health ")) {\n      send_response(client, 200, handler_("health"), origin);\n'
    new = '    } else if (request.starts_with("GET /health ")) {\n      send_response(client, 200, handler_("health"), origin);\n    } else if (request.starts_with("GET /spectrum ")) {\n      send_response(client, 200, handler_("spectrum"), origin);\n'
    if new not in source:
        count = source.count(old)
        if count != 1:
            raise RuntimeError(f'expected one spectrum route anchor, found {count}')
        source = source.replace(old, new, 1)
    pathlib.Path(sys.argv[2]).write_text(source, encoding='utf-8', newline='\n')
    print(f'generated {sys.argv[2]} with GET /spectrum')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
