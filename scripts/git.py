import subprocess
from common import readJsonFile, getParentPath

main_dir = getParentPath()
scripts_dir = main_dir / "scripts"


def run(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr)
    return result.returncode


def getCommitMsg():
    prev = readJsonFile(scripts_dir / "prev_versions.json")
    new  = readJsonFile(scripts_dir / "versions.json")

    added, updated, deleted = [], [], []

    for extType in new:
        new_data  = new[extType]
        prev_data = prev.get(extType, {})
        for ext in new_data:
            if ext not in prev_data:
                added.append(ext)
                continue
            if new_data[ext]["version"] != prev_data[ext]["version"]:
                updated.append(ext)

    for extType in prev:
        new_data  = new.get(extType, {})
        prev_data = prev[extType]
        for ext in prev_data:
            if ext not in new_data:
                deleted.append(ext)

    parts = []
    if added:
        parts.append("Added: " + ", ".join(added))
    if updated:
        parts.append("Updated: " + ", ".join(updated))
    if deleted:
        parts.append("Deleted: " + ", ".join(deleted))

    msg = "; ".join(parts) if parts else "Updated"
    return f"[bot] {msg}"


MAIL_ID = "github-actions[bot]@users.noreply.github.com"
NAME    = "github-actions[bot]"

run(f'git config --global user.email "{MAIL_ID}"')
run(f'git config --global user.name "{NAME}"')
run("git checkout main")
run("git add .")

commit_msg = getCommitMsg()
result = run(f'git commit -m "{commit_msg}"')

if result == 0:
    run("git push origin main")
else:
    print("Nothing to commit — skipping push.")
