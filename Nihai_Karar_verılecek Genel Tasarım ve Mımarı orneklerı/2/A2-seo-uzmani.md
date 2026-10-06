# A2 — SEO / AEO Uzmanı Çıktısı (TOZ AI GROUP)

Kapsam: teknik + içerik SEO, AEO/GEO, ölçüm, 90 günlük plan.
Doğrulama: `D:\AI\TozSolutions_Ai_Office` kaynak kodu okundu. Doğrulanamayan her şey `[DOĞRULANMADI]`.

## 0. Tespit edilen engeller (kod kanıtı, varsayım değil)

| # | Tespit | Kanıt | Etki |
|---|---|---|---|
| E1 | Site İngilizce: `lang="en"`, `DEFAULT_LOCALE="en"` | `src/design-system/theme/theme.ts:33`, `src/site/content.ts` | TR pazarı için yanlış |
| E2 | `CANONICAL_ORIGIN="https://example.invalid"` | `src/site/content.ts` | Tüm canonical/sitemap geçersiz |
| E3 | `og:image` bilinçli üretilmiyor | `src/site/meta.ts` (`og:image` yorumu) | AI Overviews/sosyal kart yok |
| E4 | `hreflang`, `og:locale` yok | `src/site/meta.ts` `headFor` | AEO/çok dilli sinyal eksik |
| E5 | `/blog`, `/projects` `noIndex:true`, içerik yok | `meta.ts:112-128` | İçerik motoru çalışmıyor |
| E6 | `llms.txt` / RSS / news sitemap yok | `scripts/build-site.mjs` (sadece sitemap+robots) | AI beslemesi yok |
| E7 | Site sıfır JS statik üretiliyor | `scripts/build-site.mjs` | CWV/AEO doğal avantaj |

`npm run validate` + `npm run site:build` doğrulama komutlarıdır.

## 1. Hangi yetenek hangi sistemde (tek sahip)

| Yetenek | Sahip |
|---|---|
| Sayfa/head/sitemap/schema üretimi ve değişimi | **OpenCode** (`src/site`) — kod gerekiyor |
| SERP/rakip/keyword araştırması, canlı sayfa denetimi | **Hermes** (firecrawl/web) |
| Alan adı, DNS, GSC/Bing doğrulama, hosting | **Özkan** (hesap + 2FA) |
| Haftalık rapor, AI bot log takibi | **Hermes cron** |
| Yayın onayı, gerçek vaka bilgisi | **Özkan** |

Ajanlar hesap açmaz, DNS değiştirmez, `content.ts` içerik bütünlüğü yasaklarına aykırı metin yazmaz.

## 2. Teknik SEO kontrol listesi

### Otomatik (`src/site` içinde, `npm run validate` ile)

| Kontrol | Yer | Durum |
|---|---|---|
| Her route sitemap'te | `sitemap.ts:45` | ✅ |
| Sitemap sayfası `noindex` değil (tek kural) | `sitemap.ts` | ✅ |
| `/404` sitemap'te değil | `noIndex:true` | ✅ |
| robots.txt sitemap'e işaret ediyor | `renderRobots` | ✅ |
| Schema geçerli JSON, `</script` kaçışlı | `structuredData.ts` | ✅ |
| Canonical self-referencing | `meta.ts:161` | ✅ |
| `og:url` = canonical | `meta.ts:170` | ✅ |
| `og:image` mutlak URL her sayfada | `meta.ts` | ❌ E3 |
| `hreflang` + `og:locale` | — | ❌ E4 |
| `/llms.txt` | `build-site.mjs` | ❌ E6 |
| Tek `<h1>`, atlanmayan heading seviyesi | yeni test | ❌ yazılacak |
| Title ≤60, description 120–160, benzersiz | yeni test | ❌ yazılacak |
| Statik çıktıda `<script src>` yok | yeni test | ❌ yazılacak |
| Kırık iç link (anchor + path) | mevcut link kontrolü | ✅ |

### Elle (otomatik test edilemez)

- TTFB/LCP alan ölçümü — PageSpeed/CrUX, koddan görünmez. **Özkan + Hermes.**
- Görsel alt metni, içerik doğruluğu (insan anlamı). **Özkan.**
- GSC URL Inspection "Google'ın seçtiği canonical" onayı. **Özkan.**
- E-E-A-T: gerçek vaka/referans/deneyim. `content.ts` yasağı gereği ajan üretemez — **insan sağlamak zorunda.** YouTube kanal ↔ site bağlama. **Özkan.**

Kurulmayacaklar: SPA, client-side render, framework sitemap paketi. Mevcut statik üretim zaten doğru cevap.

## 3. AEO / GEO

### Teknik gereksinimler

