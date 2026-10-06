# SAĞLAYICI KAYIT DEFTERİ

> Çelişki C-10'u çözer: **6 farklı sağlayıcı sırası** vardı.
> Tek tablo. Tek doğruluk kaynağı: `00-core/02-yonlendirici/limit-durumu.json`

---

## SORUN: 6 FARKLI SIRa

| Kaynak | Sıra |
|---|---|
| `MASTER-BUILD:239` / `deepseek_63983a:168` | Groq → Gemini → OpenRouter → Ollama |
| `10_MODEL_STRATEJISI.md:9` | Gemini → Ollama/LM Studio → diğer → ücretli |
| `BUGUN-2026-09-13:8` | qwen3-coder → deepseek-r1 → muse-spark → orcarouter → gemini → groq → nvidia |
| `Qwen_markdown:13` | OpenRouter Free Tier **öncelikli** |
| `FINAL_MASTER:389` (D5) | Yerel model **birincil** |
| `ben olsam fıye:20` | DeepSeek V3/R1 **şirketin ana beyni** |

**Neden 8 GB RAM'de yerel model birincil olamaz:**

> `MASTER-BUILD:127` — *"8 GB'de Ollama birincil"* diye **yasaklandı**

Bu madde D5'i (yerel model birincil mi?) **zaten cevaplamış**. Ama `FINAL_MASTER`
D5'i "evet, birincil" diye varsayılan yapmış. **Varsayılan yanlıştı.**

---

## GÖREV SINIFLARI

`FINAL_MASTER_ARCHITECTURE.md:198-203`'ten gelen 6 sınıf:

| Sınıf | Ne yapar | Örnek | Ücretsiz yeter mi? |
|---|---|---|---|
| **SINIFLANDIRMA** | Etiketle, ayır | "Bu e-posta satış mı, destek mi?" | ✅ Evet |
| **RAPOR** | Özetle, biçimlendir | Haftalık durum raporu | ✅ Evet |
| **ARAŞTIRMA** | Topla, kaynakla | Pazar taraması | ⚠️ Kısmen |
| **ANALİZ** | Karşılaştır, yorumla | Rakip haritası | ❌ Gerekli |
| **KOD_ÜRETİMİ** | Yaz, test et | Modül + test | ❌ Gerekli |
| **KRİTİK_HATTI** | Para/hukuk/deploy kararı | Teklif fiyatı | ❌ Kesinlikle |

---

## TABLO — BOŞ HÜCRELER D4 VE D5'İN CEVABIDIR

| Sınıf | Birincil | Yedek | Yerel | Maliyet /1K | Doğrulama |
|---|---|---|---|---|---|
| SINIFLANDIRMA | `?` | `?` | evet | 1 | ⬜ D4/D5 |
| RAPOR | `?` | `?` | evet | 2 | ⬜ D4/D5 |
| ARAŞTIRMA | `?` | `?` | kısmen | 4 | ⬜ D4/D5 |
| ANALİZ | `?` | `?` | hayır | 6 | ⬜ D4/D5 |
| KOD_ÜRETİMİ | `?` | `?` | hayır | 10 | ⬜ D4/D5 |
| KRİTİK_HATTI | `?` | `?` | hayır | 12 | ⬜ D4/D5 |

> **Bu tablo bilerek boş bırakıldı.** Doldurmak D4 (günlük token tavanı)
> ve D5 (yerel model birincil mi) kararlarına bağlı. Bu iki karar senin.
> Bkz. `08_GEREKLER/ACIK_KARARLAR.md`

**Ölçülmemiş fiyat kar gizleme aracıdır.** Bkz. `06_IS_MODELI/FIYATLANDIRMA.md`

---

## ŞU AN KODDA OLAN (doğrulanmış)

`kordinator/router.py:21-28`:

```python
VARSAYILAN_SIRA = ["openrouter", "gemini", "groq", "local_ollama"]

VARSAYILAN_MODELLER = {
    "openrouter": "google/gemini-2.0-flash-exp:free",
    "gemini": "gemini-2.0-flash",
    "groq": "llama-3.3-70b-versatile",
    "local_ollama": "qwen2.5-coder:7b",
}
```

### Bu sıra neden bu?

`router.py:20` — *"Rotalama sırası: kalite öncelikli, maliyet sonra"*

| Sıra | Gerekçe |
|---|---|
| 1. OpenRouter | Ücretsiz bulut en kaliteli yanıt. Çoğu model tek uç noktada. |
| 2. Gemini | Ücretsiz katman geniş. Bağımsız sağlayıcı → OpenRouter çökerse çalışır. |
| 3. Groq | Çok hızlı. Ücretsiz katman dakika-bazlı hız limiti kullanır. |
| 4. Ollama | Maliyeti **sıfır** ama kalitesi düşük. **En sona** kondu. |

> Yerel model maliyeti sıfır olduğu için sona kondu, yoksa değil.
> Kalite önce. Bu `10_MODEL_STRATEJISI` ile uyumlu.

### Görev sınıfı → sağlayıcı eşlemesi YOK

D-04'e göre model **çalışana** sabitlenmez (K-02), ama **görev sınıfına**
göre seçilir. Bu eşleme henüz kodlanmadı. Şu an tüm sınıflar aynı rotayı kullanıyor.

**Bu, kapatılması gereken boşluk.** Ne zaman: D4/D5 kapandıktan sonra.

---

## KOTALAR — DOĞRULANMAMIŞ

