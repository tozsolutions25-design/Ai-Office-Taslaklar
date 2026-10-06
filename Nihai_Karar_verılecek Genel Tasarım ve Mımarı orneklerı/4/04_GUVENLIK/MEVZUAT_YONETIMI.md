# MEVZUAT YÖNETİMİ

> Kaynak: `toz_ai_group_blueprint_2026/11_GUVENLIK_MEZUAT_YONETISIM.md`,
> `17_MEZUAT_HARITASI.md`
> ⚠️ **Bu içerik hiçbir FINAL_ARCHITECTURE dosyasında yoktu.** Analiz sırasında kurtarıldı.
> Tarih: 2026-10-06

---

## TEMEL İLKE

> **"Yapay zeka çalışanı yetkisi kadar iş yapar."**
> `"Model yapabiliyor" = "çalışan yapabiliyor" değildir.`
> — `11_GUVENLIK_MEZUAT_YONETISIM.md:2`

> **"AI çalışan hukuken insan çalışan değildir."**
> — `17_MEZUAT_HARITASI.md` madde 9

---

## 1 · AI ÇALIŞANIN HUKUKİ KONUMU

### AI bir taraf değildir

| Konu | Sonuç |
|---|---|
| Sözleşme imzalayamaz | ❌ Seviye 4 |
| Vergi sorumluluğu taşımaz | ❌ İnsan |
| İş hukuku kapsamında değildir | ❌ |
| **Kararın sorumluluğu** | **Veren insana ait** |

### Bu neden yetki matrisi var

```
AI çalışanı  →  0-2    (okuma, taslak, araştırma)
Dış uzman    →  0-2
Teknik (sahip)  →  3
SAHİP        →  4     (para, hukuk, deploy, kalıcı silme)
```

> *"Hiçbir AI çalışanı seviye 4 **değildir**. Bu kural bilinçli olarak
> kondu."* — `04_ORGANIZASYON_YETKI_IKILI.md:83-93`

---

## 2 · KVKK

> *"Üçüncü kişilerden alınan iletişim bilgilerinin **reklam/pazarlama için
> kullanılmasının otomatik olarak hukuki dayanak sağlamadığı**"*
> — kaynak: **kvkk.gov.tr**

### Somut sonuç

```
❌ YANLIŞ:  "Veriyi topladım, izin de aldım, o hâlde pazarlama yapabilirim"
✅ DOĞRU:   "Veriyi topladım" + "pazarlama için AYRI dayanak var mı?"
```

| Durum | Gereken |
|---|---|
| Müşterinin kendi verisi | Açık rıza **veya sözleşme** |
| **Üçüncü kişinin** verisi | **Ayrı dayanak** — sözleşme yeterli olmayabilir |
| Toplu iletişim | İYS kuralları (aşağıda) |

### Riskli olan hamle

`02_IS_MODELI` + `03_MUSTERI_IS_AKISI` içinde "müşteri listesi oluştur"
adımı varsa — **o adımın hukuki dayanağı sorulmalı.**

> ⚠️ D8 (ilk iş akışı) seçilirken bu kontrol **şarttır.**

---

## 3 · İYS (TİCARİ ELEKTRONİK İLETİ)

> *"Ticari elektronik ileti onay/ret yönetimi"* — kaynak: **ticaret.gov.tr**

### Zorunlu kayıtlar

Her ticari elektronik ileti için:

| Kayıt | Nerede |
|---|---|
| **Kim** gönderiyor | Şirket unvanı |
| **Neden** gönderiyor | Dayanak (KVKK + İYS) |
| **Hangi** kanaldan | WhatsApp / e-posta / SMS |
| **Ne sıklıkla** | Günlük/haftalık |
| **Ret** mekanizması | Her iletide ret linki |

---

## 4 · WHATSAPP

> *"WhatsApp kanalının kullanılması **KVKK ve ticari ileti kurallarını
> ortadan kaldırmaz.**"*
> — `11_GUVENLIK_MEZUAT_YONETISIM.md`

> Bu madde **hiçbir FINAL_ARCHITECTURE dosyasında yoktu.** V3'te de yok.
> Bu, sessiz bir risktir.

### Somut kural

```
WhatsApp kullanımı otomatik olarak mevzuattan muafiyet DEĞİLDİR.
Aynı kayıt yükümlülüğü WhatsApp'ta da geçerlidir.
```

### Kaydedilmesi gerekenler

| Alan | Zorunlu mu? |
|---|---|
| Gönderen kim | ✅ |
| Gerekçe / dayanak | ✅ |
| Sıklık | ✅ |
| Ret kaydı | ✅ |
| Alıcı listesi kaynağı | ✅ |

### Özellikle dikkat

Operasyon hattında WhatsApp **birim iletişim aracıdır.**
Bu kanal üzerinden **toplu pazarlama** yapılırsa İYS tetiklenir.

> Satış-pazarlama birimi yalnızca operasyon hattında (D-01).
> Bu kanal risk yoğun → insan onayı zorunlu (seviye 2).

