# DURUM RAPORU

> **TOZ AI · Ai_Office_Opencode**
> Tarih: 2026-10-06
> Bu rapor **yaptığımızı ve yapmadığımızı** ayırır.

---

## 1 · BU OTURUMDA NE YAPILDI

| İş | Taban | Kanıt |
|---|---|---|
| 226 taslak dosya analiz edildi | — | 5 alt klasör + 27 kök dosya |
| Masaüstü V3 sistemi incelendi | — | 74 dosya, 3307 satır Python |
| **28 çelişki çıkarıldı ve çözüldü** | — | `00_TEK_OTORITE/ANAYASA.md` |
| V3 kodu yeni klasöre taşındı | D-03 | **58/58 test geçiyor** |
| 3 kurucu kararı alındı | D-01, D-02, D-03 | `KARAR_GUNLUGU.md` |
| 14 doküman yazıldı | — | Aşağıdaki liste |
| 8 güvenlik ihlali ölçüldü | — | `04_GUVENLIK/IHLAL_RAPORU.md` |
| 2 UTF-8 BOM düzeltildi | — | `calistir.ps1`, `anahtar-ayarla.ps1` |

### Yazılan dokümanlar

| Doküman | Ne |
|---|---|
| `00_OKU_BENI.md` | Başlangıç |
| `00_TEK_OTORITE/ANAYASA.md` | **Bağlayıcı** — 3 karar + 28 çelişki |
| `00_TEK_OTORITE/KARAR_GUNLUGU.md` | Her kararın gerekçesi |
| `00_TEK_OTORITE/SORUMLULUK_HARITASI.md` | 226 dosyanın nereye gittiği |
| `01_MIMARI/KATMANLAR.md` | Katmanlar + akış |
| `01_MIMARI/DOGRULAMA_KAPILARI.md` | 13 kapı |
| `01_MIMARI/PROVIDER_KAYIT_DEFTERI.md` | 6 sağlayıcı sırası → 1 |
| `02_AJANLAR/AJAN_LISTESI.md` | 7 işçi |
| `03_IS_KOLU/AJAN_HATTI.md` | A tarafı (19 ajan) |
| `03_IS_KOLU/OPERASYON_HATTI.md` | B tarafı (satış, paketler) |
| `04_GUVENLIK/IHLAL_RAPORU.md` | 8 ölçülmüş ihlal |
| `04_GUVENLIK/MEVZUAT_YONETIMI.md` | KVKK / İYS / WhatsApp |
| `05_KURULUM/KURULUM_SIRASI.md` | Adım adım |
| `06_IS_MODELI/HIZMET_KATALOGU.md` | 4 paket |
| `06_IS_MODELI/FIYATLANDIRMA.md` | Hipotez fiyat |
| `07_HAFIZA/HAFIZA_MIMARISI.md` | Muhur + JSONL + Obsidian |
| `08_GEREKLER/ACIK_KARARLAR.md` | **7 açık karar** |

---

## 2 · DOĞRULAMA — GERÇEK ÇIKTI

### Testler

```powershell
python 00-core\07-araclar\test_mimarisi.py
```

```
Ran 58 tests in 0.694s
OK
```

### Anayasa kapısı

```powershell
python 00-core\07-araclar\anayasa_kontrolu.py
```

```
  K-01  Ayni gorev zincirinde yalnizca bir global koordinator
  K-02  Calisanin modeli sabitlenmez; rol yetkiye baglanir
  K-03  Failover test edilmeden ve rapor vermeden kullanilamaz
  K-04  Sir dosyalari izlenen agacta bulunamaz
  K-05  Her calisanin yetki seviyesi bildirilmis olmalidir
  K-06  Yetki seviyesi 4 hicbir zaman otomatik calismaz
  K-07  Her iddia bir kaynaga bagli olmali ya da VERIFY_REQUIRED isaretlenmeli
  K-08  Onbellekte ucuslu icerik bulunamaz
--------------------------------------------------------------
  SONUC: GECTI - 8/8 kural saglandi.
  Sistem ayaga kalkabilir.
```

