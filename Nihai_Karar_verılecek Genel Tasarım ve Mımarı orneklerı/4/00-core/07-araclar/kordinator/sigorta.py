"""
DEVRE KESICI.

V2'de HIC YOKTU. Ilk ilke "kesintisiz rotalama" diyordu, kodda ise
429'u YAKALAYAN hicbir sey yoktu (cunku HTTP cagrisi yoktu).

6 kural:
  1. Tetikleyici hata SAYISI degil, hata ORANI (varsayilan %50/30sn)
     + GECIKME (yavas cagri orani)
  2. Her saglayici icin AYRI sigorta. Tek global sigorta, bir
     saglayicinin cokmesiyle DOGRUDAN yedeklemeye de izin vermezdi.
  3. TAM JITTER: wait = random(0, min(tavan, taban*2^n))
     Duz ustel geri cekilme senkron dalga uretir = kendi kendine DoS.
  4. Kalici hatalar (401/403/404) devreyi ACMAZ.
  5. Kademeli toparlanma: 1, 2, 4 yoklama.
  6. Tembel gecis: setTimeout yarisi ve atlanan gecis YOK.
"""

import random
import time

from .hata import DevreKapaliHatasi, KaliciHata

VARSAYILAN_ESIK = 0.50
VARSAYILAN_PENCERE = 30
VARSAYILAN_SOGUMA = 30
VARSAYILAN_GECIKME_CARPANI = 3.0


class Sigorta:
    def __init__(self, kapsam, esik_oran=VARSAYILAN_ESIK,
                 pencere_sn=VARSAYILAN_PENCERE, soguma_sn=VARSAYILAN_SOGUMA,
                 gecikme_carpani=VARSAYILAN_GECIKME_CARPANI):
        self.kapsam = kapsam
        self.esik_oran = esik_oran
        self.pencere_sn = pencere_sn
        self.soguma_sn = soguma_sn
        self.gecikme_carpani = gecikme_carpani

        self.kazalar = []          # [(zaman, tur, gecikme)]
        self.basarilar = 0
        self.temel_gecikme = None
        self.durum = "kapali"      # kapali | acik | yari_acik
        self._son_gecis = 0.0
        self.carpan = 1
        self.yoklama_biten = 0

    # --- TAMBEL GECIS: zamanlayici yok ---

    def durum_oku(self, simdi=None):
        simdi = time.time() if simdi is None else simdi
        if self.durum == "acik":
            if simdi - self._son_gecis >= self.soguma_sn * self.carpan:
                self.durum = "yari_acik"
                self.yoklama_biten = 0
        return self.durum

    def giris_izin(self, simdi=None):
        d = self.durum_oku(simdi)
        if d == "kapali":
            return True
        if d == "yari_acik":
            if self.yoklama_biten < 2:
                self.yoklama_biten += 1
                return True
            raise DevreKapaliHatasi(
                f"{self.kapsam}: yari-acik, kademe doldu "
                f"({self.yoklama_biten}/2)")
        simdi = time.time() if simdi is None else simdi
        kalan = max(0.0, self.soguma_sn * self.carpan - (simdi - self._son_gecis))
        raise DevreKapaliHatasi(
            f"{self.kapsam}: DEVRE ACIK, {kalan:.0f}sn bekleniyor "
            f"(carpan {self.carpan}x). Bu saglayiciya istek GONDERILMEZ.")

    def kalan_soguma(self, simdi=None):
        simdi = time.time() if simdi is None else simdi
        if self.durum != "acik":
            return 0.0
        return max(0.0,
                   self.soguma_sn * self.carpan - (simdi - self._son_gecis))

    # --- OLUM ---

    def basari(self, gecikme_sn=0.0, simdi=None):
        simdi = time.time() if simdi is None else simdi
        if self.temel_gecikme is None and gecikme_sn > 0:
            self.temel_gecikme = gecikme_sn
        self.basarilar += 1
        self._pencere_temizle(simdi)
        if self.durum == "yari_acik":
            self.durum = "kapali"
            self.carpan = 1
            self.yoklama_biten = 0

    def hata(self, tur, gecikme_sn=0.0, simdi=None):
        simdi = time.time() if simdi is None else simdi

        # KALICI hata devreyi ACMAZ: saglayici saglam, istek hatali.
        if isinstance(tur, KaliciHata):
            raise KaliciHata(f"{self.kapsam}: {tur}")

        self.kazalar.append((simdi, str(tur), gecikme_sn))
        self._pencere_temizle(simdi)

        if self.durum == "yari_acik":
            # Kurtarma basarisiz -> tekrar aci, sogumayi ikiye katla
            self.durum = "acik"
            self._son_gecis = simdi
            self.carpan = min(self.carpan * 2, 8)
            self.yoklama_biten = 0
            return

        if self._tetiklendi():
            self.durum = "acik"
            self._son_gecis = simdi
            self.carpan = 1

    def _pencere_temizle(self, simdi):
        self.kazalar = [k for k in self.kazalar
                        if simdi - k[0] <= self.pencere_sn]

    def _tetiklendi(self):
        toplam = len(self.kazalar) + self.basarilar
        if toplam < 3:
            return False
        if len(self.kazalar) / toplam >= self.esik_oran:
            return True
        # Yavas cagri orani
        yavas = [k for k in self.kazalar if k[2] > 0]
        if self.temel_gecikme and len(yavas) >= 3:
            ort = sum(k[2] for k in yavas) / len(yavas)
            if ort > self.gecikme_carpani * self.temel_gecikme:
                return True
        return False

    # --- TAM JITTER ---

    def bekle_suresi(self, deneme, retry_after_sn=None):
        """API ipucu (Retry-After) varsa ONCE gelir."""
        if retry_after_sn is not None:
            return float(retry_after_sn)
        tavan, taban = 20.0, 1.0
        return random.uniform(0, min(tavan, taban * (2 ** deneme)))

    def kapat(self):
        self.durum = "kapali"
        self.kazalar = []
        self.basarilar = 0
        self.carpan = 1
        self.yoklama_biten = 0

    def gozlem(self):
        return {
            "kapsam": self.kapsam,
            "durum": self.durum,
            "hata_sayisi": len(self.kazalar),
            "basari_sayisi": self.basarilar,
            "carpan": self.carpan,
            "kalan_soguma_sn": round(self.kalan_soguma(), 1),
        }

    def __repr__(self):
        return f"<Sigorta {self.kapsam} {self.durum} x{self.carpan}>"


class SigortaKumesi:
    """Her saglayici icin AYRI sigorta.

    Neden ayri: bir saglayicinin cokmesi, digerinin saglam oldugunu
    anlamina gelmez. Tek global sigorta yedeklemeyi de oldururdu —
    yani tam olarak yapmamasi gereken seyi yapardi.
    """

    def __init__(self, **kwargs):
        self._ayarlar = kwargs
        self._ornekler = {}

    def al(self, saglayici):
        if saglayici not in self._ornekler:
            self._ornekler[saglayici] = Sigorta(
                f"saglayici:{saglayici}", **self._ayarlar)
        return self._ornekler[saglayici]

    def saglamlar(self):
        return [a for a, s in self._ornekler.items()
                if s.durum_oku() != "acik"]

    def gozlem(self):
        return [s.gozlem() for s in self._ornekler.values()]

    def __repr__(self):
        return f"<SigortaKumesi {list(self._ornekler)}>"
