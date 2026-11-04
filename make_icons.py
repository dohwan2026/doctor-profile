# 앱 아이콘(icon-192.png, icon-512.png)을 표준 라이브러리만으로 그린다: 청록 배경 + 흰 의료 십자 + 이력 줄
import os, struct, zlib

BG = (15, 118, 110)
WHITE = (255, 255, 255)
SOFT = (167, 230, 222)


def pixel(x, y):
    # 둥근 모서리 사각 카드
    cx, cy, w, h, r = 0.5, 0.5, 0.56, 0.64, 0.07
    dx, dy = max(abs(x - cx) - (w / 2 - r), 0), max(abs(y - cy) - (h / 2 - r), 0)
    if dx * dx + dy * dy > r * r:
        return BG
    # 카드 안: 위쪽 십자
    if (abs(x - 0.5) < 0.045 and 0.25 < y < 0.47) or (abs(y - 0.36) < 0.045 and 0.39 < x < 0.61):
        return BG
    # 아래쪽 이력 줄 3개
    for ly, lw in ((0.56, 0.36), (0.64, 0.36), (0.72, 0.24)):
        if abs(y - ly) < 0.018 and 0.32 < x < 0.32 + lw:
            return SOFT
    return WHITE


def png(size, path):
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            row += bytes(pixel((i + 0.5) / size, (j + 0.5) / size))
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", raw))
        f.write(chunk(b"IEND", b""))


here = os.path.dirname(os.path.abspath(__file__))
for s in (192, 512):
    png(s, os.path.join(here, f"icon-{s}.png"))
