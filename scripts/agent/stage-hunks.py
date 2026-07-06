"""Stage hunks of a file whose text contains any marker — robustly.

Writes each one-hunk patch to a temp file (LF endings) and applies with
`git apply --cached`, regenerating the diff after every apply so line numbers
are always correct against the current index.

Usage: python stage_hunks.py <path> <marker1> [<marker2> ...]
"""
import subprocess, sys, os


def run(args):
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8")


def get_diff(path):
    return run(["git", "diff", "--no-color", "--", path]).stdout


def split(diff):
    lines = diff.splitlines(keepends=True)
    i, header = 0, []
    while i < len(lines) and not lines[i].startswith("@@"):
        header.append(lines[i]); i += 1
    hunks, cur = [], None
    for ln in lines[i:]:
        if ln.startswith("@@"):
            if cur: hunks.append(cur)
            cur = [ln]
        elif cur is not None:
            cur.append(ln)
    if cur: hunks.append(cur)
    return "".join(header), hunks


def apply_patch(text):
    p = "C:/tmp/_one.patch"
    with open(p, "w", newline="\n", encoding="utf-8") as f:
        f.write(text if text.endswith("\n") else text + "\n")
    return run(["git", "apply", "--cached", "--recount", "--whitespace=nowarn", p])


def main():
    path, markers = sys.argv[1], sys.argv[2:]
    staged = 0
    while True:
        header, hunks = split(get_diff(path))
        target = next((h for h in hunks if any(m in "".join(h) for m in markers)), None)
        if target is None:
            break
        r = apply_patch(header + "".join(target))
        if r.returncode != 0:
            print("APPLY FAILED:\n" + "".join(target)[:300] + "\n--- " + r.stderr)
            sys.exit(1)
        staged += 1
    print(f"{path}: staged {staged} hunk(s)")


if __name__ == "__main__":
    main()
