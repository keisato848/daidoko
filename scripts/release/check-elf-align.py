#!/usr/bin/env python3
"""Check ELF PT_LOAD segment alignment for Android 16 KB page-size compliance.

Usage: python check_elf_align.py <file.aab|file.apk|dir>
Scans arm64-v8a / x86_64 .so files; each PT_LOAD must have p_align >= 0x4000.
"""
import sys, os, struct, zipfile, io, tempfile

MIN_ALIGN = 0x4000  # 16 KB


def pt_load_aligns(data: bytes):
    if data[:4] != b"\x7fELF":
        return None
    ei_class = data[4]  # 1=32bit, 2=64bit
    is64 = ei_class == 2
    endian = "<" if data[5] == 1 else ">"
    if is64:
        e_phoff = struct.unpack_from(endian + "Q", data, 0x20)[0]
        e_phentsize = struct.unpack_from(endian + "H", data, 0x36)[0]
        e_phnum = struct.unpack_from(endian + "H", data, 0x38)[0]
    else:
        e_phoff = struct.unpack_from(endian + "I", data, 0x1C)[0]
        e_phentsize = struct.unpack_from(endian + "H", data, 0x2A)[0]
        e_phnum = struct.unpack_from(endian + "H", data, 0x2C)[0]
    aligns = []
    for i in range(e_phnum):
        off = e_phoff + i * e_phentsize
        p_type = struct.unpack_from(endian + "I", data, off)[0]
        if p_type != 1:  # PT_LOAD
            continue
        if is64:
            p_align = struct.unpack_from(endian + "Q", data, off + 0x30)[0]
        else:
            p_align = struct.unpack_from(endian + "I", data, off + 0x1C)[0]
        aligns.append(p_align)
    return aligns


def check_so(name: str, data: bytes):
    aligns = pt_load_aligns(data)
    if aligns is None:
        return None
    ok = all(a >= MIN_ALIGN for a in aligns)
    hexa = sorted({hex(a) for a in aligns})
    return ok, hexa


def iter_archive(path: str):
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.endswith(".so") and ("arm64-v8a" in n or "x86_64" in n):
                yield n, z.read(n)


def main():
    target = sys.argv[1]
    results = []
    if os.path.isdir(target):
        for root, _, files in os.walk(target):
            for f in files:
                if f.endswith(".so"):
                    p = os.path.join(root, f)
                    with open(p, "rb") as fh:
                        results.append((p, check_so(p, fh.read())))
    else:
        for n, data in iter_archive(target):
            results.append((n, check_so(n, data)))

    bad = []
    for name, res in sorted(results):
        if res is None:
            continue
        ok, hexa = res
        flag = "OK " if ok else "BAD"
        if not ok:
            bad.append(name)
        print(f"  [{flag}] {','.join(hexa):<18} {name}")
    print(f"\nTotal .so checked: {len([r for _, r in results if r])}")
    if bad:
        print(f"NOT 16 KB COMPLIANT: {len(bad)} libs with align < 0x4000")
        for b in bad:
            print(f"   - {b}")
        sys.exit(1)
    print("ALL PT_LOAD segments are >= 0x4000 (16 KB) aligned. PASS.")


if __name__ == "__main__":
    main()