---

## 5 · FİNANS

> *"TOZ AI **kendi başına lisanssız yatırım şirketi** gibi konumlandırılmaz."*
> — `11_GUVENLIK_MEZUAT_YONETISIM.md`

### Sonuç

| Konu | Durum |
|---|---|
| Yatırım tavsiyesi | ⛔ Verilmez |
| Portföy önerisi | ⛔ Verilmez |
| Kripto alım-satım önerisi | ⛔ Verilmez |
| Finans **araştırması** | ⚠️ Pasif (talep gelince) |

`12_AI_CALISAN_KATALOGU` — Finans bölümü: *"Normalde **pasif**."*

### Neden

Lisanssız yatırım tavsiyesi cezai sorumluluk doğurur.
Bu, **hiçbir model yeteneğiyle telafi edilemez.**

---

## 6 · SAĞLIK / VETERİNER

> *"AI içerik üretir; **mevzuat çalışanı kontrol eder.**"*

Bu alan **1. yılda hizmet kataloğunda yok.**
Bkz. `06_IS_MODELI/HIZMET_KATALOGU.md` — Dikey 9: ⛔

### Neden

| Risk | Açıklama |
|---|---|
| Yanlış teşhis | Doğrudan zarar |
| Sıkı denetim | İzin, kayıt, sorumluluk |
| KVKK en ağır | Sağlık verisi **özel nitelikli** |

> Sağlık verisi KVKK'da **özel nitelikli kişisel veri** — işleme
> koşulları çok daha serttir.

---

## 7 · GİZLİLİK

### Kontrolsüz model bağlamına sokulmayacak

`11_GUVENLIK_MEZUAT_YONETISIM.md`:

```
❌ Parola
❌ API anahtarı
❌ Banka bilgisi
❌ Kimlik bilgisi
❌ Müşteri ticari sırrı
```

> **"Kontrolsüz model bağlamına sokulmaz."**

### Kod zorluyor

| Modül | Ne yapıyor |
|---|---|
| `baglam_muhru.py` | `kontrol()` — muhur yazılmadan önce 6 desen |
| `beyin.py` | `_kontrol()` — her yazımdan önce 6 desen |
| `sir_tara.py` | 9 desen + 9 dosya adı + git ağacı kontrolü |
| `obsidian_sync.py` | 9 desen — commit öncesi |

> **4 bağımsız katman.** Biri atlanırsa diğerleri yakalar.

### AI kendi sırlarını yönetemez

`16_SECURITY_GOVERNANCE` — AI kendine değiştiremez:
- sır yönetimi
- yetki matrisi
- yıkıcı politikalar

---

## 8 · SÖZLEŞME VE TAAHHÜT

### AI imzalayamaz

| Belge | İmza yetkisi |
|---|---|
| Hizmet sözleşmesi | ❌ İnsan (seviye 3) |
| Teklif | ❌ İnsan (seviye 2) |
| NDA | ❌ İnsan |
| Fatura / ödeme | ❌ **Seviye 4 — HİÇBİR ZAMAN** |

### Garanti verilemez

Paket D (performans bazlı) bu yüzden **1. yıl kullanılmaz:**

> *"Kontrol etmediğiniz şeyi garanti edersiniz."*

Hedeflenmeyen bir sonucu taahhüt etmek hukuki risktir.
`06_IS_MODELI/FIYATLANDIRMA.md`

---

## 9 · 6 İŞLEM — İNSAN ONAYI ZORUNLU

`11_MCP_POLICY:34-41` + `16_SECURITY_GOVERNANCE` — aynı liste:

```
1. Para
2. Hukuki işlem
3. Toplu ticari iletişim
4. Production deploy
5. Geri dönüşü zor değişiklik
6. Kalıcı silme
```

> **Kodda karşılığı:** `onay_kapisi.py` — seviye 4 **her zaman** reddedilir.

---

## 10 · KAYNAK TAKİBİ

| Konu | Kaynak | Bu dosyada |
|---|---|---|
| KVKK | kvkk.gov.tr | §2 |
| İYS / Ticari İleti | ticaret.gov.tr | §3 |
| Genel | — | Yükümlülük AI'da değil **insandadır** |

> **Bu kaynaklar `limit-durumu.json` mantığıyla aynıdır:**
> doğrulanmamış bilgi `dogrulama_durumu` alanıyla işaretlenir.
> Aşağıdaki tablo **doğrulanmamıştır** — mevzuat değişir.

| Alan | Durum |
|---|---|
| KVKK madde numaraları | ⬜ Doğrulanmadı |
| İYS güncel metni | ⬜ Doğrulanmadı |
| WhatsApp ticari ileti kapsamı | ⬜ **Belirsiz — hukuk danışmanına sorulmalı** |

> K-07: Kaynaksız iddia kurumsal bilgi **promlanamaz.**
> **Bu tablo karar verici değildir. Danışman görüşü gerekir.**
