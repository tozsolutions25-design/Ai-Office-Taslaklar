# OPERASYON HATTI — MÜŞTERİ İŞİ

> D-01 kararı: TOZ AI **hibrit**. Bu, B tarafı.
> Kaynak: `14_SIRKET_HIYERARSISI.md`, `03_MUSTERI_IS_AKISI.md`,
> `12_AI_CALISAN_KATALOGU.md`, `V3_MASTER_MIMARI §2.4`
> Tarih: 2026-10-06

---

## TANIM

**Müşterinin işini yürütüyoruz.** Sonuç satıp kalıcıyız.

Bu hatta **gelir** var. Aynı zamanda **moat** birikiyor — çünkü her
müşteri işi sektörel bilgi, iş akışı ve operasyon hafızası bırakıyor.

---

## 15 MERKEZDEN OPERASYON'A AİT OLANLAR

`14_SIRKET_HIYERARSISI.md`:

| # | Merkez | Faz | 1. yıl |
|:--:|---|:--:|:--:|
| 3 | Müşteri ve Satış Merkezi | 11 | ✅ |
| 4 | Pazarlama ve Büyüme Merkezi | 11 | ✅ |
| 7 | Sektörel Operasyon Merkezi | 8 | ✅ |
| 8 | Araştırma ve İş Zekâsı Merkezi | 8 | ✅ |
| 9 | Finans ve Uzmanlık Merkezi | talep | pasif |

> **5.** YouTube ve Medya Stüdyosu — Faz 13+, ❌ 1. yıl yok
> **14.** 3D Sanal Ofis — Faz 13+, ❌ 1. yıl yok

---

## SATIŞ-PAZARLAMA BİRİMİ — YALNIZCA BURADA

`V3_MASTER_MIMARI §2.4` — senin ifadenle:

> *"Sadece operasyon tarafında bir satış pazarlama ünitesi ile dahil
> edebiliriz."*

### Bu doğru ve gerekli. Dört sebep:

| Neden | Açıklama |
|---|---|
| **Yetki** | Satış seviye 2-3 gerektirir. A tarafında bu yok. |
| **Mevzuat** | İleti mevzuatı (İYS) ve KVKK satışta devreye girer. |
| **Kadro** | A tarafı tek kişiyle yürür; satış ekibi gerektirir. |
| **Akış** | Satışın akışı farklı (görüşme, teklif, kapanış). |

```
AJAN HATTI      →  kendi ürünümüzü kendimiz yapıyoruz
OPERASYON HATTI →  müşteriye yapıyoruz
SATIŞ-PAZARLAMA →  yalnızca B tarafında, insan onaylı
```

### ⚠️ Satış birimi AI DEĞİL, İNSAN FONKSİYONUDUR

```
AI taslak üretir  →  İNSAN gönderir
```

Bu K-06'nın gereğidir: *"Model yapabiliyor = çalışan yapabiliyor değildir."*

---

## MÜŞTERİ İŞ AKIŞI

`03_MUSTERI_IS_AKISI.md` ve `04_MUSTERI_KARSILAMA_ILK_90_GUN.md`:

```text
1. İLK TEMAS
   Müşteri bir kanaldan gelir (telefon, e-posta, WhatsApp, form)
        ↓
2. ÖN ELEME
   AI: sektör, büyüklük, ihtiyaç tahmini → VERIFY_REQUIRED
   İnsan: doğrular mı?
        ↓
3. KEŞİF
   İhtiyaç, mevcut süreç, beklenti, bütçe
        ↓
4. ANALİZ
   ORTAK ANALİZ MOTORU çalışır → iki tarafa da gider
        ↓
5. TEKLİF
   Kapsam + fiyat bantı  →  İNSAN ONAYI (seviye 2-3)
        ↓
6. KURULUM (Paket B)
   4-12 hafta · 1-3 iş akışı
        ↓
7. YÜRÜTME (Paket C)
   Aylık, 12 ay · işletme + izleme + iyileştirme
        ↓
8. ÖLÇÜM
   3 SAYI: önce kaç saat → sonra kaç saat → tutar
        ↓
9. GENİŞLETME
   Yeni beceri ekle → tekrar et
```

