"""
KUYRUK + DURUM MAKINESI + KURTARMA.

V2'de cok kritik bir hata vardi:

    UPDATE gorevler SET durum = 'isleniyor' WHERE id = ?
    ... islem ...
    # surec cokarsa 'isleniyor' KALIR
    # yeniden baslatmada 'WHERE durum = beklemede' onu BULAMAZ
    # gorev KALICI OLARAK KAYBOLUR

11 durum. Terminal durumlar DONMEZ. blocked -> failed tek cikis.
"""

import json
import os
import sqlite3
import time

BELIRSIZ = "_unresolved"

DURUMLAR = ("olusturuldu", "kapsam_cozuldu", "rota_secildi",
            "beceri_cozuldu", "yetenek_cozuldu", "calisiyor",
            "dogrulaniyor", "tamamlandi", "basarisiz", "bloke",
            "olum_kutusu")

TERMINAL = ("tamamlandi", "basarisiz", "olum_kutusu")

IZINLI = {
    "olusturuldu": {"kapsam_cozuldu", "bloke", "basarisiz", "olum_kutusu"},
    "kapsam_cozuldu": {"rota_secildi", "bloke", "basarisiz", "olum_kutusu"},
    "rota_secildi": {"beceri_cozuldu", "bloke", "basarisiz", "olum_kutusu"},
    "beceri_cozuldu": {"yetenek_cozuldu", "bloke", "basarisiz", "olum_kutusu"},
    "yetenek_cozuldu": {"calisiyor", "bloke", "basarisiz", "olum_kutusu"},
    "calisiyor": {"dogrulaniyor", "basarisiz", "bloke", "olum_kutusu"},
    "dogrulaniyor": {"tamamlandi", "basarisiz", "bloke", "olum_kutusu"},
    "tamamlandi": set(),
    "basarisiz": set(),
    "bloke": {"basarisiz"},
    "olum_kutusu": set(),
}


class GecersizGecis(Exception):
    pass


def gecis_kontrol(mevcut, hedef):
    if mevcut == hedef:
        return True                        # idempotent no-op
    return hedef in IZINLI.get(mevcut, set())


def gecis(mevcut, hedef, zorla=False):
    if not zorla and not gecis_kontrol(mevcut, hedef):
        raise GecersizGecis(
            f"{mevcut} -> {hedef} yasak. "
            f"Izin verilen: {sorted(IZINLI.get(mevcut, set())) or 'yok (terminal)'}")
    return hedef


def kapsam_belirsiz_mi(isletme, proje, musteri):
    return any(x in (None, "", BELIRSIZ)
               for x in (isletme, proje, musteri))


