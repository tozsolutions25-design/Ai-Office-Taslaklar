# KARAR GÜNLÜĞÜ

> **Bu olmadan projede mimari sayılan hiçbir değişiklik yoktur.**
> Tarih sırasına göre yeni en üstte.

Bu günlüğün amacı: *"3 günde 3 koordinatör kararı, 4 gün sonra yine
tartışıldı"* döngüsünü kırmak. Bir karar buraya yazılmadan mimari sayılmaz.

---

## D-01 · İş modeli: hibrit ajan + operasyon

**Tarih:** 2026-10-06
**Karar:** TOZ AI **hibrit** — ajan hattı (kendi ürünümüz) + operasyon hattı (müşteri işi)
**Veren:** Kurucu (Özkan)

### Neden

28 çelişkinin en kritiği buydu. 6 kaynak çelişiyordu:

| Kaynak | İddia |
|---|---|
| `01_SIRKET_ANAYASASI.md:19` | "**Ajans DEĞİLİZ**" (net, 5 kalem) |
| `02_IS_MODELI:238` | "**SANA BAĞLI**" (teslim değil) |
| `MASTER-BUILD:65` | "Satış + Araştırma + Pazarlama **Ajansı**" |
| `toz_ai_group_blueprint:5` | "yalnızca dijital ajans olarak **değil**" |
| V3_MASTER_MIMARI §2 | "**hem ajan hem operasyon şirketi**" (ikili hat) |

Hibrit seçildi çünkü zaten fiilen iki iş kolu vardı ve ikisi de
kendini ayakta tutuyordu.

### Etki

| Alan | Sonuç |
|---|---|
| Fiyat | İki kalemli: kurulum (tek seferlik) + aylık işletme |
| Sözleşme | Aylık. Teslimde bitmez. |
| Ölçüm | 3 sayı (önce kaç saat → sonra kaç saat → tutar) |
| Satış-pazarlama | **Yalnızca operasyon hattında** |
| Ortak analiz motoru | İki hattın arasında — bir kez çalışır |
| Moat | İşlem sayesinde 8 bileşen birikir |

### Etkilenen dosyalar

- `06_IS_MODELI/FIYATLANDIRMA.md` — yazıldı
- `06_IS_MODELI/HIZMET_KATALOGU.md` — yazıldı
- `01_MIMARI/KATMANLAR.md` — yazıldı
- `02_AJANLAR/AJAN_LISTESI.md` — yazıldı

---

## D-02 · Koordinatör adı: KoordinatörÇekirdeği

**Tarih:** 2026-10-06
**Karar:** Global koordinatorin adı **KoordinatörÇekirdeği**. "Munder Difflin" bir rol adıdır, paket adı değildir.
**Veren:** Kurucu (Özkan)

### Neden

"Munder Difflin" 26 dokümanda geçiyordu ama:

```
FINAL_MASTER_ARCHITECTURE.md:365-367
"Munder Difflin bu depoda değildir. Kaynağı, versiyonu, kurulumu yok."
```

Bu, **Ruflo'nun ret gerekçesini de çökertiyordu** — ret gerekçesi "Munder
zaten global coordination yapıyor, ikinci coordinator çakışır" idi. Munder
yoksa o gerekçe düşerdi.

İki yol vardı:

| Yol | Sonuç |
|---|---|
| Yol 1: Munder gerçek bir pakete karşılık gelir | Paket adı sabitlenir, ADR yazılır |
| Yol 2: Gerçek değil | Ad `KoordinatörÇekirdeği` olsun, Munder = rol adı |

**Yol 2 seçildi.** Kodda zaten `kordinator/` paketi vardı; isim değişikliği
gerektirmiyordu.

### Etki

| Alan | Sonuç |
|---|---|
| 26 doküman | Geçersiz — hepsi "Munder tek coordinator" diyordu |
| Ruflo | **Hâlâ kurulmaz**, ama gerekçesi düzeltildi (C-07) |
| `03_MUNDER_KARAR.md` 9 şartı | Geçersiz → `01_MIMARI/DOGRULAMA_KAPILARI.md` 12 kapıya dönüştü |
| K-01 | Artık koda bağlı: `kilit_al()` |

