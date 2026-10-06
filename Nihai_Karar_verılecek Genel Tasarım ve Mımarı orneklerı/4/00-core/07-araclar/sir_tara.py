"""
SIR TARAMASI — V3 (K-04)

V2'de `git add .` vardi. Bu dosya o agacin uzerinde iki sey yapar:

  1. Duz dosyalarda anahtar KALIBINI arar.
  2. Git'in IZLEMEYE ALINMIS dosyalarini tek tek yeniden tarar.

Sonuc: sifir sifir. Bir tane bile varsa cikis kodu 1.

Calistir:
    python 00-core\\07-araclar\\sir_tara.py
"""
import os
import re
import subprocess
import sys

KOK = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# --- Kalip 1: gercek anahtar bicimleri -------------------------------------
# Yapisal tanima: "ornek: abc..." seklinde yazilan KALIPLAR. Bunlar
# gercek anahtar DEGIL; ancak kodda bulunmamalari gerekir.
KALIPLAR = [
    (r"sk-or-v1-[A-Za-z0-9]{32,}", "OpenRouter anahtari bicimi"),
    (r"sk-[A-Za-z0-9]{40,}", "OpenAI/Stili anahtar bicimi"),
    (r"gsk_[A-Za-z0-9]{40,}", "Groq anahtar bicimi"),
    (r"AIza[A-Za-z0-9_\-]{35}", "Google/Gemini anahtar bicimi"),
    (r"ghp_[A-Za-z0-9]{36}", "GitHub PAT bicimi"),
    (r"github_pat_[A-Za-z0-9_]{50,}", "GitHub fine-grained PAT"),
    (r"AKIA[A-Z0-9]{16}", "AWS erisim anahtari bicimi"),
    (r"ey[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}",
     "JWT bicimi"),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "Ozel anahtar"),
]

# --- Kalip 2: dosya adi bazli ----------------------------------------------
# Icerik dogru olsa bile bu dosyalar izlenen agacta OLMAMALI.
YASAKLI_DOSYA = [
    ".env", ".env.local", ".env.production",
    "anahtar.txt", "api-keys.txt", "sirlar.txt", "credentials.txt",
    "id_rsa", "id_ed25519",
]

# --- Git yardimcisi --------------------------------------------------------
def git_calistir(*args):
    try:
        r = subprocess.run(["git"] + list(args),
                           cwd=KOK, capture_output=True, text=True,
                           timeout=20)
        return r.stdout.strip() if r.returncode == 0 else ""
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""


def izlenenler():
    return [f for f in git_calistir("ls-files").splitlines() if f]


def git_izliyor_mu(dosya):
    """
    Bu dosya Git tarafindan TAKIP EDILIYOR MU?

    K-04'un gercek kurali bu: sir dosyasi **izlenen agacta** OLMAMALI.
    Yani `.env` var olmasi ihlal DEGILDIR. `.env`in agaca girmesi ihlaldir.

    Onceki surum "her .env dosyasi ihlaldir" diyordu; bu standart
    is akisini (.env.local ile calismak) imkansiz kiliyordu.
    """
    if not git_var_mi():
        return False
    r = subprocess.run(["git", "ls-files", "--error-unmatch", "--", dosya],
                       cwd=KOK, capture_output=True, text=True, timeout=20)
    return r.returncode == 0


def gitignore_da_mi(dosya):
    """
    Dosya .gitignore kurallarina uyuyor mu?

    Git REPO DEGILSE `git check-ignore` calismaz ve hep "uyuyor degil"
    doner. Bu, kullaniciya `.env` DEGIL ama .gitignore'da degil
    gibi YANLIS bir uyari gosterirdi. O durumda dosya metni elle
    kontrol edilir.
    """
    if git_var_mi():
        r = subprocess.run(["git", "check-ignore", "-q", "--", dosya],
                           cwd=KOK, capture_output=True, text=True,
                           timeout=20)
        return r.returncode == 0

    # Git yok: .gitignore dosyasi var mi, ve dosyayi adli mi?
    gi = os.path.join(KOK, ".gitignore")
    if not os.path.exists(gi):
        return False
    try:
        with open(gi, encoding="utf-8", errors="replace") as f:
            satirlar = f.read().splitlines()
    except OSError:
        return False
    ad = os.path.basename(dosya)
    for s in satirlar:
        s = s.strip()
        if not s or s.startswith("#"):
            continue
        if s == ad or s == f"/{dosya}" or s == f".{ad}":
            return True
        # .env.* deseni .env'i yakalamaz; acik .env kurali aranir
        if s == ".env":
            return True
    return False


