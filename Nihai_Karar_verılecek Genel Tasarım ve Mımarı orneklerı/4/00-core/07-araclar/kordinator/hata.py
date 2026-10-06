"""TOZ SOLUTIONS OTONOM AI OFISI v3 — Tüm hatalar tek yerde.

Tek bir yer olmasi, "bu hatayi yakaladim mi?" sorusuna tek cevap
verir ve `except` bloklarinin dagilmasini onler.
"""


class SaglayiciHatasi(Exception):
    """Tum saglayici hatalarinin tabani."""


class KotaHatasi(SaglayiciHatasi):
    """HTTP 429 veya kota asimi. DEVRE KESICI tetikler."""


class GeciciHata(SaglayiciHatasi):
    """5xx, timeout, baglanti hatasi. Yeniden denenebilir."""


class KaliciHata(SaglayiciHatasi):
    """401/403/404. Yeniden deneme ANLAMSIZ — duzeltme gerekir."""


class AnahtarYok(SaglayiciHatasi):
    """Ortam degiskeninde anahtar tanimli degil. Yerele dusulur."""


class DevreKapaliHatasi(SaglayiciHatasi):
    """Sigorta acik: bu saglayiciya istek GONDERILMEZ."""


class MuhurDogrulanmaHatasi(Exception):
    """
    Baglam butunlugu ihlali. FAILOVER REDDEDILIR.

    Sessiz baglam kaybi, kayip gecmisten DAHA KOTUDUR: is,
    kayboldugunu BILMEDEN hatali devam eder.
    """


class SirBulundu(Exception):
    """SIR tespit edildi. Kayit veya commit REDDEDILDI (K-04)."""


class GecersizGecis(Exception):
    """Durum makinesinde yasak gecis."""


class OnayGerekli(Exception):
    """Yetki seviyesi islemi icin onay yok. Iptal edildi."""


class OnayReddedildi(Exception):
    """Kullanici islemi reddetti."""


class AnayasaIhlali(Exception):
    """Anayasa ihlali: sistem ayaga kalkmaz."""


class KapsamBelirsizHatasi(Exception):
    """
    isletme / proje / musteri kapsami cozulemedi.

    Kimlik UYDURULMAZ. Cozulemeyen kapsamla is calismaz; gorev
    BLOKE edilir. Tahmin edilen bir kimlik sessiz bir hatadir.
    """
