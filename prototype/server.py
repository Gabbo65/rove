#!/usr/bin/env python3
"""Shared textbox: every device on the same Wi-Fi edits the same text, live.

Run:  python3 server.py
Then open the printed address on your Mac and iPhone.
"""
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8000
HERE = Path(__file__).parent
DATA_FILE = HERE / "text.txt"

state = {"text": DATA_FILE.read_text() if DATA_FILE.exists() else "", "version": 0}
cond = threading.Condition()


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # no packets sent; just picks the LAN interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = (HERE / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/events":
            self.stream_events()
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/text":
            return self.send_error(404)
        length = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(length) or b"{}")
        with cond:
            state["text"] = str(payload.get("text", ""))
            state["version"] += 1
            state["sender"] = payload.get("client")
            DATA_FILE.write_text(state["text"])
            cond.notify_all()
        self.send_response(204)
        self.end_headers()

    def stream_events(self):
        """Server-Sent Events: push the text to this client whenever it changes."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        seen = -1
        try:
            while True:
                with cond:
                    if state["version"] == seen:
                        cond.wait(timeout=15)
                    snapshot = dict(state)
                if snapshot["version"] == seen:
                    self.wfile.write(b": ping\n\n")  # keep-alive
                else:
                    seen = snapshot["version"]
                    self.wfile.write(f"data: {json.dumps(snapshot)}\n\n".encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    ThreadingHTTPServer.daemon_threads = True
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"On this Mac:   http://localhost:{PORT}")
    print(f"On your iPhone: http://{local_ip()}:{PORT}  (same Wi-Fi)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
