# AÇIK KARARLAR — SENİN VERMEN GEREKEN 8 KARAR

> Kaynak: `FINAL_MASTER_ARCHITECTURE.md:383-392` (D1-D7) +
> `09_BILINMEYENLER_VE_VARSAYIMLAR.md` +
> analiz sırasında bulunan 5 yeni karar
> Tarih: 2026-10-06

---

## ZATEN VERİLEN 3 KARAR

| # | Karar | Değer | Tarih |
|:--:|---|---|---|
| **D-01** | İş modeli | Hibrit: ajan + operasyon | 2026-10-06 |
| **D-02** | Koordinatör adı | KoordinatörÇekirdeği | 2026-10-06 |
| **D-03** | Kod tabanı | V3 taşındı + üstüne kuruldu | 2026-10-06 |

---

## D4 · GÜNLÜK TOKEN TAVANI

**Varsayılan:** sıfır + aşılırsa uyarı
**Kaynak:** `FINAL_MASTER:388`

### Seçenekler

| Seçenek | Değer | Etki |
|---|---|---|
| **A** | Sınırsız | En verimli, en pahalı. Maliyet kontrolsüz. |
| **B** | 0 + aşılırsa uyarı | Önerilen. Başlangıç için güvenli. |
| **C** | Sabit sayı (örn. 500K/gün) | Kesin bütçe ama gereksizde keser. |

### B neden öneriliyor

Sistemin **gerçek maliyet verisi hiç yok.** `limit-durumu.json`daki 4 limitin
4'ü de doğrulanmamış. Kesin bütçe koymak, **yanlış bir sayıyı** kesinleştirmek
olur. Bu K-07 ihlali.

**Sonuç:** B seçilirse D9 (kota doğrulama) kapanmadan sayı belirlenmez.

---

## D5 · YEREL MODEL BİRİNCİL Mİ?

**Varsayılan:** Hayır (bulut önce)
**Kaynak:** `FINAL_MASTER:389` — "birincil (evde)"

### ⚠️ Varsayılan muhtemelen YANLIŞ

`MASTER-BUILD:127` bunu zaten cevaplamış:

> *"**8 GB'de Ollama birincil**" diye yasaklandı*

`FINAL_MASTER` bu yasağı görmemiş ve D5'i "evet, birincil" diye varsaymış.

### Seçenekler

| Seçenek | Değer | Gereksinim |
|---|---|---|
| **A** | Hayır — bulut önce, yerel son | ✅ Çalışan kod bu (`router.py:21`) |
| **B** | Evet — yerel birincil | 16-32 GB RAM, iyi GPU |

### A neden öneriliyor

1. Mevcut kod zaten A ile çalışıyor ve 58 test geçiyor
2. `router.py:20` — *"kalite öncelikli, maliyet sonra"*
3. 8 GB RAM'de yerel model yavaş
4. B seçilirse donanım yatırımı gerekir (henüz bütçe yok)

---

## D6 · 3D OFİS NE ZAMAN?

**Varsayılan:** Faz 13 sonrası
**Kaynak:** `FINAL_MASTER:390`

### Tüm kaynaklar **zaten aynı** diyor

| Kaynak | İfade |
|---|---|
| `20_3D_SANAL_OFIS.md:22-26` | "coordinator olmayacak, database olmayacak, ikinci memory olmayacak" |
| `04_ORGANIZASYON:147` | "Faz 13+ — **1. yıl: Hayır**" |
| `05_HIZMET_KATALOGU:234` | "faz 13 sonrası" |

> **Bu konuda çelişki yok.** Tekrar var. Varsayılan doğru.

**Sınır şartları** (`20_3D_SANAL_OFIS.md:22-26`):

```
3D ofis:
  ✗ coordinator olmayacak
  ✗ database olmayacak
  ✗ ikinci memory olmayacak
  ✗ ikinci MCP router olmayacak
  ✗ workflow engine olmayacak
```

> Görselleştirme **yalnızca**. Bu sınırlar kalkarsa mimari bozulur.

---

## D7 · 24 SAATLİK SOAK TESTİNİ KİM BAŞLATACAK?

**Varsayılan:** Sahibi
**Kaynak:** `FINAL_MASTER:392`

Gate 12. **Yapılmadı** (`FINAL_MASTER:327`).

### Seçenekler

