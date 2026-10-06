# KURULUM SIRA SI

> Kaynak: `08_KURULUM_ONCESI_GO_NO_GO.md`, `13_90_GUNLUK_KURULUM_PLANI.md`,
> `11_KURULUM/KURULUM_SIRASI.md`, `V3_DURUM_RAPORU §6`
> Tarih: 2026-10-06

---

## TEMEL KURAL

> *"Her aşama: **KUR → TEST ET → SONUCU KAYDET → DOĞRULA → SONRA DEVAM ET.**
> Bir test başarısızsa sonraki aşamaya geçilmez."*
> — `01_OKU_BENI.md`

**Bu kurulum "kod yazma" değildir. Bu, V3 kodu kullanmaya hazırlamaktır.**
Kod 3307 satır ve 58 testi geçiyor. Eksik olan tek şey: **gerçek anahtar.**

---

## AŞAMA 0 · ORTAM

**Süre:** 5 dakika

```powershell
# Python var mı?
python --version

# Git var mı?
git --version

# Node (isteğe bağlı)
node --version
```

**Doğrulama:** Python **3.11+** (3.14 test edildi)
**Geçmezse:** Python yükle → **durdur**

---

## AŞAMA 1 · ANAYASA KAPISI

**Süre:** 10 saniye — kod yazmadan önce

```powershell
cd C:\Users\TozSolutions\Desktop\Ai_Office_Opencode
python 00-core\07-araclar\anayasa_kontrolu.py
```

**Beklenen:**
```
SONUC: GECTI - 8/8 kural saglandi.
Sistem ayaga kalkabilir.
```

**8 kural:** K-01 tek koordinator · K-02 model sabitlenmez ·
K-03 test edilmemiş failover · K-04 şifre izlenen ağaçta ·
K-05 bildirilmemiş yetki · K-06 seviye 4 otomatik ·
K-07 kaynaksız iddia · K-08 uçucu içerik

> **İhlal varsa sistem ayaga KALKMAZ.** Bu bir hata değil, tasarım.
> `calistir.ps1` bu kontrolü her çalıştırmada yapar.

---

## AŞAMA 2 · SIR TARAMASI

**Süre:** 30 saniye

```powershell
python 00-core\07-araclar\sir_tara.py
```

**Beklenen:**
```
SONUC: TEMIZ.
Kodda ve agacta anahtar YOK.
```

### "Git deposu değil" uyarısı

```
NOT: Bu klasor git deposu DEGIL. K-04'un 'izlenen agac'
     kurali henuz TETIKLENMEZ. Git init et:
       git init
       git add 00-core 10_Anayasa 11_Ajanlar
```

Bu **uyarı, ihlal değil.** `.env` bu depoda yok. Ama git başlatmak istersen:

```powershell
git init
git add 00-core 10_Anayasa 11_Ajanlar 00_TEK_OTORITE 01_MIMARI
git commit -m "ilk: V3 kodu + tek otorite"
```

> `.env` `.gitignore`'da olduğu için otomatik dışlanır.
> `push` **otomatik değildir.**

---

## AŞAMA 3 · VERİTABANI

**Süre:** 10 saniye

```powershell
python 00-core\07-araclar\db_init.py
```

**Beklenen:** Tablolar `gorevler`, `onaylar`, `loglar`

**Oluşan dosya:** `00-core/01-kuyruk/kuyruk.db`

---

## AŞAMA 4 · TESTLER

**Süre:** 1 saniye

```powershell
python 00-core\07-araclar\test_mimarisi.py
```

**Beklenen:**
```
Ran 58 tests in 0.7s
OK
```

| Test grubu | Adet | Ne doğrular |
|---|:--:|---|
| `SigortaTestleri` | 8 | Devre kesici, tam jitter, soğuma |
| `MuhurTestleri` | 8 | O(1) bağlam, ret ledger, şifre |
| `OnbellekTestleri` | 7 | Token fiyat, eşik, uçucu içerik |
| `OnayTestleri` | 4 | Seviye 0-1 geçer, 4 reddedilir |
| `SirTaramaTestleri` | 4 | Git-bazlı sır taraması |
| `YapilandirmaTestleri` | 3 | K-02, limit dosyası, doğrulama alanı |
| `RaporTestleri` | 2 | Metaveri ayrımı |
| `DurumMakinesiTestleri` | ~20 | 11 durum, kurtarma, idempotency |
| **TOPLAM** | **58** | |

> **Geçmezse:** Kod bozuldu → **durdur, düzelt**

---

## AŞAMA 5 · ANAHTAR

**Süre:** 5 dakika — **EN ÖNEMLİ AŞAMA**

Bu depoda `.env` **yok.** Sen oluşturacaksın.

