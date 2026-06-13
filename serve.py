#!/usr/bin/env python
"""Dev-сервер полигона visual-tests: статика с заголовком Cache-Control: no-store.

Зачем: при обычном `python -m http.server` браузер кэширует manifest.js и демки,
и правки (например новое решение модели в solutions[]) не видны без жёсткого
обновления (Ctrl+F5). Этот сервер отдаёт no-store, поэтому изменения
подхватываются обычным refresh.

Запуск: python serve.py [порт]   (по умолчанию 8473)
"""
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8473
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    print(f"visual-tests dev server (no-store): http://localhost:{PORT}/index.html")
    print("Ctrl+C to stop.")
    try:
        # ThreadingHTTPServer: однопоточный HTTPServer блокируется целиком,
        # пока Chromium держит молчащее спекулятивное соединение.
        ThreadingHTTPServer(("", PORT), NoCacheHandler).serve_forever()
    except KeyboardInterrupt:
        pass