| Seçenek | Değer |
|---|---|
| **A** | Sahibi başlatır (bilinçli karar) |
| **B** | Sistem otomatik başlatır — ❌ **düşmanı davet etmek** |

### B neden yanlış

Sistem kendi dayanıklılık testini kendi başlatırsa, **kritik olduğunda
gözetimsiz kalır.** Ve Gate 12 "production ilan edilmez" diyor —
yani bu production öncesi son kapı.

**A öneriliyor.**

---

## D8 · İLK İŞ AKIŞI HANGİSİ?  ← *EN KRİTİK YENİ*

**Varsayılan:** Teklif talebi → CRM
**Kaynak:** `05_HIZMET_KATALOGU_PAKETLER.md:252`

> *"**En büyük eksik: Paketler var, ilk iş akışı yok**"*

### Bu neden D-01'den sonra EN KRİTİK

Hibrit kararı verildi. Hibritin **ilk kanıtı** ilk iş akışıdır.
Bu karar verilmeden:

- Paket fiyatı **doğrulanamaz**
- 3 sayı ölçümü **başlatılamaz**
- 7 işçiden hangisinin çalıştığı **anlaşılamaz**
- Moat'ın 1. bileşeni (sektörel bilgi) **biriktirilemez**

### 4 seçenek

| Seçenek | Akış | Neden iyi / kötü |
|---|---|---|
| **A** | Teklif talebi → e-posta/WhatsApp → CRM kaydı → takip | ✅ `05_HIZMET`: *"iyi aday"*. Sıklık yüksek, veri var, hata ucuz |
| **B** | Müşteri fiyat kararı | ⛔ Seviye 3-4 gerektirir. AI'ın yetkisi dışında |
| **C** | Kendi YouTube kanalı | ⚠️ `02_IS_MODELI:60-62`: *"gerekli değil, yanlış sırayla başlanır"* |
| **D** | PergoClean kendi işi | ✅ *"kendini müşeri yerine ilk kullanıcı kabul et"* |

### 4 kriter

`05_HIZMET_KATALOGU_PAKETLER.md`:

| Kriter | Soru |
|---|---|
| 1. Sıklık | Haftada kaç kez oluyor? |
| 2. Veri | Girdi hazır mı, toplanacak mı? |
| 3. Tasarruf | Hangi kısım otomatikleştirilebilir? |
| 4. Hata payı | Yanlış olursa kabul edilebilir mi? |

> ⛔ **B kötü aday:** "Müşterinin fiyatına karar veriyoruz."
> Seviye 3-4 gerektirir. AI çalışanı 0-2.

---

## D9 · SAĞLAYICI KOTALARI DOĞRULANSIN MI?  ← *YENİ*

**Varsayılan:** Evet
**Kaynak:** `limit-durumu.json` — 4 limitin 4'ü de doğrulanmamış

### Mevcut durum

| Sağlayıcı | Yazılı | Durum | Not |
|---|---|---|---|
| openrouter | 200/gün | `yapilmadi` | V1'de 50 idi. 200 **kaynaksız**. |
| gemini | 1500/gün | `yapilmadi` | 2026-09 taslağından |
| groq | 14400/gün | `supheli` | **Muhtemelen yanlış** — Groq günlük değil dakika hız limiti |
| local_ollama | -1 | `kurulumda_test_edilecek` | Maliyet 0 |

### Seçenekler

| Seçenek | Değer |
|---|---|
| **A** | Her biri resmi kaynaktan okunur, `dogrulama_kaynagi` URL'si yazılır | ✅ Önerilen |
| **B** | Doğrulanmamış bırakılır, `"dogrulama_durumu": "yapilmadi"` kalır | ⚠️ K-07 geçer ama yanlış maliyet riski |

> **A öneriliyor.** K-07'nin ruhu bu. `dogrulama_durumu` alanı
> **doğrulanmamışlığı dürüstçe söylemeyi zorunlu kılıyor** — bu iyi bir
> tasarım. Doğrulama yapılana kadar "yapılmadı" kalmalı.

**Etki:** Yanlış limit → **maliyet 10 kat sapabilir.** `V3_DURUM_RAPORU §7`

---

## D10 · OBSIDIAN KURULACAK MI, JSONL YETERLI MI?  ← *YENİ*

**Varsayılan:** JSONL yeterli, Obsidian sonra
**Kaynak:** `12_OBSIDIAN_SECOND_BRAIN.md` (YES) ↔ `FINAL_MASTER:123` (görünmüyor)