### Yöntem A — `.env` dosyası

```powershell
notepad .env
```

İçine:
```
OPENROUTER_API_KEY=sk-or-v1-SENİN_ANAHTARIN
GEMINI_API_KEY=SENİN_GEMINI_ANAHTARIN
GROQ_API_KEY=gsk_SENİN_GROQ_ANAHTARIN
```

**Kaydet. Kayıt türü `UTF-8` olsun.**

> ⚠️ Notepad varsayılan olarak "Unicode" (UTF-16) seçebilir.
> UTF-8 değilse Türkçe karakterler ve `=` bozulur.
> **Kayıt türünü kontrol et.**

### Yöntem B — Ekranı görmeden (alternatif)

```powershell
.\anahtar-ayarla.ps1
```

**Neden önemli:** Bu yöntem anahtarı **ekrana yazdırmaz.**
`$env:OPENROUTER_API_KEY = "sk-..."` yazarsan anahtar PowerShell geçmişinde
kalır. Bu script bunu yapmaz.

### Doğrulama

```powershell
python 00-core\07-araclar\runner.py
```

> `dotenv.ozet()` **değerleri göstermez**, sadece "VAR / YOK" der:
> ```
>   OPENROUTER_API_KEY     VAR (51 karakter)
>   GEMINI_API_KEY         YOK
>   GROQ_API_KEY           YOK
> ```

---

### ⚠️ ANAHTAR GÜVENLİĞİ — 8 KEZ DİKKAT

| Kural | Neden |
|---|---|
| **Kodda ASLA** | Git'a girer |
| **Muhurda ASLA** | `Muhur.kontrol()` yazmadan önce reddeder |
| **İzlenen ağaçta ASLA** | `sir_tara()` bulursa commit reddeder |
| **Obsidian'a ASLA** | `12_OBSIDIAN:22-26` |
| **Log'a yazma** | `router.py` değeri loglamaz, sadece uzunluğu |
| **Push otomatik değil** | `obsidian_sync.py:159` |
| **Spesifik anahtar kullan** | Her projeye ayrı anahtar → sızıntı kapsamı daralır |
| **Rotasyon yapılabilmeli** | "Bunu değiştirelim" diyebilmelisin |

### V3 raporundaki kural değişikliği

V2'de K-04 şöyleydi: *".env varsa → ihlal"*
V3'te şöyle oldu: *".env **Git'e girerse** → ihlal"*

> **Nedeni:** Eski kural, doğru yazılmış `.env`'i de ihlal sayıyordu —
> yani aracı kullanılamaz hale getiriyordu. "Standart bir iş akışını
> **suçlanır** kılıyordu."
>
> **Kural, niyeti değil sonucu ölçmeli.**

---

## AŞAMA 6 · İLK GERÇEK GÖREV — GATE 11

**Süre:** 5 dakika — **SİSTEMİN ASIL AMACI BU ADIMDIR**

### Görev ekle

```powershell
python 00-core\07-araclar\runner.py
```

Veya SQL ile:

```sql
INSERT INTO gorevler
  (kimlik, baslik, detay, atanan_ajan, yetki_seviyesi,
   oncelik, kapsam_isletme, kapsam_proje, kapsam_musteri, durum)
VALUES
  ('test-001',
   'Anayasa ozetle',
   '8 kurali tek paragrafta ozetle.',
   'ajan_00_orkestrator',
   0,
   5,
   'TOZ AI',
   'Anayasa Testi',
   'Dahili',
   'olusturuldu');
```

**Kapsam alanları ZORUNLU:**

> `KapsamBelirsizHatasi` — *"Kimlik **UYDURULMAZ**. Çözülemeyen kapsamla
> iş çalışmaz; görev **BLOKE** edilir. Tahmin edilen bir kimlik sessiz
> bir hatadır."*

**Yetki seviyesi `0` yaz** — 2+ yazarsan onay bekler ve **engel olur**:
> *"Onay arayüzü yoksa seviye 2+ işler birikir. Bu, canlıya çıkmadan önce
> çözülmesi gereken ilk engeldir."* — `V3_DURUM_RAPORU §7`

### Çalıştır

```powershell
.\calistir.ps1
```

`calistir.ps1` 5 adım çalıştırır:

```
1/5  ANAYASA KAPISI   → ihlal varsa sistem acmaz
2/5  SIR TARAMA       → anahtar varsa commit reddedilir
3/5  VERITABANI
4/5  TESTLER          → calistirmadan ONCE
5/5  IS DONGUSU       → kuyruk bosuna kadar
```

### Beklenen çıktı — **KABUL KRİTERİ**