### Etkilenen dosyalar

- `ANAYASA.md` D-02
- `01_MIMARI/KATMANLAR.md`
- `01_MIMARI/DOGRULAMA_KAPILARI.md`

---

## D-03 · Kod tabanı: V3 taşındı + üstüne kuruldu

**Tarih:** 2026-10-06
**Karar:** `AI_AUTONOMOUS_OFFICE` → `Ai_Office_Opencode`. Temiz yazıma gerek yok.
**Veren:** Kurucu (Özkan)

### Neden

3307 satır Python, 58 test. Sıfırdan yazmak bunu israf ederdi.

### Taşıma sırasında yapılanlar

| İşlem | Sonuç |
|---|---|
| 21 Python dosyası kopyalandı | `__pycache__` hariç |
| 11 yapılandırma dosyası kopyalandı | `.env` **hariç** |
| `kuyruk.db` kopyalanmadı | sıfırdan oluşur |
| **2 `.ps1` dosyasında UTF-8 BOM vardı** | **Temizlendi** |

BOM neden önemli: PowerShell 5.1 BOM'lu dosyayı ANSI okur → Türkçe karakterler
bozulur. V3 raporunda bu bilinen bir hata olarak listelenmişti.

### Doğrulama (yeni klasörde)

```
test_mimarisi.py    →  Ran 58 tests    OK
anayasa_kontrolu.py →  SONUC: GECTI - 8/8 kural
sir_tara.py         →  SONUC: TEMIZ
```

---

## BEKLEYEN KARARLAR

| # | Karar | Varsayılan | Durum |
|:--:|---|---|---|
| **D4** | Günlük token tavanı | 0 + aşılırsa uyarı | ⏳ |
| **D5** | Yerel model birincil mi? | Hayır (bulut önce) | ⏳ |
| **D6** | 3D ofis ne zaman? | Faz 13 sonrası | ⏳ |
| **D7** | 24 saatlik soak testi kim başlatır? | Sahibi | ⏳ |
| **D8** | İlk iş akışı hangisi? | Teklif talebi → CRM | ⏳ |
| **D9** | Sağlayıcı kotaları resmi kaynaktan doğrulanacak mı? | Evet | ⏳ |
| **D10** | Obsidian kurulacak mı, JSONL yeterli mi? | JSONL + sonra Obsidian | ⏳ |

> D-08 en kritiği: `05_HIZMET_KATALOGU_PAKETLER.md:252` —
> *"En büyük eksik: paketler var, **ilk iş akışı yok**"*

---

## ÖNCEKİ NESİLLER — ARŞİVDE

Bu kararlar **geçersizdir**. `99_ARSIV/` altında dokunulmaz duruyorlar.

| Tarih | Belge | Durum |
|---|---|---|
| 2026-10-05 | `TOZ_AI_GROUP_FINAL_ARCHITECTURE/24-25` | Geçersiz (Munder) |
| 2026-10-05 | `Son Taslak - Kopya/FINAL_MASTER_ARCHITECTURE.md` | Geçersiz (Munder yok) |
| 2026-10-04 | `TOZ_AI_OFIS_v3` (13 modül) | Geçersiz |
| 2026-10-03 | `toz_ai_group_blueprint_2026` (20 dosya) | Geçersiz (Hermes merkez) |
| 2026-09-13 | `ai-sirket` (9 modül) | Geçersiz |
| 2026-09 | `MASTER-BUILD-PROMPT-TOZ-v2.md` | Kısmen geçerli |

---

## DEĞİŞİKLİK PROSEDÜRÜ

```
ÖNERİ
  ↓
KARAR GÜNLÜĞÜNE YAZ   ← buraya yazılmadan karar değildir
  ↓
TEST (yeşil olmadan devam edilmez)
  ↓
İNSAN ONAYI
  ↓
YEDEK
  ↓
DEĞİŞİKLİK
  ↓
SAĞLIK KONTROLÜ
  ↓
YAYIN
```

`push` **otomatik değildir.**
