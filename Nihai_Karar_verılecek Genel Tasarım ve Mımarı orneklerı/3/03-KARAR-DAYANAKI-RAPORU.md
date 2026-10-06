# TOZ AI GROUP — KARAR DAYANAĞI RAPORU

> Bu belge **ne yaptığımızı, neyi iptal ettiğimizi, neyi sisteme dahil etmediğimizi,
> neyi hatalı gördüğümüzü, neyi seçtiğimizi, neyi değiştirdiğimizi ve NEDEN'ini**
> kayda geçirir.
> **Tarih:** 6 Ekim 2026 · **Çalışma:** Nihai mimari kararı · **Yürütücü:** OpenCode

---

## 1. BU ÇALIŞMADA NE YAPTIK

### 1.1 Okunan kaynaklar

| Ne | Kaç | Nerede |
|---|---|---|
| Taslak klasör | 8 (`Draft_0` … `Draft_7`) | `C:\Users\TozSolutions\Desktop\Toz_Ai_Office_Drafts` |
| Taslak belge | 1 (`Draft_8.md`, 1413 satır) | aynı |
| Audit raporu | 2 (Hermes 577 satır, OpenCode 338 satır) | aynı |
| Kurucu bağlam belgesi | 1 | aynı |
| **Toplam dosya** | **~260** (`.pyc` ve `kuyruk.db` hariç) | |
| Uzman ajan çıktısı | 8 (3 analiz + 5 uzman) | `_ajan-ciktilari/` |
| **Bu çalışmada üretilen belge** | **4** + 8 ajan çıktısı | `Nihai Karar\OpenCode\` |

### 1.2 Yapılan ölçümler (tahmin değil)

```
opencode --version                    → 1.18.32
D:\AI\npm-global\opencode.cmd        → 1.18.34   (shadowed)
hermes --version                     → v0.21.5+7331.g6590f13.dirty (2026.9.24)
node/npm/git                         → v24.21.0 / 11.19.0 / 2.55.0
Get-Command opencode -All            → 3 konum
opencode auth list                    → 1 credential (OpenCode Zen)
opencode mcp list                     → codebase-memory ✓ / firecrawl ○
opencode run --model opencode/space-bunny-free "..."  → PERM_TEST_OK   ✔ ÇALIŞIYOR
%LOCALAPPDATA%\hermes\config.yaml    → 201 satır, TAMAMEN OKUNDU
  :199  FİRECRAWL_API_KEY düz metin
  :15-20 security bloğu YORUMDA
  approvals bloğu HİÇ YOK
  :74-97 telegram toolset: terminal + computer_use + file + delegation AÇIK
