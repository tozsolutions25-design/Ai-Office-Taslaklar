# A5 — VERİ ANALİSTİ: KPI, ÖLÇÜM DÖNGÜSÜ VE ŞİRKET HAFIZASI

TOZ AI GROUP · v1.0 · 2026-10-06
Kapsam: teknik tasarım kararı. Uygulama yok, sadece karar.

---

## 0. DOĞRULAMA DURUMU

| İddia | Durum | Not |
|---|---|---|
| Hermes memory provider = `agentmemory` | [DOĞRULANMADI] | Kullanıcı beyanı, bu oturumda yeniden ölçülmedi |
| `agentmemory` MCP health 000 (kapalı) | [DOĞRULANMADI] | Aynı |
| `state.db` 12.6 MB | [DOĞRULANMADI] | Diskte `state.db` bulunamadı; konum `[DOĞRULANMADI]` |
| `kanban.db`, `shared-state.db` mevcut | [DOĞRULANMADI] | Bulunamadı; var oldu varsayılıyor |
| `MEMORY.md` / `USER.md` yok | [DOĞRULANMADI] | — |
| Obsidian kurulu değil | [DOĞRULANMADI] | — |
| Hermes'te `obsidian_sync` yok | [DOĞRULANMADI] | Kullanıcı beyanı |
| codebase-memory MCP bağlı, index boş | [DOĞRULANMADI] | — |
| `D:\AI\TozSolutions_Ai_Office` npm projesi | DOĞRULANDI | Klasör mevcut |
| `D:\AI\Skills`, `D:\AI\OpenCode` | DOĞRULANDI | Klasörler mevcut |

**Kural:** aşağıdaki tasarım bu belirsizliklere rağmen yazıldı; uygulama öncesi
Bölüm 8 doğrulama listesi çalıştırılacak. Doğrulanmayan bir yolun varlığına
bağlı hiçbir karar "sabit" sayılmaz.

---

## 1. KPI SETİ (14 metrik)

Ölçüm motoru: Hermes cron (zamanlanmış) → tek yazıcı → `metrics.db`.
Bütçe 0 TL: yalnızca dosya yazma + PowerShell/Node hesaplama, ücretli API yok.

### 1.1 Operasyonel

| # | Metrik | Tanım | Kaynak | Sıklık | Sahip | Karar eşiği |
|---|---|---|---|---|---|---|
| O1 | Görev tamamlanma süresi (cycle time) | `closed_at - created_at`, median | `tasks.db` | Günlük | Ajan | p90 > 48 saat |
| O2 | Yeniden deneme oranı | revizyon sayısı / toplam görev | `tasks.db` | Günlük | Ajan | > %25 |
| O3 | Açık görev yaşı | `now - created_at`, en eskiden | `tasks.db` | Günlük | Ajan | > 7 gün |
| O4 | Başarısız görev sayısı | durum = failed/blocked | `tasks.db` | Günlük | İnsan | Haftada > 3 |

### 1.2 Finansal

| # | Metrik | Tanım | Kaynak | Sıklık | Sahip | Karar eşiği |
|---|---|---|---|---|---|---|
| F1 | Teklif→kazanım oranı | won / teklif_verildi | `crm/offers.csv` | Haftalık | İnsan | < %20 |
| F2 | Teklif tutarı (toptlam) | won tekliflerin toplamı (TL) | `crm/offers.csv` | Haftalık | İnsan | Haftada 0 |
| F3 | Fatura-kanban eşleşmesi | faturalanan / teslim edilen iş | `crm/invoices.csv` | Aylık | İnsan | < %90 |

### 1.3 Büyüme

| # | Metrik | Tanım | Kaynak | Sıklık | Sahip | Karar eşiği |
|---|---|---|---|---|---|---|
| B1 | Sosyal erişim | LinkedIn erişim + X görüntülenme (toplam) | Manuel giriş `metrics.csv` | Haftalık | İnsan | Haftada 0 artış |
| B2 | Web trafiği | toplam oturum | hosting analytics export | Aylık | İnsan | < 50/ay |
| B3 | Dönüşüm (sitenin amacı) | lead formu / ziyaretçi | hosting export | Aylık | İnsan | < %2 |

### 1.4 Kalite

