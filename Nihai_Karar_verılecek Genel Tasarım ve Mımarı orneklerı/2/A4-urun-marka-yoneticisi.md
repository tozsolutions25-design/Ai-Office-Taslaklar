# A4 — ÜRÜN & MARKA YÖNETİCİSİ (TOZ AI GROUP)

Kapsam: hizmet kataloğu, 3 paket, konumlandırma, 9 iş birimi ↔ ajan eşlemesi,
kazanç/karşılık analizi, marka varlıkları (30 gün), 1. yıl başarı ölçütleri.

Mimari kısıt: Hermes = tek beyin (plan/araştırma/dağıtım/onay/hafıza), OpenCode =
uzman işçi, Özkan = onay + para. Bu belgede **her ajanın "yapamadığı"** açıkça
yazılıdır; yapamadığı şey insanın işidir.

---

## 0. TEK CÜMLE ÜRÜN FELSEFESİ

> TOZ, "yapay zekâ hizmeti" satmaz; **bir işletmenin içindeki tekrarlayan işi 1
> haftada çalışan bir sisteme çevirir** ve o sistemi devredilir kılarak bırakır.
> Satış birimi "AI projesi" değil, **teslim edilmiş işleyen şey**dir.

Her hizmet bu cümlenin parçası olmak zorunda. Parçası olmayan hizmet katalogdan çıkar.

---

## 1. HİZMET KATALOĞU (8 hizmet)

Fiyat yazılmaz. Fiyat mantığı §1.9'da.

### 1.1 AI Operasyon Merkezi Kurulumu — 10 iş günü
**Kime → Sonuç:** 10–80 çalışanlı, 5+ tekrarlayan süreci olan KOBİ (ofis, ajans, lojistik, e-ticaret operasyonu) → şirket içi tek AI yönetim katmanı; görev dağıtan, hatırlatan, raporlayan, onay isteyen "çalışan ekip". 30 günde ayda 20+ saat manuel iş tasarrufu hedefi.
**Teslimat:** ajan kataloğu + yetki matrisi · Hermes kurulumu ve config · 2 iş akışının ajana devri · 5 sayfa kılavuz · 1 ay ücretsiz izleme.
**Sınır:** 2 iş akışı. 3. akış ücretli ek iş.

