#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime, timezone
import html

ROOT = Path(__file__).resolve().parent
EDITIONS = ROOT / "editions"
OUT = ROOT / "feed.xml"

def read_pack(path):
    text = path.read_text(encoding="utf-8").strip()
    lines = text.splitlines()
    title = lines[0].lstrip("# ").strip() if lines else path.stem
    return title, text

def main():
    items = []
    if EDITIONS.exists():
        days = sorted([p for p in EDITIONS.iterdir() if p.is_dir()], reverse=True)
        for day in days[:10]:
            for name, label in [("briefing.md", "今日簡報"), ("feature.md", "深度"), ("culture.md", "文化")]:
                f = day / name
                if not f.exists():
                    continue
                title, body = read_pack(f)
                if "編譯未完成" in body or "待完整編譯" in body:
                    continue
                items.append((day.name, label, title, body))
    now = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0"><channel>',
        '<title>World Reader</title>',
        '<description>每日三包正體中文匯整</description>',
        f'<lastBuildDate>{now}</lastBuildDate>',
        '<language>zh-TW</language>'
    ]
    for day, label, title, body in items:
        parts.append('<item>')
        parts.append(f'<title>{html.escape(「【」 + label + 「】」 + title)}</title>')
        parts.append(f'<description>{html.escape(body)}</description>')
        parts.append(f'<guid isPermaLink="false">world-reader-{day}-{label}</guid>')
        parts.append(f'<pubDate>{now}</pubDate>')
        parts.append('</item>')
    parts.append('</channel></rss>')
    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} items={len(items)}")

if __name__ == "__main__":
    main()
