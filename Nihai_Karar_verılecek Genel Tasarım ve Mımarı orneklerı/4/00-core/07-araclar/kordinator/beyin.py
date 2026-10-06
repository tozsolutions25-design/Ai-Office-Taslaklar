"""
BEYIN HAFIZA YAZICI.

V2'de beyin klasoru DEKORATIFti:
    obsidian_sync.py sadece "git add ." yapiyordu.
    03-beyin/01_Kararlar, 02_Ogrenilenler, 03_Indeksler BOS kaliyordu.

Bu modul her gorevin muhrunu ve sonucunu beyine yazar.
Yazmadan once SIR TARAMASI yapilir (K-04).
"""

import json
import os
import re
from datetime import datetime

from .baglam_muhru import Muhur
from .hata import SirBulundu

_SIR = (
    re.compile(r"sk-(?:live|or|ant|proj)-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"oma_live_[A-Za-z0-9_\-]{8,}"),
    re.compile(r"hf_[A-Za-z0-9]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{12,}"),
    re.compile(r"cfut_[A-Za-z0-9]{10,}"),
    re.compile(r"AIza[0-9A-Za-z_\-]{30,}"),
)


class Beyin:
    def __init__(self, kok="00-core/03-beyin"):
        self.kok = kok
        for a in ("00_Muhurler", "01_Kararlar", "02_Ogrenilenler",
                  "03_Indeksler"):
            os.makedirs(os.path.join(kok, a), exist_ok=True)

    # -------------------------------------------------------------- GUVENLI

    def _kontrol(self, icerik):
        for p in _SIR:
            if p.search(icerik):
                raise SirBulundu(
                    "SIR KALIBI BULUNDU — yazma REDDEDILDI (K-04).")

    def _yaz(self, yol, icerik):
        self._kontrol(icerik)
        os.makedirs(os.path.dirname(yol), exist_ok=True)
        tmp = yol + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(icerik)
        os.replace(tmp, yol)          # atomik yazim

    # ------------------------------------------------------------ MUHURLER

    def muhr_yaz(self, gorev_id, muhur):
        """Gorevin baglam muhrunu kalici sakla (failover icin)."""
        muhur.kontrol()
        yol = os.path.join(self.kok, "00_Muhurler", f"{gorev_id}.json")
        self._yaz(yol, json.dumps(muhur.dict(), ensure_ascii=False, indent=2))
        return yol

    def muhr_oku(self, gorev_id):
        """Soğuk uyanma: kasadan degil muurdan devam. O(1)."""
        yol = os.path.join(self.kok, "00_Muhurler", f"{gorev_id}.json")
        if not os.path.exists(yol):
            return None
        try:
            with open(yol, encoding="utf-8") as f:
                return Muhur.dan(json.load(f))
        except (json.JSONDecodeError, OSError):
            return None

    # ------------------------------------------------------------ KARARLAR

    def karar_yaz(self, karar_id, madde, gerekce, kaynak="insan"):
        """Kararlar USTUNE YAZILMAZ — arsivlenir."""
        yol = os.path.join(self.kok, "01_Kararlar", f"{karar_id}.md")
        self._yaz(yol, (
            f"---\nkarar_id: {karar_id}\n"
            f"tarih: {datetime.now():%Y-%m-%d}\n"
            f"kaynak: {kaynak}\n---\n\n"
            f"# {madde}\n\n"
            f"**Gerekce:** {gerekce}\n\n"
            f"> Bu karar arsivlenir ve USTUNE YAZILMAZ.\n"
            f"> Yeniden dusunulduyse YENI karar acilir.\n"))
        return yol

    # -------------------------------------------------------- OGRENILENLER

    def ogrenilen_yaz(self, baslik, icerik, etiketler=None):
        et = ", ".join(etiketler or ["ogrenilen"])
        ts = datetime.now()
        yol = os.path.join(self.kok, "02_Ogrenilenler", f"{ts:%Y-%m-%d}.md")
        self._kontrol(f"{baslik}\n{icerik}")
        yeni = not os.path.exists(yol)
        with open(yol, "a", encoding="utf-8") as f:
            if yeni:
                f.write(f"---\ntarih: {ts:%Y-%m-%d}\n---\n\n")
            f.write(f"## {baslik}\n\n{icerik}\n\n`#{et}`\n\n---\n\n")
        return yol

    def hata_yaz(self, hata, kok_neden="", cozum=""):
        return self.ogrenilen_yaz(
            f"Hata: {hata[:60]}",
            f"**Hata:** {hata}\n\n"
            f"**Kok neden:** {kok_neden or 'Bilinmiyor — incelenmeli'}\n\n"
            f"**Cozum:** {cozum or 'Henuz yok'}\n",
            etiketler=["hata", "kok-neden"])

    # -------------------------------------------------------------- INDEKS

    def indeks_yaz(self, etiket, dosya):
        yol = os.path.join(self.kok, "03_Indeksler", "indeks.md")
        satir = f"- `{etiket}` -> {dosya}\n"
        mevcut = ""
        if os.path.exists(yol):
            with open(yol, encoding="utf-8") as f:
                mevcut = f.read()
        if satir not in mevcut:
            with open(yol, "a", encoding="utf-8") as f:
                f.write(satir)
        return yol

    # ------------------------------------------------------------- OZET

    def istatistik(self):
        d = {}
        for a in ("00_Muhurler", "01_Kararlar", "02_Ogrenilenler"):
            p = os.path.join(self.kok, a)
            d[a] = len([f for f in os.listdir(p)
                        if os.path.isfile(os.path.join(p, f))]) \
                if os.path.isdir(p) else 0
        return d