### 1.2 Agent & MCP Altyapı Tasarımı — 12 iş günü
**Kime → Sonuç:** Kendi yazılımını yazan yazılım ekibi / SaaS şirketi → kullanıcıdan bağımsız, denetlenebilir, tek sunucuda çalışan agent altyapısı; her ajanın yetkisi, maliyeti ve geçmişi izlenebilir.
**Teslimat:** mimari diyagram + ADR seti · MCP sunucu kodu (TypeScript, CI'da testli) · yetki/maliyet bütçesi config · audit log şeması · kurulum rehberi + devir videosu.
**Sınır:** Bulut altyapısı sağlanmaz; müşterinin hesabına deploy edilir.

### 1.3 Otomasyon ve Entegrasyon (MCP ile) — 10 iş günü
**Kime → Sonuç:** Google Workspace / Sheets / CRM kullanan, elle veri taşıyan ofis → 3 tekrarlayan sürecin koda bağlanması (teklif → fatura → kayıt). Elle kopyalama biter.
**Teslimat:** çalışan entegrasyon kodu + hata yönetimi + 1 saat eğitim videosu + 14 gün garanti.
**Sınır:** 3 entegrasyon. Sonrası ayrı proje.

### 1.4 Özel Yazılım / Web Uygulaması — 15–30 iş günü
**Kime → Sonuç:** İç süreç aracı, panel veya müşteri portalı ihtiyacı olan KOBİ → günlük kullandığı, dokümantasyonu bitmiş uygulama. Tarih kapsam sabitlendikten sonra verilir.
**Teslimat:** kaynak kod + dağıtım dosyası + 3 sayfa kullanım dokümanı + 30 gün hata düzeltme.
**Sınır:** Önceki projelerden **yeniden kullanım yok**; kod müşteriye özeldir.

### 1.5 SEO ve Görünürlük Kurtarma — 20 iş günü + 6 ay takip
**Kime → Sonuç:** "Neden aramadan gelen yok" diyen yerel işletme/KOBİ → ilk 3 ayda teknik borcu sıfırlanmış, indekslenmiş, 6 ayda ölçülebilir ana sayfa/landing görünürlüğü.
**Teslimat:** teknik SEO raporu (önce/sonra) · anahtar kelime + sayfa haritası · site içi yapı düzeltmeleri · `llms.txt` + schema · aylık rapor.
**Sınır:** İçerik üretimi ayrı hizmet (1.7). Garanti "sıralama" değil, **"indekslenme + teknik hatasızlık"**tır.

### 1.6 YouTube Kanal ve İçerik Motoru — 15 iş günü
**Kime → Sonuç:** YouTube'da görünmek isteyen ama üretim hattı olmayan uzman/şirket → ayda 3 uzun video + 8 Shorts üreten, kapak ve başlık standardı sabit kanal + video → müşteri akışı.
**Teslimat:** kanal kurgusu + doküman · 12 haftalık içerik takvimi · ilk 4 videonun senaryosu ve prodüksiyon dosyaları · kurgu/iş akışı · yayın ve raporlama talimatı.
**Sınır:** Yüz, seslendirme, konuk yönetimi TOZ'da yok — müşterinin kendisi.

### 1.7 İçerik ve Bilgi Motoru (SEO + YouTube ortak) — 15 iş günü + aylık
**Kime → Sonuç:** Hem site hem kanalı olması gereken, içerik üretemeyen işletme → ayda 8–12 gerçek içerik parçası (yazı + video senaryosu); ince toplu içerik yok.
**Teslimat:** içerik takvimi · üretim hattı · yayın kodu · aylık performans raporu.
**Sınır:** Her içerik gerçek veri içermek zorunda; müşteri veri sağlamazsa o ay 2 içerik üretilir.

### 1.8 Teknik Denetim ve AI Farkındalık Eğitimi — 3 iş günü
**Kime → Sonuç:** "Yapay zekâyı kim denetliyor?" sorusunu cevaplamak isteyen yönetim ekibi → araç risk envanteri + 2 saatlik "ne yapılır / ne yapılmaz" eğitimi + kontrol listesi.
**Teslimat:** 10–15 sayfa denetim raporu · kontrol listesi (PDF) · eğitim kaydı.
**Sınır:** Yasal denetim değildir; hukuki görüş yok.

### 1.9 Fiyatlandırma mantığı (rakam yok)

```
Teklif = (TESLİMAT_İŞ_GÜNÜ × GÜN_BİRİMİ) × KARŞILIK_KATSAYISI_İŞİ
TESLİMAT_İŞ_GÜNÜ  = hizmet kataloğundaki sabit süre (tekrar ölçülmez)
GÜN_BİRİMİ        = 1 yıllık hedeflenen brüt gelirin ÷ 220 üretim günü
KARŞILIK_KATSAYISI = 1.0 sabit teslimat | 1.3 yeni teknoloji | 1.5 kritik sektör | 0.8 tekrar eden
TAMPALAMA          = talep > teslim kapasitesi ise ×1.25 (sıra korunur)
```

Kurallar: (1) **Süre katalogda sabit**, fiyat değil — değişecekse teklif yenilenir.
(2) Kapsam dışı **fiyatlandırılır**, "bedava yapılır" denmez. (3) Teklifte **teslim
edilecek dosya sayısı** yazılı; sayı yoksa fiyat yoktur. (4) Ödeme **%40 peşin, %60
teslimde** (Sürekli Destek hariç). (5) Ek iş birim fiyat listesi tekliften önce ilan edilir.

---

## 2. ÜÇ PAKET

| Paket | Kapsam (hizmet no'ları) | Sınır (yazılı, pazarlık dışı) |
|---|---|---|
| **2.1 Başlangıç** — "tek sistemi çalıştır" | 1.1 **veya** 1.3 (müşteri seçer, ikisi birden değil) + 1.8 Denetim (hediye, ayrı satılmaz) | 2 ajan, 1 iş akışı derin, 3 belge. **Aylık destek yok**, yalnızca 14 gün garanti. Yeni istek = yeni teklif. Sürekli Destek'a geçiş ilk 30 gün ücretsiz. |
| **2.2 Kurumsal** — "çok birim, tek sözleşme" | 1.1 + 1.2 + (1.5 veya 1.7) zorunlu; 1.4 eklenebilir; 1.8 dahil | 6–8 ajan, 3 iş akışı, 6 aylık raporlama. Müşteri içi yönetici eğitimi dahil, **8 saati geçmez**. **7/24 destek dahil değil** — SLA yok, çalışma saatleri içi. |
| **2.3 Sürekli Destek** — "aylık, sınırlı" | Başlangıç veya Kurumsal **zorunlu ön koşul** (destek ortaksız satılmaz). Aylık: izleme, hata düzeltme, 1 küçük değişiklik, ayda 1 rapor, ayda 2 saat eğitim | Aylık **en fazla 8 saat**; aşan sonraki aya devredilir, **biriktirilmez**. Yeni sistem/entegrasyon/ajan **girmez**. 3 ay üstü sessizlikte faturalama **askıya alınır** (tek seferlik, insan onaylı). |

**Geçiş kuralları:** Başlangıç → Kurumsal'de ilk 6 aydaki ek iş birimlerinin **%50'si mahsup**.
Kurumsal → Başlangıç **yalnızca sözleşme bitişinde**, ön ödeme iadesiz. Sürekli Destek
iptali 30 gün önceden bildirimle; **dönemsel taahhüt yok**.

---

## 3. KONUMLANDIRMA

### 3.1 Kim hedefleniyor (birincil + ikincil)

| Öncelik | Segment | Neden | Kapsam dışı |
|---|---|---|---|
| **1. Birincil** | **10–80 çalışanlı KOBİ, özellikle yazılım/ajans/mühendislik şirketleri** | Karar verici = sahibi/teknik direktör; bütçe var, AI farkındalığı yüksek, ikna süresi kısa | Holding, kamu, banka (uzmanlık ve referans eksik) |
| 2. İkincil | **E-ticaret ve yerel hizmet işletmeleri (5–30 çalışan)** | SEO + otomasyon ihtiyacı somut; fiyat hassasiyeti yüksek | Çok uluslu e-ticaret (KVKK, vergi, entegrasyon derinliği) |
| 3. Fırsat | **Sanatkâr / uzman kişi (video + web)** | Düşük gelir beklentisi, yüksek dönüşüm; 1.6 için ideal | — |
| — | **Kurumsal (500+)** | **Hedeflenmiyor.** 1 yılda referans ve ekip yok; satış çökerse zarar verir | — |

### 3.2 Tek cümlelik iddia

> **"Tek geliştiriciyle büyütülemez dediğiniz işi, teslim ettiğimiz çalışan bir
> sisteme dönüştürüyoruz — sonra size devredip gidiyoruz."**

### 3.3 Üç kanıt noktası

1. **Devir, bağımlılık değil.** Her teslimat kaynak kod + doküman + video; TOZ'nun
   ölçülebilir kriteri "müşteri TOZ olmadan da çalıştırabiliyor" (§1.1–1.4 teslimat listelerinde yazılı).
2. **Ölçülebilir süre, pazarlama değil.** 8 hizmetin hepsinde gün sayısı katalogda sabit.
   "AI danışmanlığı" değil, "10 günde 2 iş akışı devri".
3. **Şeffaf sınır.** Her hizmette "Sınır" satırı var; ücretsiz katmanda çalışmayan şey
   vaat edilmiyor. Bu, ilk 3 referansı en ucuz yoldan üretir.

### 3.4 İkame edilebilir alternatifler (gerçek rakipler)

| Rakip | TOZ'nun farkı | TOZ'nun zayıf olduğu yer |
|---|---|---|
| **Freelance yazılımcı** | Sorumluluk + devir + dokümantasyon; 6 ay garanti | Fiyat yüksek; freelancer hızlıdır |
| **Ajans (genel amaçlı)** | Ajans tasarım/görsel odaklı, TOZ süreç otomasyonu odaklı | Ajansın ekibi vardır — TOZ tek insan |
| **ChatGPT / Claude aboneliği (kendin yap)** | ChatGPT bilmiyor, sizin verinizi bilmez, hatırlamaz; TOZ hatırlar ve çalıştırır | Müşteri 2 saat deneyince "ben de yapabilirim" der — **en tehlikeli rakip** |
| **Otomasyon araçları (Zapier/Make + AI)** | Araç kullanmak işi çözmez, süreci tasarlamak gerekir; TOZ tasarlar | Araçlar kuruş yönetimi için ucuz; TOZ'yu pahalı gösterir |
| **Yapay zekâ danışmanlığı şirketleri** | Hepsi aynı; TOZ'nun farkı **yazılım teslimatı** | Referans eksikliği |
| **Müşterinin kendi çalışanı** | Maliyet sürekli, TOZ tek seferlik | Öz kısa vadede en ucuz |

**Kritik içgörü:** TOZ'nun asıl rakibi 5. satır değil, **3. satır**. Bu yüzden "AI değil,
çalışan sistem" cümlesi **her yerde** taşınır ve demo, her toplantıda gerçek bir ajan
çalıştırılarak yapılır.

---

## 4. İŞ BİRİMİ ↔ AJAN KADROSU

### 4.0 Kurallar
Bir ajan **bir iş biriminin sorumlusudur**, ikinci iş biriminin yardımcısı olamaz
(çakışma = Hermes'te kayıt). **Ajan sayısı = aktif iş birimi sayısı**; boşta ajan
kurulmaz. Her ajan için **danışma eşiği** ve **bırakma koşulu** zorunludur.

### 4.1 Tablo

| # | İş birimi | Sorumlu ajan | Görev alanı | Danışma eşiği | Çalışmayı bırakma koşulu |
|---|---|---|---|---|---|
| 1 | **Yönetim-Strateji** | `karar-gunlugu` | Haftalık board; teklif kabul/red kaydı; kapsam değişikliği kaydı; 90 gün planı tekrar | Haftalık **1 para kararı** veya **yeni hizmet** kararı; kapsam **%20** değişimi | Kanıt/ölçüm yoksa dur; 3 tur aynı sonuç çıkarsa dur ve insana yaz |
| 2 | **AI İşletme-Koordinasyon** | `isletge-kurulum-ajansi` | 1.1 kapsamında ajan kataloğu, yetki matrisi, config, 2 iş akışı devri, kılavuz | Yeni ajan yetkisi >salt-okunur; müşteri sunucusunda kod | 2 iş akışı devredildi ve müşteri bağımsız çalıştırdıysa **ajan işini bırakır** |
| 3 | **Müşteri-Satış** | `satis-ajani` | Teklif taslağı, kapsam dışı listesi, e-posta taslağı, teklif takip kaydı, sözleşme metni | **Her müşteriye giden metin** (insan gönderir), fiyat oranı **>1.25**, sözleşme **>1 sayfa** ek şart | 3 ardışık teklif reddi → teklif şablonu gözden geçirilir; 4. redde **ürün/hizmet değişikliği insana gider** |
| 4 | **Pazarlama-Büyüme** | `pazarlama-ajansi` *(koşullu)* | Kanal içeriği, LinkedIn/Reddit metni, dağıtım takvimi, UTM, haftalık kanal raporu | Yeni kanal açılışı, sponsorluk, para harcaması, **toplulukta hesapla yazma** | 4 hafta üst üste ölçülebilir trafik artışı yoksa kanal kapatılır; 2 kanal yetmiyorsa ajan **görünür kılınmaz** |
| 5 | **Yazılım** | `yazilim-muhendisi` | 1.3 ve 1.4 kapsamındaki kod, test, dağıtım dosyası, doküman | **Üretim ortamına yazma**, yeni bağımlılık, müşterinin canlı verisine erişim | CI yeşil + test kapsamı kabul edilmeden ajan teslim "bitti" demez; 2 kez reddedilen kod yazım tarzına bakılır |
| 6 | **AI / Teknik Altyapı** | `altyapi-ajansi` | MCP sunucu kodu, yetki/bütçe config, audit log, izleme, maliyet raporu | Sunucu/veritabanı/hesap **ücretli kaynak**, model sağlayıcı değişimi, **API anahtarı** | Kimlik doğrulama açığı, sürpriz maliyet uyarısı; iki kez başarısız güvenlik incelemesi → dur |
| 7 | **YouTube-Medya** | `icerik-uretici` | Senaryo, başlık/açıklama varyantları, kapak brief'i, kurgu talimatı, yayın takvimi | Yüz/ses, telif, sponsor içerik, **yayına koyma butonu** | 8 video sonrası izlenme medyanı düşüyorsa format değil **konu** değiştirilir; 3 ayda %5 dönüşüm yoksa paket yeniden tasarlanır |
| 8 | **Sektörel Operasyonlar** | `sektor-ajansi` *(koşullu)* | Sektör bazlı süreç kütüphanesi, risk listesi, teklif taslağı | **Yeni sektör** açılışı, iddia/garanti içeren metin, mevzuat yorumu | 2 sektörde 3 ay arka arkaya teklif kaybı → o sektör kapatılır, ajan o sektöre atanmaz |
| 9 | **Finans-Uzmanlık** | `finans-ajansi` *(koşullu)* | Maliyet modeli (kâr marjı), fiyat/iskonto önerisi, teklif kârlılık kontrolü, ödeme takip kaydı | Vergi/muhasebe görüşü, beyan, sözleşme cezası, **para hareketi** | Marj %30 altına düşerse yeni teklif üretilmez; ödeme 60 günü geçerse yeni iş kabul edilmez |

### 4.2 Koşullu ajanların tetikleyicisi (boşta kurulmaz)

| Ajan | Ne zaman kurulur | Tetikleyici (sayısal) |
|---|---|---|
| `pazarlama-ajansi` | 0. ayda kurulur (A3 kanal planı zaten aktif) | — |
| `sektor-ajansi` | **6. ay** | 2+ bitmiş proje + sektör talepleri ≥ 4 |
| `finans-ajansi` | **3. ay** | İlk 3 teklif hazır + teklif hacmi ayda 4'ü geçti |

Bu ajanların klasörü ve prompt'u **şimdiden hazır**, ama `active: false`. Aktif
edilmemiş ajan görev kabul etmez, hafıza yazmaz.

### 4.3 Yapamayacağı şeyler (her ajan için)

| Ajan | **YAPAMAZ** |
|---|---|
| `karar-gunlugu` | Stratejiyi **belirleyemez**; sadece **kaydeder** ve **seçenek sunar**. |
| `isletge-kurulum-ajansi` | Ajanın **kendi yetkisini genişletemez**; müşteri verisini **dışarı çıkaramaz**. |
| `satis-ajansi` | **Fiyat söyleyemez**, **sözleşme imzalayamaz**, müşteriye **kendisi yazamaz**. |
| `pazarlama-ajansi` | **Para harcamayan reklam başlatamaz**, topluluğa **hesapla mesaj atamaz**, rakip adına konuşamaz. |
| `yazilim-muhendisi` | **Üretime deploy edemez**, **müşteri sunucusuna bağlanamaz**, testi olmayan kod teslim edemez. |
| `altyapi-ajansi` | **API anahtarını okuyup gösteremez**, **ücretli kaynak açamaz**, veri yedekleme/saklama kararı veremez. |
| `icerik-uretici` | **Yayına koyamaz**, yüz/ses üretemez, **uydurma veri veya istatistik kullanamaz**. |
| `sektor-ajansi` | **Mevzuat yorumu yapamaz**, hukuki/idari **garanti veremez**. |
| `finans-ajansi` | **Vergi beyanı yapamaz**, **ödeme tahsil edemez**, muhasebe kaydı **değiştiremez**. |
| **TÜM AJANLAR** | **Para harcayamaz**, **hesap açamaz/şifre giremez**, **müşteriyle doğrudan iletişemez**, **kendi iş birimini değiştiremez**, **kendi görevini iptal edemez**. |

---

## 5. KAZANÇ / KARŞILIK ANALİZİ

### 5.1 Ajan başına aktif iş yükü

| Ajan | Haftalık beklenen çalışma | Aktif iş var mı? | Karar |
|---|---|---|---|
| `karar-gunlugu` | 1–2 saat (board + kayıt) | **EVET** — her hafta | **KUR** |
| `satis-ajani` | 4–8 saat (teklif + takip) | **EVET** — gelir doğrudan buradan | **KUR** |
| `isletge-kurulum-ajansi` | 10–15 saat | **EVET** — ana gelir hizmeti | **KUR** |
| `yazilim-muhendisi` | 10–20 saat | **EVET** — proje döneminde yoğun | **KUR** |
| `altyapi-ajansi` | 4–8 saat | **EVET** — her kurulumda | **KUR** |
| `icerik-uretici` | 5–8 saat | **EVET** — A2/A3 ile ortak hat | **KUR** |
| `pazarlama-ajansi` | 4–6 saat | **EVET** — 3 kanal aktif | **KUR** |
| `finans-ajansi` | 1–2 saat | **KISMEN** — 0–3. ay teklif az | **ŞİMDİLİK KURMA** (3. ay) |
| `sektor-ajansi` | 0 saat | **HAYIR** — talep kanıtı yok | **KURMA** (6. ay) |

### 5.2 Kurulmayacak ajanlar (ve gerekçesi)

| Aday Ajan | Neden Kurulmaz |
|---|---|
| `muhasebe-ajani` | İş birimi 9 zaten `finans-ajansi` tarafından karşılanıyor; ikinci ajan **mükerrer otorite** yaratır. |
| `sosyal-medya-ajani` | `icerik-uretici` + `pazarlama-ajansi` **ayrı ayrı sosyal hesap yönetmez**; DM yanıtlama **insan işidir** (hesap/2FA). |
| `reklam-ajani` | Bütçe 0 → **paid kanal yok**. Yapacağı tek iş `pazarlama-ajansi`'nın altında. |
| `video-ceviri-ajani` | Render = FFmpeg + Hermes cron, **kişilik değil iş akışı**. |
| `hukuk-ajani` | 1.8'de sınır çizildi; mevzuat yorumu ajan değil **insan/avukat** işi. |
| `insan-kaynaklari-ajani` | İş birimi kataloğunda yok; ilk yıl gerekçesiz. |
| `proje-yoneticisi-ajani` | `karar-gunlugu` + `isletge-kurulum-ajansi` **ikisinin toplamı**; ayrı katman gereksiz. |
| `teknik-destek-ajani` | Sürekli Destek paketi **ilk yıl satılmayabilir**; talep kanıtı olmadan kurulmaz. |
### 5.3 Net sonuç

**Aktif kadro 7 ajan** (1–7); bekleyen 2 ajan (9 ve 8) pasif tutulur. Bir ajanın ilk 3 ayda
**haftada 2 saatten az** çalışması gerekirse kapatılır ve görevi komşusuna devredilir —
kapatma kararını `karar-gunlugu` önerir, **Özkan onaylar.** **Bütçe kuralı:** ajan maliyeti
(token) < o ajanın oluşturduğu teklif geliri ÷ 20; oran tutmazsa ajan çalıştırılmaz.

---

## 6. MARKA VE ÜRÜN VARLIKLARI

### 6.1 İlk 30 günde yapılacaklar (yapılmazsa satış olmaz)

| # | Varlık | Neden 30 günde | Sahip |
|---|---|---|---|
| 1 | **Tek sayfa teklif şablonu** (§1.1, §1.9) | Teklif gecikmesi = gelir kaybı | `satis-ajani` taslak, Özkan onay |
| 2 | **E-posta imzası + kalıp yanıtlar (5)** | Her ilk temas noktası | Özkan + `satis-ajani` |
| 3 | **Hizmet sayfaları (8)** | SEO'nun tek giriş noktası (A2 §4 kovaları) | `satis-ajani` metin → OpenCode derleme |
| 4 | **Tek renk + tipografi seti, favicon, basit logo** | Profesyonel algı; kod değil karar, AI ile üretilir | Özkan (tek seferlik) |
| 6 | **`Organization` JSON-LD + `llms.txt`** | AEO; kimlik doğrulama | `altyapi-ajansi` |
| 7 | **Hesap kayıtları (LinkedIn kişi+şirket, YouTube, GitHub)** | A3 kanal 1 ve 2'sinin ön koşulu | Özkan (kimlik/2FA) |
| 8 | **FAQ şablonu (10 soru)** | AEO cevap havuzu | `icerik-uretici` |
| 9 | **Fiyat/eskala tablosu (kendi kullanım)** | Marj takibi | `finans-ajansi` = **Özkan, manuel** |

### 6.2 Ertelenmeler

| Varlık | Erteleme gerekçesi | Ne zaman |
|---|---|---|
| Tam kapsamlı kurumsal kimlik kılavuzu | Tek müşteri kazanmadan kimlik harcar | İlk 3 müşteri sonrası |
| Broşür / katalog PDF | Dijital teklif yeterli | 6. ay |
| Kısa film / tanıtım videosu | YouTube içeriği zaten tanıtır | 9. ay |
| Sosyal "3. kanal" | İlk iki kanal kanıtlanmadan | 2 kanal doğrulandıktan sonra |
| Aylık bülten (newsletter) | Okur yokken bülten ölü | 500 abone sonrası |
| Reklam banner seti · basılı materyal · mobil uygulama | Bütçe 0 / hedef segment B2B ve dijital / sorun çözülmeden ürün yapma | **Hiç** (bütçe açılırsa yeniden değerlendirilir) |

### 6.3 Ton kuralı
**"Kısa, sayı veren, söz vermeyen."** Cevlemli iddia → ölçüme çevrilir
("Hızlandırırız" yerine "10 günde kurulur"). Üstünlük sıfatı yasak (lider, uzman,
yenilikçi). Her hizmet sayfasının ilk paragrafı tek cümlelik tanım (A2 §3.4).

---

## 7. 1. YIL BAŞARI ÖLÇÜTLERİ (5, ölçülebilir)

| # | Hedef | Ölçüm kaynağı | Hedef (1. yıl) | Zaman |
|---|---|---|---|---|
| 1 | **Katalog dışına çıkmama** | Katalog vs gerçek teklif kaydı | Sunulan tekliflerin **%100'ü** 8 hizmetten biri; "kapsam dışı" **0** | 30. günden itibaren |
| 2 | **Kapsam taşması = 0** | Teslim raporu vs teklif | Teslim edilen işin **%80'i ilk teklifte** yazılı | 6. ay kontrolü |
| 3 | **Paket dönüşüm oranı** | `satis-ajani` teklif kayıtları | **≥ 3 Kurumsal**, **≥ 2 Başlangıç** kazanımı; teklif→kabul **≥ %20** | 12. ay |
| 4 | **Referans üretimi** | Yayınlanan vaka/case | **≥ 3 yazılı izinli, ölçülebilir sonuçlu referans** | İlk referans 6. ay |
| 5 | **Sürekli Destek tekrar geliri** | Faturalanan aylık | Tekrarlayan gelir / toplam gelir **≥ %15**; 6+ ay kalan müşteri **≥ 1** | 12. ay |

**Ölçüm düzeni:** 1–5 tek dosyada (`urun/aylik/YYYY-AA.md`); Hermes cron toplar,
`karar-gunlugu` haftalık board'a koyar, **Özkan onaylar ve not eder.** Metrik yoksa hedef yoktur.

---

## 8. AÇIK KONULAR (insanın kararı)

1. **`GÜN_BİRİMİ` (§1.9) sayısı belirlenmedi.** 1. yıl hedef brüt geliri kararlaştırılmadan
   teklif üretilemez. → **Özkan, 7. gün.**
2. **Kurumsal Paket'teki "müşteri içi yönetici"** kim? Yoksa paket tek kişiye bağlı olur, satılamaz.
3. **Başlangıç Paketi'nde 1.1 / 1.3 seçim kuralı** ilk 2 tekliften sonra kararlaştırılır.
4. **Sürekli Destek** ilk yıl satılmayabilir; 6. ayda 0 müşteri ise katalogdan çıkarılır.
5. **Segment dışı talepler** (kurumsal/kamu) için hazır "kapsam dışı" yanıt metni yok.