### Sır taraması

```powershell
python 00-core\07-araclar\sir_tara.py
```

```
  git izlemeli  : False
  izlenen dosya : 0
  SONUC: TEMIZ.
  Kodda ve agacta anahtar YOK.
```

### Veritabanı (Gate 5)

```powershell
python 00-core\07-araclar\db_init.py
```

```
[OK] ...\00-core\01-kuyruk\kuyruk.db
     gorev sayisi: 1
     gorev sutun: 27
     tablolar: ['gorevler', 'sqlite_sequence', 'loglar', 'onaylar']
```

### UTF-8 BOM taraması

```
Tum dosyalar BOM'suz - TEMIZ
```

### Gate 4.5 — Loglama (gerçek çalıştırma)

`worker.py` **anahtarsız** çalıştırıldı ve şunları yaptı:

```text
[KURTARMA] geri_alinan=0 olum_kutusu=0 iptal=0

[GOREV #1] Sistem Kurulum Testi
  muhur yuklendi: 9 token (gecmis 0 mesaj)
    [local_ollama] Baglanti hatasi: [WinError 10061] -> 0.6s sonra tekrar (tam jitter)
    [local_ollama] Baglanti hatasi: [WinError 10061] -> 1.6s sonra tekrar (tam jitter)
  [ROTA BASARISIZ] openrouter: ANAHTAR YOK | gemini: ANAHTAR YOK
                  | groq: ANAHTAR YOK | local_ollama: GeciciHata
  [HATA] Tum saglayicilar basarisiz. Gorev olum kutusuna.

[i] Kuyruk bos. Sistem BEKLEMEDE (pasif ajan protokolu: token harcanmaz).

--- ROTA DURUMU ---
  saglayici:local_ollama      acik      hata=3 basari=0
  gemini                       0/1500 [dogrulama: yapilmadi]
  groq                         0/14400 [dogrulama: supheli]
  openrouter                   0/200 [dogrulama: yapilmadi]

[KUYRUK] {'olum_kutusu': 1}
[BEYIN] {'00_Muhurler': 0, '01_Kararlar': 0, '02_Ogrenilenler': 1}
```

Veritabanı doğrulaması:

```text
GOREVLER
  #1 Sistem Kurulum Testi
      durum=olum_kutusu yetki=0 ajan=ajan_00_orkestrator

LOGLAR
  [ERROR] sistem   Tum saglayicilar basarisiz. Gorev olum kutusuna: ...
```

### Bu çalıştırma neden önemli

**Anahtar yokken sistem tasarlandığı gibi davrandı:**

| Davranış | Kural | Kanıt |
|---|---|---|
| 4 sağlayıcıyı da **nedeniyle** denedi | K-07 | `ANAHTAR YOK` × 3, `GeciciHata` × 3 |
| Tam jitter ile 3 deneme | K-03 | `0.6s` → `1.6s` beklemeler |
| **Devre kesici açıldı** | K-03 | `local_ollama: acik hata=3` |
| Başarısızlık **loglandı** | K-03 | `[ROTA BASARISIZ] ...` |
| Görev **ölüm kutusuna** düştü | K-03 | `{'olum_kutusu': 1}` |
| Görev **sessizce kaybolmadı** | K-01 | `gorevler` tablosunda hâlâ var |
| Hata **beyine yazıldı** | K-04 | `02_Ogrenilenler: 1` |
| Kota **doğrulanmamış** olarak işaretli | K-07 | `[dogrulama: yapilmadi]` / `[supheli]` |
| Kuyruk boşunca **token harcanmadı** | Tasarım | `Sistem BEKLEMEDE` |

> **Sistem, "her şey çalışıyor" iddiasında bulunmadı.** Anahtar yokken
> bunu açıkça raporladı. Bu tam olarak istenen davranış.