`00-core/02-yonlendirici/limit-durumu.json` içinde **4 sağlayıcının da
`dogrulama_durumu` alanı var ve 4'ü de doğrulanmamış:**

| Sağlayıcı | Yazılı limit | Durum | Not |
|---|---|---|---|
| openrouter | 200/gün | `"yapilmadi"` | V1'de 50 idi. 200 **kaynaksız**. |
| gemini | 1500/gün | `"yapilmadi"` | 2026-09 taslağından geldi. |
| groq | 14400/gün | `"supheli"` | **Muhtemelen yanlış.** Groq ücretsiz katman GÜNLÜK değil DAKİKA hız limiti kullanır. |
| local_ollama | -1 (sınırsız) | `"kurulumda_test_edilecek"` | Maliyet 0. |

**K-07 neden bu alanı zorunlu kılıyor:**

`anayasa_kontrolu.py:113-131` — iki kontrol var:

1. `gunluk_limit` varsa `dogrulama_durumu` **olmak zorunda**
2. `dogrulama_durumu` "dogrulandı" diyorsa `dogrulama_kaynagi` **olmak zorunda**

Yani **yalan söyleyemezsin.** "Doğrulandı" yazıp kaynak yazamazsın.
Doğrulanmadıysa "yapılmadı" yaz — sistem kabul eder.

> `MASTER-BUILD:297` — *"OpenCode dokümanı uygulamıyorsa ve VERIFY
> etmediysen **otomatik çok katmanlı yönlendirme iddia etme**"*

**C-24'ün çözümü:** İddia etme ≠ yapma. Otomatik failover **çalışabilir**,
ama (a) her sınıf için test edilmiş olmalı, (b) hangi modelin hangi görevi
yaptığı loglanmalı (`10_MODEL_STRATEJISI:26`), (c) maliyet sayacı açık olmalı.

---

## 6 FARKLI AD, 6 AYRI ŞEY

`ben olsam fıye` dosyasında 6 model adı geçiyor:
qwen3-coder, deepseek-r1, muse-spark, orcarouter, gemini, groq, nvidia

Bunlar **model** adları. `24_FINAL_KARAR_TABLOSU.md`'deki "Qwen CLI | Worker |
NO INITIAL" ise **araç** adı.

**Karar (C-26):**

| Kavram | Karar |
|---|---|
| **Qwen modeli** | Kullanılabilir (`qwen2.5-coder:7b` Ollama'da zaten var) |
| **Qwen CLI aracı** | **Kurulmayacak** |

Aynı isim, iki farklı nesne. Karar tablosunda bu ayrım yazılmadığı için
iki kişi farklı okudu. **Artık yazılı.**

---

## SAĞLAYICI POLİTİKASI

`11_MCP_POLICY.md` MCP için diyor. Sağlayıcı için karşılığı:

### Her sağlayıcı için 7 soru

1. **Amaç** — ne işe yarar?
2. **Hangi görev sınıfı** — hangi satır?
3. **Anahtar** — hangi ortam değişkeni?
4. **Maliyet** — ücretsiz mi, kotalı mı?
5. **Limit kaynağı** — resmi URL nedir?
6. **Risk** — veri nerede işleniyor?
7. **Geri dönüş** — sağlayıcı çöktüğünde ne olur?

### Yasaklar

- Aynı işi yapan iki sağlayıcı kurulmaz
- Kullanılmayan sağlayıcı kurulmaz
- **Sessiz failover yasaktır** (K-03) — loglanır
- Limiti doğrulanmamış sağlayıcı "güvenilir" **denemez**
- `K-07`: her limit ya kaynaklı ya da `VERIFY_REQUIRED`

---

## MİMARİ DEĞİŞİKLİĞİ

`16_SECURITY_GOVERNANCE.md` gereği: **model / sağlayıcı yönlendirici**
AI'ın kendi kendini değiştiremeyeceği kalemlerden biri.

Değişiklik prosedürü:

```
ÖNERİ → KARAR GÜNLÜĞÜ → TEST → İNSAN ONAYI → YEDEK → DEĞİŞİKLİK
  → SAĞLIK KONTROLÜ → YAYIN
```

**Provider değişikliği koordinator değişikliği değildir** (`10_MODEL_STRATEJISI:16`)
ama yine de insan onayı ister. Çünkü maliyet ve veri aktarımı değişir.

---

## BİLİNEN TEKNİK UYARILAR

Analiz sırasında bulunan, **hiçbir dokümana geçmemiş** bilgiler:

| Uyarı | Kaynak |
|---|---|
| Hermes 8+ saat denemeye rağmen stabil bağlantı **kuramadı** | `Qwen_markdown:27` |
| Hermes CLI `--base_url --api_key` ile `.env`'i **bypass ediyor** | `Qwen_markdown:24-27` |
| Ollama `qwen2.5-coder:7b` 8 GB RAM'de **yavaş** (donanım kısıtı) | `MASTER-BUILD:127` |
| Groq ücretsiz katman **günlük değil dakika** hız limiti | `BUGUN-2026-09-13:8` |
| `lmstudio: "local-model"` **sahte model adıydı** | V3 §0 ORTA 10 |
| Prompt cache: tek karakter (zaman damgası) tüm cache'i **öldürür** | V3 `onbellek.py` |

> Bu bilgiler `99_ARSIV/`daki taslaklarda kaldı. Kullanılmadan önce
> `ACIK_KARARLAR.md`'ya taşınmalı — D9.
