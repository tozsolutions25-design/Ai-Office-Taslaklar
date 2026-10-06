# REAL WORLD VALIDATION REPORT (PHASE 100)

**Tarih:** 2026-10-06  
**Kapsam:** AI Office / AI Business OS Gerçek Dünya Senaryo Doğrulaması  
**Yöntem:** Planlama ve Uçtan Uca Simülasyon Analizi  

---

## Giriş

Bu rapor, Toz Solutions AI Office çekirdek orkestrasyon motorunun (`TozOrchestrator`) gerçek ticari projelerde nasıl çalışacağını 7 temel senaryo üzerinden uçtan uca doğrulamaktadır. Her senaryo için Kullanıcı Hedefi, Görev Ayrıştırma (Task Decomposition), Skill Seçimi, Yürütme, Kalite Kontrol (QA) ve Final Rapor aşamaları modellenmiştir.

---

## Senaryo 1: Pergoclean SEO Analizi

* **User Goal:** Pergoclean (pergoclean.com.tr) web sitesi için kapsamlı bir SEO analizi yap, mevcut anahtar kelime performansını incele ve iyot/lokal temizlik sektöründeki arama motoru görünürlüğünü artırma stratejisi belirle.
* **Task Decomposition:**
  1. Hedef URL taraması ve meta etiket denetimi (`firecrawl_scrape`).
  2. Mevcut index durumu ve sitemap analizi.
  3. Sektörel anahtar kelime eşleşme analizi.
  4. Teknik SEO eksiklik raporu üretimi.
* **Skill Selection:** `firecrawl`, `grounded-citations`, `seo-audit`.
* **Execution:** `TozOrchestrator` görevi alır, `firecrawl` aracılığıyla site içeriğini çeker, capability matcher uygun skill'leri yükler ve worker pool üzerinden eşzamanlı analiz dalgası çalıştırır.
* **QA:** `VerificationRunner` tarama sonuçlarının eksiksiz ve doğrulanabilir kanıta dayalı olduğunu doğrular (%100 kanıt kontrolü).
* **Final Report:** Teknik açıklar, eksik meta açıklamaları ve öncelikli optimizasyon adımlarını içeren SEO Durum Raporu.

---

## Senaryo 2: Pergoclean Rakip Analizi

* **User Goal:** Pergoclean'in sektördeki 3 ana rakibinin dijital varlıklarını, fiyatlandırma stratejilerini, anahtar kelime stratejilerini ve içerikfrekanslarını analiz et.
* **Task Decomposition:**
  1. Rakip site URL'lerinin tespiti ve listelenmesi.
  2. Rakiplerin içerik haritasının çıkarılması (`firecrawl_map`).
  3. Sosyal kanıt, ürün ve hizmet sunum kıyaslaması.
  4. SWOT matrisi için veri toplama.
* **Skill Selection:** `firecrawl-competitive-intel`, `firecrawl-map`, `competitor-news-monitor`.
* **Execution:** Orchestrator, rakip siteleri paralel worker'lara dağıtır; her worker kendi workspace'inde veriyi toplar.
* **QA:** Veri eksikliği veya uydurma veri (`no fabricated facts` kuralı) denetimi yapılır.
* **Final Report:** Rakip Karşılaştırma Matrisi ve Stratejik Rekabet Avantajı Raporu.

---

## Senaryo 3: Pergoclean Blog Planı

* **User Goal:** Pergoclean müşterilerinin en sık sorduğu sorular (AEO/GEO odaklı) temelinde 3 aylık bir blog içerik takvimi ve makale taslakları oluştur.
* **Task Decomposition:**
  1. Müşteri soru ve niyet analizi (FAQ & AEO extraction).
  2. Anahtar kelime kümeleme (Keyword clustering).
  3. Başlık ve hiyerarşi planlama (H1, H2, H3 yapıları).
  4. Yayın takvimi ve kategori matrisi oluşturma.
