"""
MIMARI TESTLERI — V3

Bagimlilik YOK (unittest). pip install gerekmez.

Kurpustan ogrenilen ders: "Scriptler test edilmemis halde birakildi."
Bu dosya o tekrarin olmamasi icin var. calistir.ps1 bunu calistirmadan
SISTEMI CALISTIRMAZ.

Kapsam: her "10/10" iddiasinin arkasindaki INVARIANT.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kordinator import (  # noqa: E402
    Muhur,
    MuhurDogrulanmaHatasi,
    Sigorta,
    SigortaKumesi,
    KaliciHata,
    Kuyruk,
    OnayKapisi,
    OnayGerekli,
    OnayReddedildi,
    SirBulundu,
    gecis,
    gecis_kontrol,
    kapsam_belirsiz_mi,
    idempotency_key,
    ucuslu_isaretleri,
    onbellek_uygun_mu,
    ttl_sec,
    maliyet_birim,
    Rapor,
    Ollama,
)
from kordinator.kuyruk import GecersizGecis  # noqa: E402


class MuhurTestleri(unittest.TestCase):
    """INVARIANT: Failover maliyeti gecmisten BAGIMSIZDIR (O(1))."""

    def test_maliyet_gecmisten_bagimsiz(self):
        a = Muhur("gorev")
        b = Muhur("gorev")
        for _ in range(5000):
            b.gecmis_ekle({"icerik": "x" * 300})
        self.assertLess(abs(a.token_tahmini() - b.token_tahmini()), 40)

    def test_failover_yuku_sabit(self):
        a = Muhur("k")
        b = Muhur("k")
        for i in range(5000):
            b.gecmis_ekle({"icerik": "x"})
        self.assertEqual(a.failover_yuku_token(), b.failover_yuku_token())

    def test_ret_ledgeri_korunur(self):
        m = Muhur("k")
        m.karar_kaydet("K1", "Claude Code yok", "ikinci koordinator")
        m.red_kaydet("R1", "TikTok otomasyonu", "KVKK")
        m.kisit_ekle("butce sifir")
        p = m.projeksiyon()
        self.assertIn("REDDEDILENLER", p)
        self.assertIn("TikTok otomasyonu", p)
        self.assertTrue(m.reddedildi_mi("TikTok"))

    def test_digest_degisir(self):
        a, b = Muhur("k"), Muhur("farkli")
        self.assertNotEqual(a.digest(), b.digest())
        a.karar_kaydet("K1", "x")
        self.assertNotEqual(a.digest(), b.digest())

    def test_dict_dan_gidis_donus(self):
        m = Muhur("k")
        m.karar_kaydet("K1", "x", "y")
        m.red_kaydet("R1", "z")
        m.sonraki_adim_ata("w")
        n = Muhur.dan(m.dict())
        self.assertEqual(m.digest(), n.digest())
        self.assertEqual(m.projeksiyon(), n.projeksiyon())

    def test_sir_yazilamaz(self):
        m = Muhur("k")
        m.kisiti = None
        m2 = Muhur("k")
        m2.sonraki_adim_ata("token sk-or-v1-49a3f9c2e7b1d8a6")
        self.assertTrue(m2.sir_tasiyor_mu())
        with self.assertRaises(SirBulundu):
            m2.kontrol()

    def test_kucuk_pencerede_sigar(self):
        self.assertTrue(Muhur("x").her_modele_sigar(4000))

    def test_iki_bolge_ayri(self):
        m = Muhur("Ankara")
        m.karar_kaydet("K1", "x")
        self.assertIn("KARARLAR", m.kararli_bolge())
        self.assertIn("HEDEF", m.ucuslu_bolge())
        self.assertNotIn("Ankara", m.kararli_bolge())


class MuhurDogrulamaTestleri(unittest.TestCase):
    """INVARIANT: Baglam kaybi SESSIZ OLAMAZ."""

    def test_dogru_ack_kabul(self):
        m = Muhur("k")
        m.karar_kaydet("K1", "x")
        self.assertTrue(Muhur.dogrula(m, Muhur.ack_uret(m)))

    def test_yanlis_ack_reddedilir(self):
        m = Muhur("k")
        with self.assertRaises(MuhurDogrulanmaHatasi):
            Muhur.dogrula(m, Muhur.ack_uret(Muhur("baska")))

    def test_kismi_ack_reddedilir(self):
        m = Muhur("k")
        m.karar_kaydet("K1", "x")
        eksik = Muhur.dan(m.dict())
        eksik.kararlar = []
        with self.assertRaises(MuhurDogrulanmaHatasi):
            Muhur.dogrula(m, eksik)


class SigortaTestleri(unittest.TestCase):
    """INVARIANT: Cokmus saglayiciya istek GONDERILMEZ."""

    def test_oran_ile_acar(self):
        s = Sigorta("t", esik_oran=0.5, pencere_sn=60)
        for _ in range(6):
            s.basari(simdi=0)
        for _ in range(7):
            s.hata("429", simdi=0)
        self.assertEqual(s.durum_oku(0), "acik")

    def test_dusuk_oran_kapali_kalir(self):
        s = Sigorta("t", esik_oran=0.5, pencere_sn=60)
        for _ in range(6):
            s.basari(simdi=0)
        for _ in range(4):
            s.hata("429", simdi=0)
        self.assertEqual(s.durum_oku(0), "kapali")

    def test_kalici_hata_devreyi_acmaz(self):
        s = Sigorta("t")
        with self.assertRaises(KaliciHata):
            s.hata(KaliciHata("401 anahtar hatasi"), simdi=0)
        self.assertEqual(s.durum_oku(0), "kapali")

    def test_soguma_sonrasi_otomatik_yari_acik(self):
        s = Sigorta("t", soguma_sn=30)
        for _ in range(7):
            s.hata("500", simdi=0)
        for _ in range(6):
            s.basari(simdi=0)
        self.assertEqual(s.durum_oku(10), "acik")
        self.assertEqual(s.durum_oku(31), "yari_acik")

    def test_soguma_ikiye_katlanir(self):
        s = Sigorta("t", soguma_sn=30)
        for _ in range(7):
            s.hata("500", simdi=0)
        for _ in range(6):
            s.basari(simdi=0)
        s.durum_oku(31)
        s.hata("500", simdi=31)
        self.assertEqual(s.carpan, 2)

    def test_tam_jitter_dagilir(self):
        s = Sigorta("t")
        ornek = {round(s.bekle_suresi(5), 3) for _ in range(200)}
        self.assertGreater(len(ornek), 40)
        self.assertTrue(all(0 <= s.bekle_suresi(6) <= 20 for _ in range(50)))

    def test_retry_after_once_gelir(self):
        self.assertEqual(Sigorta("t").bekle_suresi(0, retry_after_sn=17), 17.0)

    def test_kapsam_ayri(self):
        k = SigortaKumesi()
        a, b = k.al("gemini"), k.al("groq")
        for _ in range(7):
            a.hata("500", simdi=0)
        for _ in range(6):
            b.basari(simdi=0)
        self.assertEqual(a.durum_oku(0), "acik")
        self.assertEqual(b.durum_oku(0), "kapali")
        self.assertIn("groq", k.saglamlar())


class KuyrukTestleri(unittest.TestCase):
    """INVARIANT: Terminal durumlar donmez; yarim gorev kurtarilir."""

    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.k = Kuyruk(os.path.join(self.d, "t.db"))
        self.k.bag.executescript(_SEMA)

    def tearDown(self):
        self.k.kapat()

    def test_ekle_ve_al(self):
        gid = self.k.ekle("test gorevi", "detay", isletme="TOZ",
                          proje="P", musteri="M1")
        g = self.k.al()
        self.assertIsNotNone(g)
        self.assertEqual(g["id"], gid)

    def test_belirsiz_kapsam_bloke(self):
        gid = self.k.ekle("test", isletme=None, proje=None, musteri=None)
        durum = self.k.bag.execute(
            "SELECT durum FROM gorevler WHERE id=?", (gid,)).fetchone()["durum"]
        self.assertEqual(durum, "bloke")

    def test_kapsam_belirsiz_mi(self):
        self.assertTrue(kapsam_belirsiz_mi(None, "P", "M"))
        self.assertTrue(kapsam_belirsiz_mi("TOZ", "_unresolved", "M"))
        self.assertFalse(kapsam_belirsiz_mi("TOZ", "P", "M"))

    def test_terminal_donmez(self):
        for d in ("tamamlandi", "basarisiz", "olum_kutusu"):
            self.assertFalse(gecis_kontrol(d, "calisiyor"))

    def test_gecersiz_gecis_atar(self):
        gid = self.k.ekle("x", isletme="A", proje="B", musteri="C")
        with self.assertRaises(GecersizGecis):
            self.k.durum_ata(gid, "tamamlandi")

    def test_kurtarma_yarim_gorevi_alir(self):
        """
        V2'de yarih kalan 'calisiyor' gorev kalici olarak kaybolurdu.
        Kurtarma, gorevi 'olusturuldu'ya ALIR (zorlama gecis).
        """
        gid = self.k.ekle("yarim", isletme="A", proje="B", musteri="C")
        self.k.al()                                   # -> kapsam_cozuldu
        for hedef in ("rota_secildi", "beceri_cozuldu",
                      "yetenek_cozuldu", "calisiyor"):
            self.k.durum_ata(gid, hedef, "simulate crash")
        self.k.bag.close()
        self.k = Kuyruk(os.path.join(self.d, "t.db"))
        k = self.k.kurtar()
        self.assertEqual(k["kurtarilan"], 1)
        durum = self.k.bag.execute("SELECT durum FROM gorevler WHERE id=?",
                                    (gid,)).fetchone()["durum"]
        self.assertEqual(durum, "olusturuldu")

    def test_kurtarma_deneme_asimi_olum_kutusu(self):
        gid = self.k.ekle("asilan", isletme="A", proje="B", musteri="C")
        self.k.bag.execute("UPDATE gorevler SET durum='calisiyor', "
                           "deneme_sayisi=5, max_deneme=3 WHERE id=?", (gid,))
        self.k.bag.commit()
        k = self.k.kurtar()
        self.assertEqual(k["olum_kutusu"], 1)

    def test_idempotency_tekrar_engeli(self):
        gid = self.k.ekle("mail", isletme="A", proje="B", musteri="C")
        self.assertTrue(self.k.yan_etki_isaretle(gid, "eposta"))
        self.assertFalse(self.k.yan_etki_isaretle(gid, "eposta"))

    def test_istatistik(self):
        self.k.ekle("a", isletme="A", proje="B", musteri="C")
        st = self.k.istatistik()
        self.assertGreaterEqual(st["toplam"], 1)

    def test_kurtarma_tekrar_idempotent(self):
        """
        Kurtarma iki kez calistirilirsa ayni gorevi ASLA tekrar
        geri almaz ve terminal durumu bozmaz.
        """
        gid = self.k.ekle("x", isletme="A", proje="B", musteri="C")
        self.k.al()
        for hedef in ("rota_secildi", "beceri_cozuldu",
                      "yetenek_cozuldu", "calisiyor"):
            self.k.durum_ata(gid, hedef, "crash")
        self.assertEqual(self.k.kurtar()["kurtarilan"], 1)
        self.assertEqual(self.k.kurtar()["kurtarilan"], 0)
        durum = self.k.bag.execute("SELECT durum FROM gorevler WHERE id=?",
                                    (gid,)).fetchone()["durum"]
        self.assertEqual(durum, "olusturuldu")


_SEMA = """
CREATE TABLE IF NOT EXISTS gorevler (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kimlik TEXT UNIQUE, baslik TEXT NOT NULL, detay TEXT,
    kapsam_isletme TEXT, kapsam_proje TEXT, kapsam_musteri TEXT,
    atanan_ajan TEXT, yetki_seviyesi INTEGER DEFAULT 1,
    oncelik INTEGER DEFAULT 5,
    durum TEXT DEFAULT 'olusturuldu', durum_gecmisi TEXT,
    model_kullanilan TEXT, saglayici TEXT,
    token_girdi INTEGER DEFAULT 0, token_cikti INTEGER DEFAULT 0,
    maliyet_birim REAL DEFAULT 0,
    deneme_sayisi INTEGER DEFAULT 0, max_deneme INTEGER DEFAULT 3,
    hata TEXT, onay_durumu TEXT DEFAULT 'gerekmiyor',
    muhur_digest TEXT, idempotency_key TEXT,
    olusturma_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP,
    baslama_tarihi DATETIME, bitis_tarihi DATETIME,
    guncelleme_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS loglar (
    id INTEGER PRIMARY KEY AUTOINCREMENT, gorev_id INTEGER,
    seviye TEXT, kaynak TEXT, mesaj TEXT, veri TEXT,
    tarih DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS onaylar (
    id INTEGER PRIMARY KEY AUTOINCREMENT, gorev_id INTEGER,
    soru TEXT NOT NULL, secenekler TEXT, yanit TEXT,
    durum TEXT DEFAULT 'bekliyor',
    istenen_zaman DATETIME DEFAULT CURRENT_TIMESTAMP,
    yanit_zamani DATETIME, bitis_zamani DATETIME
);
"""


class OnayTestleri(unittest.TestCase):
    """INVARIANT: Yetki >= 2 onay ister; seviye 4 ASLA otomatik."""

    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.k = Kuyruk(os.path.join(self.d, "o.db"))
        self.k.bag.executescript(_SEMA)
        self.gid = self.k.ekle("g", isletme="A", proje="B", musteri="C")

    def tearDown(self):
        self.k.kapat()

    def test_seviye_0_1_gecer(self):
        o = OnayKapisi(self.k)
        self.assertEqual(o.uygula(self.gid, "okuma", 0)["durum"], "gerekmiyor")
        self.assertEqual(o.uygula(self.gid, "taslak", 1)["durum"], "gerekmiyor")

    def test_seviye_4_her_zaman_reddedilir(self):
        o = OnayKapisi(self.k)
        with self.assertRaises(OnayGerekli):
            o.uygula(self.gid, "odeme", 4)

    def test_seviye_2_onay_bekler(self):
        o = OnayKapisi(self.k, zaman_asimi_dk=0)
        with self.assertRaises(OnayGerekli):
            o.uygula(self.gid, "eposta", 2)

    def test_yanit_verilir(self):
        o = OnayKapisi(self.k)
        # "hayir" -> reddedildi, "evet" -> onaylandi
        self.assertEqual(OnayKapisi.yanitla(self.k, 1, "hayir"), "reddedildi")
        self.assertEqual(OnayKapisi.yanitla(self.k, 1, "evet"), "onaylandi")
        self.assertEqual(OnayKapisi.yanitla(self.k, 1, "?"), "bekliyor")


class RaporTestleri(unittest.TestCase):
    """INVARIANT: limit-durumu.json'daki METAVERI saglayici sanilmaz.

    V3'te worker.py gercekten coktu: durum_raporu() '_aciklama'
    (string) degerini saglayici sanip .get() cagirdi -> AttributeError.
    Bu test o hatayi geri getirir.
    """

    def test_durum_raporu_metaveri_atlar(self):
        import io
        import contextlib
        from kordinator.router import durum_raporu

        gercek = {
            "_aciklama": "SAGLAYICI KOTALARI",
            "_KRITIK_UYARI": ["a", "b"],
            "_rota_sirasi": ["openrouter", "gemini"],
            "openrouter": {"gunluk_limit": 200, "kullanilan": 3,
                           "dogrulama_durumu": "yapilmadi"},
            "local_ollama": {"gunluk_limit": -1, "kullanilan": 0,
                             "dogrulama_durumu": "test edilecek"},
        }
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            saglam = durum_raporu(SigortaKumesi(), gercek)
        cikti = buf.getvalue()
        self.assertIn("openrouter", cikti)
        self.assertIn("local_ollama", cikti)
        self.assertNotIn("_aciklama", cikti)
        self.assertNotIn("_rota_sirasi", cikti)

    def test_limit_dosyasi_metaveri_ayirir(self):
        import json
        y = os.path.join(
            os.path.abspath(os.path.join(os.path.dirname(__file__),
                                         "..", "..")),
            "00-core", "02-yonlendirici", "limit-durumu.json")
        with open(y, encoding="utf-8") as f:
            d = json.load(f)
        for ad, o in d.items():
            if ad.startswith("_"):
                continue
            self.assertIsInstance(o, dict,
                                  f"{ad} metaveri gibi davraniliyor")


class DotenvTestleri(unittest.TestCase):
    """
    INVARIANT: .env okunur, ama ortam degiskeni HER ZAMAN kazanir.

    Bu test .env dosyasini GERCEKTE yazmaz; gecici dosya kullanir.
    Kullaniciya ait .env dosyasina DOKUNMAZ.
    """

    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.y = os.path.join(self.d, ".env")

    def tearDown(self):
        for a in ("TEST_ANAHTAR", "ORTAM_USTUN", "TIRNAKLI"):
            os.environ.pop(a, None)

    def yaz(self, ic):
        with open(self.y, "w", encoding="utf-8") as f:
            f.write(ic)

    def test_ayikla(self):
        from kordinator.dotenv import ayikla
        self.assertEqual(ayikla("A=1"), ("A", "1"))
        self.assertEqual(ayikla("A=1  "), ("A", "1"))
        self.assertEqual(ayikla('A="x y"'), ("A", "x y"))
        self.assertEqual(ayikla("A='x'"), ("A", "x"))
        self.assertEqual(ayikla("export A=1"), ("A", "1"))
        self.assertIsNone(ayikla("# yorum"))
        self.assertIsNone(ayikla(""))
        self.assertIsNone(ayikla("sonuz atama"))

    def test_bos_satir_atlanir(self):
        from kordinator import dotenv
        self.yaz("TEST_ANAHTAR=\n")
        r = dotenv.yukle(self.y)
        self.assertNotIn("TEST_ANAHTAR", r["yuklenen"])
        self.assertIn("TEST_ANAHTAR", r["atlanan"])

    def test_yukler(self):
        from kordinator import dotenv
        self.yaz("TEST_ANAHTAR=deger-123\n")
        r = dotenv.yukle(self.y)
        self.assertEqual(os.environ["TEST_ANAHTAR"], "deger-123")
        self.assertIn("TEST_ANAHTAR", r["yuklenen"])

    def test_ortam_ustun(self):
        """
        KRITIK: .env icindeki eski anahtar, sistemde gecici olarak
        tanimlanan yeniyi EZMEZ. Yoksa .env'deki yanimis deger
        sessizce kullanilir ve neden anlasilmaz.
        """
        from kordinator import dotenv
        os.environ["TEST_ANAHTAR"] = "ortamdaki"
        self.yaz("TEST_ANAHTAR=envdekiler\n")
        dotenv.yukle(self.y)
        self.assertEqual(os.environ["TEST_ANAHTAR"], "ortamdaki")

    def test_zorla_ezebilir_ama_ozel(self):
        from kordinator import dotenv
        os.environ["TEST_ANAHTAR"] = "ortamdaki"
        self.yaz("TEST_ANAHTAR=envdekiler\n")
        dotenv.yukle(self.y, zorla=True)
        self.assertEqual(os.environ["TEST_ANAHTAR"], "envdekiler")

    def test_yorumlar_atlanir(self):
        from kordinator import dotenv
        self.yaz("# yorum\n\n  \n#BOS=1\nTEST_ANAHTAR=x\n")
        r = dotenv.yukle(self.y)
        self.assertNotIn("BOS", os.environ)
        self.assertEqual(os.environ["TEST_ANAHTAR"], "x")

    def test_proje_env_dosyasi_yok(self):
        """Dosya yoksa hata vermez, bos sonuc doner."""
        from kordinator import dotenv
        r = dotenv.yukle(os.path.join(self.d, "yok.env"))
        self.assertEqual(r["yuklenen"], [])

    def test_ozet_deger_gostermez(self):
        from kordinator import dotenv
        self.yaz("TEST_ANAHTAR=gizli-deger\n")
        dotenv.yukle(self.y)
        self.assertNotIn("gizli-deger", dotenv.ozet())

    def test_paket_importunda_yuklenir(self):
        """
        kordinator import edildiginde .env YUKLENMIS olmali.
        Aksi halde saglayici istemcisi anahtari bos bulur.
        """
        import kordinator
        self.assertTrue(os.environ.get("ANAYASA_KOK_DOGRULA", "1"))


class SirTaramaTestleri(unittest.TestCase):
    """
    INVARIANT: Ihlal, anahtarin dosyada olmasi degil
               GIT'E GIRMIS olmasidir.

    Onceki surum her .env dosyasini ihlal sayiyordu; bu, dogru
    yazilmis bir .env dosyasinda araci kullanilamaz kiliyordu.
    """

    ARAC = os.path.join(os.path.dirname(os.path.abspath(__file__)))
    KOK = os.path.abspath(os.path.join(ARAC, "..", ".."))

    def setUp(self):
        sys.path.insert(0, os.path.join(self.KOK, "00-core", "07-araclar"))
        import sir_tara
        self.m = sir_tara

    def test_env_dosyasi_izlenmiyorsa_temiz(self):
        if os.path.exists(os.path.join(self.KOK, ".git")):
            self.skipTest("gercek git deposu var; izlenmeyi bozuyor")
        import shutil
        geri = None
        y = os.path.join(self.KOK, ".env")
        if os.path.exists(y):
            geri = y + ".test-yedek"
            shutil.copy(y, geri)
        try:
            with open(y, "w", encoding="utf-8") as f:
                f.write("OPENROUTER_API_KEY=sk-or-v1-" + "a" * 40 + "\n")
            bulgular, _, _, _ = self.m.tara_agac()
            self.assertEqual(
                [b for b in bulgular if b[0] == ".env"], [],
                "anahtar .env icinde DOGRU; ihlal sayilmamali")
        finally:
            if geri:
                shutil.move(geri, y)
            elif os.path.exists(y):
                os.remove(y)

    def test_env_ornek_anahtar_icerirse_suphe(self):
        """
        Sablon (.env.example) Git'e GIRER; icinde anahtar OLMAMALI.
        """
        d = tempfile.mkdtemp()
        y = os.path.join(d, ".env.example")
        with open(y, "w", encoding="utf-8") as f:
            f.write("OPENROUTER_API_KEY=sk-or-v1-" + "a" * 40 + "\n")
        bulgular = []
        self.m.tara_metin(open(y, encoding="utf-8").read(), ".env.example",
                          bulgular)
        self.assertTrue(bulgular, "sablondaki anahtar yakalanmadi")


class OnbellekTestleri(unittest.TestCase):
    """INVARIANT: Ayni token 10 kat farkli fiyat."""

    def test_okuma_yazmadan_ucuz(self):
        self.assertLess(maliyet_birim(10000, 0, True),
                        maliyet_birim(10000, 0, False))

    def test_yarim_onbellek_kazanci(self):
        r = Rapor(9000, 1000, onbellekli=True)
        self.assertAlmostEqual(r.maliyet, 1900.0)
        self.assertAlmostEqual(r.kazanc, 0.81, places=2)

    def test_tam_onbellek_kazanci(self):
        self.assertAlmostEqual(Rapor(10000, 0, True).kazanc, 0.90, places=2)

    def test_esik_altinda_onbelleklenmez(self):
        self.assertFalse(onbellek_uygun_mu("x" * 1000, "sonnet"))
        self.assertTrue(onbellek_uygun_mu("x" * 10000, "sonnet"))

    def test_zaman_damgasi_yakalanir(self):
        self.assertTrue(ucuslu_isaretleri("Bugun 2026-10-05T09:30:00Z"))
        self.assertTrue(ucuslu_isaretleri("session_id: abc"))

    def test_kararli_onek_temiz(self):
        self.assertEqual(ucuslu_isaretleri("Sen bir calisansin."), [])

    def test_ttl_secimi(self):
        self.assertEqual(ttl_sec(60), "5dk")
        self.assertEqual(ttl_sec(600), "1saat")


class YapilandirmaTestleri(unittest.TestCase):
    """Kurulum dosyalari eksiksiz ve tutarli mi?"""

    KOK = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

    def test_limit_dosyasi_var(self):
        import json
        y = os.path.join(self.KOK, "00-core", "02-yonlendirici",
                         "limit-durumu.json")
        self.assertTrue(os.path.exists(y), "limit-durumu.json yok")
        with open(y, encoding="utf-8") as f:
            d = json.load(f)
        self.assertIn("local_ollama", d)

    def test_limitler_dogrulama_alani_tasiyor(self):
        """
        Her saglayici icin 'dogrulama_durumu' alani OLMAK ZORUNDA.
        '_' ile baslayan anahtarlar metaveridir, saglayici degildir.
        """
        import json
        y = os.path.join(self.KOK, "00-core", "02-yonlendirici",
                         "limit-durumu.json")
        with open(y, encoding="utf-8") as f:
            d = json.load(f)
        saglayicilar = [k for k in d if not k.startswith("_")]
        self.assertGreaterEqual(len(saglayicilar), 3)
        for ad in saglayicilar:
            self.assertIn("dogrulama_durumu", d[ad],
                          f"{ad} icinde dogrulama_durumu alani yok")
            self.assertIn("not", d[ad], f"{ad} icinde 'not' alani yok")

    def test_ajan_yaml_model_sabitlemiyor(self):
        """
        K-02: Rol modele degil yetkiye baglanir.

        YORUM SATIRLARI denetlenmez — bir kurali aciklamak icin
        metinde gecmesi, kurali ihlal etmek demek DEGILDIR.
        """
        d = os.path.join(self.KOK, "11_Ajanlar")
        if not os.path.isdir(d):
            self.skipTest("11_Ajanlar yok")
        for ad in os.listdir(d):
            if not ad.endswith(".yaml"):
                continue
            with open(os.path.join(d, ad), encoding="utf-8") as f:
                ic = f.read()
            kod = "\n".join(s for s in ic.splitlines()
                            if not s.strip().startswith("#"))
            self.assertNotIn("model_tercihi:", kod,
                             f"{ad} model sabitliyor (K-02)")
            self.assertNotIn("sabit_model", kod,
                             f"{ad} model sabitliyor (K-02)")
            self.assertIn("yetki_seviyesi:", kod,
                          f"{ad} yetki bildirilmemis (K-05)")


class AnayasaTestleri(unittest.TestCase):
    """8 kural gercekten denetleniyor mu?"""

    KOK = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

    def test_ihlal_tespiti(self):
        sys.path.insert(0, os.path.join(self.KOK, "00-core", "07-araclar"))
        import anayasa_kontrolu
        ihlaller = anayasa_kontrolu.denetle()
        self.assertIsInstance(ihlaller, list)

    def test_kurallar_tanimli(self):
        sys.path.insert(0, os.path.join(self.KOK, "00-core", "07-araclar"))
        import anayasa_kontrolu
        self.assertEqual(len(anayasa_kontrolu.KURALLAR), 8)


if __name__ == "__main__":
    unittest.main(verbosity=2)
