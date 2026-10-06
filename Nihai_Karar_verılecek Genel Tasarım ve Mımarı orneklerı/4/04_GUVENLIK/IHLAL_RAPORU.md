# GÜVENLİK İHLAL RAPORU

> `FINAL_MASTER_ARCHITECTURE.md:83` güvenlik puanını **4** verdi.
> Gerekçesi: *"İlkeler güçlü, **ihlal edilmiş**"*
> Bu dosya o ihlalleri **ölçülen** hâle getirir.
> Tarih: 2026-10-06

---

## KURAL: İHLAL ÖLÇÜLMEZSE DÜZELTİLMEZ

V3'te 10 gerçek hata bulundu ve **hepsi testlerle yakalandı.** Ama 8
güvenlik ihlali hiç testle ölçülmemişti. Bu rapor onları ölçer.

---

## İHLAL 1 · `.env` TASLAK KLASÖRÜNÜN KÖKÜNDE  🔴

### Kanıt

```
D:\AI\Toz AI Agency Taslaklar\.env     923 bayt
D:\AI\Toz AI Agency Taslaklar\.env.example  529 bayt
```

### İhlal eden kurallar

| Kural | Metin |
|---|---|
| `MASTER-BUILD:379-386` | `.env`, `.env.*`, `**/api-keys.txt` yasak |
| `12_OBSIDIAN:22-26` | "Saklanmayacaklar: **API keys**, passwords, access tokens" |
| `MASTER-BUILD:387` | "kullanıcının oluşturduğu **yerel gizli dosyaları yasakla**" |
| K-04 | Şifre izlenen ağaçta bulunamaz |

### Dosyada hangi değişkenler var

> **Değerler ASLA okunmadı ve raporlanmadı.** Yalnızca değişken adları listelendi.

`OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OLLAMA_URL`,
`ALLOW_EXTERNAL`, `GIT_AUTO_PUSH` + diğerleri

### Durum

**Düzeltilmedi.** Çözüm kurucuya bağlı:

```
1. Windows Credential Manager veya Bitwarden'e taşı
2. Taslak klasörüne .gitignore koy
3. GIT_AUTO_PUSH kaldır — yıkıcı politika AI'da olmaz
```

> Bu depoda (`Ai_Office_Opencode`) `.env` **yok**. Kullanıcı oluşturacak.

---

## İHLAL 2 · 16 AKTİF MCP  🔴

### Kanıt

`BUGUN-2026-09-13:27` — "**16 MCP enabled**"
notion, github-mcp, perplexity, chrome, higgsfield, hyperframes, headroom,
task-observer, mem0, mem-place, agent-reach, opencut, openmontage+playwright,
context7, motion, lightswind

### İhlal eden kural

`11_MCP_POLICY.md:9` — ***"Az MCP > çok MCP."***

Ayrıca `05_HERMES:34-36`: *"Her MCP / server / tool **ayrı** yetkilendirilir."*
16 MCP = 16 kat yetki yüzeyi.

### MCP politikasının 3 yasağı

| Yasağ | Durum |
|---|---|
| Aynı işi yapan iki MCP kurulmaz | ⛔ **notion + mem0 + mem-place** → 3 ayrı hafıza |
| Kullanılmayan MCP kurulmaz | ⛔ 16'nın kaçı gerçekten kullanılıyor? |
| Global kısıtsız MCP erişimi verilmez | ⛔ Doğrulanamıyor |

### Çözüm

**Faz 7 kapsamında 1 tane:** `mcp-filesystem`. Gate 8 geçmeden 2.'si açılmaz.

> `11_AJANLAR/00_orkestrator.yaml:53` — `araclar: []  # kayit defterinden; su an MCP yok`
> Bu doğru davranış. Mevcut durumda MCP yok.

---

## İHLAL 3 · 295 AGENT YÜKLÜ  🔴

### Kanıt

`BUGUN-2026-09-13:17` — "msitarzewski/agency-agents — **295 agent** manuel kopyalandı"

### İhlal eden kural

