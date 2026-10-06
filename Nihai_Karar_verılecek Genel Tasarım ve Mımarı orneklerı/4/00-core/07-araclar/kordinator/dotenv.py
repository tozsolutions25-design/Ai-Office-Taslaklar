"""
DOTENV OKUYUCU — harici paket YOK.

Neden var:
  `pip install python-dotenv` gerekir. Bu sistem KURULUM YAPILMAZ
  ve sifir bagimlilik ilkesindedir. 20 satirlik bir dosya ayni isi
  gorur ve hicbir sey kurdurmaz.

Oncelik sirasi:
  1) Ortam degiskeni  (calistir.ps1 veya anahtar-ayarla.ps1 ile)
  2) .env dosyasi     (bu okuyucu)

Ortam degiskeni HER ZAMAN kazanir. Boylece .env icindeki eski bir
anahtar, sistemde gecici olarak tanimlanan yenisini ezmez.
"""
import os

AD = "dotenv"
DOGRULANDI = False  # harici paket yok, yerel implementasyon


def kok_bul(baslangic=None):
    """Proje kokunu bul: .env olan ust dizine kadar yuksel."""
    d = os.path.abspath(baslangic or os.path.dirname(__file__))
    while True:
        if os.path.exists(os.path.join(d, ".env")):
            return d
        ust = os.path.dirname(d)
        if ust == d:
            return None
        d = ust


def ayikla(satir):
    """Tek satiri ayikla: ANAHTAR=deger  ->  ("ANAHTAR", "deger")"""
    s = satir.strip()
    if not s or s.startswith("#"):
        return None
    if s.lower().startswith("export "):
        s = s[7:].strip()
    if "=" not in s:
        return None
    anahtar, _, deger = s.partition("=")
    anahtar = anahtar.strip()
    deger = deger.strip()
    # tirnak temizleme
    if len(deger) >= 2 and deger[0] == deger[-1] and deger[0] in "\"'":
        deger = deger[1:-1]
    if not anahtar:
        return None
    return anahtar, deger


def yukle(yol=None, zorla=False):
    """
    .env dosyasini oku ve os.environ'a yaz.

    zorla=False (varsayilan): ortamda ZATEN tanimli olan degiskeni
                              EZMEZ. Ortam degiskeni kazanir.
    zorla=True              : .env her sey EZER (tehlikeli, kullanma).

    Doner: {"yuklenen": [...], "atlanan": [...], "yol": "..."}
    """
    sonuc = {"yuklenen": [], "atlanan": [], "yol": None}
    y = yol or (os.path.join(kok_bul(), ".env") if kok_bul() else None)
    if not y or not os.path.exists(y):
        return sonuc
    sonuc["yol"] = y

    with open(y, encoding="utf-8-sig") as f:
        for satir in f:
            cift = ayikla(satir)
            if not cift:
                continue
            anahtar, deger = cift
            if not deger:
                sonuc["atlanan"].append(anahtar)   # bos satir = tanimsiz
                continue
            if anahtar in os.environ and not zorla:
                sonuc["atlanan"].append(anahtar)   # ortam kazanir
                continue
            os.environ[anahtar] = deger
            sonuc["yuklenen"].append(anahtar)
    return sonuc


def tanimli(*adlar):
    """Hangi anahtarlar tanimli ve bos degil? (degeri ASLA donmez)"""
    yukle()
    out = {}
    for a in adlar:
        v = os.getenv(a)
        out[a] = bool(v and v.strip())
    return out


def ozet():
    """Tanimsiz durumu yazdir. Degerleri GOSTERMEZ."""
    yukle()
    satirlar = []
    for a in ("OPENROUTER_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY"):
        v = os.getenv(a)
        satirlar.append(
            f"  {a:<22} {'VAR (' + str(len(v)) + ' karakter)' if v else 'YOK'}")
    return "\n".join(satirlar)