"""
Bidirectional sync between anime_index.json and the Excel sheet.

Excel  -> repo:  Downloads + Sub/Dub go into anime_metadata.json
                 Version updates anime_index.json only if Excel is newer

Repo   -> Excel: Canonical name + version written back to Excel
                 when anime_index.json is newer, so Excel stays current

Usage:
    python scripts/sync_from_excel.py

The pre-commit hook runs this automatically on every commit.
"""

import json
import openpyxl
from pathlib import Path

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


def ver_tuple(v):
    try:
        return tuple(int(x) for x in str(v).split("."))
    except Exception:
        return (0,)


def sync():
    if not EXCEL_PATH.exists():
        print(f"ERROR: Excel file not found at {EXCEL_PATH}")
        return

    wb = openpyxl.load_workbook(EXCEL_PATH)
    ws = wb.active

    headers = [str(c.value).strip().lower() if c.value else "" for c in ws[1]]

    try:
        col_name    = headers.index("extension name") + 1   # openpyxl is 1-indexed
        col_dl      = headers.index("downloads") + 1
        col_subdub  = headers.index("language supported") + 1
        col_version = headers.index("version number") + 1
    except ValueError as e:
        print(f"ERROR: Missing expected column — {e}")
        print(f"Found columns: {headers}")
        return

    metadata = load_json(metadata_path)
    index = load_json(index_path)
    index_by_name = {entry["name"]: entry for entry in index}

    print(f"\nReading: {EXCEL_PATH.name}\n")

    updated_meta        = []
    excel_updated_repo  = []   # Excel version was newer -> updated anime_index.json
    repo_updated_excel  = []   # Repo version was newer  -> updated Excel
    unknown             = []
    excel_changed       = False

    for row_idx in range(2, ws.max_row + 1):
        raw_name = ws.cell(row_idx, col_name).value
        if not raw_name:
            continue

        name    = canonical_name(str(raw_name))
        dl_val  = ws.cell(row_idx, col_dl).value
        sub_val = ws.cell(row_idx, col_subdub).value
        ver_val = ws.cell(row_idx, col_version).value

        downloads = str(dl_val).strip() if dl_val else "?"
        subdub    = str(sub_val).strip() if sub_val else "?"
        xl_ver    = str(ver_val).strip() if ver_val else None

        if downloads.lower() in ("yes", "true"):
            downloads = "Yes"
        elif downloads.lower() in ("no", "false"):
            downloads = "No"

        # Excel -> metadata (Downloads + Sub/Dub)
        old_meta = metadata.get(name, {})
        metadata[name] = {"downloads": downloads, "subDub": subdub}
        if old_meta != metadata[name]:
            updated_meta.append(f"  {name}: downloads={downloads}, subDub={subdub}")

        if name not in index_by_name:
            unknown.append(f"  {raw_name!r} — not in anime_index.json, skipped")
            continue

        repo_ver = index_by_name[name]["version"]

        if xl_ver and xl_ver != repo_ver:
            if ver_tuple(xl_ver) > ver_tuple(repo_ver):
                # Excel newer -> update repo
                index_by_name[name]["version"] = xl_ver
                excel_updated_repo.append(f"  {name}: {repo_ver} -> {xl_ver}")
            else:
                # Repo newer -> update Excel cell + name cell
                ws.cell(row_idx, col_version).value = repo_ver
                ws.cell(row_idx, col_name).value = name   # also fix display name
                repo_updated_excel.append(f"  {name}: Excel {xl_ver} -> {repo_ver}")
                excel_changed = True
        elif xl_ver is None:
            ws.cell(row_idx, col_version).value = repo_ver
            ws.cell(row_idx, col_name).value = name
            excel_changed = True

    save_json(metadata_path, metadata)
    save_json(index_path, index)

    if excel_changed:
        wb.save(EXCEL_PATH)
        print(f"Saved: {EXCEL_PATH.name}")

    if updated_meta:
        print("Metadata updated:")
        print("\n".join(updated_meta))
    else:
        print("Metadata: no changes")

    if excel_updated_repo:
        print("\nRepo updated from Excel (Excel was newer):")
        print("\n".join(excel_updated_repo))

    if repo_updated_excel:
        print("\nExcel updated from repo (repo was newer):")
        print("\n".join(repo_updated_excel))

    if not excel_updated_repo and not repo_updated_excel:
        print("Versions: no changes")

    if unknown:
        print("\nSkipped (not in anime_index.json):")
        print("\n".join(unknown))


if __name__ == "__main__":
    sync()