1. **Sunucudan gelen HTML.** Botlar JS çalıştırmaz veya geç çalıştırır. Statik
   HTML bunu zaten karşılıyor — TOZ'un en büyük AEO varlığı bu.
2. **`Organization` + `Person` JSON-LD.** Kodda `WebSite`/`Service`/`FAQPage`
   var; `Organization` (logo, `sameAs`, `foundingDate`, `address`) **eksik**.
3. **`sameAs` zinciri.** Gerçek profiller (LinkedIn, YouTube, GitHub, şirket
   sicili) bağlanmalı; AI kaynakları kimliği buradan doğrular.
4. **Cevap gövdenin ilk paragrafında.** AI alıntısı genelde ilk 1–2 paragraftan
   gelir. Her hizmet sayfasının ilk paragrafı tek cümlelik tanım olmalı.
5. **`FAQPage` gerçek sorularla.** `faqPageNode` şu an statik; içerikten beslenmeli.
6. **`llms.txt`.** Şirket özeti, hizmet listesi, önemli URL'ler — `build-site.mjs`
   içinden rota tablosundan üretilmeli, elle yazılmamalı.
7. **`datePublished`/`dateModified`.** Güncellik sinyali.
8. **AI botları açık kalmalı.** `User-agent: *` / `Allow: /` doğru. `GPTBot`,
   `ClaudeBot`, `PerplexityBot` engellenirse AI görünürlüğü kapanır. Telif riski
   için `robots.txt` değil `noindex` tercih edilir.
9. **Tablo/liste yapısı.** Fiyat, kapsam, karşılaştırma içerikleri AI tarafından
   yeniden üretilebilir blok olarak alınır.

### Ücretsiz AEO ölçümü

- 15 sabit soru (`"Türkiye'de AI danışmanlığı veren firma"` gibi) → ChatGPT,
  Perplexity, Gemini'de ayda bir elle sorulur; TOZ adının geçip geçmediği
  kaydedilir. Maliyet 0. **Sahip: Özkan, ayda 1 saat.** Ölçüm değeri yüksek,
  otomasyonu zor — bilinçli olarak elle bırakılıyor.
- Sunucu logunda `GPTBot`/`ClaudeBot`/`PerplexityBot` sayfalanır, hangi
  sayfalara geldikleri görülür. **Sahip: Hermes cron, haftalık.**
- Semrush/Ahrefs ücretsiz katman ilk 90 gün kullanılmaz; ölçüm GSC ile yapılır.

## 4. Anahtar kelime ve içerik mimarisi

Kova = bir `CAPABILITIES` kaydı = otomatik sayfa (`routes.ts:175`). **Elle HTML
yazılmaz.**

| İş birimi | Kova slug | Destek içerik |
|---|---|---|
| Yönetim | `yonetim-mcp` | "MCP nedir", "şirket içi ajan güvenliği" |
| AI İşletme | `ai-isletme-ajansi` | "tek kişilik ekip AI ile" |
| Satış | `satis-mcp` | "satış otomasyonu maliyet" |
| Pazarlama | `pazarlama-seo-agents` | "AI Overviews nedir" |
| Yazılım | `ozel-yazilim-gelistirme` | "yazılım şirketi seçerken" |
| AI Altyapı | `ai-mcp-altyapi` | "OpenAI vs Anthropik maliyet" |
| YouTube | `youtube-kanal-otomasyonu` | "YouTube SEO kontrol listesi" |
| Sektörel | `sektorel-ai-cozumleri` | sektör başına 1 içerik |
| Finans | `finans-mcp` | "e-fatura otomasyonu AI ile" |

Kurallar: slug ASCII ve kısa; kelime tekrarı sayfa başına bir kez
(`meta.ts` `description` üzerinden beslenir). **Anahtar kelime hacmi ölçülmeden
slug kesinleşmez** — Hermes araştırması 30. günde bitmeli. Türkçe içerik
`lang="tr"` ile birlikte gelir. Sektörel kova ilk 6 ayda yayınlanmaz; önce
ana 8 kova oturur (ince içerik riski).

## 5. Hafif araç zinciri

### Kur (0 TL/yıl)

| Araç | Neden | Sahip |
|---|---|---|
| Google Search Console | Tek doğruluk kaynağı (clicks/impressions/index) | Özkan kurar, Hermes okur |
| Bing Webmaster Tools | Copilot/Bing görünürlüğü + IndexNow | Özkan |
| GA4 | Oturum/içerik davranışı | Özkan |
| Plausible (ücretsiz katman) | GA4'ün ağır/gizlilik yükü yerine | Özkan `[DOĞRULANMADI: güncel limit]` |
| Umbrella Analytics | Ölçüm 10k/ay'ı aşarsa alternatif | Özkan `[DOĞRULANMADI]` |
| PageSpeed Insights API | CI'a bağlanır, LCP/CLS regresyonu | OpenCode (CI) |
| CrUX BigQuery | Alan verisi, trafik düşükken bile | Hermes `[DOĞRULANMADI: erişim]` |
| Rich Results Test | JSON-LD manuel doğrulama | Özkan |
| Screaming Frog ücretsiz | 500 URL crawl; site küçük, yeter | Özkan `[DOĞRULANMADI: limit]` |

