# A3 — PERFORMANS REKLAMCILIĞI UZMANI ÇIKTISI (TOZ AI GROUP)

Kapsam: sıfır bütçeli büyüme kanalları, tek sahip ataması, dönüşüm altyapısı,
ilk 1 TL protokolü, KVKK/TİY uyumu, satış füneli, 10 kriter tablosu.

Doğrulama notu: `D:\AI\TozSolutions_Ai_Office\src\site\{routes,meta,content}.ts` okundu.
Kanal tutarları, CPC/CPM, dönüşüm oranları **hiçbir yerde doğrulanabilir kaynaktan
alınamadı** → `[DOĞRULANMADI]`. Uydurma rakam yazılmadı; ölçüm planı bu yüzden
"tahmini CPM" değil "kendi ölçtüğüm maliyet" mantığıyla kuruldu.

---

## 1. BÜTÇE = 0 TL İKEN HANGİ KANAL MÜMKÜN

Reklam (paid) ile kanalları ayırmadan önce net tanım:

- **Paid = para vererek第三方 trafik almak.** Bütçe 0 iken imkânsız.
  (Google Ads kredi kartı, Meta Ads kredi/onay; ikisi de eşik altında retdedilir `[DOĞRULANMADI — ret nedeni ve eşik değeri sağlayıcıya bağlı]`)
- **Owned/Earned = para vermeden trafik almak.** İlk yıl burada çalışılır.

| Kanal | Ücretsiz mi | Kim hedefler | Gerçekçi beklenti (90 gün) | 90 gün hedefi (sayısal) |
|---|---|---|---|---|
| LinkedIn organic (kişi + şirket sayfası) | ✅ | CFO, CTO, startup kurucusu | Doğrudan talep değil, **görünürlük + doğrudan mesaj**. Yabancı ısınması | 12 hafta, haftada 3 post; 30+ post; 200+ takipçi; **10 gerçek DM gelen**, 3 toplantı |
| YouTube (video + Shorts) | ✅ | Teknik karar verici | Yavaş; 90 günde kanal kurulumu, 6-12 uzun video, 20-40 Shorts | 3 video/ay; **≥300 saat izlenme toplam** `[DOĞRULANMADI — kanal bazlı]`, 25 abone |
| Reddit (r/turkey, r/webdev, r/SaaS, r/entrepreneur) | ✅ | Geliştirici + girişimci | Yüksek kalite, **düşük hacim**. Ban riski gerçek | 90 günde 25 yorum/answer, 3-5 viral değil **ama sürekli görünür**; 2 DM; 0 ban |
| Hacker News (Show HN) | ✅ | Teknik okur, global | Türkiye pazarı için **düşük uyum**; kredibilite için | 1 Show HN; 100+ puan `[DOĞRULANMADI]`; site trafiği ölçülür, hedef: 500 oturum |
| Teknik topluluklar (Discord, Slack, forum) | ✅ | Niş | Katılım önce, satış sonra. **Spam yasak** | 5 topluluğa giriş; 60 gün boyunca 25 cevap; 1 ortak proje/etkinlik |
| Nihai forumlar (Webmaster, ShiftDesigner, Bilişim Muhendisleri, TOBB üyesi ağları) | ✅ | Karar vericiye yakın | Yüksek niyet, düşük hacim | 3 forumda uzun üyelik; 5 ciddi cevap; **2 nitelikli talep** |
| Classifieds (letgo/sahibinden B2B) | ✅ (ilan ücretsiz) | Küçük işletme | Kurumsal imaj riski: B2B yazılım için yanlış kanal | 1 deneme ayı, 3 ilan; **ölçülen 10+ nitelikli sorgu**; 1 hafta sonra kapatılabilir |
| Sektör bültenleri (dergi/dernek ücretli) | ❌ tam ücretsiz değil `[DOĞRULANMADI]` | Teklif kararı | Şecretsiz yayın → okunmaz | Bütçe 0'da **yalnızca ücretsiz bültenlere katıl**; 2 hedef bülten |
| İş ortaklığı (agency, danışman, ekip) | ✅ | Kanal başkasının listesi | En yüksek "ilk müşteri başına maliyet = 0" | 5 ajans/bağımsız danışmanla konuşma; **2 yönlendirme anlaşması** |
| İçerik → YouTube → Site zinciri | ✅ | tümü | A2 ile ortak motor | A2'deki içerik takvimine bağlanır, ayrı iş yükü yok |