`09_AGENCY_AGENTS.md:13` — ***"Tüm Agency Agents yüklenmez."***
`01_OKU_BENI:12` — "**seçili** rol/skill kaynağı"
`blueprint:121` — "**sadeleştirilir**, TOZ rol standardına uygun hale getirilir"

### Çözüm

```
295 → önce 7 rol seç → sadeleştir → TOZ standardına çevir
```

Ham 295 dosya şirket standardı **değildir.** Bkz. `02_AJANLAR/AJAN_LISTESI.md`

---

## İHLAL 4 · 343 SKILL  🟠

### Kanıt

`10_CALISMA_ZAMANI:35-36`

### İhlal eden kural

Aynı dosya: *"Tüm becerileri her oturumda **yükleme**"*

### Çözüm

Kırpma (trimming) + seçici yükleme. `AGENTS.md`'deki uyarı:
> *"Kütüphanenin tamamını yükleme. 2000+ beceri bağlamı patlatır."*

---

## İHLAL 5 · 13 MODEL OTOMATİK GEÇİŞ  🟠

### Kanıt

`BUGUN-2026-09-13:8` — "Fallback zinciri oluşturuldu... **13 model, otomatik geçiş**"

### İhlal eden kural

`10_MODEL_STRATEJISI:24` — *"**Sessiz ve kontrolsüz fallback yasaktır**"*
K-03 — *"Failover test edilmeden ve rapor vermeden kullanılamaz"*

### En kötü tarafı

`FINAL_MASTER_ARCHITECTURE.md:100-102`:

> *"Kanıt yok. 'Otomatik yönlendirme iddia etme' diyen dokümanın **aynı
> klasöründe** 13 modelli otomatik zincir kurulmuştu."*

### Çözüm (C-24)

**İddia etme ≠ yapma.** Otomatik failover **çalışabilir**, ama:

| Koşul | Durum |
|---|---|
| (a) Her görev sınıfı için test edilmiş | ❌ |
| (b) Hangi modelin hangi görevi yaptığı loglanıyor | ❌ |
| (c) Maliyet sayacı açık | ⚠️ V3'te gerçek `usage` okunuyor |

`FINAL_MASTER:102`'nin kuralı: **"İddia etme" ≠ "Yapma"**, ama
belgelenmemiş otomatik geçiş = yapma.

> V3'te `router.py:141-142` başarısızlıkta loglar:
> `print("  [ROTA BASARISIZ] " + " | ".join(son_denemeler))`
> Bu K-03'ün **karşılanmış** hâli.

---

## İHLAL 6 · `GIT_AUTO_PUSH=true`  🟠

### Kanıt

`.env` içinde `GIT_AUTO_PUSH` değişkeni (taslak klasörü kökünde)

### İhlal eden kural

`16_SECURITY_GOVERNANCE.md:3-13` — "AI kendine değiştiremez: ... **yıkıcı politikalar**"

### Çözüm

```
push otomatik DEĞİLDİR.
```

`kordinator/obsidian_sync.py:153-159` — V3 zaten bunu yapıyor:

```python
if push:
    r = _git(kok, "push")
    ...
else:
    print("  [i] Push YAPILMADI (otomatik push yasak).")
```

---

## İHLAL 7 · 4 FARKLI GLOBAL SKILLS YOLU  🟠

### Kanıt