### Kurulmayacaklar

Ahrefs/Semrush ücretli paketler, yönetici SEO panoları, Google/Bing Ads, A/B test
aracı (trafik seviyesi gelene kadar), Lighthouse CI rapor arşivi.

### Sürdürülebilirlik

Maliyet 0 TL. Asıl maliyet **hesap sahipliği devri** — GSC ve DNS tek kişide.
Özkan ayda 1 saat erişim denetimi yapar. Araç değişikliği bedeli sıfırdır:
veri GSC'de biriktiği için yeni araç 1 aylık geçmişi kaybetmeden devreye girer.

## 6. Ölçüm

| Metrik | Kaynak | Sıklık | Sahip |
|---|---|---|---|
| Tıklanma + gösterim | GSC API | Haftalık | Hermes cron |
| Ortalama sıralama | GSC | Haftalık | Hermes |
| İndeks kapsamı / indekslenen sayfa | GSC | Haftalık | Hermes |
| LCP / INP / CLS | PSI API | Derleme başına | OpenCode CI |
| 4xx-5xx | Sunucu logları | Haftalık | Hermes |
| AI bot istekleri | Sunucu logları | Haftalık | Hermes |
| Dönüşüm (form, iletişim tıklaması) | Plausible/GA4 | Haftalık | Hermes |
| 15 soruluk AEO seti | Elle | Aylık | Özkan |

Toplanma yeri: `D:\AI\OpenCode\STATE.md` + tek Markdown rapor
(`seo/weekly/YYYY-Www.md`). Sunucuya bağımlı veri yok — dosya + API.
Hermes ölçer, hiçbir metriği değiştiremez; raporlayan O, okuyan Özkan.
90 gün başarı eşiği: indekslenen sayfa = yayınlanan sayfa ve ana hizmet
kovalarından en az biri ilk 10'a girmiş olmalı.

## 7. Risk / uyumsuzluk

| Risk | Değerlendirme | Azaltma |
|---|---|---|
| Sıfır JS ile SEO çelişir mi | **Hayır, tersi.** Anında render = en iyi LCP/INP, tam bot erişimi, küçük payload | Statik üretim korunur |
| İçerik bütünlüğü yasağı ile SEO çelişir mi | `content.ts` müşteri/case study/ödül yasaklıyor; SEO zayıf E-E-A-T ister | Yasak gevşetilmez. Kanıt **insan** sağlar |
| Google yapay içerik taraması | Üretilen metin ilk el kaynak/deneyim içermiyorsa değersiz sayılır — politika ihlali değil, sıralama kaybı | Her sayfa gerçek veri/sayı içermeli; ince toplu sayfa yok |
| AI spam taraması (site kalitesi) | 9 kova × çok dil = matris riski | Sayfa başına özgün veri zorunlu |
| `example.invalid` ile yayın | Kritik | Deploy kontrolü: domain parametresi doğrulanmadan `site:build` yok |
| `noindex` sayfa sitemap sızıntısı | Mevcut tek-kural koruması var | Değişiklik yapma |
| Google `llms.txt`'i yok sayarsa | Olası | Zararsız; tarama yüzeyi genişletir, beklenti olarak konumlandırma |
| Sabit `<lastmod>` | `sitemap.ts` bilinçli karar; her build'de değişen lastmod sinyalsiz | Değiştirme |
| E-E-A-T eksikliği (yeni firma) | 1. yıl gerçek risk | YouTube + gerçek proje belgeleri |

## 8. 90 günlük SEO planı (0 TL)

### Gün 1–30 — Temizlik ve ölçüm

| # | İş | Sahip | Kabul kriteri |
|---|---|---|---|
| 1 | Alan adı + DNS | Özkan | Alan alındı |
| 2 | `CANONICAL_ORIGIN` gerçek değer, `lang="tr"` | OpenCode | HTML'de doğru canonical |
| 3 | GSC + Bing + GA4 doğrulama | Özkan (Hermes talimat verir) | 3 panel doğrulanmış |
| 4 | `Organization`/`Person` JSON-LD + `sameAs` | OpenCode | Rich Results Test geçer |
| 5 | `og:image` gerçek dosya + `meta.ts` | OpenCode | Her sayfada mutlak URL |
| 6 | Heading/title/description testleri `validate`'e | OpenCode | `npm run validate` yeşil |
| 7 | 15 soruluk AEO seti sabitlenir | Özkan | `seo/aeo-questions.md` |
| 8 | Anahtar kelime araştırması | Hermes | `seo/keywords.md` |
| 9 | 8 kova slug'ı kesinleşir (kelimeden sonra) | OpenCode | `CAPABILITIES` güncel |
| 10 | `/llms.txt` üretimi | OpenCode | `dist/site/llms.txt` oluşuyor |

