# FİYATLANDIRMA — HİBRİT MODEL

> D-01 kararı: **hibrit**. Bu yüzden fiyat **iki kalemlidir.**
> Tarih: 2026-10-06

---

## ⚠️ BU BELGEDEKİ TÜM RAKAMLAR HİPOTEZDİR

Kaynak bunu kendisi söylüyor:

> `02_IS_MODELI_GELIR_MOTORLARI.md:107-124`
> *"Bu belgedeki fiyatlar **tahmindir**. 1. Hiç fiyat testi yapılmadı.
> 2. Doküman 'hipotez' diyor. 3. Rakip fiyatı bilinmiyor. 4. Sektör
> belirsizken fiyat verilemez."*

> **"Ölçülmemiş fiyat, kâr gizleme aracıdır."** — `:119`
> *"İlk müşteride zarar etmek, referans kazanmanın en ucuz yoludur."*

**Bu belge bir fiyat listesi DEĞİLDİR.** Bir tartışma başlangıcıdır.

---

## İKİ KALEMLİ YAPI (D-01)

Hibrit kararı, fiyat yapısını da belirledi:

| Kalem | Ne zaman | Fatura |
|---|---|---|
| **Kurulum** | Bir kez | Proje bazlı |
| **İşletme** | Her ay | Aylık |

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   KURULUM                    İŞLETME                │
│   (bir kez)                  (aylık, 12 ay)        │
│   Paket A veya B             Paket C               │
│                             │                       │
│   ┌────────┐                │    ┌────────────┐    │
│   │ Denetim│──ÖLÇÜM──▶      │    │ İşletme +  │    │
│   │  Kurulum│   3 SAYI      │    │ İzleme +   │    │
│   └────────┘     │          │    │ Yeni beceri│    │
│                  ▼          │    └────────────┘    │
│           ┌──────────┐     │                       │
│           │ Ne        │────▶│  ← fark burada       │
│           │ kazandık?│  │  │     açıklanabilir mi?│
│           └──────────┘     │                       │
└────────────────────────────┴───────────────────────┘
```

**Fark şudur:** Kurulumda **ne yaptığını** söylersin. İşletmede **ne
kazandırdığını** söylemen gerekir. İşletme fiyatı bu yüzden ölçüm olmadan
verilemez.

---

## HİPOTEZ BANDLAR

`02_IS_MODELI_GELIR_MOTORLARI.md:100-105`:

| Paket | Bant | Ne karşılığında |
|---|---|---|
| **A — AI Denetimi** | 25.000 – 75.000 TL | 1-2 hafta, rapor + önceliklendirilmiş öneri |
| **B — Kurulum** | 75.000 – 300.000+ TL | Sistem + beceri + eğitim + dokümantasyon |
| **C — Yönetilen Operasyon** | 15.000 – 100.000+ TL/ay | Sürekli işletme |

> ⚠️ **D paketi (performans bazlı) 1. yıl KULLANILMAZ.**
> Sabit + sonuç primi. Kontrol etmediğin şeyi garanti edersin.

---

## BİRİM EKONOMİ TABLOSU — TAMAMEN BOŞ

`02_IS_MODELI:132-150`:

| Değişken | Değer | Durum |
|---|---|---|
| Müşteri başına aylık AI maliyeti | **?** | **Ölçülmedi** |
| Müşteri başına aylık insan maliyeti | **?** | **Ölçülmedi** |
| Kurulumdaki toplam saat | **?** | **Ölçülmedi** |

Soru:

> *"Bu müşteriye ayda 30.000 TL fatura edersek, **brüt kârımız ne?**"*
> — **Cevabı bilmiyoruz.**

### Bu tablo doldurulmadan fiyat verilmez

`04_GUVENLIK/IHLAL_RAPORU.md` Ihlal 9'a bak: 4 sağlayıcının limiti de
doğrulanmamış. Maliyet tarafı **hiç ölçülmemiş.**

**Sıra:**
```
1. D9  — kota doğrulama (sağlayıcı maliyeti)
   ↓
2. Gerçek görev çalıştır (Gate 11) → token sayacı gerçek olsun
   ↓
3. BİRİM EKONOMİ tablosunu doldur
   ↓