| # | Metrik | Tanım | Kaynak | Sıklık | Sahip | Karar eşiği |
|---|---|---|---|---|---|---|
| Q1 | Test geçiş oranı | geçen / toplam test | `npm test` CI çıktısı → log | Kod değişiminde | Ajan | < %95 |
| Q2 | Hata sayısı (üretim) | benzersiz hata, 7 gün | hata log toplama scripti | Haftalık | Ajan | Haftada > 5 |
| Q3 | Build doğrulama | `npm run validate` exit code | log | Kod değişiminde | Ajan | != 0 |

**Sahip sütunu:** "Ajan" = ölçümü ajan yapar ve haftalık nota satır yazar.
"İnsan" = ölçüm verisi insan tarafından beslenir (LMS API anahtarı yok, manuel).
Kural: **bir KPI'nın sahibi olmayan ölçümü yok sayılır.**

---

## 2. TEK VERİ DEPOSU KARARI — GÖREV DURUMU

| Seçenek | Değerlendirme | Karar |
|---|---|---|
| Hermes `kanban.db` | Hermes şemasına bağlı, şema Hermes sürümüyle kırılır; yedekleme/migration sorumluluğu Hermes'e ait | REDDEDİLDİ |
| Hermes `state.db` | Çok amaçlı karışık durum; 12.6 MB, selektif sorgu riski; bizim KPI sorgularımızla kirlenir | REDDEDİLDİ |
| `shared-state.db` | Paylaşımlı geçici durum; kalıcı kayıt için semantik yok | REDDEDİLDİ |
| Obsidian | Görev durumu için sorgulanabilir DB değil; ayrıca kurulmayacak (Bölüm 3) | REDDEDİLDİ |
| Düz Markdown/dosya | Kanban için atomik güncelleme, kilit, geçmiş yok | REDDEDİLDİ |
| **Kendi SQLite `tasks.db`** | Atomik transaction, tek yazıcı disiplini kolay, WAL ile okuma/yazma ayrımı, git dışı ama yedeklenebilir, sürümden bağımsız | **KABUL** |

### Karar

- **Task state tek sahibi:** `D:\AI\TOZ_AI_OFFICE\data\tasks.db` (yeni SQLite).
- Hermes'in **hiçbir** `.db` dosyasına yazılmaz. Okuma da yok.
- Yazma disiplini: **tek yazıcı** = Hermes ana ajan (delegasyon çalışanları `INSERT`
  yapmaz, ajan çıktısını ana ajana döner).
