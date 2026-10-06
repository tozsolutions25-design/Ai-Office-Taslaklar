"""
V3 WORKER — V2'den YENIDEN YAZILDI.

V2'de bulunan 7 sorun:
  1. Prompt sadece "{ajan}/{baslik}/{detay}"  -> BAGLAM YOK
  2. 'isleniyor' kalan gorevler oluyordu      -> KURTARMA YOK
  3. Onay kontrolu YOKTU (anayasada yaziliydi)
  4. Idempotency YOK -> ayni gorev iki kez islenirdi
  5. Icerigi beyine YAZMIYORDU
  6. Token sayaci SABIT 150
  7. sys.path kirilgan

V3'te hepsi duzeltildi.
"""
import json
import os
import sys

ARAC = os.path.dirname(os.path.abspath(__file__))
KOK = os.path.abspath(os.path.join(ARAC, "..", ".."))
sys.path.insert(0, ARAC)

from kordinator import (  # noqa: E402
    Beyin,
    IstemciSonuc,
    Kuyruk,
    Muhur,
    OnayGerekli,
    OnayKapisi,
    OnayReddedildi,
    SigortaKumesi,
    cagir_guvenli,
    durum_raporu,
    rota_olustur,
)
from kordinator.onbellek import Rapor  # noqa: E402


def limitleri_oku():
    yol = os.path.join(KOK, "00-core", "02-yonlendirici", "limit-durumu.json")
    if not os.path.exists(yol):
        return {}
    with open(yol, encoding="utf-8") as f:
        return json.load(f)


def bekle(gorev_id, sigortalar, kuyruk, beyin, onay, m, kota):
    """Tam donanimli is adimi."""
    import time
    m.gecmis_ekle()

    g = kuyruk.bag.execute("SELECT * FROM gorevler WHERE id=?",
                          (gorev_id,)).fetchone()

    # --- 1) KAPSAM: kimlik UYDURULMAZ ---
    from kordinator.kuyruk import kapsam_belirsiz_mi
    if kapsam_belirsiz_mi(g["kapsam_isletme"], g["kapsam_proje"],
                          g["kapsam_musteri"]):
        m.red_kaydet("K-1", "Kapsam belirsiz",
                     "Kimlik uydurulmaz; kapsam netlestirilmeden "
                     "is calismaz")
        beyin.muhr_yaz(gorev_id, m)
        kuyruk.durum_ata(gorev_id, "bloke", "kapsam belirsiz")
        kuyruk.logla(gorev_id, "WARN", "Kapsam belirsiz -> BLOKE")
        return {"basarili": False, "neden": "kapsam_belirsiz"}

    # --- 2) YETKI: anayasada vardi, kodda yoktu ---
    islem = f"gorev #{gorev_id}: {g['baslik'][:60]}"
    try:
        sonuc_onay = onay.uygula(gorev_id, islem, g["yetki_seviyesi"])
    except OnayGerekli as e:
        kuyruk.logla(gorev_id, "WARN", f"Onay yok: {e}")
        kuyruk.durum_ata(gorev_id, "basarisiz", str(e))
        return {"basarili": False, "neden": str(e)}
    except OnayReddedildi as e:
        kuyruk.logla(gorev_id, "WARN", f"Kullanici reddetti: {e}")
        kuyruk.durum_ata(gorev_id, "basarisiz", str(e))
        return {"basarili": False, "neden": str(e)}

    # --- 3) MUHURU gonder (gecmis DEGIL) ---
    sistem = ("Sen Toz Solutions Otonom AI Ofisi'nin bir calisansin.\n"
              "Asagidaki baglam muhurunu esas al. Gecmisi gormuyorsun; "
              "bu muhurun sana yeterli.\n\n"
              + m.projeksiyon())
    mesaj = g["detay"] or g["baslik"]

    toplam = Rapor(0, 0)

    def tikla(s: IstemciSonuc):
        nonlocal toplam
        toplam = Rapor(s.token_girdi, s.token_cikti)

    rota = rota_olustur()
    sonuc = cagir_guvenli(sistem, mesaj, rota, sigortalar,
                          gunluk_kota=kota, tiklayici=tikla)

    if sonuc is None:
        hata = ("Tum saglayicilar basarisiz. Gorev olum kutusuna: once "
                "anahtarlari ve yerel modeli kontrol et.")
        kuyruk.bag.execute("UPDATE gorevler SET hata=? WHERE id=?",
                           (hata, gorev_id))
        kuyruk.bag.execute(
            "UPDATE gorevler SET durum='olum_kutusu' WHERE id=?", (gorev_id,))
        kuyruk.bag.commit()
        kuyruk.logla(gorev_id, "ERROR", hata)
        beyin.hata_yaz(hata, "Saglayici erisilebilir degil",
                       "Ortam degiskenlerini ve Ollama'yi kontrol et")
        return {"basarili": False, "neden": hata}

    # --- 4) GERCEK token sayaci (sabit 150 DEGIL) ---
    kuyruk.tokenlari_yaz(gorev_id, sonuc.saglayici, sonuc.model,
                         sonuc.token_girdi, sonuc.token_cikti,
                         sonuc.maliyet_birim)
    kuyruk.muhr_yaz(gorev_id, m.digest())
    kuyruk.logla(gorev_id, "INFO",
                 f"Tamamlandi: {sonuc.saglayici}/{sonuc.model} "
                 f"girdi={sonuc.token_girdi} cikti={sonuc.token_cikti} "
                 f"maliyet={sonuc.maliyet_birim:.1f} "
                 f"onbellek_kazanc={toplam.kazanc:.0%}",
                 veri={"saglayici": sonuc.saglayici,
                       "token_girdi": sonuc.token_girdi,
                       "token_cikti": sonuc.token_cikti})

    # --- 5) Beyine yaz — V2'de HIC YAZMIYORDU ---
    beyin.muhr_yaz(gorev_id, m)

    return {"basarili": True, "cikti": sonuc.metin,
            "saglayici": sonuc.saglayici, "model": sonuc.model,
            "token_girdi": sonuc.token_girdi,
            "token_cikti": sonuc.token_cikti,
            "maliyet_birim": sonuc.maliyet_birim,
            "muhur_token": m.failover_yuku_token(),
            "onay": sonuc_onay.get("durum")}


