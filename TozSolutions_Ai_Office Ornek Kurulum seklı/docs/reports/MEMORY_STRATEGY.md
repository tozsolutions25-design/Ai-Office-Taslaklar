# MEMORY STRATEGY REPORT (PHASE 104)

**Tarih:** 2026-10-06  
**Kapsam:** AI Office Bellek Mimarisi ve Sürdürülebilirlik Stratejisi  

---

## Bellek Katmanları Analizi

### 1. Kısa Süreli Hafıza (Short-Term Memory)
* **Amaç:** Aktif görev oturumu sırasındaki ara adımlar, prompt bağlamı ve geçici değişkenler.
* **Saklama Politikası:** Bellek içi geçici kuyruklar ve oturum dosyaları (`.jsonl` transcripts).
* **Temizleme Politikası:** Oturum sonlandığında veya `/clear` komutuyla otomatik temizleme.
* **Boyut Limiti:** Maksimum context window ve tampon bellek limitleri.
* **Riskler:** Bağlam şişmesi (context bloat) ve token maliyeti.

### 2. Çalışma Alanı Hafızası (Workspace Memory)
* **Amaç:** Belirli bir workspace (proje) bağlamındaki dosyalar, konfigürasyonlar ve durumlar.
* **Saklama Politikası:** Partitioned State Store (`~/.hermes/state.db` veya workspace bazlı dizinler).
* **Temizleme Politikası:** Yalnızca manuel silme veya workspace kapatma komutu.
* **Boyut Limiti:** Disk kapasitesi ile sınırlı (bölümlenmiş anahtar-değer yapısı).
* **Riskler:** Workspace'ler arası veri sızıntısı (Faz 06 izolasyon testleriyle önlenmiştir).

### 3. Marka Hafızası (Brand Memory)
* **Amaç:** Pergoclean, Toz Yapı, Record Türkiye gibi markaların tonu, kılavuzları ve hedefleri.
* **Saklama Politikası:** Obsidian vault ve yapılandırılmış Markdown notları (`docs/`).
* **Temizleme Politikası:** Kalıcı (Kalıcı hafıza olarak korunur).
* **Boyut Limiti:** Optimize edilmiş metin dosyaları (< 10 MB).
* **Riskler:** Bilgi eskimesi; düzenli güncellemeler gerektirir.

### 4. Karar Hafızası (Decision Memory)
* **Amaç:** Alınan mimari ve operasyonel kararların neden-sonuç ilişkileriyle saklanması.
* **Saklama Politikası:** `ARCHITECTURE.md`, `DECISIONS.md` ve audit log kayıtları.
* **Temizleme Politikası:** Asla silinmez (tarihsel izlenebilirlik).
* **Boyut Limiti:** Çoğul kayıtlar audit buffer sınırlarıyla yönetilir.
* **Riskler:** Log şişmesi; bounded ring buffer ile çözülmüştür.

### 5. Uzun Süreli Hafıza (Long-Term Memory / Agent Memory)
* **Amaç:** Ajanların ve sistemin geçmiş oturumlardan öğrendiği kurallar, tercihler ve dersler.
* **Saklama Politikası:** `agentmemory` servisi / yerel bellek veritabanı.
* **Temizleme Politikası:** Önem eşiği (importance floor) altında kalanların budanması.
* **Boyut Limiti:** Karakter bütçesi ve sıkıştırma mekanizmaları.
* **Riskler:** Gürültülü veya hatalı öğrenmelerin kalıcı hale gelmesi.
