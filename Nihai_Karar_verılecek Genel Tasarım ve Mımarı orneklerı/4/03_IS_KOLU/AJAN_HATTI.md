# AJAN HATTI — KENDİ ÜRÜNÜMÜZ

> D-01 kararı: TOZ AI **hibrit**. Bu, A tarafı.
> Kaynak: `AUTONOMOUS_WEB_AGENCY.md` (19 ajan)
> Tarih: 2026-10-06

---

## TANIM

**Kendi ürünümüzü kendimiz yapıyoruz.** Müşteri işi yapmıyoruz.

Bu hatta maliyet var, gelir yok. **Ama ürün buradan çıkıyor** — ve ürün
operasyon hattının hammaddesi.

---

## 19 AJAN

`AUTONOMOUS_WEB_AGENCY.md`:

| # | Ajan | Ne yapar |
|:--:|---|---|
| 00 | **Orchestrator / Creative Director** | Yaratıcı yön, son karar |
| 01 | **Codebase Architect** | Kod yapısı, bağımlılık yönetimi |
| 02 | **Research Director** | Araştırma yönlendirme |
| 03 | **Viral Web Researcher** | Viral içerik keşfi |
| 04 | **UX / Product Strategist** | Ürün stratejisi |
| 05 | **Art Director** | Görsel dil |
| 06 | **3D Engineer** | three.js, WebGL |
| 07 | **Motion / Scroll Director** | Animasyon, scroll |
| 08 | **Frontend Engineer** | Arayüz |
| 09 | **Copywriter / Brand Strategist** | Metin, marka |
| 10 | **SEO Engineer** | Arama motoru |
| 11 | **AEO / GEO Engineer** | AI arama optimizasyonu |
| 12 | **Local SEO Engineer** | Yerel SEO |
| 13 | **CRO Specialist** | Dönüşüm optimizasyonu |
| 14 | **Performance Engineer** | Hız |
| 15 | **Accessibility Engineer** | Erişilebilirlik |
| 16 | **Security Engineer** | Güvenlik |
| 17 | **QA / Red Team** | Kırma testi |
| 18 | **Final Creative Critic** | Son kalite elemesi |

> ⚠️ **Bu 19 ajan genel şirket kataloğuyla KARIŞTIRILMAZ** (C-05).
> Bunlar web ürün üretimi içindir. Genel katalog 7 işçidir.

---

## KALİTE KAPISI

`AUTONOMOUS_WEB_AGENCY:740-747`:

> *"Minimum: **90/100**. Target: **95+**"*

### Bu, sistem sağlığı kapısı DEĞİLDİR (C-14)

| Yüz | Ölçüm | Kim |
|---|---|---|
| **Web çıktısı** | 90/100 puan | QA / Red Team (17) + Final Critic (18) |
| **Sistem sağlığı** | PASS/FAIL kapı | `01_MIMARI/DOGRULAMA_KAPILARI.md` |

> **İkisini karıştırma.** Web çıktısı 95 alabilir, sistem sağlığı başarısız
> olabilir. Ve tersi de doğru.

---

## OTONOM MOD KAPSAMI (C-13)

`AUTONOMOUS_WEB_AGENCY:82-118` — *"Kullanıcıdan tekrar onay isteme."*

### Bu, şirket genelinde GEÇERLİ DEĞİL

```
╔══════════════════════════════════════════════════════════════╗
║  ✅ OTONOM:  Yalnızca bu klasör kapsamında                   ║
║              Yalnızca kod / SEO / UX / içerik kararlarında   ║
║              Dışarı GÖNDEREN hiçbir şey otomatik değil       ║
╠══════════════════════════════════════════════════════════════╣
║  ❌ ONSIZ:  para · silme · production deploy                ║
║              credential değiştirme · sözleşme               ║
║              hukuki işlem · toplu iletişim                   ║
╠══════════════════════════════════════════════════════════════╣
║  📋 DOKÜMAN: Dışarı giden her şey insan onayı ister         ║
║              (16_SECURITY_GOVERNANCE — 6 işlem)              ║
╚══════════════════════════════════════════════════════════════╝
```

