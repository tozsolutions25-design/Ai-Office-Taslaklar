import os, sqlite3, sys
KOK = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DB = os.path.join(KOK, "00-core", "01-kuyruk", "kuyruk.db")
SQL = os.path.join(KOK, "00-core", "01-kuyruk", "kuyruk-olustur.sql")
os.makedirs(os.path.dirname(DB), exist_ok=True)
with open(SQL, encoding="utf-8") as f:
    sql = f.read()
c = sqlite3.connect(DB)
c.executescript(sql)
n = c.execute("SELECT COUNT(*) FROM gorevler").fetchone()[0]
if n == 0:
    c.execute("INSERT INTO gorevler (kimlik, baslik, detay, atanan_ajan, "
              "yetki_seviyesi, oncelik, kapsam_isletme, kapsam_proje, "
              "kapsam_musteri, durum) VALUES (?,?,?,?,?,?,?,?,?,?)",
              ("00000000T000000Z-t0000000-s000000", "Sistem Kurulum Testi",
               "V3 semasi ve kurtarma dogrulanacak.",
               "ajan_00_orkestrator", 0, 1, "TOZ", "Kurulum", "SISTEM",
               "olusturuldu"))
c.commit()
cols = [r[1] for r in c.execute("PRAGMA table_info(gorevler)")]
print(f"[OK] {DB}")
print(f"     gorev sayisi: {n+1 if n==0 else n}")
print(f"     gorev sutun: {len(cols)}")
print(f"     tablolar: {[r[0] for r in c.execute('SELECT name FROM sqlite_master WHERE type=\"table\"')]}")
c.close()
