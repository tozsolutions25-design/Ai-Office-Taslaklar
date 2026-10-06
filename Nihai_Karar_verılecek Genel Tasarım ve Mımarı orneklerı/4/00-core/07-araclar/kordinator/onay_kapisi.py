"""
ONAY KAPISI.

V2'de bu KODDA YOKTU. Anayasa madde 2 diyordu:
"Veritabani silme, dosya silme veya dis e-posta gonderimi insani
Telegram onayi gerektirir."
Ama worker.py'de TEK BIR onay kontrolu yoktu.

Kural:
  0-1  -> gecir
  2-3  -> onay iste
  4    -> ISTISNA: hicbir zaman otomatik

Suresi dolan onay OTOMATIK IPTAL edilir. Onaylanmayan is,
onaylanmis olmaktan iyidir.
"""

import time

from .hata import OnayGerekli, OnayReddedildi

ZAMAN_ASIMI_DK = 60

# Seviye 4 ASLA otomatik — politika degil, kod (K-06)
OTOMATIK_YASAK = {4}

SEVIYE_ADI = {
    0: "Okuma / arastirma",
    1: "Taslak / geri alinabilir is",
    2: "Disari gonderim (insan onayi)",
    3: "Kontrollu kayit yazma (insan onayi)",
    4: "Para / hukuk / deploy / silme (HICBIR ZAMAN otomatik)",
}


class OnayKapisi:
    def __init__(self, kuyruk, bildirim=None, zaman_asimi_dk=ZAMAN_ASIMI_DK):
        self.kuyruk = kuyruk
        self.bildirim = bildirim          # Telegram vb. Bos olabilir.
        self.zaman_asimi_dk = zaman_asimi_dk

    def uygula(self, gorev_id, islem, yetki_seviyesi):
        """
        Yetki kontrolu. 0-1 gecer, 2-3 onay ister, 4 reddeder.
        """
        if yetki_seviyesi in OTOMATIK_YASAK:
            self.kuyruk.logla(
                gorev_id, "ERROR",
                f"Yetki {yetki_seviyesi} ('{islem}') otomatik calistirilamaz",
                kaynak="onay_kapisi")
            raise OnayGerekli(
                f"Yetki {yetki_seviyesi} ('{islem}') ASLA otomatik "
                "calismaz. Yetkili insan zorunludur.")

        if yetki_seviyesi < 2:
            return {"durum": "gerekmiyor", "islem": islem,
                    "yetki_seviyesi": yetki_seviyesi}

        soru = (f"ONAY GEREKIYOR\n\n"
                f"Islem        : {islem}\n"
                f"Gorev         : #{gorev_id}\n"
                f"Yetki seviyesi: {yetki_seviyesi} — {SEVIYE_ADI[yetki_seviyesi]}\n"
                f"Sure          : {self.zaman_asimi_dk} dk\n\n"
                f"Secenekler: onayla / reddet")
        bitis = time.time() + self.zaman_asimi_dk * 60

        cur = self.kuyruk.bag.execute(
            "INSERT INTO onaylar (gorev_id, soru, secenekler, bitis_zamani) "
            "VALUES (?,?,?,?)",
            (gorev_id, soru, "onayla|reddet", bitis)).lastrowid
        self.kuyruk.bag.execute(
            "UPDATE gorevler SET onay_durumu='bekliyor' WHERE id=?",
            (gorev_id,))
        self.kuyruk.bag.commit()

        self.kuyruk.logla(gorev_id, "WARN",
                          f"Onay istendi: {islem} (seviye {yetki_seviyesi})",
                          kaynak="onay_kapisi")
        if self.bildirim:
            self.bildirim.gonder(soru)

        # Bekle: yanit gelir veya sure dolar
        while True:
            s = self.kuyruk.bag.execute(
                "SELECT durum FROM onaylar WHERE id=?", (cur,)).fetchone()
            if s["durum"] == "onaylandi":
                self.kuyruk.logla(gorev_id, "INFO", "Onay alindi",
                                  kaynak="onay_kapisi")
                return {"durum": "onaylandi", "islem": islem,
                        "onay_id": cur, "yetki_seviyesi": yetki_seviyesi}
            if s["durum"] == "reddedildi":
                raise OnayReddedildi(f"'{islem}' kullanici tarafindan reddedildi")
            if s["durum"] == "iptal":
                raise OnayGerekli(f"'{islem}' onay zaman asimina ugradi")
            if time.time() > bitis:
                self.kuyruk.bag.execute(
                    "UPDATE onaylar SET durum='iptal' WHERE id=?", (cur,))
                self.kuyruk.bag.commit()
                self.kuyruk.logla(
                    gorev_id, "WARN",
                    f"Onay zaman asimi ({self.zaman_asimi_dk} dk) - IPTAL",
                    kaynak="onay_kapisi")
                raise OnayGerekli(
                    f"Onay zaman asimi ({self.zaman_asimi_dk} dk). "
                    "Is OTOMATIK IPTAL edildi.")
            time.sleep(2)

    @staticmethod
    def yanitla(kuyruk, onay_id, yanit):
        """Insan yaniti. Telegram botundan gelir."""
        es = {"evet": "onaylandi", "onayla": "onaylandi", "onay": "onaylandi",
              "hayir": "reddedildi", "reddet": "reddedildi",
              "red": "reddedildi"}.get(str(yanit).strip().lower(), "bekliyor")
        kuyruk.bag.execute(
            "UPDATE onaylar SET durum=?, yanit=?, "
            "yanit_zamani=CURRENT_TIMESTAMP WHERE id=?", (es, str(yanit), onay_id))
        kuyruk.bag.commit()
        return es

    @staticmethod
    def bekleyenler(kuyruk):
        return [dict(r) for r in kuyruk.bag.execute(
            "SELECT id, gorev_id, soru, bitis_zamani FROM onaylar "
            "WHERE durum='bekliyor'").fetchall()]