**0 TL kanal listesine girmeyenler:** Google Ads, Meta Ads, LinkedIn Ads, TikTok Ads,
X Ads, Reddit Ads, arama/sosyal boost, sponsorluk, ücretli bülten, dijital reklam
ağı (DV360/Trade Desk) — hepsi para ister veya önce veri ister. İlk yıl **hiçbiri yok.**

### Öncelik (kısıtlı insan gücü = Özkan)
Tek insan + AI kadrosu varsayımıyla **en fazla 3 kanal eşzamanlı**:

1. **LinkedIn organic** (en yüksek niyet, en düşük süre maliyeti, günlük <20 dk)
2. **Reddit + 1 teknik topluluk** (uzmanlık görünürlüğü, haftada 45 dk)
3. **İş ortaklığı (5 ajans/danışman görüşmesi)** (kapıyı açan, içerik üretmez)

YouTube **A2 ile ortak üretim hattına** bağlanır; tek başına 4. kanal değil.
Classifieds 7 günlük deneme, sonra karar.

---

## 2. HANGİ SİSTEM HANGİ İŞİ YAPAR (TEK SAHİP)

| İş | Sahip | Neden | Sıklık |
|---|---|---|---|
| Kanal içerik metni (LinkedIn, Reddit, bülten) | **OpenCode** (`Agency Agents` ajanı, tek ajan = tek kanal) | Kod/topluluk formatı kuralları metinde | haftada 1 çalıştırma |
| Video senaryosu + kapak/klip metni | **OpenCode** | senaryo = metin üretimi | haftada 1 |
| Görsel/video **render** (ffmpeg, kurgu, seslendirme) | **Hermes** (cron + delegasyon) | FFmpeg/zamanlanmış iş | haftada 2 |
| Rakip/mention/toplu mention takibi (ücretsiz katman) | **Hermes** web tarama | tarama = Hermes işi | günlük cron |
| Analiz (UTM bazlı oturum, kanal karşılaştırma) | **OpenCode** veri analizi | CSV/JSON okuma | haftada 1 |
| Rapor (haftalık tablo + "ne durdu/ne başladı") | **Hermes cron** üretir → **Özkan onaylar** | raporlama zamanlanmış iş | haftada 1 |
| Sosyal hesap açma, 2FA, DM yanıtlama, teklif imzası | **Özkan** | hesap/insan içidir | sürekli |
| Bütçe harcama kararı | **Özkan** | para = insan onayı | ayda 1 |
| Landing page kodu | **OpenCode** (`src/site`) | statik site kodu | talep üzerine |
| KVKK metin onayı, izin listesi yönetimi | **Özkan** | hukuki sorumluluk | sürekli |

**Çakışma kuralı:** içerik ajanı **hesaba girmez**, paylaşmaz, DM atmaz.
Paylaşım/dm = Özkan. Bu, "ajanlar hesap açmaz" kuralıyla da uyumlu.

---

## 3. DÖNÜŞÜM (CONVERSION) ALTYAPISI

Sıfır bütçede dönüşüm ikiye ayrılır: **tıklanabilir olay** (kendi ölçtüğümüz) ve
**çevrimdışı olay** (insan kaydı — otomatik ölçülemez, disipline edilir).

### 3.1 Siteye yapılacak revizyonlar (`D:\AI\TozSolutions_Ai_Office`)
Kanıtlanmış mevcut durum: sıfır JS statik üretim (`scripts/build-site.mjs`),
sadece `Home/About/Capabilities/Contact/Projects(noIndex)/Blog(noIndex)/404` rotaları.