---

## 3 · TAŞINAN KOD — ENVANTER

| Dosya | Satır | Ne |
|---|:--:|---|
| `kordinator/kuyruk.py` | 249 | 11 durum + kurtarma + idempotency |
| `kordinator/saglayici_istemcileri.py` | 260 | 4 gerçek HTTP istemcisi |
| `kordinator/baglam_muhru.py` | 207 | O(1) failover muhuru |
| `kordinator/sigorta.py` | 192 | Devre kesici (tam jitter) |
| `kordinator/router.py` | 170 | Rota + kota + güvenli çağrı |
| `kordinator/obsidian_sync.py` | 167 | Güvenli git senkronu |
| `kordinator/beyin.py` | 133 | Hafıza yazıcı |
| `kordinator/onbellek.py` | 104 | Token muhasebesi |
| `kordinator/dotenv.py` | 105 | Bağımlılıksız .env okuyucu |
| `kordinator/onay_kapisi.py` | 124 | Yetki kapısı |
| `kordinator/hata.py` | 67 | 15 hata sınıfı |
| `kordinator/__init__.py` | 83 | Paket arayüzü |
| `sir_tara.py` | 238 | K-04 tarayıcı |
| `anayasa_kontrolu.py` | 205 | 8 kural denetimi |
| `worker.py` | 201 | Ana iş döngüsü |
| `test_mimarisi.py` | 648 | 58 test |
| `runner.py` | 53 | Görev ekleyici |
| `router.py` (eski) | 60 | Geriye uyum |
| `db_init.py` | 25 | Şema kurulumu |
| `obsidian_sync.py` (eski) | 16 | Geriye uyum |
| **TOPLAM** | **3307** | |

**Harici bağımlılık: sıfır.** `pip install` gerekmez.

### Taşınmayanlar

| Öğe | Neden |
|---|---|
| `.env` | **Anahtar taşınmaz.** Kullanıcı oluşturacak |
| `kuyruk.db` | Sıfırdan oluşur |
| `__pycache__/` | Yeniden derlenir |
| `__pycache__` içindeki `.pyc` | 17 dosya |

---

## 4 · 3 KURUCU KARARI

| # | Karar | Değer |
|:--:|---|---|
| **D-01** | İş modeli | **Hibrit: ajan + operasyon** |
| **D-02** | Koordinatör adı | **KoordinatörÇekirdeği** |
| **D-03** | Kod tabanı | **V3 taşındı + üstüne kuruldu** |

Gerekçeler: `00_TEK_OTORITE/KARAR_GUNLUGU.md`

---

## 5 · 28 ÇELİŞKİNİN ÇÖZÜMÜ

Öne çıkanlar:

| # | Konu | Karar |
|:--:|---|---|
| C-01 | Global koordinator kim? | KoordinatörÇekirdeği (3 koordinatör → 1) |
| C-04 | Model sabit mi seçilir mi? | Rol **yetkiye** bağlı, model **görev sınıfına** |
| C-05 | Kaç ajan? | 7 (295 / 100+ / 60 değil) |
| C-07 | Ruflo gerekçesi çöktü | Gerekçe **yeniden yazıldı** |
| C-08 | Hermes var mı? | Rol: kabul / Kullanım: dikkat |
| C-09 | Obsidian mı JSONL mu? | **İkisi de** — iki katman |
| C-10 | 6 farklı sağlayıcı sırası | **Tek kayıt defteri** |
| C-13 | Otonom mu onay mı? | **Kapsamlı otonom** — sadece ajan hattında |
| C-19 | Ajans mı operasyon mu? | **D-01 hibrit** |
| C-24 | "Otomatik failover iddia etme" | İddia etme ≠ yapma, ama belgelenmeli |
| C-27 | "100+ ajanlı AI şirketi" | **7 işçi** — belge arşive |

Tam liste: `00_TEK_OTORITE/ANAYASA.md §2`

