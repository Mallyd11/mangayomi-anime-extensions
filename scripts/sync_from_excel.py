"""
Reads the anime extensions Excel sheet and syncs:
  - scripts/anime_metadata.json  (Downloads + Sub/Dub columns for README)
  - anime_index.json              (version numbers)

Usage:
    python scripts/sync_from_excel.py

Run this whenever you update the Excel, then commit and push.
The GitHub Action will auto-update the README.
"""

import json
import openpyxl
from pathlib import Path
from datetime import datetime

EXCEL_PATH = Path(r"C:\Users\malik\OneDrive\Documents\Mangayomi\anime extensions versions and notes.xlsx")

# Maps Excel display names -> canonical anime_index.json names
NAME_MAP = {
    "animetsu": "Animetsu",
    "myron": "MyroniX",
    "anikototv": "AniKoto",
    "hianime": "HiAnime",
    "anidap": "Anidap",
    "animeheaven": "AnimeHeaven",
    "animeparadise": "AnimeParadise",
    "justanime": "JustAnime",
    "anicove": "AniCove",
    "animekai": "AnimeKai",
}

scripts_dir = Path(__file__).resolve().parent
main_dir = scripts_dir.parent

metadata_path = scripts_dir / "anime_metadata.json"
index_path = main_dir / "anime_index.json"


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    print(f"Saved: {path.name}")


def canonical_name(raw):
    return NAME_MAP.get(raw.strip().lower(), raw.strip())


def sync():
    if not EXCEL_PATH.exists():
        print(f"ERROR: Excel file not found at {EXCEL_PATH}")
        return

    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    ws = wb.active

    headers = [str(c.value).strip().lower() if c.value else "" for c in ws[1]]

    try:
        col_name     = headers.index("extension name")
        col_dl       = headers.index("downloads")
        col_subdub   = headers.index("language supported")
        col_version  = headers.index("version number")
    except ValueError as e:
        print(f"ERROR: Missing expected column — {e}")
        print(f"Found columns: {headers}")
        return

    metadata = load_json(metadata_path)
    index    = load_json(index_path)
    index_by_name = {entry["name"]: entry for entry in index}

    print(f"\nReading: {EXCEL_PATH.name}\n")

    updated_meta    = []
    updated_version = []
    unknown         = []

    for row in ws.iter_rows(min_row=2, values_only=True):
        raw_name = row[col_name]
        if not raw_name:
            continue

        name     = canonical_name(str(raw_name))
        downloads = str(row[col_dl]).strip().capitalize() if row[col_dl] else "?"
        subdub    = str(row[col_subdub]).strip() if row[col_subdub] else "?"
        version   = str(row[col_version]).strip() if row[col_version] else None

        # Normalise Yes/No casing
        if downloads.lower() in ("yes", "true"):
            downloads = "Yes"
        elif downloads.lower() in ("no", "false"):
            downloads = "No"

        # Update metadata
        old_meta = metadata.get(name, {})
        metadata[name] = {"downloads": downloads, "subDub": subdub}
        if old_meta != metadata[name]:
            updated_meta.append(f"  {name}: downloads={downloads}, subDub={subdub}")

        # Update version in anime_index.json only if Excel is NEWER
        if version and name in index_by_name:
            entry = index_by_name[name]
            try:
                def ver_tuple(v):
                    return tuple(int(x) for x in v.split("."))
                excel_newer = ver_tuple(version) > ver_tuple(entry["version"])
            except Exception:
                excel_newer = False

            if excel_newer:
                updated_version.append(f"  {name}: {entry['version']} -> {version}")
                entry["version"] = version
            elif entry["version"] != version:
                updated_version.append(f"  {name}: Excel has {version}, repo has {entry['version']} (repo is newer — update your Excel)")
        elif name not in index_by_name:
            unknown.append(f"  {raw_name!r} (mapped to {name!r}) — not in anime_index.json, skipped")

    save_json(metadata_path, metadata)
    save_json(index_path, index)

    if updated_meta:
        print("Metadata updated:")
        print("\n".join(updated_meta))
    else:
        print("Metadata: no changes")

    if updated_version:
        print("\nVersions updated in anime_index.json:")
        print("\n".join(updated_version))
    else:
        print("Versions: no changes")

    if unknown:
        print("\nSkipped (not in anime_index.json — add them manually):")
        print("\n".join(unknown))

    print("\nDone. Now run: git add -A && git commit -m 'sync from excel' && git push")


if __name__ == "__main__":
    sync()