Ay 1 sonunda: site yayında, 8 kova yerinde, ölçüm açık. Sıralama bekleme.

### Gün 31–60 — Yayın ve içerik motoru

| # | İş | Sahip |
|---|---|---|
| 11 | 8 kova sayfası 600–1000 kelime, ilk paragrafta tek cümlelik tanım | OpenCode |
| 12 | Kova başına 1 destek içerik (nasıl-yapılır/karşılaştırma) | OpenCode |
| 13 | `/blog` `noindex`'ten çıkar, 4 yazı yayınlanır | OpenCode |
| 14 | `FAQPage` içerikten beslenir (statik değil) | OpenCode |
| 15 | PageSpeed API CI'a bağlanır | OpenCode |
| 16 | AI bot log raporu haftalık | Hermes cron |
| 17 | YouTube ↔ site URL eşlemesi | Özkan |
| 18 | 1. manuel AEO ölçümü | Özkan |
| 19 | Screaming Frog kırık link taraması | Özkan |

### Gün 61–90 — Otorite ve ölçüm derinleştirme

| # | İş | Sahip |
|---|---|---|
| 20 | Kova başına 2. içerik | OpenCode |
| 21 | 5 hedefli YouTube videosu, site içeriğine bağlı | Özkan |
| 22 | 10 hedefli medya/dernek/etkinlik listesi (satın alma yok) | Hermes |
| 23 | İlk 10 site dışı alıntı/link takibi | Özkan |
| 24 | 2. manuel AEO ölçümü + karşılaştırma | Özkan |
| 25 | Görsel optimizasyonu, `width/height`, font-display | OpenCode |
| 26 | 3 aylık rapor: tutan/düşürülecek kova | Hermes + Özkan |
| 27 | Karar: 2 alt kova birleştirilir veya çıkarılır | Özkan |

### Yapılmayacaklar (bilinçli)

Backlink satın alma, toplu guest post, programatik SEO (şehir/kelime sayfası),
AI ile toplu blog üretimi, otomatik mention. İlk yıl hem bütçe hem AI spam
politikası riski.

## 9. Mimariye somut talepler

1. `content.ts`: `CANONICAL_ORIGIN` build-time ortam değişkeni (`TOZ_ORIGIN`) olsun.
2. `meta.ts`: `Organization` + `sameAs` + gerçek `og:image`.
3. `structuredData.ts`: `faqPageNode` içerikten beslensin.
4. `build-site.mjs`: rota tablosundan `llms.txt`.
5. `tests/`: heading hiyerarşisi, title/description uzunluk, sıfır-JS, OG completeness → `npm run validate` içine.
6. Bağımlılık yönü korunur: SEO testleri `site` ağacında kalır, core'a bağımlılık eklemez.

## Özet

1. Site şu an İngilizce (`lang="en"`) ve `example.invalid` canonical kullanıyor — TR pazarı için ikisi de yayın öncesi zorunlu düzeltmedir.
2. Sıfır JS statik üretim SEO/AEO için doğru karardır, değiştirilmemeli.
3. 14 otomatik kontrol; en kritik eksikler: heading hiyerarşisi, title/description uzunluğu, `og:image`, sıfır-JS testi.
4. Şema altyapısı hazır; eksik `Organization`/`Person`/`sameAs` — AI görünürlüğünün kimlik tarafı budur.
5. AEO teknik şartı sunucudan gelen HTML'dir; TOZ bunu karşılıyor. Eksik: `llms.txt` ve AI bot log takibi (ikisi de ücretsiz).
6. Araç zinciri tamamen ücretsiz (GSC, Bing, GA4, Plausible, PageSpeed CI). Maliyet 0 TL/yıl; asıl risk hesap sahipliği devri.
7. Ölçüm: 7 metrik haftalık (Hermes cron), AEO seti aylık (Özkan). Veri dosyada tutulur.
8. İçerik bütünlüğü yasağı SEO ile çelişmez; kanıt insan sağlar, ajan uydurmaz.
9. 90 gün: 30 temizlik+ölçüm, 30 içerik, 30 derinleştirme. Backlink satın alma, programatik SEO ve toplu AI içerik bilinçli olarak dışarıda.
10. Mimariye 6 talep: `TOZ_ORIGIN`, `Organization` şeması, `og:image`, içerik tabanlı FAQ, `llms.txt`, 4 yeni test.