```
[GOREV #1] Anayasa ozetle
  ajan=ajan_00_orkestrator yetki=0 oncelik=5 kapsam=Dahili
  muhur yuklendi: 12 token (gecmis 0 mesaj)

  [TAMAM] gemini/gemini-2.0-flash
  token: girdi=412 cikti=187 maliyet=228.1 birim
  onay: gerekmiyor
  cikti: TOZ AI Sistemi Anayasasi 8 kurallik...

[OZET] islenen=1 basarili=1

--- ROTA DURUMU ---
  saglayici:gemini             kapali      hata=0 basari=1
  openrouter                   kapali      hata=0 basari=0
  openrouter                   0/200 [dogrulama: yapilmadi]

[KUYRUK] {'tamamlandi': 1}
  toplam=1 tamamlanma=100%
[BEYIN] {'00_Muhurler': 1, '01_Kararlar': 0, '02_Ogrenilenler': 0}
```

### Kabul kriteri tek cümle

> **Bir görev gerçekten bir API'ye gitti, gerçekten token saydı, gerçekten
> karar yazdı ve bunlar logda görülebiliyor.**

### "150" yazıyorsa

Bu **sabit sayaçtır** — V2 hatası. V3'te gerçek `usage` okunur.
150 yazıyorsa V3 kodu çalışmıyor demektir, `saglayici_istemcileri.py`
sürümünü kontrol et.

---

## AŞAMA 7 · GATE 4.5 — LOGLAMA

```powershell
python -c "import sqlite3; c=sqlite3.connect('00-core/01-kuyruk/kuyruk.db'); [print(r) for r in c.execute('SELECT seviye,kaynak,mesaj FROM loglar ORDER BY id DESC LIMIT 20')]"
```

**Beklenen:** Her durum geçişi, token sayıları, sağlayıcı bilgisi

---

## AŞAMA 8 · GATE 12 — 24 SAATLİK SOAK  ← ❌ HENÜZ YAPILMADI

Bu kapı **senin** başlatman gereken bir kapı. (D7)

**Ne kontrol edilir:**
- Bellek sızıntısı var mı
- Devre kesici doğru açılıp kapanıyor mu
- Ölüm kutusuna düşen görevler çözülüyor mu
- Maliyet beklenenden saptı mı

---

## SIRADAKİ ADIMLAR (Kapı kapanınca)

```
9.  D8 — ilk iş akışını seç      → 06_IS_MODELI
10. Paket A'yı kendi işinde uygula (PergoClean)
11. 3 sayı ölçümü yap
12. BİRİM EKONOMİ tablosunu doldur
13. Fiyat bandını belirle
14. İlk gerçek müşteri
```

---

## TAM KURULUM — TEK KOMUT

```powershell
.\calistir.ps1
```

Anayasa → sır taraması → veritabanı → testler → iş döngüsü.
**Sıra bozulursa durur.**

---

## SORUN GİDERME

| Belirti | Sebep | Çözüm |
|---|---|---|
| `ModuleNotFoundError: kordinator` | Yan dizinden çalıştırıldın | `cd` ile klasöre gir |
| `SONUC: KAPALI - N ihlal` | Anayasa ihlali | Mesajları oku, **düzeltmeden devam etme** |
| `SIR TESPIT EDILDI` | Anahtar koda girdi | **Önce anahtarı rotate et**, sonra dosyadan kaldır |
| `ANAHTAR YOK` | `.env` yazılmamış veya boş | Aşama 5 |
| Testler geçmiyor | Kod bozuldu | `git diff` bak |
| `DEVRE ACIK` | Sağlayıcı çökmüş | `limit-durumu.json`'a bak |
| `Kapsam belirsiz -> BLOKE` | 3 kapsam alanından biri boş | SQL ile doldur |
| Onayda takılıyor | Seviye 2+ ve onay arayüzü yok | **Seviye 0-1 kullan** |

---

## YAPILMAMIŞLAR — DÜRÜST LİSTE

| Konu | Durum | Neden |
|---|---|---|
| Gerçek API çağrısı | ❌ | Anahtar yok |
| Kota rakamları | ❌ | Doğrulanmadı |
| Telegram onay akışı | ❌ | Bot token yok |
| Obsidian senkronu | ⬜ | Kod var, denenmedi |
| Yerel model | ❌ | Ollama kurulu değil |
| 24 saat dayanıklılık | ❌ | Zaman yok |
| Gerçek müşteri işi | ❌ | Müşteri yok |
| Prompt cache ölçümü | ❌ | Maliyet etkisi tahmin |
| Maliyet projeksiyonu | ❌ | Fiyat listesi güncel değil |

> **Bu liste `30_Teknik/DURUM_RAPORU.md`'de de var.**
> Yaptığımızı yapmadığımızı iddia etmiyoruz.
