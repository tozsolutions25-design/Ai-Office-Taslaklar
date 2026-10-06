# BUSINESS WORKFLOW PACKS & OPERATOR MODE (PHASES 102 & 103)

**Tarih:** 2026-10-06  
**Kapsam:** AI Office İş Akışı Paketleri ve Tek Komutlu Operatör Modu  

---

## 1. İş Akışı Paketleri (Workflow Packs)

### WORKFLOW_PKG_SEO
* **Site Tarama:** `firecrawl_scrape` ile hedef URL içeriğini ve meta yapısını çekme.
* **Rakip Analizi:** `firecrawl-competitive-intel` ile rakip site anahtar kelime haritalarını çıkarma.
* **Anahtar Kelime Araştırması:** AEO ve SEO odaklı niyet kümelemesi yapma.
* **İçerik Planı:** 3 aylık başlık ve hiyerarşi matrisi oluşturma.
* **Yayın Takvimi:** Haftalık otomatize takvim girdileri üretme.

### WORKFLOW_PKG_SOCIAL
* **Rakip İzleme:** Sektörel hesapların sosyal medya paylaşımlarını tarama.
* **İçerik Planı:** Haftalık kampanya ve kanca (hook) tasarımı.
* **Gönderi Üretimi:** Platform bazlı (LinkedIn, Instagram) metin üretimi.
* **Performans Değerlendirmesi:** Etkileşim potansiyeli ve kural denetimi.

### WORKFLOW_PKG_MARKET_RESEARCH
* **Pazar Araştırması:** Sektör büyüklüğü, trendler ve hedef kitle taraması.
* **Rakip Araştırması:** Ürün/hizmet ve fiyatlandırma kıyaslaması.
* **SWOT:** Güçlü yönler, zayıf yönler, fırsatlar ve tehditler matrisi.
* **Fırsatlar & Riskler:** Büyüme alanları ve operasyonel risklerin raporlanması.

### WORKFLOW_PKG_CONTENT
* **Blog:** SEO uyumlu makale taslakları ve hiyerarşi oluşturma.
* **Landing Page:** Dönüşüm odaklı sayfa metni ve CTA tasarımı.
* **FAQ:** Sık sorulan sorular ve AEO (Cevap Motoru) optimizasyonu.
* **GEO & AEO:** Yapay zeka arama motorlarında görünürlük stratejileri.

---

## 2. Operateur Modu (Operator Mode - Tek Komutlu Tetikleme)

Yeni kullanıcılar için karmaşık komut dizileri yerine tek satırlık operatör komutları tanımlanmıştır:

* `RUN_SEO_AUDIT --target=<url>` -> Siteyi tarar, teknik SEO eksiklerini raporlar.
* `RUN_COMPETITOR_RESEARCH --industry=<sector>` -> Rakip analiz matrisini üretir.
* `RUN_CONTENT_PLAN --brand=<name> --months=3` -> 3 aylık içerik takvimi hazırlar.
* `RUN_SOCIAL_PLAN --brand=<name>` -> Sosyal medya kampanya planı oluşturur.
* `RUN_MARKET_RESEARCH --topic=<subject>` -> Kapsamlı pazar araştırması ve SWOT raporu çıkarır.