---

## 4 PAKET

`05_HIZMET_KATALOGU_PAKETLER.md`:

| Paket | Süre | Kapsam | Risk |
|---|---|---|---|
| **A — AI DENETİMİ** | 1-2 hafta | Salt okunur. Rapor + önceliklendirilmiş öneri + tahmini kazanç. Başlangıç ölçümü dahil | *"Satışın ilk adımı. **Risk sıfır.**"* |
| **B — KURULUM** | 4-12 hafta | **1-3 iş akışı. Daha fazlası değil.** Sistem + beceri + eğitim + dokümantasyon | *"3 akıştan sonra 'bir de şunu ekleyelim' başlar."* |
| **C — YÖNETİLEN AI OPERASYONU** | Aylık, 12 ay | İşletme, izleme, iyileştirme, yeni beceri | *"**Bu, şirketin asıl gelir motorudur**"* |
| **D — PERFORMANS BAZLI** | — | Sabit + sonuç primi | ⚠️ *"**İlk yıl KULLANILMAZ.** Kontrol etmediğiniz şeyi garanti edersiniz."* |

### Paket başına 8 teslim

1. Çalışan sistem
2. Beceri dosyaları
3. Değerlendirme testleri
4. Yetki matrisi
5. İz (denetim) kaydı
6. Ölçüm raporu (3 sayı)
7. Devir planı
8. Bilgi aktarımı

---

## 3 SAYI ÖLÇÜMÜ

`02_IS_MODELI_GELIR_MOTORLARI.md`:

> **1.** Önce kaç saat
> **2.** Sonra kaç saat
> **3.** Tutar

> *"Bu üç sayı olmadan 'ROI' satamazsın."*

**Ölçüm kimin işi:** AI ölçer (seviye 0-1, otomatik), insan doğrular.

> ⚠️ D paketi bu ölçüme dayanıyor — ama **kontrol etmediğin şeyi garanti
> ediyorsun.** 1. yıl kullanılmaz.

---

## İLK İŞ AKIŞI SEÇİLMEDİ — EN KRİTİK EKSİK

`05_HIZMET_KATALOGU_PAKETLER.md:252`:

> *"**En büyük eksik: Paketler var, ilk iş akışı yok**"*

Bu **D8** kararıdır. Bkz. `08_GEREKLER/ACIK_KARARLAR.md`

### 4 kriter

| Kriter | Soru |
|---|---|
| 1. Sıklık | Haftada kaç kez oluyor? |
| 2. Veri | Girdi hazır mı, toplanacak mı? |
| 3. Tasarruf | Hangi kısım otomatikleştirilebilir? |
| 4. Hata payı | Yanlış olursa kabul edilebilir mi? |

### Adaylar

| Seçenek | Değerlendirme |
|---|---|
| ✅ **Teklif talebi → CRM** | *"İyi aday"* — sıklık yüksek, veri var, hata ucuz |
| ⛔ **Müşterinin fiyatı** | Seviye 3-4 gerektirir. AI'ın yetkisi dışında. |
| ⚠️ **Kendi YouTube kanalı** | *"Gerekli değil, yanlış sırayla başlanır"* |
| ✅ **PergoClean kendi işi** | *"Kendini müşteri yerine ilk kullanıcı kabul et"* |

---

## DİKEY MATRİSİ — 9 DİKEY

`05_HIZMET_KATALOGU_PAKETLER.md` — **Sağlık = 1. yıl yok.**

| # | Dikey | Durum |
|:--:|---|---|
| 1 | Pergeola / tente bakımı | ✅ Kendi alanımız |
| 2 | Otomatik kapı / ramp | ✅ Alan bilgisi var (Record Doors) |
| 3 | Endüstriyel bakım | ✅ |
| 4–8 | *5 dikey daha* | Araştırılacak |
| 9 | Sağlık / Veteriner | ⛔ **1. YIL YOK** |