%LOCALAPPDATA%\hermes\.env            → TELEGRAM_BOT_TOKEN (46 krkt, gerçek)
%LOCALAPPDATA%\hermes\state.db       → 15.8 MB + WAL 4.2 MB
~\.config\opencode\opencode.jsonc    → 61 satır, TAMAMEN OKUNDU
Obsidian / Munder / Ruflo / OpenClaw / Open Dots → HİÇBİRİ KURULU DEĞİL
Masaüstü düz metin anahtar dosyaları → YOK (reset sonrası)
RAM / CPU                            → 31.7 GB / i7-1255U
```

### 1.3 Görevlendirilen uzman ajanlar

| # | Uzman | Ne yaptı | Çıktı |
|---|---|---|---|
| R1 | Taslak analisti (1–2) | Draft_1/2 eleştirisi, kodun gerçekten çalışıp çalışmadığı | `R1-draft1-2-analizi.md` |
| R2 | Mimari + güvenlik (3–4) | Draft_3/4, V3 motoru, `.env` incelemesi | `R2-draft3-4-analizi.md` |
| R3 | Mimari (5–8) | Draft_5–8, 1413 satırlık son taslak dahil | `R3-draft5-8-analizi.md` |
| A1 | Araştırmacı | Munder/Ruflo/OpenClaw/Open Dots/Agency Agents — kaynak URL'li | `A1-arastirma-rekabet-sistemleri.md` |
| A2 | SEO + AEO uzmanı | Kurumsal site kodunu okuyup 7 engel buldu, 10 kriter tablosu | `A2-seo-uzmani.md` |
| A3 | Reklam uzmanı | 0 TL kanal haritası, KVKK, 10 kriter tablosu | `A3-reklam-uzmani.md` |
| A4 | Ürün & marka yöneticisi | 8 hizmet, 3 paket, 9 iş birimi → 7 ajan eşlemesi | `A4-urun-marka-yoneticisi.md` |
| A5 | Veri analisti | 14 KPI, hafıza mimarisi kesin kararı, Cuma ritmi | `A5-veri-analisti.md` |
| A6 | Platform mühendisi | Worker protokolü, 8 adımlı kurulum, anahtar rotasyonu | `A6-muhendis-platform-protokol.md` |
| A7 | Güvenlik mühendisi | Kaynak koddan varsayılan doğrulama, 12+ risk, 20 kapı | `A7-guvenlik-muhendisi.md` |

**Toplam:** 10 ajan, 10 çıktı dosyası, hepsi `_ajan-ciktilari\` altında.

### 1.4 Çıktı denetimi (her ajan çıktısı kontrol edildi)

| Denetim | Ne yapıldı | Sonuç |
|---|---|---|
| Uydurma sayı/URL var mı | Her rapor `[DOĞRULANMADI]` işareti zorunlu tutuldu | 10 raporda toplam ~35 `[DOĞRULANMADI]` işareti |
| Ajanlar birbiriyle çelişiyor mu | 3 kritik çelişki bulundu ve **lehine karar verildi** (aşağıda §5) | 3/3 çözüldü |
| Kırılmaz kullanıcı kararlarına aykırı mı | Claude Code/CCR öneren hiçbir ajan çıktısı kabul edilmedi | 1 ajan (R1) taslaktaki öneriyi raporladı, **reddedildi** |
| Gereksiz sistem öneriyor mu | 5 aday sistemin 3'ü elendi | Munder, Ruflo, Open Dots **çıkarıldı** |

---

## 2. İPTAL ETTİĞİMİZ KARARLAR (ve neden)

### 2.1 Önceki turun brifinginden iptaller

`Nihai Karar\Hermes\00_GOREV-BRIEFING.md` dosyasında önceki oturumun kararları vardı.
Bazıları bu çalışmada **iptal edildi:**

| Önceki brifing kararı | Bu çalışmadaki karar | İptal gerekçesi |
|---|---|---|
| "Hermes sürüm: **vunknown**" | Gerçek: **v0.21.5+7331** | Önceki ölçüm hatalıydı; `hermes --version` artık sürüm veriyor |
| "Munder kurulu değil → kurmayı değerlendir" | **Munder tamamen çıkarıldı** | A1 araştırması + çakışma analizi sonucu |
| "OpenCode (gölgelenmiş) 1.18.34" | Doğru, ama **müdahalesiz çözüm** benimsendi | PATH değişikliği riski; `$Oc` sabit yolu daha sade |
| "Hermes MCP: firecrawl 32 araç **aktif**" | **Beklemeye alındı** | API anahtarı gerekiyor, 0 TL bütçe var; anahtar düz metin sızıntısı |
| "Hermes bellek: agentmemory provider" | **Kaldırıldı** | Sunucu health 000; `write_approval=False` |
| "10 ajan görevlendir" (A1–A10) | **7 ajan** benimsendi | Boşta çalışan ajan yasak; 10 ajanın 3'ünün işi yok |
| "Obsidian ikinci beyin" | **Kurulmaz** | Vault = klasör; `obsidian_sync` Hermes'te yok |
| "Nihai karar Hermes + Munder + diğerleri" | **Yalnız Hermes + OpenCode + Agency Agents** | 10 kriter ve çakışma analizi |

### 2.2 Taslaklardan iptal edilen kararlar

| İptal | Neden |
|---|---|
| KoordinatörÇekirdeği (Python beyin) | Hermes aynı işi yapıyor + **motor çalışmıyor** |
| V3 motoru (Draft_4) | `worker.py:114` AttributeError, `:177` geçersiz geçiş → hiçbir iş tamamlanamıyor |
| Ruflo / claude-flow | Claude Code'a bağlı → kırılmaz karar ihlali |
| Open Dots | Kendi README'si "prototype, üretime hazır değil" |
| OpenCode `F3_orchestrator` | 9 satırlık stub; çift beyin |
| `agentmemory` MCP | Ölü sunucu (health 000) |
| OpenCode `firecrawl` MCP | `enabled:false` + ölü tanım |
| Obsidian | Harici uygulama değer katmıyor |
| AnythingLLM | İkinci veri tabanı + ikinci arayüz |
| LiteLLM / OmniRoute | Çift router |
| 4'lü/5'li bellek katmanı | Tek katman: `MEMORY.md` + git |
| 5 farklı task-state mekanizması | Tek: `tasks.db` |
| 11 ajanlık kadro | 7 ajan |
| Programatik SEO / toplu AI içerik | Google spam politikası |
| Backlink satın alma | 0 TL bütçe |
| Gözlem (log) tabanlı haftalık ritim | Ölçüm tabanlı |

---

## 3. SİSTEME DAHİL ETMEDİĞİMİZ ŞEYLER (ve neden)

| Dahil etmedik | Neden | Ne zaman gerekir |
|---|---|---|
| **Munder** | Kendi orkestrator/router/hafızası → izin çakışması en yüksek. 186 MB Electron. Ticari katkısı yok. | Hiçbir koşulda v1'de |
| **Ruflo** | Claude Code'a bağlı → kullanıcı kararı ihlali | Hiçbir koşulda |
| **Open Dots** | Prototype; ikinci orkestrator + ikinci onay | Hiçbir koşulda |
| **OpenClaw** | Hermes'te Telegram zaten var → ikinci kanal ikinci risk yüzeyi | Müşteri WhatsApp/Slack kanalı talebi gelirse **izole pilot** |
| **Obsidian** | Vault bir klasör; harici uygulama değer katmıyor | Klasör ileride Obsidian ile açılabilir (geri alınabilir) |
| **Agentmemory MCP** | Sunucu ölü, yazma onaysız | Sunucu sağlıklı olursa yeniden değerlendirilir |
| **Firecrawl MCP (OpenCode)** | Ölü tanım | — |
| **Firecrawl MCP (Hermes)** | Ücretsiz katman yok, anahtar gerekiyor | Bütçe doğarsa |
| **Yeni yerel model (Ollama vb.)** | 31.7 GB RAM var ama i7-1255U **entegre GPU** → kaliteye göre yavaş; 0 TL için bedava bulut modelleri yeterli | Kod gizliliği zorunlu olursa |
| **GitHub Actions / CI** | Tek geliştirici, tek repo; karmaşıklık | Ekip büyürse |
| **Docker / WSL** | Hermes native Windows'ta çalışıyor; ihtiyaç yok | Hiçbir koşulda |
| **Çoklu dil desteği** | Tek dönem ekibi (Özkan) | Yeni ajan alınırsa |
| **Kapsamlı KPI panosu / dashboard** | 14 KPI tek dosyada ölçülebiliyor | 10+ metrik olursa |
| **Ajans (3B sanal ofis)** | A3 reklam uzmanı: "yol haritası dışı — gelir getirmez" | Gelir geldikten sonra |

---

## 4. HALALI GÖRDÜĞÜMÜZ ŞEYLER (yanlış olan tespitler)

Bu, "dosyaların hiçbirini doğru kabul etme" kuralının sonucudur. **6 bulgu:**

### 4.1 Audit raporlarının yanlış tespitleri

| # | İddia | Gerçek | Nasıl anlaşıldı |
|---|---|---|---|
| 1 | "`security` bloğu pasif → sır maskeleme ve tirith **kapalı**" | **Yanlış.** `redact_secrets` ve `tirith_enabled` kaynak kodda **default `True`**. Yorum satırı olmaları kapatmaz. | A7 `config_defaults.py` okudu (`:1793`) |
| 2 | "`firecrawl_interact` canlı tarayıcı form gönderimi yapar" | **Kanıtsız.** Kaynak kodda bulunamadı. | A7 kaynak taraması |
| 3 | "`opencode` PATH'ta değil" | **Yanlış.** PATH'ta 2. sırada. | `Get-Command opencode -All` |
| 4 | "Munder = sadece görsel ofis" | **Yanlış.** `approvals queue`, `per-agent budget`, `circuit breaker` README'de var — bunlar kontrol mantığı. | A1 kaynak taraması |
| 5 | "10 güvenlik testinin 4'ü başarısız, 5'i yapılmamış" — yani "Production **hazır değir**" | **Doğru** bulgu, yanlış çerçeve: Bu bizim auditimiz değil, bizim **P0 listemiz**. | — |

### 4.2 Taslakların kendi iddialarının yanlış olması

| # | İddia | Gerçek |
|---|---|---|
| 1 | Draft_1 README: "**106 test yeşil**" | **104/106.** `test_anayasa_ihlalleri.py:205,216` sabit `D:\` yoluna bağlı → geçemez. Faz 2 kapısı hiç kapanmaz. Ayrıca JSONL kuyruk yazılıp **hiç okunmuyor** (Kapi 7 sahte). |
| 2 | Draft_4: "**58/58 test PASS**" | Doğru **ama** testler görev tamamlama yolunu kapsamıyor. `worker.py:114` AttributeError, `:177` geçersiz durum geçişi → sistem hiçbir işi bitiremiyor. |
| 3 | Draft_4: "V3'te 7 ilkenin 7'si kodda" | İlke doğru, **uygulama eksik** — `worker.py` iki ayrı yerden çöküyor. |
| 4 | Draft_5: "106/106 yeşil" | Aynı Draft_1 hatasının kopyası |
| 5 | Draft_8: "Risk kaydı: üç orkestratör riski var" | Eksik sayıyor: **5 task-state mekanizması** + **2 durum makinesi** (11 vs 16 durum) |
| 6 | Draft_8: "Munder, Ruflo, Agency Agents, Obsidian, MCP ve 3D ofis **hiç geçmiyor**" | Doğru — ve **gerekçe de yazılmamış**. Sessiz eleme de elemedir; taslak kendi K5 ilkesini ihlal ediyor. |
| 7 | Draft_2: Obsidian = ikinci beyin | **Draft_1 ADR-0003 bunu açıkça yasaklıyor.** Taslak kendi ADR'ini ihlal ediyor. |

### 4.3 Yanlış olduğu tespit edip **düzeltmediğimiz** şeyler (bilinçli)

| Konu | Neden düzeltmedik |
|---|---|
| Draft_1–8 kodundaki 2 test hatası | Bu kod **üretime alınmıyor**. Düzeltmek, kullanılmayan koda yatırım olurdu. |
| Draft_4 `worker.py` hataları | Motor çıkarıldı; düzeltme değer üretmez. |
| Draft_1 `baglam_muhru` totolojik doğrulama | Aynı gerekçe. |

> **Gerekçe:** "Kurulduktan sonra sürekli söküp yeniden tasarlamak zorunda kalacağın bir
> sistem önerme" kuralı. Kullanılmayan kodu düzeltmek, o kodu kalıcılaştırır.

---

## 5. SEÇİKLERİMİZ (çelişkileri nasıl çözdük)

Ajanlar ve taslaklar **birbirinden farklı sonuçlara** vardı. Her çelişkide bir seçim
yaptık:

### Çelişki 1 — "Güvenlik bloğu kapalı mı, açık mı?"

| Kaynak | İddia |
|---|---|
| Önceki audit | `security` yorumda → kontroller **kapalı** |
| A7 (kaynak kod) | Default'ta **açık** (`True`), ama `tirith` binary **yok** + `fail_open: True` → **fiilen çalışmıyor** |

**Seçim:** A7. Gerçek sorun "kontrol kapalı" değil, **"kontrol var ama etkisiz"**.
Düzeltme `security` bloğunu açmak değil, `tirith_fail_open: false` + binary kurmak.
*Bu ayrım önemli: yanlış teşhis, yanlış düzeltme yapırdı.*

### Çelişki 2 — "Görev durumu nerede?"

| Kaynak | İddia |
|---|---|
| Draft_1 | JSONL kuyruk |
| Draft_3 | SQLite'yi **açıkça reddetti** (`MIMARI.md:150-152`) |
| Draft_4 | SQLite kurdu (`kuyruk.db` mevcut) |
| Draft_5 | JSONL + `gorev.json` |
| Draft_6/7 | Hermes kanban / cron |
| A5 | **Kendi SQLite `tasks.db`'si** |

**Seçim:** A5. Gerekçe: (a) Hermes'in `kanban.db`/`state.db` şeması **Hermes'e ait** —
yazma disiplini elimizde değil, sürüm güncellemesi şemayı bozabilir; (b) `tasks.db`
üzerinde tam kontrol; (c) JSONL eşzamanlı yazmada çakışır.
*Draft_3'ün reddi **ilkesel** değil, o anki SQLite motorunun kırık olmasıydı.*

### Çelişki 3 — "Obsidian kurulsun mu?"

| Kaynak | İddia |
|---|---|
| Draft_3/5/6/7 | "İkinci beyin" |
| Draft_5 | **Tamamen sildi** (gerekçesiz) |
| Draft_8 | Yok (0 kelime, gerekçesiz) — yerine **AnythingLLM** |
| A5 | **Kurulmaz**; vault = klasör; geri alınabilir |

**Seçim:** A5 + gerekçe. *Draft_5'in sildiği karar doğruydu ama **gerekçesiz** —
gerekçesiz karar, altı ay sonra "acaba neden kaldırmıştık?" sorusuna cevap
veremez.*

### Çelişki 4 — "Ajan sayısı kaç?"

| Kaynak | Sayı |
|---|---|
| Draft_3 | 8 aktif + 282 pasif |
| Draft_4 | 43 |
| Draft_7 | 11 |
| Draft_8 | 10 |
| A4 | **7 aktif**, 2'si `active: false` |

**Seçim:** A4. *Sayı tartışması değil, **boşta çalışma** tartışmasıydı. 11 ajandan
4'ünün (`Hukuk`, `Kalite`, `Sekreterya`, `Arşiv`) şirketin bugünkü faaliyetinde
karşılığı yok — kriter 10.*

### Çelişki 5 — "Munder ne işe yarar?"

| Kaynak | İddia |
|---|---|
| Önceki audit | "Munder = sadece görsel" (6/10 model) |
| A1 (README) | `approvals queue`, `per-agent budget`, `circuit breaker` **var** |
| Hermes audit | "Model C en doğru kağıt üstü ama en pahalı ve en kırılgan" (5/10) |
| A3 (reklam) | "Ajans 3B ofis — gelir getirmez" |

**Seçim:** **Tamamen çıkar.** *Kritik nokta: Munder'ın gerçek yetenekleri
(approvals queue, circuit breaker, token bütçesi) **UI değil, kontrol mantığı** —
yani "sadece görsel" konumu onu anlamsızlaştırırdı. Ama bu kontrol mantığı
**zaten Hermes'in `approvals` altyapısıyla çakışıyor**. Kullanıcı basit sistem
istiyor; ikinci kontrol düzlemi kazanç değil yük.*

### Çelişki 6 — "Kim beyin?"

| Kaynak | İddia |
|---|---|
| Draft_1 | `KoordinatorÇekirdeği` (kendi Python) |
| Draft_2 | Hermes |
| Draft_3 | Hermes (kullanıcının kendi oturumu) |
| Draft_4 | Kendi Python motoru |
| Draft_7 | Munder |
| OpenCode audit | "C) Global orchestrator **önerilmez**" (F3 stub, tek provider) |
| Hermes audit | "D modeli en yüksek puanlı (8/10)" |

**Seçim:** **Hermes.** *Her iki audit de aynı yere işaret etti: OpenCode'un
orkestrasyon yeteneği yok, Hermes'in ölçülebilir yetenekleri var. "Ölçülebilir
yetenekli olan kazanır" kuralıyla tartışma bitti.*

---

## 6. DEĞİŞTİRDİĞİMİZ ŞEYLER (ve neden)

| Değişiklik | Eski hâl | Yeni hâl | Neden | Nerede |
|---|---|---|---|---|
| Ajan kadrosu | 8–11 ajan | **7 etkin + 2 pasif** | Boşta çalışan ajan = maliyet + karmaşa | `10_AJANLAR/` |
| Görev durumu | 5 mekanizma | **1 SQLite `tasks.db`** | Tek doğruluk kaynağı | `20_VERI/` |
| Bellek | 4 katman | **1 katman (`MEMORY.md`) + `sirket/`** | `agentmemory` sunucusu ölü | `30_HAFIZA/` |
| Ajan yetki modeli | Model bazlı (`Model: anthropic/...`) | **Yetki bazlı** | Model değişince rol bozulmaz | `10_AJANLAR/00-kadro-tanimlari.yaml` |
| Prompt injection koruması | Draft_4'te **yoktu** | **Geri getirildi** | Sessiz güvenlik regresyonu | `50_GUVENLIK/` |
| Silme yasağı | Draft_4'te **yoktu** | **Geri getirildi** + `ON DELETE RESTRICT` | Veri kaybı önleme | `50_GUVENLIK/` |
| Token maliyet modeli | Draft_8'de **yoktu** | **Geri getirildi** (Draft_5'ten) | 0 TL bütçe ancak görünür tutulmalı | `20_VERI/olcum.jsonl` |
| Kurulum sırası | 13 faz (Draft_5) | **14 adım**, kapı + rollback ile | Test edilemeyen adım kaldırıldı | `02-KURULUM-KOMUTLARI.md` |
| `external_directory` | `"*": allow` | **`deny` + beyaz liste** | Sınır kavramı yoktu | OpenCode config |
| `bash` varsayılanı | `"*": allow` | **`"*": deny`** | `ask` fail-closed **değildir** | OpenCode config |
| Site dili | `lang="en"` | `lang="tr"` (yayın ön şartı) | TR pazarı | `D:\AI\TozSolutions_Ai_Office` |
| Site canonical | `example.invalid` | Gerçek alan adı | Yayın ön şartı | A2 raporu |

---

## 7. BU ÇALIŞMANIN SINIRLARI ( dürüstçe)

| Sınır | Etki |
|---|---|
| 20 güvenlik/fonksiyon kapısının **7'si hiç test edilmedi** | **"BİLİNMİYOR"** yazıldı, tahmin edilmedi. Kapatılmalı. |
| **8 kapı doğrulanmış olarak BAŞARISIZ** | Production'a hazır değil. Adım 1–3 bunları kapatır. |
| Munder/Ruflo/OpenClaw/Open Dots **kurulu değil, denenmedi** | Değerlendirme kaynak + kriter analiziyle yapıldı, deneme ile değil |
| `firecrawl_interact` davranışı doğrulanamadı | `[DOĞRULANMADI]` |
| OpenCode izin deseni öncelik sırası doğrulanamadı | `"*": deny` kuralı işe yaramayabilir — **kurulum komutlarında test edildi** |
| `${env:VAR}` Hermes config şemasında doğrulanmadı | Alternatif yol (sunucuyu kapat) yazıldı |
| Kurumsal site `npm run validate` **çalıştırılmadı** | Adım 11'de zorunlu |
| Ajan çıktıları birbirini görmedi | Çelişkiler bilinçli olarak bırakıldı → §5'te çözüldü |

> **Bu rapor bir savunma dokümanı değil, bir kayıt dokümanıdır.** Yanlış gördüğümüz
> şeyleri de yazdık. "Hepsi doğruydu" demiyoruz.

---

## 8. ÖNERİLEN SIRADAKİ ADIM

```
1. Bu belgeyi Özkan okusun ve ONAYLASIN / DÜZELTSIN
2. Kurulum ADIM 0 (yedek) → ADIM 1 (sır rotasyonu)
3. Adım 1'den sonra güvenlik kapılarını yeniden ölç
4. G1–G7 yeşil olmadan ADIM 14 (pilot) çalıştırılmaz
```

> **Kural:** Bu çalışma **hiçbir sistem değişikliği yapmadı.** Yalnızca okuma,
> ölçüm ve belge üretimi yapıldı. Hiçbir config, skill, MCP, ajan veya anahtar
> değiştirilmedi. Değişiklikler `02-KURULUM-KOMUTLARI.md`'de **onayınızı bekliyor.**

---

**BELGE SONU — KARAR DAYANAĞI RAPORU**