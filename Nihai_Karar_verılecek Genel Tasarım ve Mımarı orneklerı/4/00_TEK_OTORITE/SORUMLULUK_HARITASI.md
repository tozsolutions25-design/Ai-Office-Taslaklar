# SORUMLULUK HARİTASI — HANGİ DOSYA NEDEN VAR?

> 226 taslak dosya vardı. Bu harita **her birinin nereye gittiğini** gösterir.
> Amaç: aynı hata 4. kez yaşanmasın.

---

## TEMEL KURAL

> **226 taslak → 4 karar → 1 anayasa → 1 mimari**

Taslaklar silinmedi. `99_ARSIV/` altında dokunulmaz duruyorlar. Ama
**otorite tek yerde.**

---

## KLASÖR HARİTASI

```
Ai_Office_Opencode/
├── 00_TEK_OTORITE/          ← BAĞLAYICI. Buraya yazılmayan kural kural değildir
│   ├── ANAYASA.md           Tek otorite + 28 çelişkinin çözümü
│   ├── KARAR_GUNLUGU.md     Her mimari karar burada
│   └── SORUMLULUK_HARITASI.md  (bu dosya)
│
├── 01_MIMARI/
│   ├── KATMANLAR.md         KoordinatörÇekirdeği → işçiler → MCP → araçlar
│   ├── DOGRULAMA_KAPILARI.md  12 kapı (03_MUNDER_KARAR 9 şartı geçersiz)
│   └── PROVIDER_KAYIT_DEFTERI.md  Tek sağlayıcı tablosu (6 sıra → 1)
│
├── 02_AJANLAR/
│   ├── AJAN_LISTESI.md      7 işçi (295 ve 60 değil)
│   └── 03_kodlama.yaml      Kod işçisi tanımı
│
├── 03_IS_KOLU/
│   ├── AJAN_HATTI.md        Kendi ürünümüz
│   └── OPERASYON_HATTI.md   Müşteri işi + satış-pazarlama
│
├── 04_GUVENLIK/
│   ├── IHLAL_RAPORU.md      Ölçülmüş 8 ihlal
│   └── MEVZUAT_YONETIMI.md  KVKK/İYS/WhatsApp
│
├── 05_KURULUM/
│   └── KURULUM_SIRASI.md    Sıra kapılar → anahtar → ilk iş
│
├── 06_IS_MODELI/
│   ├── HIZMET_KATALOGU.md   4 paket (D paketi 1. yıl yok)
│   └── FIYATLANDIRMA.md     Kurulum + aylık (D-01 hibrit)
│
├── 07_HAFIZA/
│   └── HAFIZA_MIMARISI.md   Muhur (O(1)) + JSONL + Obsidian
│
├── 08_GEREKLER/
│   └── ACIK_KARARLAR.md     D4-D10
│
├── 00-core/                 ← MOTOR (kod)
│   ├── config/ana-config.yaml
│   ├── 01-kuyruk/           kuyruk-olustur.sql
│   ├── 02-yonlendirici/     limit-durumu.json + yonlendirici-kurallari.yaml
│   ├── 03-beyin/            00_Muhurler + 01_Kararlar + 02_Ogrenilenler + 03_Indeksler
│   ├── 07-araclar/
│   │   ├── kordinator/      11 modül (3307 satırın 2166'sı)
│   │   └── test_mimarisi.py  58 test
│   └── ...
│
├── 10_Anayasa/anayasa.md    8 kural (K-01..K-08)
├── 11_Ajanlar/              00_orkestrator.yaml + 01_kodlama.yaml
├── 20_Is_Dokumanlari/
├── 30_Teknik/
├── 40_Kurulum/
└── 99_ARSIV/                ← 226 taslak buraya, dokunulmaz
```

---

## 226 TASLAK NEREYE GİTTİ?

### 1. `TOZ_AI_GROUP_FINAL_ARCHITECTURE/` — 26 dosya (4 Eki)

| Dosya | Nereye | Ne oldu |
|---|---|---|
| `03_MUNDER_KARAR.md` (9 şart) | `01_MIMARI/DOGRULAMA_KAPILARI.md` | **Genişletildi** 9 → 12 kapı |
| `24_FINAL_KARAR_TABLOSU.md` | `ANAYASA.md` + `01_MIMARI/PROVIDER_KAYIT_DEFTERI.md` | D-01, D-02 uygulandı |
| `25_DEGISIKLIK_KAYDI.md` | `KARAR_GUNLUGU.md` "Önceki nesiller" | Geçersiz ilan edildi |
| `06_RUFLO.md` | `ANAYASA.md` C-06, C-07 | Gerekçe **düzeltildi** |
| `17_TEST_GATES.md` | `01_MIMARI/DOGRULAMA_KAPILARI.md` | Aynen korundu (12 kapı) |
| `16_SECURITY_GOVERNANCE.md` | `ANAYASA.md` §3, §4 | Aynen |
| `11_MCP_POLICY.md` | `04_GUVENLIK/IHLAL_RAPORU.md` | "Az MCP > çok" ihlali ölçüldü |
| `15_ILK_AI_CALISANLARI.md` | `02_AJANLAR/AJAN_LISTESI.md` | **7 işçi** korundu |
| `14_SIRKET_HIYERARSISI.md` | `03_IS_KOLU/` | "Ayrı departman" → "ürün hattı" (C-18) |
| `20_3D_SANAL_OFIS.md` | `08_GEREKLER/ACIK_KARARLAR.md` D6 | Faz 13 sonrası |
| Diğer 15 dosya | `99_ARSIV/` | Dokunulmaz |