### Sağlık neden yok

> `11_GUVENLIK_MEZUAT_YONETISIM.md` — *"AI içerik üretir; **mevzuat çalışanı kontrol eder.**"*
> Sağlıkta hata maliyeti çok yüksek, düzenleme katı.

---

## "KAPIDA KIRALA" — ÜRÜN HATTI

`14_SIRKET_HIYERARSISI:48`:
> *"Kapıda Kirala / Kapıda Servis **ayrı departman değildir**. Bir business
> initiative olarak yönetilir."*

**Standart kelime: ÜRÜN HATTI** (C-18)

| Kavram | Anlamı |
|---|---|
| Departman | Birbirine bağlı roller grubu |
| **Ürün hattı** | Bağımsız ticari girişim, kendi P&L'ı |
| Merkez | Şirket içi destek fonksiyonu |

> `01_SIRKET_ANAYASASI:119-126` — "kanat + gövde" mantığı:
> Kapıda Kirala kanattır, TOZ operasyon gövdesidir.

**Slogan:** *"Kapıyı kiralamayın. Teknolojiye Abone Olun."*
**Konum:** CapEx → OpEx

---

## MOAT BURADA BİRİKİR

`01_SIRKET_ANAYASASI.md:66`:
> *"**Şirketin moat'ı model olmamalıdır.**"*

Model herkesin erişebildiği bir hammadde. Moat **operasyon hattında** birikir:

| # | Bileşen | Nerede birikir | Durum |
|:--:|---|---|---|
| 1 | Sektörel bilgi | Her müşteri işi | Tek müşteriyle çalışıldı |
| 2 | İş akışı grafikleri | Her iş akışı | ❌ |
| 3 | Kuruma özel eval testleri | Her kurulum | ❌ |
| 4 | Müşteri operasyon hafızası | Her yönetilen operasyon | ❌ |
| 5 | Araç kütüphanesi | Paket B | ❌ |
| 6 | Yetki/yönetişim | Anayasa kapısı | ✅ |
| 7 | Ölçülmüş sonuç geçmişi | 3 sayı | ❌ |
| 8 | Yeniden kullanılabilir beceri | Paket B | Kısmi |

> **Bu sekiz bileşenin hiçbiri bugün tam değil.**
> 1 numaralı dışında hiçbiri için tek bir müşteriyle bile çalışılmadı.

### Ölçek

| Katman | 1. yıl | 3. yıl | 5. yıl |
|---|---|---|---|
| Gerçek insan | **1** | 3-5 | 8-15 |
| Sanal çalışan eşdeğeri | **7** | 20-30 | 60-150 |

> ⚠️ 8-15 "eşdeğer" **aynı anda açık model çağrısı değildir.**
> Olay oldukça açılırlar. Bu ayrım karıştırılırsa maliyet 10 kat çıkar.

---

## KENDİNİ MÜŞTERİ YERİNE İLK KULLANICI KABUL ET

`01_SIRKET_ANAYASASI:145-151`:

> *"Kendini müşteri yerine **ilk kullanıcı** kabul etmek... Kendi işinde
> başarısız olmadan müşteri işine geçmemek, **para riskini 10 kat düşürür.**"*

**Pratik sonuç:** PergoClean kendi iş akışı B tarafının ilk iş akışı olabilir.

### ⚠️ Marka temizliği uyarısı

`Ozkan MASTER_AI_PROFILE:297`:

> *"Record Doors alanı **PergoClean ile otomatik olarak birleştirilmemelidir**.
> Kullanıcı açıkça bağlamı ayırdığında ayrı proje olarak ele alınmalıdır."*

> Bu kural bilinçli olarak kondu. PergoClean = bakım, Record Doors = ürün.
> Bunlar birleşirse marka bulanıklaşır.
