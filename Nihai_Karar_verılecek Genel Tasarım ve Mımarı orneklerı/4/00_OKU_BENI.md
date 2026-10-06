# OKU BENİ — BURADA BAŞLA

> **TOZ AI · Ai_Office_Opencode**
> Tarih: 2026-10-06 · Sürüm 1.0

---

## BU KLASÖR NE

226 karışık taslak dosyadan çıkarılmış **tek tutarlı sistem.**

Masaüstünde başka bir klasör (`AI_AUTONOMOUS_OFFICE`) vardı — bu onun
üzerine kuruldu. Artık **iki klasör yok, bir var.**

---

## ÖNCE ŞUNU BİL — 226 DOSYA, 28 ÇELİŞKİ

Kaynak klasör `D:\AI\Toz AI Agency Taslaklar` içindeydi. Analiz sonucu:

| Bulgu | Sayı |
|---|---|
| Doküman | 226 |
| Mimari nesil | 5 |
| **"Coordinator" tanımı** | **7 farklı** |
| Koordinatör kararı | **4 günde 3** |
| **Çelişki** | **28** |

Kaynaktaki kendi teşhisi:

> *"Ozonometre: 3 günde 3 koordinatör kararı. `25_DEGISIKLIK_KAYDI.md`
> 'bir daha tartışılmasın' diye yazıldı — **4 gün sonra yine tartışıldı.**"*

**Sorun mimari değil, otorite.** Bu klasörün var olma sebebi bu.

---

## 5 DAKİKADA BAŞLA

```powershell
# 1. Klasöre gir
cd C:\Users\TozSolutions\Desktop\Ai_Office_Opencode

# 2. Her şeyi tek komutla doğrula
.\calistir.ps1
```

`calistir.ps1` sırayla yapar:

```
1/5  ANAYASA KAPISI    → 8 kural kontrolü. İhlal varsa DURUR
2/5  SIR TARAMASI      → kodda anahtar var mı
3/5  VERİTABANI        → kuyruk.db oluşturur
4/5  TESTLER           → 58 test. Yeşil değilse DURUR
5/5  İŞ DÖNGÜSÜ        → kuyruktaki görevleri işler
```

---

## ANAHTAR GEREKİYOR

Bu depoda `.env` **yok** — sen oluşturacaksın.

```powershell
notepad .env
```

```
OPENROUTER_API_KEY=sk-or-v1-SENİN_ANAHTARIN
GEMINI_API_KEY=SENİN_GEMINI_ANAHTARIN
GROQ_API_KEY=gsk_SENİN_GROQ_ANAHTARIN
```

**Kayıt türü `UTF-8` olsun.** (Notepad "Unicode" seçerse bozulur.)

Ekranı görmeden:
```powershell
.\anahtar-ayarla.ps1
```

> Detaylı anlatım: `05_KURULUM/KURULUM_SIRASI.md`

---

## SİSTEM NE YAPIYOR

```
Sen bir iş verirsin
      ↓
Kuyruğa yazılır  (kapsam belirsizse BLOKE — kimlik uydurulmaz)
      ↓
Onay kapısı  (seviye 0-1 geçer · 2-3 onay ister · 4 ASLA)
      ↓
Sağlayıcı sırası  (devre açık ve kotası dolu olanlar elenir)
      ↓
Gerçek API çağrısı  (tam jitter + Retry-After + devre kesici)
      ↓
Gerçek token sayacı  (sabit 150 DEĞİL)
      ↓
Beyine yazılır  (mühür + karar + öğrenilen)
```

**Başarısız olursa:** Yarım kalan görev kaybolmaz. Bir sonraki açılışta
geri alınır veya ölüm kutusuna gider.

---

## KLASÖR HARİTASI

| Klasör | Ne |
|---|---|
| `00_TEK_OTORITE/` | **Bağlayıcı.** Anayasa + karar günlüğü + sorumluluk haritası |
| `01_MIMARI/` | Katmanlar, doğrulama kapıları, sağlayıcı kayıt defteri |
| `02_AJANLAR/` | 7 işçi + ajan listesi |
| `03_IS_KOLU/` | Ajan hattı (kendi ürünümüz) + Operasyon hattı (müşteri işi) |
| `04_GUVENLIK/` | Ölçülmüş ihlaller + mevzuat yönetimi |
| `05_KURULUM/` | Adım adım kurulum |
| `06_IS_MODELI/` | Hizmet kataloğu + fiyatlandırma (tümü hipotez) |
| `07_HAFIZA/` | Hafıza mimarisi |
| `08_GEREKLER/` | **Açık kararlar — senin vermen gereken 7 karar** |
| `00-core/` | **MOTOR.** 3307 satır Python, 58 test |
| `10_Anayasa/` | 8 kural (K-01..K-08) |
| `11_Ajanlar/` | Ajan tanım dosyaları |
| `20_Is_Dokumanlari/` | İş dokümanları |
| `30_Teknik/` | Teknik notlar + durum raporu |
| `40_Kurulum/` | Kurulum detayları |
| `99_ARSIV/` | **226 taslak burada. Dokunulmaz.** |

---

## ÖNCE OKU (10 dakika)