### "Tekrar onay isteme" ne demek

Bu ajan grubu **tek bir web projesi** üzerinde çalışır. Her adımda
"devam edeyim mi?" sormak kullanıcı yorgunluğu yaratır.

**Ama:** "Devam edeyim mi?" sorusu **iç süreçte** sorulmaz.
**"Bunu müşteriye gönderiyorum"** sorusu sorulur.

> Ayrım: **karar** otonom, **dışarı giden eylem** onaylı.

---

## A HATTI İÇİN ORTAK ANALİZ MOTORU

Ortak analiz motoru **iki hattın arasında** çalışır. A tarafında ne üretir?

| Analiz çıktısı | A tarafında kullanım |
|---|---|
| Pazar konumlanması | Marka stratejisi |
| Rakip haritası | İçerik farklılaştırma |
| Özellik haritası | İçerik üretimi |
| Hedef kitle profili | Kanal seçimi |
| Fiyat aralığı | Ürün konumlandırma |
| İçerik fırsatları | SEO/AEO planı |

> **Analiz bir kez yapılır, iki hatta da gider.** Maliyet iki kez ödenmez.
> Bkz. `01_MIMARI/KATMANLAR.md § AKIŞ GÖRSELİ`

---

## 3D OFİS — A HATTI MI, YOKSA GÖRSELLEŞTİRME MI?

`20_3D_SANAL_OFIS.md:22-26` — beş yasak:

```
3D ofis:
  ✗ coordinator olmayacak
  ✗ database olmayacak
  ✗ ikinci memory olmayacak
  ✗ ikinci MCP router olmayacak
  ✗ workflow engine olmayacak
```

> Bu, **görselleştirme**. Ajan hattının 3D Engineer'ı (06) web ürününde
> three.js kullanır. "3D Sanal Ofis" ise şirketin **durumunu görselleştiren**
> bir arayüz olur. İkisi farklı şey.

**Durum:** Faz 13 sonrası (D6). **1. yılda yapılmıyor.**

---

## A HATTI ÖLÇÜMÜ

Bu hatta **maliyet** ölçülür, gelir değil.

| Metrik | Nerede |
|---|---|
| Üretilen web varlığı sayısı | Beklenen: 1 (PergoClean) |
| Saatlik maliyet | `06_IS_MODELI/FIYATLANDIRMA.md` |
| 3 sayı ölçümü | Bu hatta **geçerli değil** — 3 sayı müşteri işi içindir |

> Kendi ürünümüzü yaparken "önce kaç saat, sonra kaç saat" ölçümü
> müşteri memnuniyeti içindir. Burada ölçülecek şey: **üretim hızı.**

---

## 90 GÜNDE NE YAPILACAK

`13_90_GUNLUK_KURULUM_PLANI.md:80` — *"Bu 90 günde yapılmayacaklar:
**100+ ajanı aktif etmek**"*

| Faz | A hattı |
|---|---|
| 1-2 | Kurulum altyapısı (kapılar) |
| 3 | Orkestratör ayaga kalkar |
| 5-6 | Teknik altyapı |
| 7 | Bilgi + hafıza |
| 8 | Araştırma işçisi |
| 9 | Güvenlik kapısı |
| 10 | Kod işçisi |
| 11 | Pazarlama (A + B hatları birlikte) |
| 12 | Öğrenme |
| 13+ | Medya + 3D ofis |

---

## İLK YAPILACAK

```
1. PergoClean web varlığını bu hatta üret.
2. 19 ajanı değil, 3-4 tanesini kullan (00, 08, 10, 17).
3. Kaliteyi 90/100 ile ölç.
4. Maliyeti ölç.
5. Gerçekten daha hızlı mısın — ölç, varsay.
```

> **5. madde önemli.** "AI ile daha hızlıyız" bir iddiadır.
> K-07 gereği ölçülmeden söylenemez. `VERIFY_REQUIRED`