---

## 6 · BİLEREK KORUNAN BİLGİ KAYBI

226 dosyada bulunan ama **hiçbir dokümana geçmemiş** bilgiler:

| Bilgi | Nereye yazıldı |
|---|---|
| Hermes 8+ saatte bağlantı kuramadı | `ANAYASA.md` C-08 |
| Hermes CLI `.env`'i bypass ediyor | `ANAYASA.md` C-08 |
| Qwen bir **model**, Qwen CLI bir **araç** | `ANAYASA.md` C-26 |
| 8 GB RAM'de Ollama birincil **olamaz** | `PROVIDER_KAYIT_DEFTERI.md` |
| Groq ücretsiz katman **günlük değil dakika** limitli | `PROVIDER_KAYIT_DEFTERI.md` |
| **KVKK/İYS/WhatsApp kuralları hiçbir mimari belgede yoktu** | `MEVZUAT_YONETIMI.md` |
| Prompt cache'te tek karakter her şeyi öldürür | `HAFIZA_MIMARISI.md` |
| `git add .` → anahtar sızıntısı riski | `HAFIZA_MIMARISI.md` |

---

## 7 · NE YAPILMADI  ← *EN ÖNEMLİ BÖLÜM*

| Konu | Durum | Neden |
|---|---|---|
| **Gerçek API çağrısı** | ❌ | Anahtar yok |
| **Kota rakamları doğrulaması** | ❌ | Resmi kaynak okunmadı |
| **24 saatlik dayanıklılık** | ❌ | Zaman yok |
| **Gerçek müşteri işi** | ❌ | Müşteri yok |
| **Telegram onay akışı** | ❌ | Bot token yok |
| **Yerel model** | ❌ | Ollama kurulu değil |
| **Obsidian** | ❌ | D10 kararı bekliyor |
| **Prompt cache ölçümü** | ❌ | Maliyet etkisi tahmin |
| **Maliyet projeksiyonu** | ❌ | Fiyat listesi güncel değil |
| **Birim ekonomi tablosu** | ❌ | Tamamen boş |
| **`.env` ihlali (kaynak klasör)** | ❌ | **Kurucuya bağlı** |
| **16 MCP → 1** | ❌ | Ortam değişikliği gerekir |
| **295 agent → 7** | ❌ | Ortam değişikliği gerekir |

### Kapı durumu: **8 yeşil / 5 açık**

| Kapı | Durum | Kanıt |
|:--:|:--:|---|
| 1 Ortam | ✅ | Python 3.14, Git |
| 2 Anayasa (8/8) | ✅ | `GECTI - 8/8 kural saglandi` |
| 3 Sır taraması | ✅ | `SONUC: TEMIZ` |
| 4 Testler | ✅ | `Ran 58 tests ... OK` |
| **4.5 Loglama** | ✅ | **gerçek çalıştırmada doğrulandı** |
| **5 Veritabanı** | ✅ | **4 tablo oluştu** |
| 6 Kurtarma | ✅ | testler |
| 7 Tek otorite | ✅ | D-02 |
| 8 Yetki | ✅ | 4 test |
| 9 Token muhasebesi | ✅ | 7 test |
| 10 Bağlam bütünlüğü | ✅ | 8 test |
| **11 Gerçek API** | ❌ | **Anahtar yok** |
| **12 24 saat soak** | ❌ | **Zaman yok** |
| **13 Gerçek müşteri işi** | ❌ | **Müşteri yok** |

> **Çekirdek test edildi, uçlar test edilmedi.**
> Gate 11 olmadan "çalışıyor" denemez.

---

## 8 · SIFIR HATA HEDEFİ — NEREDEYİZ

### Testler

```
Ran 58 tests in 0.694s
OK
```

**Sıfır hata.** Test sayısı artırılmadı — **taşınan kod doğrulandı.**

### Taşıma sırasında bulunan 2 hata