### 2. `toz_ai_group_blueprint_2026/` — 20 dosya (3 Eki)

| Dosya | Nereye | Ne oldu |
|---|---|---|
| `00_OKU_BENI_ILK.md` | — | **Güncel değil** (14 dosya listelemiş, 20 var) |
| `01_SIRKET_MIMARISI.md` | `03_IS_KOLU/` | 4 gelir motoru korundu |
| `05_HERMES_RUFLO_OPENCODE_MIMARISI.md` | `ANAYASA.md` C-01, C-06, C-21 | "Hermes merkez" **reddedildi** |
| `10_CALISMA_ZAMANI_TOKEN_MALIYET.md` | `01_MIMARI/PROVIDER_KAYIT_DEFTERI.md` | Ölçek tablosu korundu |
| `11_GUVENLIK_MEZUAT_YONETISIM.md` | `04_GUVENLIK/MEVZUAT_YONETIMI.md` | **Hiç FINAL_ARCHITECTURE'da yoktu** — kurtarıldı |
| `17_MEZUAT_HARITASI.md` | `04_GUVENLIK/MEVZUAT_YONETIMI.md` | "AI çalışan hukuken insan değildir" korundu |
| `13_90_GUNLUK_KURULUM_PLANI.md` | `05_KURULUM/KURULUM_SIRASI.md` | "100+ ajan 90 günde yapılmaz" korundu |
| Diğer 12 dosya | `99_ARSIV/` | Dokunulmaz |

### 3. `TOZ_AI_OFIS_v3/` — 40 dosya (4 Eki)

| Klasör | Nereye | Ne oldu |
|---|---|---|
| `TOZ_VAULT/00_Anayasa/` | `10_Anayasa/anayasa.md` | V3 8 kuralı **daha güçlü** (kodla zorlanıyor) |
| `TOZ_VAULT/01_Ajanlar/` (10 dosya, 143-430 bayt) | `02_AJANLAR/` | **Çok ince.** Gerçek tanım değil. |
| `TOZ_VAULT/10_Teknik/mimari/GENEL_MIMARI.md` (1197 bayt) | `01_MIMARI/KATMANLAR.md` | Genişletildi |
| `TOZ_VAULT/09_Guvenlik/` | `04_GUVENLIK/` | 3 dosya |
| `TOZ_VAULT/11_3D_Ofis/` | `08_GEREKLER/` D6 | Faz 13 sonrası |
| Diğerler | `99_ARSIV/` | Dokunulmaz |

### 4. `ai-sirket/` — 30 dosya (Eylül, 1. nesil)

