"""
TOKEN MALIYETI: AYNI TOKEN 10 KAT FARKLI FIYATTA.

V2 kotayi sabit sayiyordu:
    update_limit(provider, used_tokens=150)   # SABIT 150
Girdi/cikti ne olursa olsun her cagri 150 sayiliyordu.

    onbelleksiz girdi       : 1.0x
    onbellekli OKUMA        : 0.1x   (%90 tasarruf)
    onbellekli YAZMA (5dk)  : 1.25x
    onbellekli YAZMA (1saat): 2.0x

Onbellek minimum esigi 1024-4096 token. ALTINDA HICBIR SEY
onbelleklenmez ve API HATA DA VERMEZ — sessiz basarisizlik.

En sik bulunan sessiz hata: sistem ipucuna ZAMAN DAMGASI koymak.
Tek karakter, butun onbellegi oldurur.
"""

import re

FIYAT = {"okuma": 0.1, "yazma_5dk": 1.25, "yazma_1saat": 2.0}
MIN_ONBELLEK = {"haiku": 2048, "sonnet": 1024, "opus": 4096, "fable": 4096}
TTL_SN = {"5dk": 300, "1saat": 3600}

# OnbelleklenMEMESI gereken, her cagri degisen icerik
_UCUSLU = (
    re.compile(r"\b20\d\d-\d\d-\d\dT\d\d:\d\d"),
    re.compile(r"\b\d{2}:\d{2}:\d{2}\b"),
    re.compile(r"\bsession[_ -]?id\b", re.I),
    re.compile(r"\brun[_ -]?id\b", re.I),
    re.compile(r"\brequest[_ -]?id\b", re.I),
    re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}"),
)


def ucuslu_isaretleri(metin):
    """Prefix icinde ONBELLEKLENEMEYECEK icerik var mi?

    Bulursa tek karakter butun prefix'i gecersizlestirir ve kimse
    nedenini bilmez. Bu yuzden bir KURAL (K-08).
    """
    bulunan = []
    for d in _UCUSLU:
        m = d.search(metin)
        if m:
            bulunan.append(m.group(0))
    return bulunan


def onbellek_uygun_mu(onek, model_sinifi="sonnet"):
    """Onek onbelleklenebilir mi? Esigin altinda ONAYLANMAZ."""
    return (len(onek) // 4) >= MIN_ONBELLEK.get(model_sinifi, 1024)


def ttl_sec(tekrar_araligi_sn):
    """5 dk mi 1 saat mi?

    Insan onayi bekleyen islerde aralik saatlerce olabilir
    (4.300 oturumda kullanici dusunme suresi oturum suresinin %92'si).
    """
    return "1saat" if tekrar_araligi_sn > TTL_SN["5dk"] else "5dk"


def maliyet_birim(token_girdi, token_cikti, onbellekli_girdi=False):
    """Nisbi maliyet. 1.0 girdi tokeni = tam fiyat."""
    return (token_girdi * (FIYAT["okuma"] if onbellekli_girdi else 1.0)
            + token_cikti * 1.0)


def kazanc_orani(token_girdi, token_cikti, onbellekli_girdi):
    """Bu cagri onbellekle ne kadar kazandi? (0..1)"""
    ham = token_girdi + token_cikti
    if not ham:
        return 0.0
    return 1.0 - (maliyet_birim(token_girdi, token_cikti, onbellekli_girdi) / ham)


class Rapor:
    """Token muhasebesi ciktisi — tahmin degil SAYIM."""

    def __init__(self, token_girdi, token_cikti, onbellekli=False,
                 model_sinifi="sonnet", not_=""):
        self.girdi = token_girdi
        self.cikti = token_cikti
        self.onbellekli = onbellekli
        self.not_ = not_

        if onbellekli:
            self.maliyet = maliyet_birim(token_girdi, token_cikti, True)
        else:
            self.maliyet = maliyet_birim(token_girdi, token_cikti, False)

        self.kazanc = kazanc_orani(token_girdi, token_cikti, onbellekli)

        if not onbellekli and token_girdi >= MIN_ONBELLEK.get(model_sinifi, 1024):
            self.uyari = "ONBELLEKLENEMEDI: prefix kararli ama esigin altinda " \
                         "veya icinde ucuslu icerik var"
        else:
            self.uyari = ""

    def __repr__(self):
        return (f"<Rapor girdi={self.girdi} cikti={self.cikti} "
                f"maliyet={self.maliyet:.1f} kazanc={self.kazanc:.0%}>")
