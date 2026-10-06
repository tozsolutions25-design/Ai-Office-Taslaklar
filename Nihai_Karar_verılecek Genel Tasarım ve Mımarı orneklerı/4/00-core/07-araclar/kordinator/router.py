"""
YONLENDIRICI — ROTA KARARI.

Kurallar:
  1. Sirasıyla dene, ilk calisan saglayiciyi kullan
  2. Devre acik saglayiciya GIRMEZ
  3. Kotasi dolu saglayiciya GIRMEZ
  4. Anahtari olmayan saglayici ATLANIR (yerele dusulur)
  5. Yerel model EN SON — maliyeti sifir ama kalitesi dusuk
  6. Hicbiri calismiyorsa KUYRUGA AL (sessizce kaybolma yok)
"""

import os

from .hata import (AnahtarYok, DevreKapaliHatasi, GeciciHata,
                   KaliciHata, KotaHatasi)
from .saglayici_istemcileri import (Gemini, Groq, Ollama, OpenRouter,
                                     IstemciSonuc)

# Rotalama sirasi: kalite oncelikli, maliyet sonra
VARSAYILAN_SIRA = ["openrouter", "gemini", "groq", "local_ollama"]

VARSAYILAN_MODELLER = {
    "openrouter": "google/gemini-2.0-flash-exp:free",
    "gemini": "gemini-2.0-flash",
    "groq": "llama-3.3-70b-versatile",
    "local_ollama": "qwen2.5-coder:7b",
}


def rota_olustur(modeller=None, sira=None, yerel_model=None):
    """Yapilandirmadan rota (istemci listesi) olustur."""
    modeller = modeller or VARSAYILAN_MODELLER
    sira = sira or VARSAYILAN_SIRA
    yerel_model = yerel_model or modeller.get("local_ollama")

    rota = []
    for ad in sira:
        model = (yerel_model if ad == "local_ollama"
                 else modeller.get(ad))
        if not model:
            continue
        if ad == "openrouter":
            rota.append(OpenRouter(model))
        elif ad == "gemini":
            rota.append(Gemini(model))
        elif ad == "groq":
            rota.append(Groq(model))
        elif ad == "local_ollama":
            rota.append(Ollama(model))
    return rota


def rota_sec(sigortalar=None, sira=None, modeller=None):
    """Rota sirasi + devre/kota durumuna gore filtrelenmis saglayicilar."""
    rota = rota_olustur(modeller, sira)
    if sigortalar is None:
        return rota

    saglam = []
    for istemci in rota:
        try:
            sigortalar.al(istemci.saglayici).giris_izin()
            saglam.append(istemci)
        except DevreKapaliHatasi as e:
            print(f"  [SKIP] {istemci.saglayici}: {e}")
    return saglam


def cagir_guvenli(sistem, mesaj, rota, sigortalar, max_deneme=3,
                  gunluk_kota=None, tiklayici=None):
    """
    Rotayi sirayla dener. Ilk calisan sonucu dondurur.

    Kural: sessizce bos gecmek YOK. Hepsi basarisizsa None doner ve
    cagiran taraf gorevi kuyruga geri alir.

    `tiklayici(istemci_sonuc)` — her basarili cagri sonrasi cagrilir;
    token muhasebesi icin.
    """
    son_denemeler = []

    for istemci in rota:
        s = sigortalar.al(istemci.saglayici) if sigortalar else None
        if s:
            try:
                s.giris_izin()
            except DevreKapaliHatasi as e:
                son_denemeler.append(f"{istemci.saglayici}: DEVRE ACIK")
                continue

        # Kota kontrolu (V2'de vardi, ama SABIT 150 sayiyordu)
        if gunluk_kota:
            o = gunluk_kota.get(istemci.saglayici)
            if o and o.get("gunluk_limit", -1) != -1:
                if o.get("kullanilan", 0) >= o["gunluk_limit"]:
                    son_denemeler.append(f"{istemci.saglayici}: KOTA DOLU")
                    continue

        basarili = False
        for deneme in range(max_deneme):
            try:
                sonuc = istemci.cagir(sistem, mesaj)
                if s:
                    s.basari(sonuc.sure_sn)
                basarili = True
                break
            except AnahtarYok as e:
                # Anahtar yok: yeniden denemenin anlami yok
                son_denemeler.append(f"{istemci.saglayici}: ANAHTAR YOK")
                break
            except KaliciHata as e:
                # 401/403/404: yeniden deneme ANLAMSIZ
                son_denemeler.append(f"{istemci.saglayici}: KALICI - {e}")
                if s:
                    s.hata(e)
                break
            except (KotaHatasi, GeciciHata) as e:
                if s:
                    s.hata(type(e).__name__)
                bekle = s.bekle_suresi(deneme) if s else 1.0
                son_denemeler.append(f"{istemci.saglayici}: {type(e).__name__}")
                if deneme < max_deneme - 1:
                    print(f"    [{istemci.saglayici}] {e} -> "
                          f"{bekle:.1f}s sonra tekrar (tam jitter)")
                    import time
                    time.sleep(min(bekle, 3.0))     # testlerde hizli olsun
                continue

        if basarili:
            if gunluk_kota:
                o = gunluk_kota.get(istemci.saglayici)
                if o and o.get("gunluk_limit", -1) != -1:
                    # GERCEK token sayaci — V2'deki sabit 150 yerine
                    o["kullanilan"] = o.get("kullanilan", 0) \
                        + sonuc.token_girdi + sonuc.token_cikti
            if tiklayici:
                tiklayici(sonuc)
            return sonuc

    if son_denemeler:
        print("  [ROTA BASARISIZ] " + " | ".join(son_denemeler))
    return None


def durum_raporu(sigortalar, gunluk_kota=None):
    """Rota sagligi — her sey calismiyorsa erken haber ver."""
    print("\n--- ROTA DURUMU ---")
    for s in sigortalar.gozlem():
        print(f"  {s['kapsam']:<28} {s['durum']:<10} "
              f"hata={s['hata_sayisi']} basari={s['basari_sayisi']}")
    if gunluk_kota:
        # '_' ile baslayan anahtarlar METAVERIDIR (aciklama, rota sirasi).
        # Bunlar saglayici DEGILDIR; string/list degerlidir.
        # limit-durumu.json'da hem aciklama hem saglayici var.
        for ad, o in sorted(gunluk_kota.items()):
            if ad.startswith("_") or not isinstance(o, dict):
                continue
            lim = o.get("gunluk_limit", -1)
            if lim == -1:
                print(f"  {ad:<28} kota: sinirsiz")
            else:
                d = o.get("dogrulama_durumu", "bilinmiyor")
                print(f"  {ad:<28} {o.get('kullanilan',0)}/{lim} "
                      f"[dogrulama: {d}]")
    saglam = sigortalar.saglamlar()
    if not saglam:
        print("\n  [!!!] HICBIR saglayici saglam degil. "
              "Isler kuyruga alinmali.")
    return saglam