| Dosya | Hata | Etki |
|---|---|---|
| `calistir.ps1` | UTF-8 BOM (239,187,191) | PowerShell 5.1 ANSI okur → Türkçe bozulur |
| `anahtar-ayarla.ps1` | UTF-8 BOM | Aynı |

**İkisi de düzeltildi.** V3 raporunda bu bilinen bir hata olarak listelenmişti
(`V3_DURUM_RAPORU §2` madde 9) — **taşımada tekrar karşımıza çıktı.**

### `.env` kopyalanmadı

Kopyalansaydı K-04 ihlali olurdu. `.env` bu depoda **yok**.

---

## 9 · AÇIK KARARLAR — 7 TANE

| # | Karar | Öneri | Aciliyet |
|:--:|---|---|:--:|
| **D8** | İlk iş akışı | A veya D | 🔴 **EN KRİTİK** |
| **D9** | Kota doğrulaması | Resmi kaynak | 🟠 |
| D4 | Token tavanı | 0 + uyarı | ⬜ |
| D5 | Yerel model birincil mi? | Hayır | ⬜ |
| D6 | 3D ofis ne zaman? | Faz 13+ | ⬜ |
| D7 | Soak testini kim başlatır? | Sahibi | ⬜ |
| D10 | Obsidian | Kur + mimari sınır | ⬜ |

> D8 olmadan fiyat, sözleşme, ölçüm belirlenemez.

---

## 10 · SIRADAKİ ADIM

```
1. .env'e anahtar yaz
      notepad .env      (kayıt türü: UTF-8)

2. Doğrula
      python 00-core\07-araclar\runner.py

3. İlk gerçek görev
      .\calistir.ps1

4. Gate 11'i kapat
      → logda GERÇEK token sayısı gör (sabit 150 DEĞİL)

5. D8 kararını ver
      → 08_GEREKLER/ACIK_KARARLAR.md
```

**Kabul kriteri tek cümle:**

> **Bir görev gerçekten bir API'ye gitti, gerçekten token saydı, gerçekten
> karar yazdı ve bunlar logda görülebiliyor.**

---

## 11 · KAPSAM NOTU

Bu oturumda **silinen hiçbir dosya yok.**

| İşlem | Durum |
|---|---|
| Masaüstünden taşınan | `Son Taslak`, `Son Taslak - Kopya` → `D:\AI\Toz AI Agency Taslaklar\_MASAUSTU_TASLAKLARI\` |
| Yeni oluşturulan | `Desktop\Ai_Office_Opencode` (bu klasör) |
| Kopyalanan | V3 Python + yapılandırma |
| **Silinen** | **YOK** |

> Bu, `ANAYASA.md §8` "kalıcı silme yasak" kuralının uygulamasıdır.
> 226 taslak `D:\AI\Toz AI Agency Taslaklar` içinde **dokunulmaz** duruyor.

---

## 12 · SKOR

Kendimize kısa bir ölçüt:

| Boyut | Puan | Gerekçe |
|---|:--:|---|
| **Mimari netliği** | **8/10** | 3 koordinatör → 1. 28 çelişki çözüldü |
| **Kod kalitesi** | **9/10** | 3307 satır, 58 test, sıfır bağımlılık |
| **Dokümantasyon tutarlılığı** | **9/10** | Tek otorite + karar günlüğü |
| **Güvenlik** | **7/10** | 8 ihlal ölçüldü, 1'i kurucuya bağlı |
| **Entegrasyon** | **1/10** | Hiç gerçek API çağrısı yok |
| **İş modeli olgunluğu** | **2/10** | Fiyat/sıra/maliyet ölçülmemiş |
| **Doğrulama** | **4/10** | 58 test var, gerçek görev yok |

> **`FINAL_MASTER_ARCHITECTURE.md` kendine 5.2/10 verdi ve bunu açıkladı.**
> Bu rapor aynı disiplini sürdürüyor: **puanlar iddia değil, ölçümdür.**
