"""Hand-made engine output for tests: a small Markdown reader shaped like engine_cli's JSON.

It is not the engine. It finds ATX headings, blank-line paragraphs, "- " lists, "|" tables,
[text](url) links and sentences ending in . ! or ?, which is all the fixtures use.
"""

import re


def sentences(text, start, end):
    out, pos = [], start
    for m in re.finditer(r"[.!?](?=\s|$)", text[start:end]):
        e = start + m.end()
        s = pos
        while s < e and text[s].isspace():
            s += 1
        if s < e:
            out.append({"start": s, "end": e})
        pos = e
    rest = text[pos:end]
    if rest.strip():
        s = pos + (len(rest) - len(rest.lstrip()))
        out.append({"start": s, "end": end})
    return out


def fake_engine(md, checks=None):
    headings, paragraphs, lists, tables, links, sections = [], [], [], [], [], []
    section = 0
    sections.append({"start": 0, "end": len(md), "headingIndex": None, "paragraphIndices": []})
    for m in re.finditer(r"[^\n]+(?:\n[^\n]+)*", md):
        block, s, e = m.group(0), m.start(), m.end()
        h = re.match(r"(#{1,6}) (.*)", block)
        if h:
            depth = len(h.group(1))
            headings.append({"start": s + depth + 1, "end": e, "depth": depth, "text": h.group(2)})
            if depth in (2, 3):
                sections[-1]["end"] = s
                section += 1
                sections.append({"start": s, "end": len(md), "headingIndex": len(headings) - 1,
                                 "paragraphIndices": []})
            continue
        if block.startswith("- "):
            items, off = [], s
            for line in block.split("\n"):
                items.append({"start": off + 2, "end": off + len(line), "text": line[2:]})
                off += len(line) + 1
            lists.append({"start": s, "end": e, "sectionIndex": section, "items": items})
            continue
        if block.startswith("|"):
            tables.append({"start": s, "end": e, "sectionIndex": section, "rows": block.count("\n")})
            continue
        sections[-1]["paragraphIndices"].append(len(paragraphs))
        paragraphs.append({"start": s, "end": e, "sectionIndex": section, "inListItem": False,
                           "inBlockquote": block.startswith(">"), "sentences": sentences(md, s, e)})
    for m in re.finditer(r"\[([^\]]*)\]\(([^)]*)\)", md):
        links.append({"start": m.start(), "end": m.end(), "url": m.group(2), "text": m.group(1)})
    return {"wordCount": len(md.split()), "checks": checks or {},
            "artifacts": {"headings": headings, "sections": sections, "paragraphs": paragraphs,
                          "lists": lists, "tables": tables, "links": links}}


def check(score, applicable=True, findings=(), suggestions=(), metrics=None):
    return {"applicable": applicable, "score": score, "metrics": metrics or {},
            "findings": [dict(f) for f in findings], "suggestions": [dict(s) for s in suggestions]}
