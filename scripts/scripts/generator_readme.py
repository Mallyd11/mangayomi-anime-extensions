from common import readJsonFile, readFile, writeFile, getParentPath, writeJsonFile
from model import UpdateInfo, Source, ItemType
from datetime import datetime
from pytz import timezone
from pprint import pp
import shutil

main_dir = getParentPath()
scripts_dir = main_dir / "scripts"


def generateVersionData():
    versionPath = scripts_dir / "versions.json"
    oldData = readJsonFile(versionPath)

    FILES = ["", "anime_", "novel_"]
    title = ["manga", "anime", "novel"]

    currentDT = datetime.now(timezone("America/Toronto")).timestamp()

    newData = {}
    for file in FILES:
        ind = main_dir / f"{file}index.json"
        data = readJsonFile(ind)
        itemType = title[FILES.index(file)]
        oldDataCat = oldData[str(itemType)]
        collection = {}
        for item in data:
            item: Source = Source().fromJSON(item)
            name = item.name
            lang = item.lang
            version = item.version

            if name in oldDataCat:
                oldInfo = oldDataCat[name]
                oldVersion = oldInfo["version"]
                if version == oldVersion:
                    collection[name] = oldInfo
                    continue

            info = None
            if name in collection:
                info: UpdateInfo = UpdateInfo().fromJSON(collection[name])
                info.setLang(lang)
            else:
                version = item.version
                updTime = currentDT

                info: UpdateInfo = UpdateInfo(
                    name=name, version=version, lastUpd=updTime
                )
                info.setLang(lang)

            if info is not None:
                collection[name] = info.toJSON()

        newData[str(itemType)] = dict(
            sorted(
                collection.items(), key=lambda item: item[1]["lastUpd"], reverse=True
            )
        )

    writeJsonFile(versionPath, newData)


def generateExtensionList():
    tz = timezone("America/Toronto")
    lines = []
    lines.append("## Available Extensions List")
    lines.append("<details>")
    lines.append(
        '<summary><span style="font-size:1.7em; font-weight:bold;">Expand list</span></summary>\n'
    )

    data = readJsonFile(scripts_dir / "versions.json")
    metadata_path = scripts_dir / "anime_metadata.json"
    anime_metadata = readJsonFile(metadata_path) if metadata_path.exists() else {}

    today = datetime.now(tz).strftime("%Y/%m/%d")

    for category, items in data.items():
        catData = data[category]
        if len(catData) < 1:
            continue
        lines.append(f"## {category.title()}\n")

        if category == "anime":
            lines.append("| Name | Version | Downloads | Sub/Dub | Last Updated |")
            lines.append("|------|---------|-----------|---------|--------------|")
            for item_name in sorted(items):
                item = catData[item_name]
                lastUpd = datetime.fromtimestamp(item["lastUpd"], tz).strftime("%Y/%m/%d")
                meta = anime_metadata.get(item_name, {})
                downloads = meta.get("downloads", "?")
                subdub = meta.get("subDub", "?")
                lines.append(
                    f"| {item['name']} | {item['version']} | {downloads} | {subdub} | {lastUpd} |"
                )
        else:
            lines.append("| Name | Version | Language | Last Updated |")
            lines.append("|------|---------|----------|---------------|")
            for item_name in items:
                item = catData[item_name]
                lastUpd = datetime.fromtimestamp(item["lastUpd"], tz).strftime("%Y/%m/%d")
                lines.append(
                    f"| {item['name']} | {item['version']} | {item['langs']} | {lastUpd} |"
                )

        lines.append("")

    lines.append("</details>")
    print("DONE: Table")
    return "\n".join(lines)


shutil.copy(scripts_dir / "versions.json", scripts_dir / "prev_versions.json")
generateVersionData()
extTable = generateExtensionList()
temp = readFile(scripts_dir / "README-temp.md")
tempData = temp.replace("{{Extension Table}}", extTable)

readMePath = main_dir / "README.md"
writeFile(readMePath, tempData)
print("DONE: README.md")
