"""Original, independent eSCL HTTP fixture. No NAPS2 server/T12 code or physical hardware.

Deliberately only a 32x24, single-page, PNG, flatbed device; direct URL, no mDNS.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import struct
import threading
import xml.etree.ElementTree as ET
import zlib

SCAN = "http://schemas.hp.com/imaging/escl/2011/05/03"
PWG = "http://www.pwg.org/schemas/2010/12/sm"
CAPABILITIES = f'''<?xml version="1.0"?>
<scan:ScannerCapabilities xmlns:scan="{SCAN}" xmlns:pwg="{PWG}">
 <pwg:Version>2.0</pwg:Version><pwg:MakeAndModel>Zilo independent SP-2a fixture</pwg:MakeAndModel>
 <scan:Manufacturer>Zilo test only</scan:Manufacturer>
 <scan:Platen><scan:PlatenInputCaps>
  <scan:MinWidth>1</scan:MinWidth><scan:MaxWidth>128</scan:MaxWidth>
  <scan:MinHeight>1</scan:MinHeight><scan:MaxHeight>96</scan:MaxHeight>
  <scan:SettingProfiles><scan:SettingProfile>
   <scan:ColorModes><scan:ColorMode>RGB24</scan:ColorMode></scan:ColorModes>
   <scan:DocumentFormats><pwg:DocumentFormat>image/png</pwg:DocumentFormat></scan:DocumentFormats>
   <scan:SupportedResolutions><scan:DiscreteResolutions><scan:DiscreteResolution>
    <scan:XResolution>75</scan:XResolution><scan:YResolution>75</scan:YResolution>
   </scan:DiscreteResolution></scan:DiscreteResolutions></scan:SupportedResolutions>
  </scan:SettingProfile></scan:SettingProfiles>
 </scan:PlatenInputCaps></scan:Platen>
</scan:ScannerCapabilities>'''.encode()
STATUS = f'<scan:ScannerStatus xmlns:scan="{SCAN}" xmlns:pwg="{PWG}"><pwg:State>Idle</pwg:State></scan:ScannerStatus>'.encode()


def png():
    def chunk(name, value):
        return struct.pack(">I", len(value)) + name + value + struct.pack(">I", zlib.crc32(name + value))
    pixels = b"".join(
        b"\0" + b"".join(bytes((x * 7, y * 9, 200)) for x in range(32)) for y in range(24)
    )
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 24, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


class Fixture:
    def __init__(self):
        self.requests = []
        self.formats = []
        self.remaining = 0
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def respond(self, status, content=b"", mime="text/xml", location=None):
                owner.requests.append(f"{self.command} {self.path}")
                self.send_response(status)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(content)))
                if location:
                    self.send_header("Location", location)
                self.end_headers()
                self.wfile.write(content)

            def do_GET(self):
                if self.path == "/eSCL/ScannerCapabilities":
                    self.respond(200, CAPABILITIES)
                elif self.path == "/eSCL/ScannerStatus":
                    self.respond(200, STATUS)
                elif self.path == "/eSCL/ScanJobs/1/NextDocument" and owner.remaining:
                    owner.remaining -= 1
                    self.respond(200, png(), "image/png")
                else:
                    self.respond(404)

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                if self.path != "/eSCL/ScanJobs" or not 0 < length < 8192:
                    self.respond(400)
                    return
                settings = ET.fromstring(self.rfile.read(length))
                fmt = settings.findtext(f"{{{PWG}}}DocumentFormat")
                owner.formats.append(fmt)
                if fmt != "image/png" or settings.findtext(f"{{{PWG}}}InputSource") != "Platen":
                    self.respond(409)
                    return
                owner.remaining = 1
                self.respond(201, location="/eSCL/ScanJobs/1")

            def do_DELETE(self):
                owner.remaining = 0
                self.respond(200)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/eSCL"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