4. Fiyat bandı belirle
```

---

## ÖLÇÜM NASIL YAPILIR — 3 SAYI

`02_IS_MODELI`:

| # | Sayı | Ne zaman |
|:--:|---|---|
| **1** | Önce kaç saat | Kurulum öncesi ölçüm |
| **2** | Sonra kaç saat | 90 gün sonra |
| **3** | Tutar | Saat × saatlik maliyet |

> *"Bu üç sayı olmadan **'ROI' satamazsın.**"* — `:145`

### Paket A neden "risk sıfır"

Çünkü Paket A **zaten ölçümle başlar.** Müşteri 25.000-75.000 TL öder,
siz 1-2 hafta içinde rapor verirsiniz. Garanti verdiğiniz bir şey yok —
**satın alınan şey bilgidir.**

### Paket C neden pahalı

Çünkü Paket C'de **siz işletiyorsunuz.** Müşterinin ekibi değil.
Kâr marjı yüksek çünkü **sistem satıyorsunuz, saat değil.**

---

## İKİ KULLANIM ALANI

| Alan | Fiyat | Not |
|---|---|---|
| **Kendi işin** (PergoClean) | **0** | Kendine maliyet |
| **Müşteri işi** | Tablo yukarıda | Gelir |

> ⚠️ **Kendi işinde fatura kesme.** Kendi maliyetini ölç — ama "satış" yapma.
> Karıştırırsan 3 sayı ölçümü kendi işinde de yapılmaz.

---

## BÜTÇE KISITI

`MASTER-BUILD-PROMPT-TOZ-v2.md:28`:

> *"Parasal olarak **başlangıçta hiçbir şeye para ödemek** istemiyorum."*

| Kısıt | Ticari sonucu |
|---|---|
| $0 araç maliyeti | Ücretsiz modeller + yerel model |
| $0 eğitim maliyeti | Kendi öğrenmemiz gerekir |
| $0 pazarlama bütçesi | İlk müşteri **ağdan** gelir |
| $0 müşteri kazanım aracı | Referans + doğrudan görüşme |

### Bu, model seçimini etkiler

C-10 çelişkisi bu yüzden önemli: **6 farklı sağlayıcı sırası** vardı.
Bütçe kısıtı nedeniyle hepsi ücretsiz katmana yönelmiş — ama tutarlı değil.

> `10_MODEL_STRATEJISI:16` — *"Provider değişikliği **koordinator değişikliği
> değildir**"* ama yine de insan onayı ister (maliyet + veri aktarımı değişir).

---

## FİYAT KURALLARI

### Asla

- ❌ Ölçülmemiş maliyetle fiyat verme
- ❌ "En az" garantisi verme
- ❌ Paket D'yi 1. yılda kullanma
- ❌ Saat satma (marj düşük, ölçek yok)
- ❌ Fiyatı gizleme — **fiyat tartışması kazanç emaresidir**

### Her zaman

- ✅ Önce ölçüm (Paket A)
- ✅ 3 sayıyla konuş
- ✅ Ne yapıldığını yaz, ne yapılacağını değil
- ✅ Kaynak göster (K-07)

---

## PAKETLERİN DETAYLI TANIMI

### PAKET A · AI DENETİMİ

| Alan | İçerik |
|---|---|
| Süre | 1-2 hafta |
| Teslim | Denetim raporu + önceliklendirilmiş öneri + tahmini kazanç |
| Ölçüm | **Başlangıç ölçümü dahil** (3 sayı #1) |
| Risk | **Sıfır** — salt okunur |
| Rol | Satışın ilk adımı |

### PAKET B · KURULUM

| Alan | İçerik |
|---|---|
| Süre | 4-12 hafta |
| Kapsam | **1-3 iş akışı. Daha fazlası değil.** |
| Teslim | 8 teslim maddesi (sistem, beceri, test, yetki, iz, ölçüm, devir, aktarım) |
| Ölçüm | 3 sayı #1 (önce) |
| Risk | Orta |

> ⚠️ *"3 akıştan sonra 'bir de şunu ekleyelim' başlar."* — kapsam kayması

### PAKET C · YÖNETİLEN AI OPERASYONU

| Alan | İçerik |
|---|---|
| Süre | **12 ay, aylık fatura** |
| Kapsam | İşletme + izleme + iyileştirme + yeni beceri |
| Ölçüm | 3 sayı #2 ve #3 |
| Rol | **Şirketin asıl gelir motoru** |

### PAKET D · PERFORMANS BAZLI

| Alan | İçerik |
|---|---|
| Süre | — |
| Yapı | Sabit + sonuç primi |
| Durum | ⛔ **1. yıl KULLANILMAZ** |

> ⚠️ *"Kontrol etmediğiniz şeyi garanti edersiniz."*

---

## KARAR: D8 İLK İŞ AKIŞI

Bu belge yazılabilir ama **müşteri için fiyat konuşulamaz** — çünkü hangi
iş akışını otomatikleştireceğimiz belli değil.

**D8 olmadan:** fiyat bandı, kapsam, SLA ve sözleşme süresi belirlenemez.

> Bkz. `08_GEREKLER/ACIK_KARARLAR.md` D8 — *En kritik açık karar.*
