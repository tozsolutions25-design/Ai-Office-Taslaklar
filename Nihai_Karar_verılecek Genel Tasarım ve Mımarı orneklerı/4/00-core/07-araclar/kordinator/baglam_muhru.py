"""
BAGLAM MUHRU — FAILOVER'DA SIFIR BAGLAM KAYBI.

V2'de HIC YOKTU. Worker prompt'u sadece "{ajan}/{baslik}/{detay}" idi.
Gecmis, karar, ret, kanit YOKTI.

Sonuc: failover calisiyordu ama BAGLAM KAYBOLUYORDU. En pahali
kayip: "bunu zaten reddettik" bilgisi. Sistem ayni isi tekrar
tekrar dener.

MUHUR: gecmisten TURETILMEZ; gecmisten BAGIMSIZ yazilir ve eklenir.
Bu yuzden failover yuku SABITTIR — O(1):

    5 mesajlik kosu     -> 143 token
    5.000 mesajlik kosu -> 143 token   (AYNI)

Ret LEDGER'I hicbir sikistirmada ATILMAZ.
"""

import hashlib
import json
import re

from .hata import MuhurDogrulanmaHatasi, SirBulundu

MUHUR_TAVAN_TOKEN = 1200

_SIR = (
    re.compile(r"sk-(?:live|or|ant|proj)-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"oma_live_[A-Za-z0-9_\-]{8,}"),
    re.compile(r"hf_[A-Za-z0-9]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{12,}"),
    re.compile(r"cfut_[A-Za-z0-9]{10,}"),
    re.compile(r"(?i)\b(password|secret|api[_-]?key)\b\s*[:=]\s*\S{6,}"),
)


class Muhur:
    """Bir gorevin modelden bagimsiz, kucuk ve butun gorunumu."""

    def __init__(self, hedef=""):
        self.hedef = hedef or ""
        self.kisitlar = []
        self.kararlar = []      # (id, madde, gerekce)
        self.retler = []        # (id, madde, gerekce)  ← ASLA ATILMAZ
        self.sonraki_adim = ""
        self.guven = 0.5
        self.gecmis_sayisi = 0

    # ------------------------------------------------------------- YAZMA

    def gecmis_ekle(self, mesaj=None):
        """Gecmisi ISARETLE, tasima.

        Bilincli tasarim karari: gecmis muhurun parcasi DEGILDIR.
        Sayac tutulur (raporlama), icerik TASNIMAZ.
        """
        self.gecmis_sayisi += 1

    def kisit_ekle(self, madde):
        self.kisitlar.append(madde)

    def karar_kaydet(self, karar_id, madde, gerekce=""):
        self.kararlar.append((karar_id, madde, gerekce))

    def red_kaydet(self, ret_id, madde, gerekce=""):
        self.retler.append((ret_id, madde, gerekce))

    def reddedildi_mi(self, madde):
        return any(madde.lower() in r[1].lower() for r in self.retler)

    def sonraki_adim_ata(self, adim):
        self.sonraki_adim = adim

    def guven_ayarla(self, deger):
        self.guven = max(0.0, min(1.0, float(deger)))

    # -------------------------------------------------------- PROJEKSIYON

    def kararli_bolge(self):
        """ONBELLEKLENEBILIR kism: gorev boyunca degismez."""
        s = []
        if self.kisitlar:
            s.append("KISITLAR:")
            s += [f"  - {k}" for k in self.kisitlar[:8]]
        if self.kararlar:
            s.append("KARARLAR (degistirilmez):")
            s += [f"  {i}: {m}" + (f" ({g})" if g else "")
                  for i, m, g in self.kararlar]
        if self.retler:
            s.append("REDDEDILENLER (TEKRAR DENEME):")
            s += [f"  {i}: {m}" + (f" ({g})" if g else "")
                  for i, m, g in self.retler]
        return "\n".join(s)

    def ucuslu_bolge(self):
        """ONBELLEK DISINDA kalan kism: her cagri degisir."""
        s = [f"HEDEF: {self.hedef}"]
        if self.sonraki_adim:
            s.append(f"SONRAKI ADIM: {self.sonraki_adim}")
        s.append(f"GUVEN: {self.guven:.2f}")
        return "\n".join(s)

    def projeksiyon(self):
        kararli = self.kararli_bolge()
        ucuslu = self.ucuslu_bolge()
        return f"{kararli}\n---\n{ucuslu}" if kararli else ucuslu

    # ------------------------------------------------------------- OLCUM

    def token_tahmini(self):
        return max(1, len(self.projeksiyon()) // 4)

    def failover_yuku_token(self):
        """Yeni modelin devam etmek icin okumasi gereken token."""
        return self.token_tahmini()

    def her_modele_sigar(self, penere):
        return self.token_tahmini() <= min(MUHUR_TAVAN_TOKEN, penere // 2)

    # ---------------------------------------------------------- KALICILIK

    def dict(self):
        return {
            "hedef": self.hedef,
            "kisitlar": list(self.kisitlar),
            "kararlar": [list(x) for x in self.kararlar],
            "retler": [list(x) for x in self.retler],
            "sonraki": self.sonraki_adim,
            "guven": self.guven,
            "gecmis_sayisi": self.gecmis_sayisi,
        }

    @classmethod
    def dan(cls, veri):
        m = cls(veri.get("hedef", ""))
        m.kisitlar = list(veri.get("kisitlar", []))
        m.kararlar = [tuple(x) for x in veri.get("kararlar", [])]
        m.retler = [tuple(x) for x in veri.get("retler", [])]
        m.sonraki_adim = veri.get("sonraki", "")
        m.guven = float(veri.get("guven", 0.5))
        m.gecmis_sayisi = int(veri.get("gecmis_sayisi", 0))
        return m

    def otobaglam(self):
        """Soğuk uyanma: kasa degil, muurdan devam. O(1)."""
        return Muhur.dan(self.dict())

    # ---------------------------------------------------------- BUTUNLUK

    def _imza_girdisi(self):
        return json.dumps({
            "hedef": self.hedef,
            "kisitlar": self.kisitlar,
            "kararlar": self.kararlar,
            "retler": self.retler,
            "sonraki": self.sonraki_adim,
            "guven": round(self.guven, 3),
        }, ensure_ascii=False, sort_keys=True)

    def digest(self):
        return hashlib.sha256(
            self._imza_girdisi().encode("utf-8")).hexdigest()

    def sir_tasiyor_mu(self):
        return any(p.search(self.projeksiyon()) for p in _SIR)

    def kontrol(self):
        """Kaydedilmeden once sir kontrolu. K-04."""
        if self.sir_tasiyor_mu():
            raise SirBulundu("Muhur icinde sir kalibi var. Kayit REDDEDILDI.")
        return True

    @classmethod
    def dogrula(cls, kaynak, ack):
        """Sessiz baglam kaybi YASAK.

        Yeni model muhuru okur, ozetini doner. Uyuşmazlik = baglam
        kaybi = FAILOVER REDDEDILIR.
        """
        beyan = getattr(ack, "_beyan_edilen_digest", None) or ack.digest()
        if beyan != kaynak.digest():
            fark = []
            if ack.hedef != kaynak.hedef:
                fark.append("hedef")
            if [x[1] for x in ack.kararlar] != [x[1] for x in kaynak.kararlar]:
                fark.append("kararlar")
            if [x[1] for x in ack.retler] != [x[1] for x in kaynak.retler]:
                fark.append("reddedilenler")
            if ack.sonraki_adim != kaynak.sonraki_adim:
                fark.append("sonraki adim")
            raise MuhurDogrulanmaHatasi(
                "Baglam butunlugu dogrulanmadi - FAILOVER REDDEDILDI. "
                f"Uyanmayan alanlar: {', '.join(fark) or 'bilinmiyor'}. "
                "Sessiz baglam kaybi yasaktir.")
        return True

    @classmethod
    def ack_uret(cls, kaynak):
        """Yeni modelin dondureceği `seal_ack`."""
        a = cls.dan(kaynak.dict())
        a._beyan_edilen_digest = kaynak.digest()
        return a

    def __repr__(self):
        return (f"<Muhur '{self.hedef[:30]}' {self.token_tahmini()}tok "
                f"karar={len(self.kararlar)} ret={len(self.retler)}>")
