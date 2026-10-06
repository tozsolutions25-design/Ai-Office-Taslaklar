-- TOZ SOLUTIONS OTONOM AI OFISI v3 — KUYUK SEMASI
--
-- V2'den farklar:
--   + kimlik (zaman + ozet + rastgele)
--   + kapsam (isletme/proje/musteri) — cozulemezse BLOKE
--   + yetki_seviyesi (K-05 zorunlu)
--   + oncelik
--   + durum_gecmisi (JSON) — hangi asamadan gecildi
--   + token_girdi / token_cikti / maliyet_birim  (sabit 150 DEGIL)
--   + deneme_sayisi / max_deneme
--   + muhur_digest  (failover butunlugu)
--   + idempotency_key (yan etki korumasi)
--   + onaylar tablosu (V2'de YOKTU — anayasada yaziliydi, kodda degil)
--   + olum_kutusu (DLQ) — islenemeyen is gorunur durur

CREATE TABLE IF NOT EXISTS gorevler (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    kimlik            TEXT UNIQUE,
    baslik            TEXT NOT NULL,
    detay             TEXT,

    -- KAPSAM: cozulemezse '_unresolved'. Kimlik UYDURULMAZ.
    kapsam_isletme    TEXT DEFAULT '_unresolved',
    kapsam_proje      TEXT DEFAULT '_unresolved',
    kapsam_musteri    TEXT DEFAULT '_unresolved',

    atanan_ajan       TEXT,
    yetki_seviyesi    INTEGER DEFAULT 1,   -- K-05: bildirilmesi zorunlu
    oncelik           INTEGER DEFAULT 5,

    -- 11 DURUMLU MAKINE
    durum             TEXT DEFAULT 'olusturuldu',
    durum_gecmisi     TEXT,                -- JSON: [{durum, zaman, not}]

    model_kullanilan  TEXT,
    saglayici         TEXT,
    token_girdi       INTEGER DEFAULT 0,
    token_cikti       INTEGER DEFAULT 0,
    maliyet_birim     REAL    DEFAULT 0,  -- onbellek-duyarli GERCEK maliyet

    deneme_sayisi     INTEGER DEFAULT 0,
    max_deneme        INTEGER DEFAULT 3,
    hata              TEXT,
    onay_durumu       TEXT DEFAULT 'gerekmiyor',

    muhur_digest      TEXT,                -- baglam butunlugu
    idempotency_key   TEXT,                -- ayni is iki kez TETIKLENMEZ

    olusturma_tarihi  DATETIME DEFAULT CURRENT_TIMESTAMP,
    baslama_tarihi    DATETIME,
    bitis_tarihi      DATETIME,
    guncelleme_tarihi DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gorev_durum   ON gorevler(durum);
CREATE INDEX IF NOT EXISTS idx_gorev_oncelik ON gorevler(oncelik DESC, olusturma_tarihi);
CREATE INDEX IF NOT EXISTS idx_gorev_kimlik  ON gorevler(kimlik);
CREATE INDEX IF NOT EXISTS idx_gorev_idem    ON gorevler(idempotency_key);

-- Terminal durumlar DONMEZ (bitmis is bitmistir)
CREATE TRIGGER IF NOT EXISTS trg_terminal_koruma
BEFORE UPDATE OF durum ON gorevler
FOR EACH ROW WHEN OLD.durum IN ('tamamlandi','basarisiz','olum_kutusu')
BEGIN
    SELECT RAISE(ABORT, 'Terminal durum donemez: ' || OLD.durum);
END;

CREATE TABLE IF NOT EXISTS loglar (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    gorev_id  INTEGER,
    seviye    TEXT,
    kaynak    TEXT,
    mesaj     TEXT,
    veri      TEXT,                        -- JSON: token, saglayici, sure
    tarih     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(gorev_id) REFERENCES gorevler(id)
);

CREATE INDEX IF NOT EXISTS idx_log_gorev ON loglar(gorev_id);
CREATE INDEX IF NOT EXISTS idx_log_seviye ON loglar(seviye, tarih);

-- V2'de bu tablo YOKTU. Anayasada "insani onay" yaziliydi,
-- worker.py'de tek bir onay kontrolu yoktu.
CREATE TABLE IF NOT EXISTS onaylar (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    gorev_id      INTEGER,
    soru          TEXT NOT NULL,
    secenekler    TEXT,
    yanit         TEXT,
    durum         TEXT DEFAULT 'bekliyor',  -- bekliyor|onaylandi|reddedildi|iptal
    istenen_zaman DATETIME DEFAULT CURRENT_TIMESTAMP,
    yanit_zamani  DATETIME,
    bitis_zamani  DATETIME,                -- otomatik iptal icin
    FOREIGN KEY(gorev_id) REFERENCES gorevler(id)
);

CREATE INDEX IF NOT EXISTS idx_onay_durum ON onaylar(durum, bitis_zamani);