| # | Dosya | Ne öğretir |
|:--:|---|---|
| 1 | `00_TEK_OTORITE/ANAYASA.md` | 3 kurucu kararı + 28 çelişkinin çözümü |
| 2 | `30_Teknik/DURUM_RAPORU.md` | **Ne yapıldı, ne yapılmadı** |
| 3 | `10_Anayasa/anayasa.md` | 8 kural |
| 4 | `08_GEREKLER/ACIK_KARARLAR.md` | **7 karar senin** |

---

## ŞU AN NEREDEYİZ

| Katman | Durum |
|---|---|
| Çekirdek kod (3307 satır) | ✅ 58/58 test |
| Anayasa kapısı (8 kural) | ✅ 8/8 |
| Sır taraması | ✅ Temiz |
| Yapılandırma tutarlılığı | ✅ |
| **Gerçek API çağrısı** | ❌ **Anahtar yok** |
| **24 saatlik test** | ❌ **Yapılmadı** |
| **Gerçek müşteri işi** | ❌ **Müşteri yok** |

### Doğrulama kapıları: **3 / 13**

| Kapı | Durum |
|:--:|---|
| 1 Ortam | ✅ |
| 2 Anayasa | ✅ |
| 3 Sır taraması | ✅ |
| 4 Testler | ✅ |
| 4.5 Loglama | ⬜ |
| 5 Veritabanı | ⬜ |
| 6 Kurtarma | ✅ |
| 7 Tek otorite | ✅ |
| 8 Yetki | ✅ |
| 9 Token muhasebesi | ✅ |
| 10 Bağlam bütünlüğü | ✅ |
| **11 Gerçek API** | ❌ |
| **12 24 saat soak** | ❌ |
| **13 Gerçek müşteri işi** | ❌ |

> **Çekirdek test edildi, uçlar test edilmedi.**
> Gate 11 olmadan "çalışıyor" denemez.

---

## SIRADAKİ ADIM — 3 KURUCU KARAR

```
1. .env'e anahtar yaz
2. .\calistir.ps1 çalıştır
3. Gerçek token sayacını gör     ← Gate 11
4. 08_GEREKLER/ACIK_KARARLAR.md'ye bak
   └─ D8 (ilk iş akışı) EN KRİTİK
```

---

## İKİ KURAL

### 1. Silme yok

Bu depoda **hiçbir dosya kalıcı olarak silinmez.** Devre dışı bırakmak
`99_ARSIV/` altına taşımaktır.

> Gerekçe: `FINAL_MASTER_ARCHITECTURE.md:83` güvenlik puanını 4 verdi,
> gerekçesi "ilkeler güçlü, **ihlal edilmiş**." İhlallerin çoğu silmeydi.

### 2. Bu klasörde yeni mimari kararı

```
1. 00_TEK_OTORITE/KARAR_GUNLUGU.md'na yaz
2. ANAYASA.md'yi güncelle
3. Testleri çalıştır (58 yeşil olmalı)
4. Anayasa kapısını çalıştır (8/8 olmalı)
```

**Karar günlüğüne girmeyen iddia, taslaktır.**

---

## ŞÜPHE EDİYORSAN

### "Bu iddia doğru mu?"

`30_Teknik/DURUM_RAPORU.md` → **YAPILMADI** listesi.
Ve `00_TEK_OTORITE/ANAYASA.md` §6:

> *"Kanıtsız iddia kurumsal bilgi **promlanamaz.** Uydurma en pahalı
> hatadır: bir kez yakalanan müşteri bir daha gelmez."*

### "Bu dosya neden burada?"

`00_TEK_OTORITE/SORUMLULUK_HARITASI.md` → 226 dosyanın her birinin
nereye gittiği yazılı.

### "Neden bu karar?"

`00_TEK_OTORITE/KARAR_GUNLUGU.md` → her kararın gerekçesi ve etkisi.

---

## KURALLAR

| Kural | Ne |
|---|---|
| **K-01** | Tek global koordinator. İki işçi olabilir. **İki amir olmaz.** |
| **K-02** | Rol modele değil **yetkiye** bağlanır |
| **K-03** | Test edilmemiş failover **kullanılamaz** |
| **K-04** | Şifre **izlenen ağaçta** bulunamaz |
| **K-05** | Her çalışanın yetkisi **bildirilmiş** olmalı |
| **K-06** | Seviye 4 **hiçbir zaman** otomatik |
| **K-07** | Her iddia kaynaklı ya da `VERIFY_REQUIRED` |
| **K-08** | Uçucu içerik önbelleği bozmaz |

Tam: `10_Anayasa/anayasa.md`

---

## YETKİ SEVİYELERİ

| Seviye | Ne | Otomatik mi? |
|:--:|---|---|
| 0 | Okuma, araştırma | **Evet** |
| 1 | Taslak, geri alınabilir | **Evet** |
| 2 | Dışarı gönderim | **İnsan onayı** |
| 3 | Kontrollü kayıt | **İnsan onayı** |
| 4 | Para, hukuk, deploy, silme | **HİÇBİR ZAMAN** |

> Yapay zeka çalışanı yetkisi kadar iş yapar.
> **"Model yapabiliyor" = "çalışan yapabiliyor" değildir.**
> Hiçbir AI çalışanı seviye 4 **olamaz.**
