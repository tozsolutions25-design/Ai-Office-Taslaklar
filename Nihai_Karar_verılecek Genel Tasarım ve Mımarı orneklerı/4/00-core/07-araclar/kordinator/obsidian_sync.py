"""
GUVENLI OBSIDIAN / BEYIN SENKRONIZASYONU.

V2'de TEHLIKELIYD:

    subprocess.run(["git", "add", "."], check=True)   # HER SEY
    subprocess.run(["git", "commit", ...])
    # .gitignore YOK, sir taramasi YOK, push riski VAR

Tehlikeler:
  - .env stage edilir  -> API anahtari gider depoya
  - Beyin push edilir   -> musteri verisi sizar
  - Her calistirmada commit -> depo siser

V3:
  1. .gitignore ZORUNLU (eksikse olusturulur/guncellenir)
  2. Commit ONCESI sır taramasi — bulursa commit REDDEDILIR
  3. Degisiklik yoksa commit ATLANIR (depo sismesin)
  4. push OTOMATIK DEGIL (manuel)
"""

import os
import re
import subprocess
from datetime import datetime

_SIR = (
    re.compile(r"sk-(?:live|or|ant|proj|test)-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"oma_live_[A-Za-z0-9_\-]{8,}"),
    re.compile(r"hf_[A-Za-z0-9]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"cfut_[A-Za-z0-9]{10,}"),
    re.compile(r"AIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"gsk_[A-Za-z0-9]{20,}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*"
               r"['\"]?[A-Za-z0-9_\-]{12,}"),
)

ZORUNLU_IGNORE = (
    ".env", "*.env", ".env.*", "**/api-keys.txt", "**/.secrets/",
    "**/sifre*", "**/*secret*", "**/*parola*",
    "node_modules/", "*.log", "*.db", ".DS_Store", "**/__pycache__/",
    "*.tmp", ".koordinator-kilidi",
)

# Taranmayacaklar (ikinci savunma hatti)
ATLA = (".git", "__pycache__", "node_modules", ".venv",
        "AI_AUTONOMOUS_OFFICE_FIRMA", "Sessions")


def sir_tara(kok=".", derin=True):
    """Commit oncesi tarama. Supli dosyalari dondurur."""
    supheli = []
    for dizin, dizinler, dosyalar in os.walk(kok):
        dizinler[:] = [d for d in dizinler
                       if d not in ATLA and d != ".git"]
        for d in dosyalar:
            yol = os.path.join(dizin, d)
            low = yol.lower()
            if any(p.replace("**/", "").replace("*", "") in low
                   for p in ZORUNLU_IGNORE if p.replace("**/", "")):
                continue
            try:
                if os.path.getsize(yol) > 2_000_000:
                    continue
                with open(yol, "r", encoding="utf-8", errors="ignore") as f:
                    icerik = f.read()
            except OSError:
                continue
            for d in _SIR:
                m = d.search(icerik)
                if m:
                    supheli.append({
                        "dosya": yol,
                        "bulunan": m.group(0)[:10] + "...",
                        "satir": icerik[:m.start()].count("\n") + 1,
                    })
                    break
            if not derin and len(supheli) > 5:
                break
    return supheli


def _git(kok, *args):
    return subprocess.run(["git", *args], cwd=kok,
                          capture_output=True, text=True)


def gitignore_hazirla(kok="."):
    """Zorunlu .gitignore. Eksikse olusturur/gunceller."""
    yol = os.path.join(kok, ".gitignore")
    yeni = os.path.exists(yol)
    mevcut = ""
    if not yeni:
        with open(yol, "w", encoding="utf-8") as f:
            f.write("\n".join(ZORUNLU_IGNORE) + "\n")
        return yeni, 0
    with open(yol, encoding="utf-8") as f:
        mevcut = f.read()
    eksik = [p for p in ZORUNLU_IGNORE
             if not p.startswith("**/") and p not in mevcut]
    if eksik:
        with open(yol, "a", encoding="utf-8") as f:
            f.write("\n" + "\n".join(eksik) + "\n")
    return False, len(eksik)


def git_sync(kok=".", push=False, mesaj=None):
    """Guvenli beyin senkronizasyonu."""
    print("[BEYIN] Git senkronizasyonu...")

    # 1) .gitignore
    olusturuldu, eklendi = gitignore_hazirla(kok)
    if olusturuldu:
        print(f"  [+] .gitignore olusturuldu ({len(ZORUNLU_IGNORE)} kural)")
    elif eklendi:
        print(f"  [+] .gitignore guncellendi (+{eklendi} kural)")

    # 2) Git deposu var mi?
    if not os.path.isdir(os.path.join(kok, ".git")):
        print("  [i] Git deposu yok. Kurulum: git init && git add -A "
              "&& git commit -m 'ilk'")
        return {"basarili": False, "neden": "git_deposu_yok"}

    # 3) SIR TARAMASI — commit oncesi
    supheli = sir_tara(kok)
    if supheli:
        print(f"\n  [!!!] SIR TESPIT EDILDI ({len(supheli)} dosya). "
              "COMMIT REDDEDILDI.\n")
        for s in supheli[:12]:
            print(f"    {s['dosya']}:{s['satir']}  {s['bulunan']}")
        print("\n  Once degerleri temizle veya .gitignore'a ekle. (K-04)")
        return {"basarili": False, "neden": "sir_tespit_edildi",
                "bulunan": supheli}

    # 4) Degisiklik var mi?
    _git(kok, "add", "-A")
    durum = _git(kok, "status", "--porcelain")
    if not durum.stdout.strip():
        print("  [i] Degisiklik yok. Commit ATLANDI (depo sismesin).")
        return {"basarili": True, "neden": "degisiklik_yok"}

    # 5) Commit
    msg = mesaj or f"beyin: otomatik senkron {datetime.now():%Y-%m-%d %H:%M:%S}"
    r = _git(kok, "commit", "-m", msg)
    if r.returncode != 0:
        print(f"  [!] Commit basarisiz: {(r.stderr or r.stdout)[:200]}")
        return {"basarili": False, "neden": (r.stderr or r.stdout)[:200]}
    print(f"  [OK] Commit: {msg}")

    # 6) PUSH YALNIZCA ISTEKLE
    if push:
        r = _git(kok, "push")
        ok = r.returncode == 0
        print(f"  [{'OK' if ok else '!'}] push "
              f"{'tamam' if ok else 'basarisiz'}")
    else:
        print("  [i] Push YAPILMADI (otomatik push yasak). Gerekirse: git push")
    return {"basarili": True, "neden": "commit_edildi"}


if __name__ == "__main__":
    import sys
    kok = sys.argv[1] if len(sys.argv) > 1 else "."
    r = git_sync(kok)
    sys.exit(0 if r["basarili"] else 1)
