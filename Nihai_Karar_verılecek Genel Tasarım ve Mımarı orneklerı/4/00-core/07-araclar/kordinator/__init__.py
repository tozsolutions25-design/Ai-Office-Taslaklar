"""TOZ SOLUTIONS OTONOM AI OFISI v3 — kordinator paketi."""

from .baglam_muhru import Muhur
from .beyin import Beyin
from . import dotenv as dotenv
from .hata import (
    AnahtarYok,
    AnayasaIhlali,
    DevreKapaliHatasi,
    GecersizGecis,
    GeciciHata,
    KaliciHata,
    KapsamBelirsizHatasi,
    KotaHatasi,
    MuhurDogrulanmaHatasi,
    OnayGerekli,
    OnayReddedildi,
    SaglayiciHatasi,
    SirBulundu,
)
from .kuyruk import (
    BELIRSIZ,
    DURUMLAR,
    IZINLI,
    TERMINAL,
    Kuyruk,
    gecis,
    gecis_kontrol,
    idempotency_key,
    kapsam_belirsiz_mi,
)
from .onay_kapisi import SEVIYE_ADI, OnayKapisi
from .onbellek import (
    FIYAT,
    MIN_ONBELLEK,
    Rapor,
    kazanc_orani,
    maliyet_birim,
    onbellek_uygun_mu,
    ttl_sec,
    ucuslu_isaretleri,
)
from .router import (
    VARSAYILAN_MODELLER,
    VARSAYILAN_SIRA,
    cagir_guvenli,
    durum_raporu,
    rota_olustur,
    rota_sec,
)
from .saglayici_istemcileri import (
    ISTEMCILER,
    Gemini,
    Groq,
    IstemciSonuc,
    Ollama,
    OpenRouter,
)
from .sigorta import Sigorta, SigortaKumesi

__version__ = "3.0.0"

# .env dosyasi otomatik yuklenir. Ortam degiskeni varsa ONUN kazanir.
# Bunu paket import olundugu anda yapmak, saglayici istemcilerinin
# anahtari okumadan once .env'in yuklenmis olmasini garanti eder.
dotenv.yukle()

__all__ = [
    "Muhur", "Beyin", "dotenv",
    "Kuyruk", "gecis", "gecis_kontrol", "kapsam_belirsiz_mi",
    "idempotency_key", "BELIRSIZ", "DURUMLAR", "IZINLI", "TERMINAL",
    "OnayKapisi", "SEVIYE_ADI",
    "Sigorta", "SigortaKumesi",
    "Rapor", "FIYAT", "MIN_ONBELLEK", "maliyet_birim", "kazanc_orani",
    "ucuslu_isaretleri", "onbellek_uygun_mu", "ttl_sec",
    "OpenRouter", "Gemini", "Groq", "Ollama", "IstemciSonuc", "ISTEMCILER",
    "rota_olustur", "rota_sec", "cagir_guvenli", "durum_raporu",
    "VARSAYILAN_SIRA", "VARSAYILAN_MODELLER",
    "SaglayiciHatasi", "KotaHatasi", "GeciciHata", "KaliciHata",
    "AnahtarYok", "DevreKapaliHatasi", "MuhurDogrulanmaHatasi",
    "SirBulundu", "GecersizGecis", "OnayGerekli", "OnayReddedildi",
    "AnayasaIhlali", "KapsamBelirsizHatasi",
]