* **Skill Selection:** `yt-seo`, `content-strategy`, `grounded-citations`.
* **Execution:** Model router uygun LLM rotasını seçer, planlama ajanı içerik yapılarını üretir.
* **QA:** İçeriklerin pazarlama klişelerinden uzak ve teknik doğruluğa sahip olduğu kontrol edilir.
* **Final Report:** 12 Haftalık Blog İçerik Takvimi ve AEO Odaklı Soru-Cevap Matrisi.

---

## Senaryo 4: Toz Yapı SEO Analizi

* **User Goal:** tozyapi.com.tr alan adı için AEO (Answer Engine Optimization) ve SEO uyumluluk denetimi gerçekleştir.
* **Task Decomposition:**
  1. Yapısal veri (Schema.org) denetimi.
  2. Sayfa yüklenme ve başlık yapısı analizi.
  3. Yerel arama (Local SEO) ve GEO (Generative Engine Optimization) görünürlük analizi.
* **Skill Selection:** `firecrawl-seo-audit`, `firecrawl-scrape`.
* **Execution:** Orchestrator denetim görevini çalıştırır, structured data ve sitemap verilerini toplar.
* **QA:** Schema yapıları ve başlık hiyerarşisi kural uygunluğu test edilir.
* **Final Report:** Toz Yapı AEO/SEO Denetim ve İyileştirme Raporu.

---

## Senaryo 5: Toz Yapı Rakip Analizi

* **User Goal:** İnşaat ve yapı kimyasalları alanında Toz Yapı'nın ana rakiplerinin dijital konumlandırmasını incele.
* **Task Decomposition:**
  1. Rakip web sitelerinin taranması.
  2. Ürün kategorilendirme ve teklif yapıları analizi.
  3. Eksik alanlar (Gaps) ve fırsat analizi.
* **Skill Selection:** `firecrawl-competitive-intel`, `competitor-news-monitor`.
* **Execution:** Paralel worker'lar ile rakip siteler taranır ve audit sink'e kaydedilir.
* **QA:** Veri doğrulama ve çakışma önleme kontrolleri.
* **Final Report:** Yapı Sektörü Dijital Rakip Analiz Raporu.

---

## Senaryo 6: Record Türkiye Sosyal Medya Planı

* **User Goal:** Record Türkiye markası için aylık sosyal medya içerik stratejisi ve paylaşımlık konu başlıkları üret.
* **Task Decomposition:**
  1. Hedef kitle ve platform (LinkedIn, Instagram vb.) analizi.
  2. Haftalık tema ve kanca (Hook) tasarımı.
  3. Görsel ve metin yönlendirmeleri.
* **Skill Selection:** `social-media`, `marketing`, `yt-script`.
* **Execution:** Yaratıcı içerik ajanı, belirlenen temalar çerçevesinde metinleri üretir.
* **QA:** Marka sesine uygunluk ve özgünlük denetimi.
* **Final Report:** Record Türkiye 4 Haftalık Sosyal Medya İçerik Planı.

---

## Senaryo 7: Kapıda Kirala Pazar Araştırması

* **User Goal:** "Kapıda Kirala" girişimi için pazar büyüklüğü, potansiyel müşteri segmentleri, riskler ve rekabet ortamı hakkında kapsamlı araştırma raporu hazırla.
* **Task Decomposition:**
  1. Pazar dinamikleri ve trend analizi.
  2. Hedef kitle segmentasyonu.
  3. Operasyonel riskler ve fırsatlar matrisi.
  4. SWOT analizi.
* **Skill Selection:** `research`, `market-research`, `grounded-citations`.
* **Execution:** Araştırma ajanı çok kaynaklı verileri tarar, doğrular ve sentezler.
* **QA:** Spekülatif veya doğrulanmamış pazar büyüklüğü iddialarının filtrelenmesi (`no fabricated facts`).
* **Final Report:** Kapıda Kirala Girişimi Kapsamlı Pazar Araştırma ve Fizibilite Raporu.