| Klasör | Nereye | Ne oldu |
|---|---|---|
| `00-core/config/ana-config.yaml` | `00-core/config/` | **Aynen korundu** (V3'te zaten vardı) |
| `01-kuyruk/kuyruk-olustur.sql` | `00-core/01-kuyruk/` | **Aynen korundu** |
| `02-yonlendirici/limit-durumu.json` | `00-core/02-yonlendirici/` | **Aynen korundu** |
| `03-beyin/` | `00-core/03-beyin/` | Yapı korundu |
| Diğer 20 dosya | `99_ARSIV/` | Dokunulmaz |

### 5. `_MASAUSTU_TASLAKLARI/Son Taslak - Kopya/` — 43 dosya

| Dosya | Nereye | Ne oldu |
|---|---|---|
| `FINAL_MASTER_ARCHITECTURE.md` (13 KB) | **Ana kaynak** | 28 çelişkinin çoğu buradan |
| `01_SIRKET_ANAYASASI.md` | `ANAYASA.md` §1, §7 | "Ajans DEĞİLİZ" → D-01 hibrit ile dengelendi |
| `02_IS_MODELI_GELIR_MOTORLARI.md` | `06_IS_MODELI/FIYATLANDIRMA.md` | Fiyat bantları **hipotez** olarak işaretli |
| `04_ORGANIZASYON_YETKI_IKILI.md` | `ANAYASA.md` §5 | Seviye 0-4 tablosu **aynen** |
| `05_HIZMET_KATALOGU_PAKETLER.md` | `06_IS_MODELI/HIZMET_KATALOGU.md` | 4 paket korundu |
| `06_TEKNIK_HAZIRLIK_KONTROL.md` | `05_KURULUM/` | 9 kontrol maddesi |
| `09_BILINMEYENLER_VE_VARSAYIMLAR.md` | `08_GEREKLER/ACIK_KARARLAR.md` | **En değerli dosya** — ne bilindiğini söylüyor |
| `10_90_GUNLUK_PLAN.md` | `05_KURULUM/KURULUM_SIRASI.md` | 90 gün korundu |
| `08_KURULUM_ONCESI_GO_NO_GO.md` | `05_KURULUM/` | Go/No-Go kriterleri |
| `11_KORDINATOR/calistir.py` | `00-core/07-araclar/` | V3'e **zaten dahil** edilmişti |
| Diğer 20+ dosya | `99_ARSIV/` | Dokunulmaz |

### 6. Kök dosyalar — 27 dosya

| Dosya | Nereye | Ne oldu |
|---|---|---|
| `MASTER-BUILD-PROMPT-TOZ-v2.md` (24.6 KB) | `99_ARSIV/` | 18 kritik hata V3'te düzeltildi |
| `Ozkan MASTER_AI_PROFILE (1).md` (28 KB) | `01_MIMARI/KURUCU_PROFILI.md` | 5 kırmızı çizgi korundu |
| `AUTONOMOUS_WEB_AGENCY.md` (19 KB, 19 ajan) | `03_IS_KOLU/AJAN_HATTI.md` | 19 ajan **ajan hattına** ayrıldı |
| `gemini-code-...md` ("100+ ajan") | `99_ARSIV/` | **En eski, en gerçekçi olmayan.** C-27 |
| `Qwen_markdown_*.md` (2 dosya) | `01_MIMARI/PROVIDER_KAYIT_DEFTERI.md` | **Teknik uyarılar korundu** (Hermes kırılgan, Ollama iddiası yanlış) |
| `deepseek_markdown_*.md` (3 dosya) | `99_ARSIV/` | Sağlayıcı sırası C-10 |
| `ben olsam şeye başlayan bir ai modeli.md` | `99_ARSIV/` | C-25, C-26 kaynağı — **3. isim** |
| `.env` | **HİÇBİR YERE** | K-04 ihlali. `04_GUVENLIK/IHLAL_RAPORU.md`'na yazıldı |
| `TOZ Operations Company_sablon_*.md` (9 dosya) | `99_ARSIV/` | En eski nesil |
| Diğer | `99_ARSIV/` | Dokunulmaz |

---

## BİLEREK KORUNAN BİLGİ KAYBI

Analiz sırasında bulunan ama **hiçbir dokümana geçmemiş** bilgiler:

| Bilgi | Kaynak | Nereye yazıldı |
|---|---|---|
| **Hermes 8+ saat denemede bağlantı kuramadı** | `Qwen:27` | `ANAYASA.md` C-08 |
| **Hermes CLI `.env` bypass ediyor** | `Qwen:24-27` | `ANAYASA.md` C-08 |
| **Qwen bir MODEL, Qwen CLI bir ARAÇ** | `Qwen` + `24_FINAL` | `ANAYASA.md` C-26 |
| **8 GB RAM'de Ollama birincil olamaz** | `MASTER-BUILD:127` | `01_MIMARI/PROVIDER_KAYIT_DEFTERI.md` |
| **Groq ücretsiz katman GÜNLÜK değil DAKİKA hız limiti** | `BUGUN:8` | `00-core/02-yonlendirici/limit-durumu.json` (mevcut not) |
| **`git add .` tehlikeliydi** | V3 §0 | `00-core/07-araclar/kordinator/obsidian_sync.py` (düzeltildi) |
| **Prompt cache'te tek karakter her şeyi öldürür** | V3 | `00-core/07-araclar/kordinator/onbellek.py` |

---

## TERSİNE ÇEVİRME

Bu yapı **kopyalanabilir**, taşınamaz. Çünkü:

1. `99_ARSIV/` her şeyi korur — silme yok
2. `KARAR_GUNLUGU.md` gerekçeyi korur — "neden" kaybolmaz
3. `ANAYASA.md` çelişki çözümünü korur — aynı tartışma tekrarlanmaz

> Bir karar geri alınmak istenirse: `KARAR_GUNLUGU.md`'na D-0X *İptal*
> maddesi eklenir. Silinmez.

---

## KONTROL LİSTESİ

Yeni dosya eklerken:

- [ ] `KARAR_GUNLUGU.md`'na kayıt var mı?
- [ ] `ANAYASA.md`'da ilgili kural güncellendi mi?
- [ ] `test_mimarisi.py` geçiyor mu?
- [ ] `anayasa_kontrolu.py` 8/8 veriyor mu?
- [ ] Bu dosya `99_ARSIV/`deki bir şeyin kopyası mı? → **O zaman ekleme.**
