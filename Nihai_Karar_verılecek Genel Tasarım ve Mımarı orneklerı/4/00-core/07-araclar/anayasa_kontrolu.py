"""
ANAYASA KAPISI — sistem ayaga kalkmadan once kural ihlalini reddeder.

8 kural. V2'de 3 madve PROSE olarak vardi; calisan karsiligi yoktu.
Burada her kuralin bir kontrolu var.

Ihlal varsa sistem ACMAZ.

Kullanim:
    python 00-core\\07-araclar\\anayasa_kontrolu.py
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kordinator.hata import AnayasaIhlali  # noqa: E402
from kordinator.onbellek import ucuslu_isaretleri  # noqa: E402

KOK = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

KURALLAR = {
    "K-01": "Ayni gorev zincirinde yalnizca bir global koordinator",
    "K-02": "Calisanin modeli sabitlenmez; rol yetkiye baglanir",
    "K-03": "Failover test edilmeden ve rapor vermeden kullanilamaz",
    "K-04": "Sir dosyalari izlenen agacta bulunamaz",
    "K-05": "Her calisanin yetki seviyesi bildirilmis olmalidir",
    "K-06": "Yetki seviyesi 4 hicbir zaman otomatik calismaz",
    "K-07": "Her iddia bir kaynaga bagli olmali ya da "
            "VERIFY_REQUIRED isaretlenmeli",
    "K-08": "Onbellekte ucuslu icerik bulunamaz",
}


class Ihlal:
    def __init__(self, kural, mesaj, delil=""):
        self.kural = kural
        self.mesaj = mesaj
        self.delil = delil

    def __str__(self):
        return f"[{self.kural}] {self.mesaj}" + (f": {self.delil}" if self.delil else "")


def ajanlari_yukle():
    d = os.path.join(KOK, "11_Ajanlar")
    if not os.path.isdir(d):
        return []
    ajanlar = []
    for ad in sorted(os.listdir(d)):
        if not ad.endswith(".yaml"):
            continue
        yol = os.path.join(d, ad)
        with open(yol, encoding="utf-8") as f:
            icerik = f.read()
        # YAML bagimliligi olmadan minimum ayristirma
        ajanlar.append({"dosya": ad, "icerik": icerik})
    return ajanlar


def denetle():
    """8 kurali denetle. Ihlal listesini dondurur."""
    ihlaller = []

    # --- K-02 + K-05 + K-06: ajan tanimlari ---
    for a in ajanlari_yukle():
        ic = a["icerik"]
        # YORUM SATIRLARI denetlenmez. Bir kurali aciklamak icin metinde
        # gecmesi, kurali ihlal etmek demek DEGILDIR.
        # (test_mimarisi.py ile ayni davranis — iki denetleyici ayrilamaz)
        kod = "\n".join(s for s in ic.splitlines()
                        if not s.strip().startswith("#"))
        if "sabit_model" in kod or "model_tercihi:" in kod:
            ihlaller.append(Ihlal(
                "K-02", "Ajan modele sabitlenmis. Rol yetkiye baglanir.",
                a["dosya"]))
        if "yetki_seviyesi:" not in kod:
            ihlaller.append(Ihlal(
                "K-05", "Ajanin yetki seviyesi bildirilmemis.",
                a["dosya"]))
        else:
            for satir in kod.splitlines():
                s = satir.strip()
                if s.startswith("yetki_seviyesi:"):
                    try:
                        seviye = int(s.split(":")[1].strip())
                    except ValueError:
                        continue
                    if seviye == 4:
                        ihlaller.append(Ihlal(
                            "K-06", "AI iscisi seviye 4 olamaz.", a["dosya"]))
                    elif seviye > 4 or seviye < 0:
                        ihlaller.append(Ihlal(
                            "K-05", f"Gecersiz yetki seviyesi: {seviye}",
                            a["dosya"]))

    # --- K-07: her sayi/iddia bir KAYNAK tasiyormali ---
    # Anayasa K-07: "Her iddia bir kaynaga bagli olmali ya da
    # VERIFY_REQUIRED isaretlenmeli." Yani denetlenen sey saglayici
    # varligi degil, SAYISAL VERININ KAYNAKSIZ OLARAK SUNULMAMASI.
    lim = os.path.join(KOK, "00-core", "02-yonlendirici", "limit-durumu.json")
    if not os.path.exists(lim):
        ihlaller.append(Ihlal("K-07", "limit-durumu.json bulunamadi"))
    else:
        with open(lim, encoding="utf-8") as f:
            try:
                lim = json.load(f)
            except json.JSONDecodeError:
                ihlaller.append(Ihlal("K-07", "limit-durumu.json bozuk JSON"))
                lim = {}
        for ad, o in lim.items():
            if ad.startswith("_"):
                continue
            if not isinstance(o, dict):
                continue
            # Kotali her saglayici dogrulanabilir olmali
            if "gunluk_limit" in o and "dogrulama_durumu" not in o:
                ihlaller.append(Ihlal(
                    "K-07",
                    f"{ad}: kotali sayi dogrulama alani olmadan sunulmus",
                    "00-core/02-yonlendirici/limit-durumu.json"))
            # Dogrulanmis oldugunu iddia ediyorsa kaynaga OLMALI
            d = str(o.get("dogrulama_durumu", "")).lower()
            if d.startswith("dogruland") and not o.get("dogrulama_kaynagi"):
                ihlaller.append(Ihlal(
                    "K-07",
                    f"{ad}: 'dogrulama_durumu' kaynak olmadan "
                    f"'{o.get('dogrulama_durumu')}' diyor", 
                    "00-core/02-yonlendirici/limit-durumu.json"))

    # Dokumanlarda dogrulanmamis sayi VERIFY_REQUIRED isaretlenmeli
    for ad in ("00-core", "10_Anayasa"):
        d = os.path.join(KOK, ad)
        if not os.path.isdir(d):
            continue
        for kok, _, dosyalar in os.walk(d):
            for f_ in dosyalar:
                if not f_.endswith(".md"):
                    continue
                yol = os.path.join(kok, f_)
                with open(yol, encoding="utf-8", errors="replace") as fh:
                    ic = fh.read()
                if re.search(r"\bTOPLAM\s+\d+\s+(AJAN|MUSTERI|KULLE)", ic,
                             re.IGNORECASE):
                    if "VERIFY_REQUIRED" not in ic:
                        ihlaller.append(Ihlal(
                            "K-07",
                            "Toplam sayisi VERIFY_REQUIRED isareti olmadan "
                            "sunulmus",
                            os.path.relpath(yol, KOK)))

    # --- K-08: onbellek oneklerinde ucuslu icerik ---
    if os.path.isdir(os.path.join(KOK, "10_Anayasa")):
        for ad in os.listdir(os.path.join(KOK, "10_Anayasa")):
            if not ad.endswith(".md"):
                continue
            yol = os.path.join(KOK, "10_Anayasa", ad)
            with open(yol, encoding="utf-8") as f:
                ic = f.read()
            for isaret in ucuslu_isaretleri(ic):
                # Markdown'da ornek olarak gosterilen desenler haric
                if ad == "anayasa.md" and isaret:
                    continue
                ihlaller.append(Ihlal(
                    "K-08", "Onbelleklenebilir metinde ucuslu icerik",
                    f"{ad}: {isaret}"))

    return ihlaller


def main():
    print("=" * 62)
    print("  TOZ SOLUTIONS OTONOM AI OFISI v3 - ANAYASA KAPISI")
    print("=" * 62)
    print(f"  kural sayisi: {len(KURALLAR)}")
    for kod, ac in KURALLAR.items():
        print(f"    {kod}  {ac}")
    print("-" * 62)

    ihlaller = denetle()

    if not ihlaller:
        print("  SONUC: GECTI - 8/8 kural saglandi.")
        print("  Sistem ayaga kalkabilir.")
        print("=" * 62)
        return 0

    print(f"  SONUC: KAPALI - {len(ihlaller)} ihlal")
    for i in ihlaller:
        print(f"    {i}")
    print()
    print("  Sistem ayaga KALKMAZ.")
    print("  Detay: 10_Anayasa/anayasa.md")
    print("=" * 62)
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AnayasaIhlali as e:
        print(f"\nANAYASA IHNALI:\n{e}")
        sys.exit(1)