### C-09: Bu bir çelişki **değil** — iki katman

| Katman | Ne | Neden |
|---|---|---|
| **JSONL** | Makine-içi değişmez kayıt | fsync, append-only, DLQ, hızlı |
| **Obsidian** | İnsan-okur derin bilgi | Karar, SOP, müşteri hafızası, bağlantılar |

`12_OBSIDIAN:35-39`:
> *"Memory = bilgi deposu. Coordinator = görev yönetimi. **İkisi aynı şey değildir.**"*

### V3'te ne var

| Modül | Ne yapar |
|---|---|
| `kordinator/beyin.py` | Muhür JSON + karar MD + öğrenilen MD + indeks |
| `kordinator/obsidian_sync.py` | Güvenli git senkronu (sır taraması ile) |

> `obsidian_sync.py` adı Obsidian diyor ama **Obsidian'dan bahsetmiyor.**
> Sadece git senkronu yapıyor. Bu bir **isim kalıntısı.**

### Seçenekler

| Seçenek | Değer |
|---|---|
| **A** | JSONL + MD yeterli. Obsidian kurulmaz. | ✅ En az bağımlılık |
| **B** | Obsidian kurulur, ikinci beyin olarak | Obsidian açık kaynak, maliyet 0 |

> **B öneriliyor** — ama **D-10 önce mimari sınır yazmalı:**
> Obsidian **muhur değildir, router değildir, ikinci kaynak değildir.**
> K-01 ve K-04 ihlali olmamalı.

---

## KARAR TABLOSU ÖZETİ

| # | Karar | Öneri | Aciliyet |
|:--:|---|---|:--|
| ~~D-01~~ | ~~İş modeli~~ | ✅ **Hibrit** | Çözüldü |
| ~~D-02~~ | ~~Koordinatör~~ | ✅ **KoordinatörÇekirdeği** | Çözüldü |
| ~~D-03~~ | ~~Kod tabanı~~ | ✅ **V3 taşındı** | Çözüldü |
| **D4** | Token tavanı | **0 + uyarı** | ⬜ |
| **D5** | Yerel model birincil mi? | **Hayır** | ⬜ |
| **D6** | 3D ofis ne zaman? | **Faz 13+** | ⬜ |
| **D7** | Soak testini kim başlatır? | **Sahibi** | ⬜ |
| **D8** | İlk iş akışı | **A veya D** | 🔴 **EN KRİTİK** |
| **D9** | Kota doğrulama | **A (resmi kaynak)** | 🟠 |
| **D10** | Obsidian | **B + mimari sınır** | ⬜ |

---

## SIRAYA GÖRE

```
1. D8  — ilk iş akışı. Fiyat ve ölçüm buna bağlı.
2. D9  — kota doğrulama. Maliyet 10 kat sapabilir.
3. D4  — token tavanı. D9'a bağlı.
4. D5  — yerel model. D4'e bağlı.
5. D10 — Obsidian. D8'den bağımsız, isteğe bağlı.
6. D6  — 3D ofis. Zaten faz 13.
7. D7  — soak testi. Gate 11 kapandıktan sonra.
```

---

## BİLMEDİĞİMİZ VE BİLİYORUZ

> *"Bilmiyorum → araştırıyorum → kontrol ediyorum → sonucu söylüyorum."*
> — `Ben Özkan Toz Ai Sahibi Kimdir.md:41-57`

### Bilmiyoruz (bu yüzden karar soruluyor)

- Gerçek müşteri başına aylık AI maliyeti — **hiç ölçülmedi**
- Gerçek kurulum süresi — **hiç ölçülmedi**
- Gerçek brüt kâr — **hiç ölçülmedi**
- Rakiplerin fiyatı — **bilinmiyor**
- 7 işçinin gerçek maliyeti — **tahmin**

### Biliyoruz

| Bilgi | Kaynak |
|---|---|
| 226 doküman, 28 çelişki | Bu analiz |
| 3307 satır kod, 58 test geçiyor | `test_mimarisi.py` |
| 8 ihlal ölçüldü | `04_GUVENLIK/IHLAL_RAPORU.md` |
| 10 gerçek hata bulundu | `V3_DURUM_RAPORU §2` |
| Hiç gerçek API çağrısı yapılmadı | Gate 11 |

> **Ölçülmemiş fiyat kar gizleme aracıdır.** — `02_IS_MODELI:119`