| # | Değişiklik | Nerede | Neden |
|---|---|---|---|
| C1 | `/blog` ve `/projects` `noIndex:true` → indekslenir | `meta.ts` (E5, A2'de raporlandı) | Organik + AI kaynak trafik **tek** giriş noktası; şu an kapalı |
| C2 | Ölçüm script'i: yalnızca `privacy.txt`/cookie metni + **sayfa görüntüleme olayı** | `renderRoute` / `shell.ts` | Analytics JS = kişisel veri riski; 3. parti script yerine **kendi ilk-parti endpoint'i** (`/collect`), cookie'siz, IP saklamayan |
| C3 | `/teklif-al` (veya `/iletisim/teklif`) yeni rota | `routes.ts` | Lead formu = ana dönüşüm hedefi; her kanal buraya bağlanır |
| C4 | Lead formu alanları: ad, kurum, e-posta, telefon (opsiyonel), bütçe aralığı, ihtiyaç cümlesi, KVKK aydınlatma onayı + tarih | yeni `pages/teklif.ts` | Form = dönüşüm altyapısının kendisi |
| C5 | UTM parametreleri **form gönderimine taşınır** | form handler / yeni `collect` payload | Kaynak kaybı olmaz; CRM/tablo bağlanabilir |
| C6 | `POST /collect` → `docs/` altına günlük JSONL append (statik host'ta POST yoksa alternatif: form `mailto`/Formspree benzeri kendi endpoint'i `[DOĞRULANMADI — hosting yeteneği]`) | `scripts/` | Dönüşüm verisi disipline edilir, analiz OpenCode'da yapılır |
| C7 | `ThankYou` sayfası + `og:image` + `Organization`/`sameAs` | `meta.ts` (E3/E4, A2) | Paylaşım kartı + AI kimlik doğrulaması |
| C8 | `robots.txt` + `sitemap.xml` içinde `/teklif-al` | `sitemap.ts` | Dönüşüm sayfasının keşfi |
| C9 | **Do-not-track banner** + geri çekme sayfası | yeni route | KVKK/erişilebilirlik |
| C10 | `npm run validate` + `npm run site:build` sonrası test: form 200 dönüyor, sitemap güncel, tek `<h1>` | `tests/` | Doğrulama disiplini |

### 3.2 UTM konvansiyonu (sabit, tek kaynak)
`src/site` içinde tek bir `utm.ts` (veya `content.ts` içinde tek sabit) olmalı — iki
yere yazılırsa ayrışır.

```
utm_source   : linkedin | reddit | youtube | hn | forum | classifieds | partner | newsletter
utm_medium   : organic_social | organic_video | community | referral | email
utm_campaign : 2026q3_hizmet-{kisa-kod}
utm_content  : {post-tipi}-{serial}     ör. linkedin-carouseli-014
utm_term     : yalnız paid için (şimdilik boş)
```

Kural: **her** dış bağlantıda `utm_source` + `utm_campaign` zorunlu.
`[DOĞRULANMADI]` — ilk 90 gün sonunda gerçek trafik dağılımı ölçülene kadar
hangi `utm_medium`'un işe yaradığı bilinmiyor; 90 gün sonra kısılacak.

### 3.3 Olay takibi (ölçülebilir olay listesi)
Sunucu-suz statik sitede **etiket/piksel tabanlı piksel yerine** şu yapı kurulur:

| Olay | Nasıl ölçülür | Hedef |
|---|---|---|
| Landing ziyareti | `/collect` sayfa görüntüleme (UTM ile) | kanal bazlı oturum |
| Teklif formu gönderimi | POST kaydı | **birincil KPI** |
| Telefon/WhatsApp tıklaması | `/collect` click olayı (2. KPI) | yanlışlıkla WhatsApp ölçümü |
| Dosya indirme (varsa) | `/collect` | teklif kalitesi |
| 30+ saniye oturum | `/collect` dwell | ilgi derinliği |

Analiz sahibi: **OpenCode** (JSONL → özet tablo). Yayın sahibi: Hermes cron
haftalık raporu. Karar sahibi: **Özkan**.

---

## 4. GELİR BAŞLADIĞINDA İLK 1 TL NEREYE?

### 4.1 Ön koşul (sert kapı)
Para harcanmadan önce **3 şartın tamamı** sağlanmalı:
1. Organik kanallardan **en az 1 ücretli teklif → kazanılmış gelir** oluştu.
2. `/collect` **en az 30 gün** veri topladı (hangi kanal işe yaradı belli).
3. `teklif-al` formu **en az 10 başarılı gönderim** üretti.

Bu üçü tutmadan Google Ads açmak = ölçülemez para. Kurallar gereği **ayrılmaz**.

### 4.2 Test protokolü (ölçüm disiplini)
| Parametre | Kural |
|---|---|
| Platform seçimi | Google Search (niyet bazlı B2B). Meta/TikTok **kapalı** — 0 TL'de veri tabanı yok, test edilebilir değil |
| Kampanya tipi | Yalnız **Arama ağı** + **Maks. Otomatik Fiyatlandırmalı Arama**. Görünürlüğün genişletilmesi/PMax ilk yıl **açılmaz** (kontrol yok) |
| Bütçe dağılımı | Günlük eşit bölünmüş **2 kampanya**: `YANITLI/niyetli` vs `DAHA GENİŞ/öğrenen`. Toplam sabit tut, kanal bazlı dağıtım |
| Kontrol grubu | **Kontrol = harcanmayan organik LinkedIn/Reddit**. Aynı dönem, aynı içerik teması. Kaldırma yok, ayrım raporda |
| Eşleme | UZM/anahtar kelime eşleme (`exact` önce), negatif kelime listesi ilk gün yazılı |
| Minimum örneklem | Kampanya başına **tıklama ≥ 100** ve **dönüşüm (teklif) ≥ 5** olmadan karar **yok**. Bu eşikler **iş kuralı**, platform eşiği değil `[DOĞRULANMADI]` |
| Süre | Test başlangıcından **en az 6 hafta tam hafta**, sonra değerlendirme. 2 haftada karar = gürültü |
| Bütçe tavanı | Aylık harcama, o ay tahmini brüt kârın **%10'unu** geçemez. Tavanı aşarsa kampanya durur |
| Geçiş kuralı | 6 hafta sonunda CPA **hedefin üstündeyse** → önce teklif/landing revize, sonra bütçe; para artırılmaz |

### 4.3 Sıralama (parayla alınacak ilk işler)
1. Alan adı + **ücretsiz** Google Search Console/Bing/Analytics (para değil, önce bu).
2. Hosting/CDN (site zaten statik; ölçüm endpoint'i barındırma).
3. Google Ads arama testi (4.2 protokolü ile).
4. Retargeting **şimdilik yok** — 1 aylık etkileşim havuzu oluşmadan anlamsız.
5. Video/sponsorluk — en son, kanıt geldikten sonra.

**Ölçülmüş her şey CPM/CPC değil kendi CPA'mızdır.** Platform eşikleri ve
TR'deki sektör CPC aralıkları `[DOĞRULANMADI]`; ilk test bunları **bize** öğretir.

---

## 5. ETİK / MEVZUAT (zorunlu uyum maddeleri)

> Aşağıdaki maddeler **kontrol listesidir, hukuki görüş değildir**. Ticari ileti
> kuralları için Bakanlık tebliğleri güncel şekilde doğrulanmalıdır
> `[DOĞRULANMADI — güncel mevzuat metni]`.

### 5.1 KVKK
| # | Kural | Site/marketplace yansıması |
|---|---|---|
| KV1 | Form = kişisel veri toplama. **Aydınlatma metni** zorunlu, ne toplandığı/yasal sebep saklama süresi/aktarım açık yazılır | `pages/teklif.ts` altında metin, onay kutusu + **onay tarihi** |
| KV2 | **Açık rıza**: önceden işaretlenmiş kutucuk (`pre-ticked` yasak). Zorunlu alan olarak da kabul edilmez — ayrı onay kutusu | `input[type=checkbox] defaultChecked` yok |
| KV3 | Toplanan veri **yalnız teklif değerlendirme** amacıyla; **izinli ticari ileti listesi** ayrı ve ispatlanabilir olmalı | Marketing izni formda **ayrı alan**, tarih damgalı, "listeye eklenmek istiyorum" |
| KV4 | İzin listesi = sadece **açık rıza** verenler. B2B unvanı/telefonu **veri tabanından otomatik** alınamaz | `docs/` altında izin listesi JSONL, kim ne zaman izin verdi |
| KV5 | Her mesajda **abonelikten çıkma yolu** + güncel izin listesi. Ret kaydı kalıcı | Ret listesi de tutulur; 2. kez izin istenmez |
| KV6 | **Veri sorumluları sicili** (VERBİS) bildirimi; politika metni `/gizlilik` sayfasında, footer'dan erişilebilir | `routes.ts` + `footer.ts` |
| KV7 | 3. taraf analitik/piksel = **veri aktarımı** → KVKK m.5 kapsamı. Bu yüzden 3. parti piksel yerine kendi toplama endpoint'i (C2) | `collect` endpoint'i kişiselleştirme yapmaz |
| KV8 | Saklama süresi: teklif süreci kapanana + yasal zamanaşımı. **Otomatik silme** kuralı yazılı | `scripts/` içinde temizlik görevi |
| KV9 | Kişisel veri içeren WhatsApp/e-posta **konuşma arşivi** de veri; saklama disiplini aynı | Hermes rapor arşivi ayrı klasör |
| KV10 | Yurt dışı (LinkedIn, Google, Reddit) aktarımı; açık rıza kapsamı genişletilmeli | formda sınır bilgisi |

### 5.2 Ticari İleti Yönetmeliği (TİY)
- Önceden **izin** alınmış kişilere (İYS listesi mantığı) ileti; **reddedene tekrar yok**.
- Reddedenin **kendi** verisi barındırma yükümlülüğü vardır.
- İletide **ret/durma yolu** açık; kanallar arası (e-posta → WhatsApp) ret **taşınır**.
- Yalnız **iş etiğine uygun, gerçek**, ölçülebilir vaat. Sahte "indirim/sınırlı süre"
  dolandırıcılık sınırına girer → **birliktelik ağında reklam yazısı yasak.**
- **B2B dahi** kapsamdadır (tüketici ayrımı eski anlayış; "B2B istisna" yoktur
  `[DOĞRULANMADI — nihai hukuki yorum]`). **Güvenli taraf:** her temas izine dayanır.

### 5.3 Topluluk kuralları (para değil ama ceza riski)
- Reddit/Discord/forum: **kurallar önce okunur**, kendi tanıtımını özel mesajla atma.
- Bağlantı: **gerektiğinde**, açıkça kaynak/ilan olarak.
- HN Show HN: tek gönderi, gerçek ürün, alakasız pazarlama = silinme.
- Kaldırma protokolü: kural ihlali 1 kez → dur, insan incelemesi.

### 5.4 Siteye eklenecek zorunlu sayfalar/route'lar
`/gizlilik-politikasi` (KVKK + aydınlatma), `/cerez-politikasi`,
`/izinler` (izinli ticari ileti listesi yönetimi, tercih değiştirme),
`/kvkk-iletisim` (veri sorumlusu), `/etik` (reklam etiketi politikası).

---

## 6. SATIŞ FÜNELİ (ilk 90 gün)

### 6.1 Fünel
```
İçerik/kanal → Landing (/teklif-al) → Teklif formu (bırakma adımı)
  → Ön görüşme (30 dk, keşif) → Teklif dokümanı → Kazanma/Reddetme gerekçesi
```
Anahtar: **iki adımlı form** (ad/e-posta/kurum → ihtiyaç + bütçe aralığı).
Adım 1 sonrası teşekkür/önizleme sayfası = ölçülebilir ilk adım.

### 6.2 Lead magnet (tek araç)
**Seçenek:** "AI Dönüşüm Denetimi — 15 soruluk hazır form, 2-3 sayfa rapor".
Neden B2B yazılım/AI danışmanlığı satar: **teslim edilebilir çıktı üretir**, ücretsiz
ama çalışma ister, "ücretsiz danışmanlık" değildir → etik sorun yok.
Biçim: PDF değil → **HTML/Google Doc + site üzerinde bir sayfa** (SEO/AEO faydası da var).

### 6.3 İlk 90 gün teklif akışı (takvim)
| Gün | Aksiyon | Sahip | Başarı ölçütü |
|---|---|---|---|
| 1-14 | `/teklif-al` + `/gizlilik` + `/kvkk-iletisim` + UTM düzeni canlı | OpenCode + Özkan | `site:build` temiz, form 200 dönüyor |
| 15-30 | Lead magnet v1 yayınlandı (3 kanalda dağıtım) | OpenCode | 3 dağıtım |
| 31-45 | İlk 5 LinkedIn DM + 3 iş ortaklığı görüşmesi | Özkan | 5 görüşme kaydı |
| 46-60 | İlk teklif dokümanı (şablon) hazır | Özkan | 1 şablon |
| 61-75 | Ufuk avı yorumları (Reddit/forum/Discord) | Hermes üretir, Özkan atar | 25 cevap |
| 76-90 | Haftalık rapor serisi; hangi kanal gerçek iş getirdi | Hermes cron | **≥1 nitelikli teklif talebi** |

90 gün başarısı = **para değil, kanıt**: hangi kanalın nitelikli talep ürettiği.

### 6.4 Teklif şablonu için gereken içerik üretim girdileri
| Bölüm | Nereden gelir | Sahip |
|---|---|---|
| Problem tanımı (amaç, kapsam, kısıtlar) | Görüşme notu | Özkan |
| Mevcut durum + darboğaz listesi | Lead magnet formu sonucu | OpenCode |
| Önerilen kapsam (3 alternatif senaryo) | A1 + A2 + deneyim | Özkan |
| Teslim/takvim (hafta bazında) | A1 mimari | OpenCode |
| Fiyat (bütçe bandı, değil tek rakam) | Özkan | Özkan |
| Risk/garanti + kapsam dışı listesi | Şablon | Özkan |
| KVKK/teklif gizlilik notu | Şablon | Özkan |
| Ölçüm planı (hangi KPI, hangi araç) | A3 §3 | OpenCode |

**Teklif şablonu ajan yazmaz.** Ajan taslak üretir, Özkan imzalar.

---

## 7. 10 KRİTER TABLOSU

Skor: `✅` var / `🟡` koşullu / `❌` yok · sıra: güçlü → zayıf

| # | Aday | 1 gerçek iş | 2 tekrar | 3 çakışma | 4 router/memory/MCP | 5 Windows güvenilir | 6 ücretsiz katman | 7 sürdürülebilir | 8 kaldırılabilir | 10 ticari katkı | Sonuç |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **LinkedIn organic** | ✅ talep üretir | ✅ yok | ✅ yok | ✅ yok | ✅ tarayıcı/manuel | ✅ | 🟡 insan saatine bağlı | ✅ tek tık | ✅ **yüksek** | **AL (1. sıra)** |
| 2 | **Reddit / topluluklar** | ✅ uzmanlık + DM | ✅ yok | ✅ yok | ✅ yok | ✅ düz metin | ✅ | 🟡 ban riski | ✅ | ✅ yüksek | **AL (2. sıra)** |
| 3 | **İş ortaklığı / ajans yönlendirme** | ✅ ilk müşteri | ✅ yok | ✅ A1 ile uyum | ✅ yok | ✅ toplantı+mail | ✅ | ✅ ortaklık kalıcı | ✅ | ✅ **en yüksek** | **AL (3. sıra)** |
| 4 | **YouTube** | 🟡 uzun vade | 🟡 A2 içerik motoru | 🟡 A2 ile ortak takvim | 🟡 paylaşım/dm sahipliği ayrı | 🟡 ffmpeg var, test edilmeli | ✅ | ❌ insan + render | ✅ | 🟡 90 günde dolaylı | **AL ama A2'ye bağlı** |
| 5 | **Hacker News Show** | 🟡 kredibilite | ✅ yok | ✅ yok | ✅ yok | ✅ metin | ✅ | 🟡 tek seferlik | ✅ | 🟡 TR pazarına dolaylı | **AL, 1 kez** |
| 6 | **Nihai / sektör forumları** | ✅ niyet yüksek | ✅ yok | ✅ yok | ✅ yok | ✅ | ✅ | 🟡 moderasyon | ✅ | ✅ yüksek niyet | **AL** |
| 7 | **Classifieds (letgo/sahibinden)** | 🟡 kurumsal imaj riski | ✅ yok | ✅ yok | ✅ | ✅ | ✅ | ❌ düşük kalite | ✅ | 🟡 olumsuz olabilir | **7 gün deneme, sonra kapat** |
| 8 | **Ücretli sektör bültenleri** | ✅ hedefli | ✅ yok | ✅ | ✅ | ✅ | ❌ ücretli | ✅ | ✅ | ✅ | **0 TL'da yok** |
| 9 | **Google Ads** | ✅ | ✅ yok | ✅ | ✅ | ✅ | ❌ kredi yok | ✅ ölçülebilir | ✅ | ✅ | **ERTELENDİ — §4 kapısı** |
| 10 | **Meta Ads** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟡 piksel KVKK riski | ✅ | 🟡 B2B'te zayıf | **KAPALI** |
| 11 | **LinkedIn Ads** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ min bütçe `[DOĞRULANMADI]` | ✅ | ✅ | 🟡 | **KAPALI (min bütçe yüksek)** |
| 12 | **TikTok Ads** | 🟡 B2B uyumsuz | ✅ | ✅ | ✅ | ✅ | ❌ | 🟡 | ✅ | ❌ | **KAPALI** |
| 13 | **Hermes içi reklam ajanı** | ❌ rakam/performans verisi yok | 🟡 ajan var mı belirsiz | 🟡 OpenCode ajanlarıyla | ❌ **karmaşa yaratır** (kriter 4) | 🟡 cron+browser | 🟡 kod yazımı bedava | ❌ sahiplik belirsiz | 🟡 | ❌ ölçülemez veri | **KURMA** |
| 14 | **OpenCode içi reklam ajanı** | ❌ karar veremez (hesap/kredi) | ❌ A2 içerik ajanıyla örtüşür | ❌ **çakışma** | ❌ **karmaşa** | ✅ | 🟡 | ❌ sahiplik | ✅ | ❌ | **KURMA** |
| 15 | **Ajans 3B sanal ofis (`D:\AI\Dashboard`)** | ❌ trafik getirmez; **vitrin** | ❌ site içeriğinin 3B kopyası | ❌ A2 ile aynı mesaj | ❌ ayrı bakım/derleme zinciri | 🟡 Vite+three build | 🟡 | ❌ zaman yiyici | ✅ | ❌ doğrudan yok | **KURMA (yol haritası dışı)** |

**Kriter 10 notu (ticari faaliyet katkısı):** 15 adayın yalnızca 8'i doğrudan
ticari kanal; 2'si kurumsal kimlik/showcase (#13-15) **gelir üretmez**, trafik
getirmez ve geri kazanımı düşüktür. **Öneri: A3 kapsamı 8 kanalla sınırlı kalsın.**

### 7.1 Kurulum sırası (tek cümle, 0 TL)
`LinkedIn → Reddit/topluluk → iş ortaklığı → forum/bülten → (90 gün veri) → HN 1 kez →
Classifieds 7 gün → gelir varsa Google Ads testi`

---

## 8. DOĞRULANMADI / DOĞRULANMASI GEREKEN LİSTE

1. Google Ads kredi eşiği ve ret koşulu (TL bazında).
2. LinkedIn Ads minimum bütçe eşiği.
3. TR'de yazılım/AI danışmanlığı sektörü arama CPC aralığı.
4. Reddit/HN topluluk kurallarının güncel metni (teknik danışmanlık ve AI ürünleri).
5. Ücretsiz bültenlerin gerçekten erişilebilir listede olduğu.
6. Statik barındırmanın POST endpoint'i karşılama yeteneği.
7. Ticari İleti Yönetmeliği'nin güncel tebliğ metni (B2B dahil miyeti doğrulanmalı).
8. `D:\AI\Dashboard` derleme süresi/kaynak tüketimi — karar için ölçülmeli.
9. "Ajans 3B ofis"in hangi kanalı besleyeceği — tanım gerekiyor.
10. Agency Agents içinde mevcut reklam/pazarlama ajanı var mı — envanter yapılmadı.

**Doğrulama komutları:** `npm run validate` ve `npm run site:build`
(`D:\AI\TozSolutions_Ai_Office`). Form/UTM/olay davranışı `tests/` altında yazılacak.