def main():
    print("=" * 62)
    print("  TOZ SOLUTIONS OTONOM AI OFISI v3 - WORKER")
    print("=" * 62)

    kuyruk = Kuyruk(os.path.join(KOK, "00-core", "01-kuyruk", "kuyruk.db"))
    sigortalar = SigortaKumesi()
    beyin = Beyin(os.path.join(KOK, "00-core", "03-beyin"))
    onay = OnayKapisi(kuyruk)
    kota = limitleri_oku()

    # KURTARMA — V2'de yoktu
    k = kuyruk.kurtar()
    print(f"[KURTARMA] geri_alinan={k['kurtarilan']} "
          f"olum_kutusu={k['olum_kutusu']} iptal={k['iptal']}")

    islenen = basarili = 0
    while True:
        g = kuyruk.al()
        if g is None:
            print("\n[i] Kuyruk bos. Sistem BEKLEMEDE "
                  "(pasif ajan protokolu: token harcanmaz).")
            break

        gid = g["id"]
        print(f"\n[GOREV #{gid}] {g['baslik']}")
        print(f"  ajan={g['atanan_ajan']} yetki={g['yetki_seviyesi']} "
              f"oncelik={g['oncelik']} kapsam={g['kapsam_musteri']}")

        # Soğuk uyanma: muhur beyinden yukle — O(1), kasa degil
        m = beyin.muhr_oku(gid) or Muhur(g["baslik"])
        print(f"  muhur yuklendi: {m.failover_yuku_token()} token "
              f"(gecmis {m.gecmis_sayisi} mesaj)")

        kuyruk.durum_ata(gid, "rota_secildi")
        r = bekle(gid, sigortalar, kuyruk, beyin, onay, m, kota)

        if r["basarili"]:
            kuyruk.bag.execute(
                "UPDATE gorevler SET bitis_tarihi=CURRENT_TIMESTAMP, hata=NULL "
                "WHERE id=?", (gid,))
            kuyruk.durum_ata(gid, "tamamlandi")
            basarili += 1
            print(f"  [TAMAM] {r['saglayici']}/{r['model']}")
            print(f"  token: girdi={r['token_girdi']} cikti={r['token_cikti']} "
                  f"maliyet={r['maliyet_birim']:.1f} birim")
            print(f"  onay: {r['onay']}")
            cikti = (r["cikti"] or "").replace("\n", " ")
            print(f"  cikti: {cikti[:250]}")
        else:
            print(f"  [HATA] {r['neden']}")
        islenen += 1

    print(f"\n[OZET] islenen={islenen} basarili={basarili}")
    durum_raporu(sigortalar, kota)
    st = kuyruk.istatistik()
    print(f"\n[KUYRUK] {st['durumlar']}")
    print(f"  toplam={st['toplam']} tamamlanma={st['tamamlanma_orani']:.0%} "
          f"token={st['token_girdi']}/{st['token_cikti']} "
          f"maliyet={st['maliyet_birim']} birim")
    print(f"[BEYIN] {beyin.istatistik()}")
    print("=" * 62)


if __name__ == "__main__":
    main()
