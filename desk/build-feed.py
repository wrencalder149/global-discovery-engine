#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime, timezone
import html
ROOT = Path(__file__).resolve().parent
EDITIONS = ROOT / "editions"
OUT = ROOT / "feed.xml"
SLOTS = [("briefing.md", "今日簡報"), ("feature.md", "深度"), ("knowledge.md", "新知"), ("culture.md", "文化")]
def main():
    items = []
    if EDITIONS.exists():
        days = sorted([p for p in EDITIONS.iterdir() if p.is_dir()], reverse=True)
        for day in days[:5]:
            for name, label in SLOTS:
                f = day / name
                if not f.exists():
                    continue
                text = f.read_text(encoding="utf-8").strip()
                if len(text) < 80 or "編譯未完成" in text:
                    continue
                title = text.splitlines()[0]
                items.append((day.name, label, title, text))
    now = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
    parts = ['<?xml version="1.0" encoding="UTF-8"?>','<rss version="2.0"><channel>','<title>World Reader</title>','<description>每日簡報、深度、新知、文化</description>','<language>zh-TW</language>']
    for day, label, title, body in items:
        parts.append('<item>')
        parts.append('<title>' + html.escape("【" + label + "】" + title) + '</title>')
        parts.append('<description>' + html.escape(body) + '</description>')
        parts.append('<guid isPermaLink="false">wr-' + day + '-' + label + '</guid>')
        parts.append('</item>')
    parts.append('</channel></rss>')
    OUT.write_text("\n".join(parts), encoding="utf-8")
if __name__ == "__main__":
    main()