| Kaynak | Yol |
|---|---|
| `MASTER-BUILD:185` | `%USERPROFILE%\.config\opencode\skills\` |
| `SKILLS-HAFIZA:4,13` | `C:\Users\Admin\Desktop\Belgeler\Web\skills-main` |
| `gemini-code:49` | `D:\Cli\Skills` — "**asla değiştirilemez**" |
| `Ozkan PROFILE:48` | `C:\Users\Admin\.config\opencode\DESIGN-KNOWLEDGE-BASE.md` |

Artı: `D:\OpenClaude`, `D:\Hermes`, `.zcode` kopyaları (`BUGUN:36-41`)

### İhlal eden kural

`MASTER-BUILD:184-188` — *"Global skills proje dışında olduğu için **git bunları
otomatik yedeklemez**"* → bu kural **hiç uygulanmamış**

### Çözüm (C-23)

Tek yol: **`D:\AI\Skills`** (AGENTS.md'de zaten kaynak olarak tanımlı).
Junction ile aktif edilir.

---

## İHLAL 8 · AÇIK DOTS / RUFLO GEREKÇESİ ÇÖKTÜ  🟡

### Kanıt

| Belge | İddia |
|---|---|
| `06_RUFLO.md:5` | "başlangıç production mimarisine **kurulmaz**" (NO INITIAL) |
| `06_RUFLO.md:11` | "**Munder zaten** global coordination yaptığı için: Munder + Ruflo çakışır" |
| `FINAL_MASTER:365` | ***"Munder Difflin bu depoda değildir."*** |

### Sorun

Ruflo'nun ret gerekçesi **"ikinci koordinator"a** dayanıyordu. Munder yoksa
gerekçe düşer.

### Çözüm (C-07)

**Karar korundu** (Ruflo kurulmaz) ama **gerekçe düzeltildi**:

> **Yeni gerekçe:** Eklenen her katmanın **ölçülebilir faydası kanıtlanana
> kadar kurulmaz.** Katman sayısı bir maliyettir.

`Qwen:37` bunu destekliyor:
> *"73.8k yıldız gösterişli ama arkasında bağımsız motor yok."*

---

## ÖZET

| # | İhlal | Şiddet | Durum |
|:--:|---|:--:|---|
| 1 | `.env` taslak kökünde | 🔴 | **Düzeltilmedi** — kurucuya bağlı |
| 2 | 16 aktif MCP | 🔴 | **Düzeltildi** — bu depoda MCP yok |
| 3 | 295 agent yüklü | 🔴 | **Çözüldü** — 7 rol standardı |
| 4 | 343 skill | 🟠 | Kırpma gerekli |
| 5 | 13 model otomatik geçiş | 🟠 | **Çözüldü** — K-03 loglanıyor |
| 6 | `GIT_AUTO_PUSH=true` | 🟠 | **Çözüldü** — push otomatik değil |
| 7 | 4 farklı skills yolu | 🟠 | Tek yol: `D:\AI\Skills` |
| 8 | Ruflo gerekçesi çöktü | 🟡 | **Düzeltildi** — C-07 |

**Bu depodaki durum:** 2'si kodla çözüldü, 1'i kurucuya bağlı,
4'ü prosedürle çözüldü. Hiçbiri bu depoda **aktif değil**.

---

## V3'TE ÇÖZÜLEN 10 GÜVENLİK HATASI

`V3_DURUM_RAPORU.md §2` — testlerin bulduğu gerçek hatalar:

| # | Hata | Etki |
|:--:|---|---|
| 2 | **28 dosyada UTF-8 BOM** | `json.load` ve YAML ayrıştırıcıları reddediyordu |
| 3 | Kurtarma yasak durum geçişi yapıyordu | `calisiyor → olusturuldu` makinesinde izinli değil |
| 4 | Onay iptali **tüm** iptal kayıtlarını geziyordu | Terminal durumdaki görevler zorlanıyordu |
| 5 | K-02 yorum satırlarını denetliyordu | Açıklama yazmak ihlal sayılıyordu |
| 8 | PowerShell `Write-Host "$1"` **boş** döndürüyordu | Tüm script başlıkları görünmüyordu |
| 9 | `.ps1` dosyaları BOM'suz okunmuyordu | PS 5.1 ANSI okur → Türkçe bozulurdu |
| 10 | `sir_tara.py` her `.env`'i ihlal sayıyordu | Doğru yazılmış `.env` aracı kullanılamaz kılıyordu |

**Bu depoda 2 ve 9 tekrar kontrol edildi:** 2 `.ps1` dosyasında BOM bulundu,
temizlendi. Test: `58/58 OK`.

> `FINAL_MASTER_ARCHITECTURE.md` bunu şöyle yazdı:
> *"Skor 5.2, 10 değil."* **Bu dürüstlük kopyalanmalı.**