def git_var_mi():
    return bool(git_calistir("rev-parse", "--git-dir"))


def tara_metin(ic, kaynak, bulgular):
    for kalip, ad in KALIPLAR:
        for m in re.finditer(kalip, ic):
            # Sir DEGERI ASLA yazdirilmaz. Konum + tur yeterli.
            bulgular.append((kaynak, ad, m.start()))


def tara_agac():
    bulgular = []
    izli = set(izlenenler())
    git_var = git_var_mi()
    notlar = []

    for kok, _, dosyalar in os.walk(KOK):
        if ".git" in os.path.dirname(kok).split(os.sep):
            continue
        rel = os.path.relpath(kok, KOK)
        if rel.split(os.sep)[0] in (".git", "__pycache__", "node_modules"):
            continue
        for d in dosyalar:
            yol = os.path.join(kok, d)
            r = os.path.relpath(yol, KOK).replace("\\", "/")

            # --- .env ve benzerleri: K-04un GERCEK kurali ---
            #
            # IHLAL, anahtarin DOSYADA olmasi degil; Git'e
            # GIRMIS olmasidir. `.env` icinde anahtar olmasi
            # sistemin tasarimidir.
            #
            # Ic onceki surumde bu dosyalarin icerigi de taraniyordu
            # ve sonuc: .env dogru yazilmis olsa bile her zaman
            # "SUPHE" veriyordu. Arac kullanilamaz hale geliyordu.
            if d.startswith(".env") or d in YASAKLI_DOSYA:
                if d == ".env.example":
                    # Sablon olmali: icinde anahtar OLMAMALI
                    try:
                        if os.path.getsize(yol) < 2_000_000:
                            with open(yol, encoding="utf-8",
                                      errors="replace") as f:
                                tara_metin(f.read(), r, bulgular)
                    except OSError:
                        pass
                    continue

                if git_izliyor_mu(r):
                    # TEK ihlal durumu: agacta
                    bulgular.append((r,
                                     f"AGACTA: {d} Git'e girMEMELI", 0))
                else:
                    durum = "izlenmiyor" + (", .gitignore'da" if
                                            gitignore_da_mi(r) else
                                            ", .gitignore YOK (riskli)")
                    if not gitignore_da_mi(r):
                        notlar.append((r,
                                      "git deposu degilken konum dogru; "
                                      "AMA .gitignore'da degil — "
                                      "git init edersen SIZAR"))
                    else:
                        notlar.append((r, f"konum dogru ({durum})"))
                continue

            uzanti = os.path.splitext(d)[1].lower()
            if uzanti not in (".py", ".json", ".yaml", ".yml", ".md",
                              ".txt", ".sql", ".ps1", ".cfg",
                              ".toml", ".ini", ""):
                continue
            try:
                if os.path.getsize(yol) > 2_000_000:
                    continue
                with open(yol, encoding="utf-8", errors="replace") as f:
                    ic = f.read()
            except OSError:
                continue
            tara_metin(ic, r, bulgular)

    return bulgular, git_var, izli, notlar


def main():
    bulgular, git_var, izli, notlar = tara_agac()

    print("=" * 64)
    print("  SIR TARAMASI (K-04)")
    print("=" * 64)
    print(f"  git izlemeli  : {git_var}")
    print(f"  izlenen dosya : {len(izli)}")

    if notlar:
        print(f"  sir dosyasi   : {len(notlar)} (konum dogru)")
        for dosya, durum in notlar:
            print(f"      - {dosya}  {durum}")
    print()

    if not bulgular:
        print("  SONUC: TEMIZ.")
        print("  Kodda ve agacta anahtar YOK.")
        if not git_var:
            print()
            print("  NOT: Bu klasor git deposu DEGIL. K-04'un 'izlenen")
            print("       agac' kurali henuz TETIKLENMEZ. Git init et:")
            print("         git init")
            print("         git add 00-core 10_Anayasa 11_Ajanlar")
            print("       (.env .gitignore'da oldugu icin otomatik dislanir)")
        return 0

    print(f"  SONUC: {len(bulgular)} SUPHE")
    print()
    for kaynak, tur, konum in bulgular[:40]:
        print(f"    [{tur}]")
        print(f"        dosya : {kaynak}")
        print(f"        konum : {konum}")
    if len(bulgular) > 40:
        print(f"    ... ve {len(bulgular) - 40} tane daha")
    print()
    print("  Bu degerler kaynaga YAZILMAZ.")
    print("  Once anahtarlari ROTATE et, sonra dosyalardan kaldir.")
    return 1


if __name__ == "__main__":
    sys.exit(main())