class Kuyruk:
    def __init__(self, yol="00-core/01-kuyruk/kuyruk.db"):
        os.makedirs(os.path.dirname(yol), exist_ok=True)
        self.yol = yol
        self.bag = sqlite3.connect(yol)
        self.bag.row_factory = sqlite3.Row
        self.bag.execute("PRAGMA foreign_keys = ON")

    def kapat(self):
        self.bag.close()

    # ------------------------------------------------------------ KURTARMA

    def kurtar(self):
        """
        V2'de YOKTU. Yarim kalmis gorevler kalici olarak kaybolurdu.

        1. 'calisiyor'/'dogrulaniyor' durumunda kalanlar:
           - deneme < max  -> 'olusturuldu'ya AL
           - deneme >= max -> 'olum_kutusu'na GONDER
        2. Zaman asimina ugramis onaylar iptal edilir.
        """
        kurtarilan = olum = 0

        for g in self.bag.execute(
                "SELECT id, durum, deneme_sayisi, max_deneme FROM gorevler "
                "WHERE durum IN ('calisiyor','dogrulaniyor')").fetchall():
            if g["deneme_sayisi"] >= g["max_deneme"]:
                self.durum_ata(g["id"], "olum_kutusu",
                               "Kurtarma: deneme siniri asildi", zorla=True)
                olum += 1
            else:
                # Kurtarma bir ZORLAMA gecisidir: 'calisiyor' ->
                # 'olusturuldu' makinesinde izinli degildir, ama
                # yarim kalmis isin geri alinmasi zorunludur.
                self.durum_ata(g["id"], "olusturuldu",
                               "Kurtarma: yarim kalmis gorev geri alindi",
                               zorla=True)
                kurtarilan += 1

        # Zaman asimina ugramis bekleyen onaylar: ONCE kimlikleri TOPLA.
        # (Dogrudan UPDATE + "SELECT ... WHERE durum='iptal'" yapmak
        #  oncece iptal edilmis kayitlari da tekrar tekrar gezer ve
        #  terminal durumdaki gorevleri zorlar.)
        asimda = self.bag.execute(
            "SELECT id, gorev_id FROM onaylar "
            "WHERE durum='bekliyor' AND bitis_zamani IS NOT NULL "
            "AND bitis_zamani <= datetime('now')").fetchall()
        iptal = len(asimda)

        if asimda:
            self.bag.executemany(
                "UPDATE onaylar SET durum='iptal' WHERE id=?",
                [(a["id"],) for a in asimda])
            for a in asimda:
                if a["gorev_id"] is None:
                    continue
                try:
                    self.durum_ata(a["gorev_id"], "basarisiz",
                                   "Onay zaman asimi: is otomatik iptal "
                                   "edildi", zorla=True)
                except GecersizGecis:
                    pass
        self.bag.commit()
        return {"kurtarilan": kurtarilan, "olum_kutusu": olum,
                "iptal": iptal}

    # --------------------------------------------------------------- DURUM

    def durum_ata(self, gorev_id, hedef, not_="", zorla=False):
        g = self.bag.execute(
            "SELECT durum, durum_gecmisi FROM gorevler WHERE id=?",
            (gorev_id,)).fetchone()
        if g is None:
            raise GecersizGecis(f"Gorev #{gorev_id} bulunamadi")
        gecmis = json.loads(g["durum_gecmisi"] or "[]")
        gecmis.append({"durum": g["durum"], "hedef": hedef,
                       "zaman": round(time.time(), 3), "not": not_})
        self.bag.execute(
            "UPDATE gorevler SET durum=?, durum_gecmisi=?, "
            "guncelleme_tarihi=CURRENT_TIMESTAMP WHERE id=?",
            (gecis(g["durum"], hedef, zorla), json.dumps(gecmis), gorev_id))
        self.bag.commit()

    # ------------------------------------------------------------------ IS

    def ekle(self, baslik, detay="", ajan="ajan_00_orkestrator",
             yetki_seviyesi=1, oncelik=5,
             isletme=None, proje=None, musteri=None):
        """Gorev ekle. Kapsam belirsizse otomatik BLOKE edilir."""
        belirsiz = kapsam_belirsiz_mi(isletme, proje, musteri)
        kimlik = f"{int(time.time()*1000)}-{abs(hash(baslik)) % 10**8:08d}"
        durum = "bloke" if belirsiz else "olusturuldu"

        cur = self.bag.execute(
            "INSERT INTO gorevler (kimlik, baslik, detay, atanan_ajan, "
            "yetki_seviyesi, oncelik, kapsam_isletme, kapsam_proje, "
            "kapsam_musteri, durum, durum_gecmisi) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (kimlik, baslik, detay, ajan, yetki_seviyesi, oncelik,
             isletme or BELIRSIZ, proje or BELIRSIZ, musteri or BELIRSIZ,
             durum, json.dumps([{"durum": durum, "zaman": round(time.time(), 3),
                                 "not": "kapsam belirsiz" if belirsiz else ""}])))
        self.bag.commit()
        return cur.lastrowid

    def al(self):
        """Oncelikli sirayla siradaki gorevi al. Idempotent."""
        satir = self.bag.execute(
            "SELECT * FROM gorevler WHERE durum='olusturuldu' "
            "ORDER BY oncelik DESC, olusturma_tarihi LIMIT 1").fetchone()
        if satir is None:
            return None
        self.durum_ata(satir["id"], "kapsam_cozuldu", "calisiyor: alindi")
        self.bag.execute(
            "UPDATE gorevler SET baslama_tarihi=CURRENT_TIMESTAMP, "
            "deneme_sayisi=deneme_sayisi+1 WHERE id=?", (satir["id"],))
        self.bag.commit()
        return self.bag.execute("SELECT * FROM gorevler WHERE id=?",
                                (satir["id"],)).fetchone()

    # --------------------------------------------------------- IDEMPOTENCY

    def yan_etki_yapildi_mi(self, gorev_id, islem):
        return self.bag.execute(
            "SELECT 1 FROM gorevler WHERE id=? AND idempotency_key=?",
            (gorev_id, idempotency_key(gorev_id, islem))).fetchone() is not None

    def yan_etki_isaretle(self, gorev_id, islem):
        """Ayni is iki kez TETIKLENMEZ. Guvenli yeniden deneme."""
        if self.yan_etki_yapildi_mi(gorev_id, islem):
            return False
        self.bag.execute(
            "UPDATE gorevler SET idempotency_key=? WHERE id=?",
            (idempotency_key(gorev_id, islem), gorev_id))
        self.bag.commit()
        return True

    # -------------------------------------------------------------- KAYIT

    def tokenlari_yaz(self, gorev_id, saglayici, model, girdi, cikti, maliyet):
        self.bag.execute(
            "UPDATE gorevler SET saglayici=?, model_kullanilan=?, "
            "token_girdi=?, token_cikti=?, maliyet_birim=? WHERE id=?",
            (saglayici, model, girdi, cikti, maliyet, gorev_id))
        self.bag.commit()

    def muhur_yaz(self, gorev_id, digest):
        self.bag.execute("UPDATE gorevler SET muhur_digest=? WHERE id=?",
                         (digest, gorev_id))
        self.bag.commit()

    def logla(self, gorev_id, seviye, mesaj, kaynak="sistem", veri=None):
        self.bag.execute(
            "INSERT INTO loglar (gorev_id, seviye, kaynak, mesaj, veri) "
            "VALUES (?,?,?,?,?)",
            (gorev_id, seviye, kaynak, mesaj,
             json.dumps(veri or {}, ensure_ascii=False)))
        self.bag.commit()

    def istatistik(self):
        satirler = self.bag.execute(
            "SELECT durum, COUNT(*) n FROM gorevler GROUP BY durum").fetchall()
        d = {s["durum"]: s["n"] for s in satirler}
        toplam = sum(d.values()) or 1
        t = self.bag.execute(
            "SELECT COALESCE(SUM(token_girdi),0) g, "
            "COALESCE(SUM(token_cikti),0) c, "
            "COALESCE(SUM(maliyet_birim),0) m FROM gorevler "
            "WHERE durum='tamamlandi'").fetchone()
        return {
            "durumlar": d,
            "toplam": sum(d.values()),
            "tamamlanma_orani": round(
                d.get("tamamlandi", 0) / toplam, 3),
            "token_girdi": t["g"], "token_cikti": t["c"],
            "maliyet_birim": round(t["m"], 2),
        }


def idempotency_key(gorev_id, islem):
    import hashlib
    return hashlib.sha256(f"{gorev_id}|{islem}".encode("utf-8")).hexdigest()[:24]
