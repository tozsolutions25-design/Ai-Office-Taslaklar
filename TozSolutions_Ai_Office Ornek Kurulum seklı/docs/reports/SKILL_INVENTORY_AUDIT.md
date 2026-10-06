# SKILL INVENTORY AUDIT (PHASE 101)

**Tarih:** 2026-10-06  
**Kapsam:** Mevcut Skill (Yetenek) Kütüphanesinin İncelenmesi ve Sınıflandırılması  

---

## Skill Envanteri ve Değerlendirme Tablosu

| Skill Adı | Kullanım Amacı | Son Kullanım / Durum | Bağımlılıklar | Risk Seviyesi | Sınıflandırma |
|---|---|---|---|---|---|
| `firecrawl` / `firecrawl-scrape` | Web sitelerini taramak ve markdown'a dönüştürmek | Aktif (SEO ve Rakip Analizi) | Firecrawl API Key | Düşük | **KEEP** |
| `firecrawl-map` / `firecrawl-crawl` | Site haritası çıkarmak ve toplu veri çekmek | Aktif (Rakip Analizi) | Firecrawl API Key | Düşük | **KEEP** |
| `obsidian` | Şirket bilgi tabanı ve not yönetimi | Aktif (Knowledge Base) | Lokal dosya sistemi | Düşük | **KEEP** |
| `research` / `grounded-citations` | Akademik/web tabanlı doğrulanabilir araştırma | Aktif (Pazar Araştırması) | Web arama / LLM | Düşük | **KEEP** |
| `airtable` / `google-workspace` | Veri tabanı ve ofis entegrasyonları | Potansiyel (Operasyon Katmanı) | API Credentials | Orta | **KEEP** |
| `social-media` / `marketing` | Sosyal medya içerik planlama | Aktif (Record Türkiye) | LLM | Düşük | **KEEP** |
| `architecture-diagram` / `p5js` | Görsel tasarım ve mimari şemalar | Tasarım aşamasında | Lokal motorlar | Düşük | **KEEP** |
| Çoğul/Eski Tarama Scriptleri (Eski Botlar) | Tekrarlayan veya eski test betikleri | Deprecated / Kullanılmıyor | Yok | Yüksek | **REMOVE / DEPRECATE** |

---

## Sınıflandırma Kriterleri

1. **KEEP:** Çekirdek iş akışlarında (SEO, Araştırma, Sosyal Medya, Bellek) aktif olarak kullanılan, test edilmiş ve güvenli skill'ler.
2. **MERGE:** Benzer işlevi gören küçük skill'lerin tek bir çatı altında birleştirilmesi (Örn: Firecrawl alt skill'lerinin gruplanması).
3. **DEPRECATE:** Güncelliğini yitirmiş veya nadir kullanılan modüller.
4. **REMOVE:** Güvenlik riski taşıyan veya kullanılmayan artık dosyalar.
