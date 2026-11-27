#!/usr/bin/env python3
"""Regenerate public/js/demo-data.js from supabase/seed.sql.

Demo data is the same menu as the seed (same products/categories/settings),
used only when Supabase is not configured (config.js still has placeholders).
Do NOT edit demo-data.js by hand — edit seed.sql and re-run:

    python3 tools/gen_demo_data.py

from ~/workspace/khatuliswa-resto-cloudflare/.
Settings below are the live defaults (002_v2_members.sql / 001_init.sql);
they are not in seed.sql, so they are kept here as constants.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "supabase" / "seed.sql"
OUT = ROOT / "public" / "js" / "demo-data.js"

SETTINGS = {
    "restaurant_name": "Khatulistiwa Resto",
    "currency": "LE",
    "whatsapp_admin_phone": "201515041807",
    "loyalty_rate": "10",
    "tax_rate": "10",
    "service_charge": "5",
}


def split_top_level(text):
    """Split on commas that are not inside single quotes ('' = escaped quote)."""
    parts, cur, in_q = [], [], False
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "'":
            if in_q and i + 1 < len(text) and text[i + 1] == "'":
                cur.append("''")
                i += 2
                continue
            in_q = not in_q
            cur.append(ch)
        elif ch == "," and not in_q:
            parts.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
        i += 1
    parts.append("".join(cur).strip())
    return parts


def parse_tuples(statement):
    """Yield the field list of every top-level (...) group after VALUES."""
    values = statement.split("values", 1)[1]
    groups, depth, in_q, cur = [], 0, False, []
    i = 0
    while i < len(values):
        ch = values[i]
        if ch == "'":
            if in_q and i + 1 < len(values) and values[i + 1] == "'":
                cur.append("''")
                i += 2
                continue
            in_q = not in_q
            cur.append(ch)
        elif not in_q and ch == "(":
            depth += 1
            if depth == 1:
                cur = []
                i += 1
                continue
            cur.append(ch)
        elif not in_q and ch == ")":
            depth -= 1
            if depth == 0:
                groups.append(split_top_level("".join(cur)))
                cur = []
                i += 1
                continue
            cur.append(ch)
        elif not in_q and ch == ";" and depth == 0:
            break
        else:
            if depth >= 1:
                cur.append(ch)
        i += 1
    return groups


def unquote(field):
    field = field.strip()
    if field == "NULL":
        return None
    if field.startswith("'") and field.endswith("'"):
        return field[1:-1].replace("''", "'")
    if re.fullmatch(r"-?\d+", field):
        return int(field)
    return field


def main():
    sql = SEED.read_text()
    cat_stmt = re.search(
        r"insert into public\.categories.*?;", sql, re.S | re.I
    ).group(0)
    prod_stmt = re.search(
        r"insert into public\.products.*?;", sql, re.S | re.I
    ).group(0)

    categories = [
        {
            "id": unquote(f[0]),
            "name": unquote(f[1]),
            "description": unquote(f[2]),
            "product_count": unquote(f[3]),
            "variations": [],
        }
        for f in parse_tuples(cat_stmt)
    ]
    products = [
        {
            "id": unquote(f[0]),
            "sku": unquote(f[1]),
            "name": unquote(f[2]),
            "category": unquote(f[3]),
            "price": unquote(f[4]),
            "stock": unquote(f[6]),
            "status": unquote(f[7]),
            "imageUrl": unquote(f[8]) or "",
            "point_price": unquote(f[9]),
            "stock_source": unquote(f[10]),
        }
        for f in parse_tuples(prod_stmt)
    ]

    data = {"categories": categories, "products": products, "settings": SETTINGS}
    header = (
        "// Khatulistiwa Resto v2 — DEMO data (generated from supabase/seed.sql).\n"
        "// Do NOT edit by hand — edit supabase/seed.sql and re-run:\n"
        "//   python3 tools/gen_demo_data.py\n"
        "// Demo data is only used when Supabase is not configured (config.js\n"
        "// still has placeholders); once config.js has a real URL + anon key,\n"
        "// the app reads the same menu from Supabase instead.\n"
    )
    OUT.write_text(header + "window.DEMO_DATA = " + json.dumps(data, ensure_ascii=False) + ";\n")
    print(f"{OUT.name}: {len(categories)} categories, {len(products)} products, "
          f"{sum(1 for p in products if p['imageUrl'])} with imageUrl")


if __name__ == "__main__":
    main()