- Şema sözleşmesi: `tasks`, `task_events`, `metrics_daily`, `cost_ledger`
  (kolon listesi Bölüm 8'de doğrulanacak).
- Ajan çalışma hafızası ile görev durumu **ayrı dosyalarda** tutulur
  (`memory/` klasörü vs `data/tasks.db`).

---

## 3. ŞİRKET HAFIZASI MİMARİSİ — KESİN KARAR

| Katman | İçerik | Tek sahip | Format | Ömür | Yazma aracı |
|---|---|---|---|---|---|
| **A. Ajan çalışma hafızası** | öğrenilen kısa vade notlar | Hermes `MEMORY.md` | Markdown, agentmemory değil | ~30 gün, sonra sıkıştırılır | Hermes kendi memory aracı |
| **B. Kalıcı şirket bilgisi** | sözleşme, müşteri, karar, ADR | **Git deposu, düz Markdown** | `.md` + git | süresiz | Write/Edit + commit |
| **C. Görev/kanban durumu** | görev, durum, sahiplik | **`tasks.db` (SQLite)** | SQL | süresiz | tek yazıcı script |
| **D. Haftalık not** | günlük deneyim → haftalık çıkarım | `memory/weekly/YYYY-Www.md` | Markdown şablon | 24 ay, sonra `archive/` | Cuma cron + insan onayı |
| **E. Gözlem (log/metric)** | ham olay, sayaç | `metrics/` JSONL + `metrics_daily` tablosu | JSONL (günlük) + toplu tablo | JSONL 30 gün, tablo 24 ay | script |

### 3.1 Obsidian kararı

**KURULMAZ.**

Gerekçe:
1. Görev durumu ve KPI sorguları Obsidian'ın güçlü yanı değil; ek maliyet.
2. Hermes'te `obsidian_sync` yok — entegrasyon tamamen elle, yani boş yere
   ikinci bir yazma yolu açılır (Bölüm 6 çift kayıt riski).
3. Obsidian vault = git deposu değil; şirket hafızasının versiyonlanması
   (yani "ne zaman kim ne değiştirdi") zayıflar.
4. İlk yıl bütçe 0: GUI aracı gereksiz; Markdown + git aynı işi bedava yapar.
5. Markdown dosyaları Obsidian'la **açılabilir** (vault = klasör). Yani karar
   geri alınabilir; bu yüzden Obsidian kurmamak **kapıyı kapatmaz**.

`MEMORY.md` vs `agentmemory` seçimi (A katmanı):
**`MEMORY.md` seçildi.** Gerekçe: `agentmemory` MCP sunucusu sağlıksız (health
000) → bu katmanın tek kritik yolu çalışmıyor, üstüne de süreklilik garantisi
vermiyor. `MEMORY.md` dosya tabanlıdır, git ile versiyonlanır, elle okunur,
ajan sürüm güncellemesinde kaybolmaz. `agentmemory` MCP düzelirse B katmanı
olarak eklenebilir; o zaman bile A katmanının sahibi `MEMORY.md` olarak kalır.

### 3.2 Silme / güncelleme kuralları

| Katman | Güncelleme | Silme |
|---|---|---|
| A `MEMORY.md` | üstüne yaz (append), hafta sonunda özet sıkıştırma | girdi yoksa ekleme; 30 günden eski girdi arşiv/sil |
| B şirket bilgisi | `Edit` ile, git commit | **YASAK** — müşteri/sözleşme kaydı silinmez, `status: superseded` |
| C `tasks.db` | durum geçişi + `task_events` satırı | `tasks` satırı silinmez; iptal = `status=cancelled` |
| D haftalık not | yeni hafta = yeni dosya | 24 aydan eski `archive/`; silinmez, yalnız taşınır |
| E JSONL log | aylık toplulaştırma sonrası | 30 gün sonra `.gz`; toplu tablo silinmez |

---

## 4. HAFTALIK RİTİM (Cuma kapanışı)

Zaman: Cuma 17:30 TR (Europe/Istanbul). Hermes cron, 60 dk.

| Adım | Saat | Komut/işlem | Sahip | Çıktı |
|---|---|---|---|---|
| 0. Toplama | 17:30 | `hermes cron run weekly-collect` | Ajan | `metrics/2026-10-09.jsonl` |
| 1. Görev kapama | 17:32 | `UPDATE tasks SET status='done', closed_at=... WHERE status='in_progress'` | Ajan | kapanmış görevler |
| 2. Ajan notları toplama | 17:35 | her görev için `MEMORY.md` girdilerini oku, `[GÖREV#]` etiketiyle grupla | Ajan | taslak not |
| 3. KPI hesap | 17:40 | `sqlite3 tasks.db "SELECT ..."` → `metrics_daily` | Ajan | 14 KPI satırı |
| 4. Eşik kontrolü | 17:42 | eşik aşılan KPI'lar için kural tablosu uygula | Ajan | uyarı listesi |
| 5. Taslak haftalık not | 17:45 | şablona göre yaz → `memory/weekly/2026-W42.draft.md` | Ajan | taslak |
| 6. İnsan onayı | 18:00 | insan taslağı okur, `YENI_ADI.md` olarak onaylar (fail-closed) | İnsan | kesin not |
| 7. Arşiv | onaydan sonra | `.draft.md` silinir, dosya `2026-W42.md` olur | Ajan | kalıcı kayıt |
| 8. B katmanı | onaydan sonra | eşik aşıldıysa ilgili karar/ADR taslağı yaz | Ajan | ADR taslak (insan onaylı) |

**Arşiv/silme kuralı:** haftalık not kalıcıdır, silinmez. 24 aydan eskiyse
`memory/weekly/archive/` altına taşınır. Ham JSONL 30 gün, `metrics_daily` 24 ay.

**PowerShell ile doğrulanabilir iskelet (yol `[DOĞRULANMADI]` yer tutucu):**

```powershell
# Haftalık kapama - insan onaylı adım
$root = 'D:\AI\TOZ_AI_OFFICE'
$stamp = Get-Date -Format 'yyyy-MM-dd'
$draft = Join-Path $root "memory\weekly\$stamp.draft.md"
# 1) JSONL'i toplulaştır
Get-Content (Join-Path $root "metrics\$stamp.jsonl") | ConvertFrom-Json |
  Group-Object metric | ForEach-Object {
    [PSCustomObject]@{ date=$stamp; metric=$_.Name; value=($_.Group.value | Measure-Object -Sum).Sum }
  } | Export-Csv (Join-Path $root "metrics\$stamp.rollup.csv") -NoTypeInformation -Encoding UTF8
# 2) taslak notu üret
if (-not (Test-Path $draft)) { "Raporlanacak veri yok." | Out-File $draft -Encoding UTF8 }
# 3) onay bekleniyor - dosyayi yazma
Write-Host "Bekliyor: $draft"
```

Not: PowerShell 5.1 `Out-File -Encoding UTF8` BOM yazar; haftalık not
Markdown'da sorun değil ama `git diff` gürültüsü yapıyorsa
`[System.IO.File]::WriteAllText($p,$s,[System.Text.Encoding]::UTF8)` kullanılır.

---

## 5. AJAN ÖĞRENME DÖNGÜSÜ

### 5.1 Akış

| Adım | Araç | Dosya | Format |
|---|---|---|---|
| Çalışma sırasında | Hermes memory aracı | `MEMORY.md` | `- [GÖREV#id] <tek cümle öğrenme>` |
| Görev kapanışında | `Edit` (append) | `MEMORY.md` | aynı satır + tarih |
| Cuma 17:35 | `Read` + gruplama | → taslak haftalık not | `- **Öğrenme:** ... [GÖREV#id]` |
| Cuma onayı | `Edit` | `memory/weekly/YYYY-Www.md` | kalıcı |
| Ayda 1 | `Edit` | `MEMORY.md` sıkıştırma | sadece kalıcı çıkarımlar |

### 5.2 `memory.write_approval=False` yönetimi

Risk: ajan `MEMORY.md`'ye istediğini yazabilir → hataya/yabancı kaynağa
kalıcı yerleşir.

| Önlem | Uygulama |
|---|---|
| Format zorlaması | Yazım yalnız `- [GÖREV#<id>] ` prefiksi ile. Uymayan satır script ile tespit edilir ve `invalid` sayılır. |
| Boyut sınırı | `MEMORY.md` > 200 KB ise yazım reddedilir, haftalık arşiv tetiklenir. |
| Ayıklama | `task_events` tablosundaki görev ID ile `[GÖREV#id]` eşleşmezse girdi `[DOĞRULANMADI]` işaretlenir ve haftalık nota **girer**, `MEMORY.md`'ye yazılmaz. |
| Geri alma | `MEMORY.md` git'te. Her Cuma sonrası otomatik commit; kötü girdi `git revert` ile geri alınır. |
| Zehirlilik | Dışarıdan gelen metin (web, müşteri e-postası) `MEMORY.md`'ye **asla** otomatik yazılmaz; yalnız haftalık notta `[DOGRULANMADI]` ile görünür. |
| Fail-closed | Haftalık not `.draft` aşamasında insan onayı olmadan `.md` adı alamaz. |

**Ajanın haftalık nota aktarımı tek yazma yoludur.** `MEMORY.md` ajanın kendi
çalışma defteridir; şirket hafızası (B) ve haftalık çıkarım (D) insan onaylıdır.

---

## 6. VERİ KALİTESİ KURALLARI (10 kural)

| # | Kural | Uygulama | İhlal cezası |
|---|---|---|---|
| V1 | Kayıt zorunluluğu | Her `task_events` satırı `task_id`, `ts`, `actor`, `source` içermeli; eksikse satır yazılmaz | satır düşürülür |
| V2 | Çift kayıt yasağı | `(task_id, status, ts_saniye)` UNIQUE; tekrar INSERT sessizce yutulmaz | UNIQUE ihlali loglanır |
| V3 | Silme yasağı | `tasks`, `task_events`, `metrics_daily` üzerinde `DELETE` yok; `ON DELETE RESTRICT` | sorgu reddedilir |
| V4 | Kaynak güvenilirliği | Her satırda `source ∈ {cron, manual, agent, external}`; `manual` ve `external` insan doğrulaması bekler | `verified=0` |
| V5 | `[DOĞRULANMADI]` işaretleme | Doğrulanmamış metin ölçüme girmez; rapor satırının başında görünür | KPI hesaplanmaz |
| V6 | Tek yazıcı | `tasks.db`'ye yalnız `hermes cron` ve tek senaryo yazar; delegasyon çalışanı yazamaz | çalışan hata ile durur |
| V7 | Geriye dönük düzeltme | Yanlış kayıt `UPDATE ... SET note='correction'` + yeni satır; eski satır korunur | geçmiş silinmez |
| V8 | Zaman damgası | UTC saklanır (`ts_utc`), raporda TR'ye çevrilir; saat dilimi karışmaz | — |
| V9 | Boş değer yasağı | Sayısal metrik alanı NULL olamaz; veri yoksa satır hiç yazılmaz (0 yazılmaz) | — |
| V10 | Haftalık bütünlük | Hafta kapanışında 14 KPI için `measured` veya `[DOĞRULANMADI]` zorunlu | rapor eksik satır basmaz |

Ek kural (V11): ölçüm tanımı değişirse KPI sürüm numarası alır
(`O1@v1`, `O1@v2`); geçmiş veri yeniden hesaplanmaz.

---

## 7. AYLIK MALİYET ÖLÇÜMÜ (0 TL bütçe dahil)

| Maliyet kalemi | Kaynak | Araç | Sıklık | Not |
|---|---|---|---|---|
| LLM token (yerel model) | model sunucusu logu | `metrics/tokens.csv` | haftalık | maliyet 0, kullanım izlenir |
| LLM token (API) | sağlayıcı kullanım sayfası | manuel giriş `cost_ledger` | aylık | ücretsiz katman dahil sayaç |
| MCP çağrı sayısı | codebase-memory log | `metrics/mcp.csv` | haftalık | ücretsiz, izlenir |
| Web scraping | Firecrawl ücretsiz kredi | manuel `cost_ledger` | aylık | kalan kredi görünür |
| Hosting / alan ad | fatura | `cost_ledger` | aylık | sabit gider |
| Electricity / VPN | yok sayılır | — | — | 0 bütçe varsayımı |

`cost_ledger` kolonları: `period, provider, tier(free|paid), units, unit_cost,
total_cost, currency, source_url, [DOĞRULANMADI]`.

**Kural:** ücretsiz katman da `units` olarak yazılır; `total_cost = 0` olsa bile
satır silinmez. "Ücretsiz" belirsizse `[DOĞRULANMADI]`.
Aylık `Birim Maliyet` = toplam maliyet / üretilen iş (teslim edilen görev).

---

## 8. UYGULAMA ÖNCESİ DOĞRULAMA LİSTESİ

| # | Kontrol | Komut | Sonuç beklenen |
|---|---|---|---|
| 1 | Hermes DB konumları | `Get-ChildItem <hermes-home> -Recurse -Filter *.db` | state/kanban/shared yolları |
| 2 | agentmemory sağlık | MCP health çağrısı | 000 mi 200 mü |
| 3 | MEMORY.md var mı | `Test-Path` | yol + boyut |
| 4 | Obsidian yok mu | `Get-Command obsidian -ErrorAction SilentlyContinue` | null |
| 5 | codebase-memory index | `index_status` çağrısı | node sayısı |
| 6 | Zaman dilimi | `Get-TimeZone` | `Europe/Istanbul` mi |
| 7 | sqlite3 var mı | `sqlite3 --version` | sürüm |

Bu yedi kontrol yapılmadan `tasks.db` şeması sabitlenmez.

---

## 9. AÇIK KARARLAR (bilinçli olarak ertelendi)

| Konu | Neden ertelendi |
|---|---|
| `shared-state.db` kullanımı | Konumu doğrulanamadı |
| Görev geçmişinin `state.db`'ye yazılması | Şema sahipliği Hermes'te kalıyor |
| Manuel ölçüm (B1/B2/B3) otomasyonu | Analytics erişimi yok |
| `agentmemory` MCP'nin B katmanı olması | Sunucu sağlıksız |
| Haftalık not arşivleme hedefi (bulut / lokal) | Bütçe kararı bekliyor |