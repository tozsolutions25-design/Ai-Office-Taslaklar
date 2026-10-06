# TOZ AI GROUP — NİHAİ MİMARİ

> **Karar tarihi:** 6 Ekim 2026
> **Bu belge nihai karardır.** Alternatif açık bırakılmamıştır.
> **Yöntem:** Önce gerçek makine ölçümü → sonra 8 uzman ajan görevi → sonra çıktı
> denetimi → sonra tek karar.
> **Yetki notu:** Bu çalışmanın yürütücüsü **OpenCode**'dur (kullanıcı talebi).
> *Hedef sistemde* beyin **Hermes Agent**'tir. Bu ikisi çelişmez: biri bu projenin
> koordinatörü, diğeri üretilen sistemin çalışma zamanı otoritesidir.

---

## 0. TEK CÜMLELİ KARAR

> **TOZ AI GROUP için kullanılacak sistem budur: Hermes Agent (beyin) + OpenCode
> (uzman işçi) + Agency Agents (iş kadrosu) + düz Markdown/Git (şirket hafızası)
> + tek SQLite `tasks.db` (görev durumu).**

Kullanılmayacaklar: Munder, Ruflo, Open Dots, Claude Code/CCR, Gemini CLI,
Cursor CLI, Antigravity, OpenCode'un kendi orchestrator ajanı (`F3_orchestrator`),
`agentmemory` MCP, OpenCode içindeki `firecrawl` MCP, Obsidian.

Beklemede: OpenClaw (yalnız müşteri WhatsApp/Slack kanalı talebi gelirse, izole pilot).

---

## 1. GERÇEK DURUM RAPORU

Laptop yeniden kurulduğu için **tüm ölçümler bu oturumda yeniden yapıldı.** Audit
raporlarındaki değerler doğrulanmadan kabul edilmedi.

### 1.1 Ölçülen ve doğrulanmış olan

| Öğe | Değer | Nasıl doğrulandı |
|---|---|---|
| OpenCode aktif | **1.18.32** | `opencode.cmd --version` |
| OpenCode gölgelenmiş | **1.18.34** (`D:\AI\npm-global`) | `& "D:\AI\npm-global\opencode.cmd" --version` |
| **OpenCode headless** | **ÇALIŞIYOR** — `PERM_TEST_OK` döndü | `opencode run --model opencode/space-bunny-free "..."` |
| OpenCode credential | 1 adet: OpenCode Zen, 73 model | `opencode auth list` |
| OpenCode fallback | **TANIMLI DEĞİL** | `opencode.jsonc` okundu |
| OpenCode MCP | 2 kayıtlı, 1 bağlı: `codebase-memory` ✓ / `firecrawl` ✗ | `opencode mcp list` |
| codebase-memory indeksi | **BOŞ** (0 proje) | `list_projects` |
| OpenCode ajan | 18 (9'u 9 satırlık **stub**) | `agents/` dizini |
| OpenCode izin | `edit: allow`, `bash: * → allow` (17 `ask`), `external_directory: * → allow` | `opencode.jsonc:26-51` |
| Hermes | **v0.21.5+7331 (2026.9.24)**, native Windows, Python 3.14.7 | `hermes --version` |
| Hermes config | `%LOCALAPPDATA%\hermes\config.yaml` (201 satır) | okundu |
| Hermes modeli | `openrouter` / `nvidia/nemotron-3.5-lightning:free` | `config.yaml:44-46` |
| Hermes fallback | **YOK** (`fallback_model` yorum satırı) | `config.yaml:40-42` |
| Hermes skill | 105 | `hermes skills list` |
| Hermes MCP | 2 sunucu: `agentmemory` + `firecrawl` | `config.yaml:185-201` |
| Hermes plugin | `agency-agents-router` (≈282 ajan kaydı) | `config.yaml:180-182` |
| Hermes `approvals` | **BLOK YOK** → `mode` default, `deny: []` **BOŞ** | `config.yaml` tamamen okundu |
| Hermes `security` | **BLOK YOK** → default değerler | `config.yaml:15-20` yorum |
| Hermes pre-exec tarama | `tirith_fail_open: True` (default) + **tirith binary kurulu değil** → fiilen çalışmıyor | `config_defaults.py:1793` |
| **Hermes sır sızıntısı** | `config.yaml:199` → `FIRECRAWL_API_KEY` **düz metin** | kendi okuma ile teyit |
| **Telegram gateway** | `.env` → `TELEGRAM_BOT_TOKEN` (46 krkt, **gerçek**), `TELEGRAM_ALLOWED_USERS` (1 kişi) | `.env` uzunluk ölçümü |
| Telegram toolset | `terminal`, `file`, `computer_use`, `browser`, `delegation` **AÇIK** | `config.yaml:74-97` |
| Hermes hafıza DB | `state.db` 15.8 MB + WAL 4.2 MB | dosya ölçümü |
| Obsidian / Munder / Ruflo / OpenClaw / Open Dots | **HİÇBİRİ KURULU DEĞİL** | disk + PATH kontrolü |
| Masaüstü düz metin anahtar dosyaları | **YOK** (reset sonrası temiz) | masaüstü taraması |
| Node / npm / Git | v24.21.0 / 11.19.0 / 2.55.0 | `* --version` |
| Ortam | PowerShell 5.1, WSL **yok**, Docker **yok** | `wsl` PATH'te yok |
| Donanım | 31.7 GB RAM · i7-1255U · 12 çekirdek | CIM |

### 1.2 Audit raporlarında **yanlış çıkan** tespitler

Bu, "dosyaların hiçbirini doğru kabul etme" kuralının sonucudur.

| # | Audit iddiası | Gerçek |
|---|---|---|
| 1 | "Hermes'te `security` bloğu yorumda → kontroller **kapalı**" | **Yanlış.** `redact_secrets` ve `tirith_enabled` kaynak kodda **default `True`**. Yorum satırı olmaları onları kapatmaz. Asıl sorun başka: `tirith` binary yok → tarama çalışmıyor. |
| 2 | "`firecrawl_interact` canlı tarayıcı form gönderimi yapar" | **Kanıtsız.** Kaynak kodda `firecrawl_interact` **bulunamadı**. `[DOĞRULANMADI]` |
| 3 | "`opencode` PATH'ta değil" | **Yanlış.** PATH'ta **2. sırada**, `AppData\Roaming\npm` önde. `Get-Command opencode -All` bunu doğruladı. |
| 4 | "Draft_5'te `106/106` test geçiyor" | **Yanlış.** 2 test sabit `D:\` yoluna bağlı → geçemez. Ayrıca JSONL yazılıp hiç okunmuyor. |
| 5 | "`.env` içinde 3 API anahtarı boş" (Draft_4) | Doğru o dökümanda, ama **gerçek** sır Hermes `config.yaml:199` ve `TELEGRAM_BOT_TOKEN`'da. |
| 6 | "Munder sadece görsel ofis" | **Yanlış.** README'de `approvals queue`, `per-agent budget`, `circuit breaker` doğrulandı — bunlar kontrol mantığı, UI değil. |

### 1.3 Bugün gerçekten çalışan ne

**Çalışıyor:** OpenCode headless kod/terminal işleri · Hermes delegasyon, cron, web araçları,
skill'ler · Agency Agents ajan kadrosu · `codebase-memory` MCP (boş index) · git.

**Çalışmıyor / eksik:** Hermes hafıza sunucusu (health 000) · Hermes pre-exec güvenlik taraması
(tirith yok) · Hermes onay listesi (boş) · OpenCode fallback · codebase-memory indeksi ·
kurumsal web sitesi yayına hazır değil (`lang="en"`, `CANONICAL_ORIGIN = example.invalid`).

**Çalışmayan kendi kod:** Draft_4 `worker.py:114` → `kuyruk.muhr_yaz` AttributeError
(metot adı `muhur_yaz`) ve `worker.py:177` → geçersiz durum geçişi. **Sistem hiçbir işi
tamamlayamıyor.** Bu hata Draft_3'te aylar önce kayıtlı (K-004), Draft_4 sadece belgelemiş.
> **Karar:** Bu Python motoru üretime alınmaz. Yeniden yazılması da gerekmez —
> görev durumu ve onay Hermes + tek SQLite ile karşılanır.

---

## 2. ESKİ TASLAKLARIN ELEŞTİRİSİ

Sekiz taslak (Draft_0 … Draft_8) + 2 audit incelendi. Tam liste: `_ajan-ciktilari/R1`, `R2`, `R3`.

### 2.1 Korunan fikirler

| Fikir | Nereden | Neden korundu |
|---|---|---|
| **Tek yazıcı / tek sahip** ilkesi | Draft_1 ADR-0001 | Tüm sorunların kökü bu. Korundu ve mimariye bağlandı. |
| **Rollar modele değil yetkiye bağlı** | Draft_1 ADR-0006 | En değerli fikir. Model değişince rol bozulmaz. |
| **Dokümantasyon karar değildir, kod karardır** | Draft_1 | Her adım bir PASS testine bağlandı. |
| **Ayaklanma kapısı** (her katman test edilmeden devreye girmez) | Draft_1 Faz sistemi | Kurulum sırası bu ilkeye göre yazıldı. |
| **Append-only + silme yasağı** | Draft_3 | Veri analisti `ON DELETE RESTRICT` ile sabitlendi. |
| **Prompt injection kuralları** | Draft_3 | Draft_4'te **kaybolmuştu**; geri getirildi. |
| **İki eksenli yetki matrisi (T0–T4)** | Draft_3 | Mükerrer otoriteyi engelliyor. Korundu. |
| **Fail-closed onay** | Hermes zaten var | Kalıcı ayarlarda zorlanacak. |
| **Prompt injection + sır kontrolü redakte** | Hermes varsayılanı | Korundu. |
| **Bağımsız izolasyon ilkesi** (sökülebilirlik kriteri) | Draft_1 ADR-0005 | Kullanıcının 8. kriteriyle birebir. |

### 2.2 Değiştirilen fikirler

| Fikir | Eski hâli | Yeni hâli | Neden |
|---|---|---|---|
| Beyin | 5 taslak 4 farklı isim seçiyor (Hermes / OpenCode / KoordinatorÇekirdeği / Munder) | **Tek beyin: Hermes** | Tek otoriteliğin seçilmesi bir karardı, ölçüm değil. Ölçüm Hermes'i destekliyor. |
| Görev durumu (task state) | 5 ayrı mekanizma öneriliyor (SQLite, JSONL, Hermes cron, geri bildirim kuyruğu, Approval Gate) + 2 farklı durum makinesi (11 vs 16 durum) | **Tek SQLite `tasks.db`** | 5 mekanizma = 5 doğruluk kaynağı. |
| Memory | 4 katman (Munder hive + agentmemory + `MEMORY.md` + Obsidian) | **Tek katman: `MEMORY.md` + git** | `agentmemory` sunucusu ölü (health 000). Ölü yola bağlamak yanlış. |
| Obsidian | "İkinci beyin" (Draft_3/5/6/7) | **Kurulmaz** | Vault bir klasördür; karar geri alınabilir. Algoritma değil, düz dosya + git yeterli. |
| Kalıcı şirket bilgisi | Obsidian / AnythingLLM / ayrı kayıt sistemi | **Düz Markdown + git** | Üçüncü bağımlılık, sıfır ek değer. |
| Agent kadrosu | 2 / 7 / 8 / 10 / 43 / 282 / 60–150 arası değişiyor | **7 aktif ajan** | Boşta çalışan ajan yasak. 282 ajanın hepsi değil, 7'si etkin. |
| Munder | "3D sanal ofis" / "ops kontrol" / "kabul kuyruğu" | **Tamamen çıkar** | İzin çakışması en yüksek sistem. Kullanıcı sade konumu istiyor. |
| Token maliyeti | Draft_5'te ölçülmüş model; **Draft_8'de tamamen kaybolmuş** | Geri getirildi | 0 TL bütçede bile görünür olmalı. |
| Güvenlik | Draft_4'te prompt injection ve silme yasağı **yok** | Draft_3 kuralları geri getirildi | Sessiz regresyondu. |
| Munder/Obsidian/MCP | Draft_8'de **hiç geçmiyor** (0 kelime), gerekçe yazılmamış | Gerekçeli eleme yazıldı | Sessiz eleme de elemedir; gerekçesi olmalı. |

### 2.3 Tamamen reddedilen fikirler

| Fikir | Red gerekçesi |
|---|---|
| Kendi Python "koordinator" motoru (Draft_1/Draft_4/Draft_5) | Kendi kuyruğu/router'ı/sigortası Hermes ile mükerrer. Ayrıca **çalışmıyor** (`worker.py` AttributeError). Yeniden yazmak = kurulduktan sonra yeniden tasarlama tuzağı. |
| Ruflo / claude-flow | Değer önerisi tamamen Claude Code'a bağlı → kullanıcının kırılmaz kararını ihlal eder. 314 MCP aracı + 35 plugin = istenmeyen karmaşa. Sökümü de temiz değil. |
| Open Dots | Kendi README'si "prototype, üretime hazır değil". Kalıcı memory/yok, multi-user yok, Windows yolu belgelenmemiş. |
| OpenCode `F3_orchestrator` | 9 satırlık **stub**. Orkestrasyon iddiasının arkasında gerçek mantık yok. OpenCode'un 16 detaylı subagent'ı uzman işçi olarak kalır. |
| `agentmemory` MCP | Sunucu sağlıksız (health 000), `write_approval=False`, 54 araç. Bağlanmamalı. |
| Obsidian | Vault = klasör. Algoritma değil. |
| AnythingLLM (Draft_8) | İkinci vektör veritabanı + ikinci arayüz. Sıfır ek yetenek. |
| LiteLLM / OmniRoute | Çift router. Hermes `fallback_model` aynı işi tek başına yapar. |
| Programatik SEO / toplu AI içerik | Google spam politikası + güvenilirlik. 1. yıl bütçesi zaten 0. |
| Backlink satın alma | Bütçe 0. |

### 2.4 Taslaklar arasındaki en büyük çelişkiler

1. **Hermes'in rolü ters çevrilmiş:** Draft_1 Munder'i "ikinci orkestrator" gerekçesiyle reddetti; Draft_2 aynı gerekçeyle Hermes'i beyin yaptı. Aynı ölçüt, iki farklı sonuç.
2. **Üç beyin birden:** `KoordinatorCekirdeği` + Hermes + "Orchestrator/Creative Director".
3. **Task-state'in 5 sahibi.** Draft_3 SQLite'yi açıkça reddetti, Draft_4 SQLite kurdu.
4. **Draft_5 Obsidian'ı tamamen sildi**, Draft_8 yerine AnythingLLM koydu — ikisi de gerekçesiz.
5. **9 stub ajan** "aktif ajan kadrosu" diye sayıldı.

---

## 3. TEK NİHAİ MİMARİ

```
                        ┌───────────────────────────┐
                        │  ÖZKAN  (insan, tek muhatap) │
                        │  para · silme · publish · müşteri · sır rotasyonu │
                        └──────────────┬────────────┘
                                       │ onay (fail-closed)
                        ┌──────────────▼────────────┐
                        │   HERMES AGENT  —  BEYİN   │
                        │ planlama · araştırma · görev dağıtımı · onay kapısı │
                        │ hafıza (MEMORY.md) · task-state YAZICI · cron │
                        │ tek orkestrator · tek onay otoritesi │
                        └───┬──────────────────────┬──┘
                            │                      │
              ┌─────────────▼──────────┐   ┌───────▼─────────────┐
              │ AGENCY AGENTS          │   │ OPENCODE             │
              │ 7 iş kadrosu ajanı     │   │ UZMAN İŞÇİ           │
              │ SEO·reklam·ürün·marka  │   │ kod·terminal·git·test│
              │ veri·medya·satış       │   │ build·debug          │
              └─────────────┬──────────┘   └───────┬─────────────┘
                            │                      │
                        ┌───▼──────────────────────▼───┐
                        │  SKILLS · MCP · TOOLS        │
                        │ codebase-memory ✓ · web      │
                        │ firecrawl (beklemede)        │
                        └──────────────────────────────┘

   VERİ:  tasks.db (tek yazıcı: Hermes)
          hafiza/  (Markdown + git, sahibi: Hermes)
          sirket/  (Markdown + git, sahibi: insan)
```

**Tek yetenek = tek sahibi:**

| Yetenek | Sahibi | Başka hiçbir sistem yapmayacak |
|---|---|---|
| Orkestrasyon / beyin | **Hermes** | OpenCode orkestre etmez |
| Onay / izin kararı | **Hermes** | OpenCode `--auto` kullanmaz |
| Görev durumu (task state) | **`tasks.db`** | Hermes'in kanban/state DB'si kullanılmaz |
| Planlama, araştırma, web | **Hermes** | OpenCode web araştırmaz |
| Kod, terminal, test, build, git | **OpenCode** | Hermes kod yazmaz |
| İş alanı uzmanlığı | **Agency Agents** (Hermes altında) | — |
| Ajan çalışma hafızası | **`MEMORY.md`** | agentmemory kullanılmaz |
| Kalıcı şirket bilgisi | **`sirket/` (Markdown + git)** | Obsidian yok |
| Nihai karar, para, müşteri | **Özkan** | — |

---

## 4. HİYERARŞİ

```
1. ÖZKAN
   Tek muhatap. Her şeyi o onaylar. Kimse atlayamaz.
2. HERMES — beyin ve kontrol düzlemi
   Girdi: Özkan'ın talimatı
   Çıktı: görev parçalanmış hali, onay istekleri, haftalık rapor
   Yapamaz: kod yazma, para harcama, müşteriye doğrudan cevap, publish
3. OPENCODE — uzman işçi
   Girdi: Hermes'ten gelen tek iş, dosya + komut + kabul kriteri
   Çıktı: `worker_result.json` (pass | fail | blocked | timeout | crash)
   Yapamaz: görev dağıtma, kendi işine genişletme, `--auto`, dış dizine çıkma
4. AGENCY AGENTS — 7 iş kadrosu ajanı
   Girdi: Hermes'in iş tanımı
   Çıktı: belge/analiz (dosya), doğrudan müşteri iletişimi YOK
5. SKILLS / MCP / TOOLS — yetenek kataloğu
   Kim kullanabilir: Bölüm 7'deki politika
```

**Ajan → kime sonuç verir:** Her ajan **yalnızca Hermes'e** raporlar. Ajanlar birbirine
doğrudan görev veremez (istisna: Hermes'in kendi delegasyonu).

---

## 5. GÖREV / SORUMLULUK MATRİSİ

| # | İş birimi | Sorumlu | Görev alanı | Yapamaz | İnsana danışma eşiği | Çalışmayı bırakma |
|---|---|---|---|---|---|---|
| 1 | Yönetim & Strateji | **Özkan** | Nihai karar, öncelik, bütçe | — | — | — |
| 2 | AI İşletme & Koordinasyon | **Hermes** | Planlama, görev dağıtımı, task state, haftalık ritim | Kod yazma, para, publish | Onay gerektiren her iş | Onay 1 kez reddedildiyse |
| 3 | Müşteri & Satış | **Özkan** (yardım: Hermes araştırma) | Teklif, sözleşme, iletişim | Fiyat verme, indirim | Fiyat %25 altına | — |
| 4 | Pazarlama & Büyüme | `paid-social-strategist` + `seo-specialist` | İçerik, kanal, SEO/AEO | Siteyi doğrudan değiştirme (OpenCode'ya yazdırır) | Yeni kanal açmak | 2 kanal başarısız |
| 5 | Yazılım | **OpenCode** | Kod, test, build, git, deploy | `--auto`, dış dizin | `git push`, deploy | Test geçmezse |
| 6 | AI / Teknik Altyapı | **OpenCode** (OpenCode worker) | MCP, skill, agent config, sunucu | Kimlik bilgisi oluşturma | Sır rotasyonu | — |
| 7 | YouTube & Medya | `video-optimization-specialist` | Senaryo, başlık, yayın takvimi | **Publish/takipçiye mesaj** | Her publish | — |
| 8 | Sektörel Operasyonlar | `active: false` (6. ay) | Sektör paketleri | — | Aktivasyon | — |
| 9 | Finans & Uzmanlık | `active: false` (3. ay) | Fiyatlandırma verisi | Teklif verme | — | — |

**Kural:** Görevi olmayan ajan **çalıştırılmaz.** 8 ve 9 numaralı ajanlar şimdilik
`active: false`; numaralı tetikleyici olmadan devreye girmez.

### 5.1 Sistem matrisi

| Sistem | Ne yapar | Ne YAPMAZ (yasak) |
|---|---|---|
| **Hermes** | plan, araştırma, web, delegasyon, cron, onay, `MEMORY.md`, `tasks.db` yazımı | kod yazma, git push, publish, para, sır okuma-yazma |
| **OpenCode** | kod, edit, terminal, test, build, git (push hariç), dosya okuma | orkestrasyon, `--auto`, dış dizin, kendi görevini genişletme |
| **Agency Agents** | iş alanı analizi/belge üretimi | müşteri iletişimi, kod, publish, para |
| **Özkan** | onay, para, müşteri, sır rotasyonu, silme | — |

---

## 6. MEMORY MİMARİSİ

| Katman | Ne | Sahibi | Depo | Silinme |
|---|---|---|---|---|
| **Çalışma hafızası** | Ajanın öğrendikleri, kısa vade | Hermes | `hafiza/MEMORY.md` (git) | Haftalık ritimde çıkarılır, geçmişe taşınır |
| **Görev durumu** | Kim ne yapıyor, hangi aşamada | Hermes (**tek yazıcı**) | `veri/tasks.db` (SQLite) | **SİLİNMEZ** (soft-close) |
| **Kalıcı şirket bilgisi** | Sözleşme, müşteri, karar, ADR, mimari | İnsan | `sirket/` Markdown + git | **SİLİNMEZ** |
| **Haftalık not** | Cuma kapanışı deneyim dökümü | Hermes yazar, Özkan onaylar | `haftalik/YYYY-Www.md` | Silinmez, 24 ay sonra arşiv |
| **Gözlem / metrik** | Token, süre, hata sayısı | OpenCode toplar | `veri/olcum.jsonl` → haftalık toplam | 13 ay |
| **Log** | Hermes `state.db` | Hermes | `%LOCALAPPDATA%\hermes\state.db` | Hermes'in kendi politikası |

**Obsidian kararı — KESİN: KURULMAZ.** Gerekçe: (1) Vault bir klasördür, harici
uygulama değildir — arama ve düzenleme zaten Markdown + git ile sağlanır; (2) Hermes'in
`obsidian_sync` özelliği **yok** (doğrulandı, 0 eşleşme), yani önerilen entegrasyon
hayali bir özelliktir; (3) 4. bellek katmanı olurdu; (4) geri alınabilir — klasör ileride
Obsidian ile açılabilir.

**Haftalık ritim (Cuma 17:30, Hermes cron):**
1. Ajanlar hafta boyunca `hafiza/hafta-YYYY-Www.md` altına `[GÖREV#id]` prefiksiyle öğrendiklerini yazar
2. Hermes taslak özet üretir → **fail-closed insan onayı**
3. Kalıcı olanlar `sirket/`, geçici olanlar silinir, tekrarlılar arşive
4. `tasks.db` kapanış damgası alır

**`write_approval=False` riski için 6 önlem:** zorunlu `[GÖREV#id]` prefiksi · dosya
200 KB sınırı · görev ID eşleşmesi zorunlu · git revert · dış metin kopyalama yasağı ·
insan onayı.

---

## 7. MCP / SKILL / TOOL POLİTİKASI

### 7.1 MCP

| Sunucu | Sistem | Karar | Gerekçe |
|---|---|---|---|
| `codebase-memory` | OpenCode | **KAL** + indeks doldur | Gerçek iş yapıyor (kod grafiği). İlk `index_repository` native runtime indirir ve **checksum doğrular** — kurulumdan önce SHA256 teyidi yapılacak. |
| `agentmemory` | Hermes | **KALDIR** | Sunucu health 000. `write_approval=False`. Ölü katman. |
| `firecrawl` | Hermes | **BEKLE** | Ücretsiz katman yok (API anahtarı gerekiyor). Anahtar env'e taşınır, sunucu `enabled: false`. |
| `firecrawl` | OpenCode | **KALDIR** | Zaten `enabled:false` + anahtar gerekiyor. Ölü tanım. |

> **Kural:** Yeni MCP eklemek = mimari değişiklik. Her MCP için 10 kriter geçmeli.

### 7.2 Skill politikası

**OpenCode:** 89 skill'in tamamı tek oturuma giriyor — bu, kullanıcının kendi AGENTS.md
kuralına ("kütüphanenin tamamını yükleme") aykırı ve bağlam şişmesi üretiyor.
**Kural:** Kayıtlı skill sayısı **≤ 25**. Firecrawl paketinin 28 ölü skill'i silinir.
Router skill'ler (`using-superpowers`, `ask-matt`) korunur, gerisi ihtiyaca göre yüklenir.

**Hermes:** 105 skill korunur (iş kütüphanesi), ancak çakışan gruplar tek yola indirilir:
`firecrawl` ↔ `web` ↔ `browser` → **`web` sahibi** (A1/A2).
`opencode` ↔ `claude-code` ↔ `codex` → **`opencode` sahibi**; `claude-code`/`codex`
skill'leri devre dışı.

### 7.3 Araç politikası

| Araç | Kime | Koşul |
|---|---|---|
| `terminal`, `file`, `code_execution` | Hermes, OpenCode worker | worker'da proje dizini dışına çıkamaz |
| `web`, `browser` | Hermes | Çıktı **eşleşme** (source-id), çıktı direktifi sayılmaz |
| `computer_use`, `image_gen`, `tts`, `video*` | **YASAK** | Uzaktan tam makine kontrolü — riski karşılığı yok |
| `cronjob` | Hermes | Yalnız onaylı 3 zamanlayıcı |
| `delegation` | Hermes | Çocuk ajan: `clarify`, `memory`, `cronjob`, `delegate` **yok** |
| `manage_adr(update)`, `delete_project` | **YASAK** | Dosya ezme / indeks silme |

---

## 8. GÜVENLİK MİMARİSİ

### 8.1 Güven bölgeleri

| Bölge | Kim | Erişebilir | Kesinlikle erişemez |
|---|---|---|---|
| **D — Dış dünya** | Web, müşteri dosyası, YouTube transkripti | — | Sistem dosyaları, sırlar |
| **C — İşçi** | OpenCode worker, 7 ajan | Kendi görev dosyası, proje dizini | `sirket/`, `.env`, `tasks.db`, dış dizin |
| **B — Beyin** | Hermes | Her şey (ama onay kapısından geçerek) | Doğrudan publish/para |
| **A — İnsan** | Özkan | Her şey | — |

Veri akışı **tek yönlü**: D → C → B → A. A → B → C yazma yalnız onayla.

### 8.2 P0 — Production öncesi zorunlu (olmadan müşteri işine başlanmaz)

| # | Konu | Eski | Yeni |
|---|---|---|---|
| P0-1 | `FIRECRAWL_API_KEY` düz metin (`config.yaml:199`) | düz metin | `{env:...}` / env'e taşı + **anahtarı döndür** |
| P0-2 | `TELEGRAM_BOT_TOKEN` düz metin, `allowed_users` 1 kişi | tüm toolset açık | Ya **kanalı kapat** ya da **toolset'i sadece `clarify`+`memory`** yap |
| P0-3 | `approvals.deny: []` | boş | Yıkıcı komut listesi **fail-closed** doldur |
| P0-4 | tirith binary yok + `fail_open: True` | tarama çalışmıyor | `tirith_fail_open: False` **veya** tirith kur |
| P0-5 | `command_allowlist` tek madde | `-e/-c` serbest | Genişlet veya ikinci katman onay |
| P0-6 | `computer_use: cua` | açık | **Kapat** |
| P0-7 | `browser: browser-use` | canlı | Kapat (web fetch yeterli) |
| P0-8 | OpenCode `bash "*": "allow"` | serbest | `ask` fail-closed **değildir** → `deny` kullan |
| P0-9 | `external_directory: "*": allow` | her yer | Proje diziniyle sınırla |
| P0-10 | `--auto` bayrağı | korumasız | Kullanım yasağı + wrapper engeli |
| P0-11 | `inherit_mcp_toolsets: True` | 10×86 araç | `False` |
| P0-12 | 9 stub ajan tam araç setiyle | sınırsız | `tools:` bloğu ile daralt |

### 8.3 Onay kapısı — insan onayı şart olan işlemler

Para harcama · dosya/repo silme · `git push` · publish/deploy · müşteriye iletişim ·
sır yazan her işlem · `--auto` kullanımı · yeni ajan/skill/MCP ekleme · sistem
konfigürasyon değişikliği · `agentmemory`'ye kalıcı yazma.

**Fail-closed garantisi:** onay kanalı bozuksa → **izin yok**. Mevcut durumda
`approvals.transport_fallback: deny` ve `cron_mode/single_query_mode/unattended_mode: deny`
zaten doğru — **korunur**.

### 8.4 Terminal sınırı

PowerShell 5.1'de `ask` desenleri **kolayca atlatılır**: `Remove-Item` (`rm` alias'ını
yakalamaz), `Invoke-Expression`, `[System.IO.File]::Delete()`, `cmd /c`, `Start-Process`,
`powershell -c` — hiçbiri `ask`'e düşmez ama `"*": allow` içinden geçer.
**Bu yüzden `ask` yerine `deny` kullanılır.** `deny` fail-closed'dur, `ask` değildir.

### 8.5 Ajan yetki matrisi

| Ajan | Okuma | Yazma | Terminal | Git | MCP | Onay |
|---|---|---|---|---|---|---|
| mimari/planlama | ✅ | kendi klasörü | ❌ | ❌ | ❌ | — |
| seo | ✅ | belge | ❌ | ❌ | ❌ | site değişikliği |
| reklam | ✅ | belge | ❌ | ❌ | ❌ | publish |
| ürün/marka | ✅ | belge | ❌ | ❌ | ❌ | fiyat |
| veri | ✅ | `veri/` | ❌ | ❌ | ❌ | kalıcı nota |
| medya | ✅ | belge | ❌ | ❌ | ❌ | **her publish** |
| OpenCode worker | ✅ | **proje dizini** | ✅ (izinli komut) | ✅ (push hariç) | codebase-memory ✅ | push/deploy |

---

## 9. KURULUM SIRASI

Mevcut sistem **korunarak**, ileriye doğru. Her adım bir sonrakini açar.

| Adım | İş | Neden bu sırada | Kapı |
|---|---|---|---|
| **0** | API anahtarı rotasyonu (firecrawl + telegram) | Sızıntı her şeyden önce | `Select-String` ile düz metin anahtar kalmadığı doğrulandı |
| **1** | Hermes güvenlik ayarları (P0-3…P0-7, P0-11) | Uzaktan erişim yüzeyi kapanır | `approvals.deny` boş değil; `computer_use` kapalı |
| **2** | OpenCode izin sertleştirme (P0-8…P0-10) | İşçi en geniş yetkiye sahip | `bash * → deny`, `external_directory` sınırlı |
| **3** | Shadowed binary çözümü (1.18.32 / 1.18.34) | Sürüm belirsizliği | `opencode --version` tek ve beklenen |
| **4** | `tasks.db` şeması + tek yazıcı CLI | Görev durumunun sahibi | 5 komutlu smoke test PASS |
| **5** | `hafiza/`, `sirket/`, `haftalik/` klasörleri (git) | Hafıza mimarisi | `git status` temiz |
| **6** | Worker sözleşmesi canlı testi | Hermes↔OpenCode iletişimi | `worker_result.json: pass` |
| **7** | Agency Agents kadrosu bağlama | İş birimleri çalışsın | 7 ajan etkin, hepsi görev alabiliyor |
| **8** | Skill azaltma (89 → ≤25) | Bağlam ve hız | `opencode run` çıktısı ≤25 skill |
| **9** | `codebase-memory` indeksi | Kod grafiği | `list_projects` ≥1 |
| **10** | Kurumsal site düzeltmeleri (`lang="en"`, canonical) | Yayın ön şartı | `npm.cmd run validate` PASS |
| **11** | KVKK / izinli ileti sayfaları | Mevzuat | `/kvkk-iletisim`, `/izinler` yayında |
| **12** | Gözlem + maliyet toplama | 0 TL bütçe görünürlüğü | `olcum.jsonl` haftalık büyüyor |
| **13** | İlk müşteri pilotu (kapalı kutu) | Gerçek test | Onay kapısı yeşil |

> **Ajan 8 ve 9 (Sektörel, Finans) bu sırada yok.** 6. ve 3. ayda, sayısal tetikleyiciyle.

---

## 10. TEST KAPILARI

**Kural: Bir kapı PASS olmadan sonraki kapı açılmaz.** Toplam 20 kapı.

### Faz 1 — Güvenlik (bu çalışma için **zorunlu**)

| # | Test | PASS ölçütü | Durum |
|---|---|---|---|
| G1 | Config'de düz metin anahtar taraması | `Select-String` → 0 eşleşme | ❌ **ŞU AN BAŞARISIZ** |
| G2 | `approvals.deny` boş mu | Boş değil | ❌ **BAŞARISIZ** |
| G3 | `computer_use` kapalı m | Kapalı | ❌ **BAŞARISIZ** |
| G4 | `tirith` çalışıyor mu | Binary var **ve** `fail_open: False` | ❌ **BAŞARISIZ** |
| G5 | Telegram kanalı | Kapalı veya toolset kısıtlı | ❌ **BAŞARISIZ** |
| G6 | OpenCode `bash` default | `deny` | ❌ **BAŞARISIZ** |
| G7 | `external_directory` | Proje diziniyle sınırlı | ❌ **BAŞARISIZ** |
| G8 | Yıkıcı komut reddi | `Remove-Item` reddedilir | ❓ **BİLİNMİYOR** |
| G9 | `--auto` kapalı | Kullanılamaz | ❓ **BİLİNMİYOR** |
| G10 | `inherit_mcp_toolsets` | `False` | ❓ **BİLİNMİYOR** |

### Faz 2 — İşlev

| # | Test | PASS ölçütü | Durum |
|---|---|---|---|
| F1 | Hermes → OpenCode worker | `worker_result.json: pass` | ❓ |
| F2 | `tasks.db` tek yazıcı | Aynı anda 2 yazma reddedilir | ❓ |
| F3 | Session kalıcılığı | 2. çağrıda bağlam korunur | ❓ |
| F4 | Fallback sağlayıcı | Ana sağlayıcı kapalıyken sistem ayakta | ❓ **BAŞARISIZ (tanımlı değil)** |
| F5 | 7 ajan görev alabiliyor | 7/7 etkin | ❓ |
| F6 | Site doğrulama | `npm.cmd run validate` exit 0 | ❓ |
| F7 | Skill sayısı | ≤ 25 | ❓ **BAŞARISIZ (89)** |

### Faz 3 — Sürdürülebilirlik

| # | Test | PASS ölçütü |
|---|---|---|
| S1 | Haftalık ritim | Cuma cron'u not üretir + onay ister |
| S2 | Sökülebilirlik | Hermes kaldırılınca OpenCode tek başına çalışır |
| S3 | Geri dönüş | Her adımın rollback komutu çalışır |
| S4 | Maliyet görünürlüğü | Haftalık 0 da olsa `units` satırı var |

> **Bugün 20 kapının 8'i doğrulanmış olarak BAŞARISIZ, 1'i tanım gereği başarısız,
> 7'si BİLİNMİYOR. Production'a hazır değil.** Bu bir kusur değil, ölçüm sonucudur.

---

## 11. ÜRETİM KİLİDİ

Sistem çalıştıktan sonra yeniden tasarlanmaması için bağlayıcı kurallar.

**K1 — Tek sahip kuralı.** Bir yeteneğin ikinci sahibi olamaz. Yeni bir sistem/ajan/skill
eklenmeden önce "bu kimin işini kopyalıyor?" sorusu cevaplanır. Cevap "kimseninkini" değilse
reddedilir.

**K2 — Tek beyin.** Yalnız Hermes orkestre eder. OpenCode'un orchestrator rolü yoktur.
`F3_orchestrator` **kalıcı olarak silinir.**

**K3 — Tek task-state.** Yalnız `tasks.db`. Hermes `kanban.db` / `state.db` /
`shared-state.db` **iş verisi için kullanılmaz** (Hermes'in kendi iç çalışması hariç).

**K4 — Yeni bağımlılık kuralı.** Her yeni ajan/skill/MCP/CLI eklenmesi üç soruyu geçmeli:
(1) Hangi yeteneği **ekliyor** — mevcut biri yapamıyor mu? (2) Hangi sistemi **bozuyor** —
çakışma var mı? (3) Hangi kapıdan **çıkarılır** — temiz söküm yolu var mı?
Üçünden biri cevaplanamazsa eklenmez.

**K5 — Gerekçe yazımı zorunluluğu.** Sessiz eleme de elemedir. Bir sistemi çıkarmak
gerekçesiz bırakılamaz (Draft_8'in hatası budur).

**K6 — Sürüm/kanıt disiplini.** Mimari değişiklik ADR ile kaydedilir. "Çalışıyor"
deniyorsa test çıktısı yapıştırılır; yoksa **çalışmıyor** sayılır.

**K7 — Aylık mimari denetim.** Ayda bir kez bu 14 soru: (1) her yeteneğin tek sahibi var mı
(2) kullanılmayan ajan var mı (3) yetkisiz yüzey var mı (4) düz metin sır var mı
(5) ölü tanım var mı (6) ölü skill/MCP var mı (7) görev durumu tek yerde mi
(8) mimari doküman gerçek kodla uyuşuyor mu (9–14) maliyet, yedek, eğitim, sürüm,
geri dönüş yolu, kullanım oranı. Denetim bir mimari değişikliği tetiklemez; **yalnız
sapma varsa** gündeme gelir.

**K8 — Büyüme kapısı.** Ajan sayısı 7'yi geçmez. Yeni ajan ancak bir ajanın işi
kaldırılacaksa eklenir (net artış 0).

**K9 — Kaldırma kapısı.** Bir bileşen 90 gün kullanılmadıysa **kaldırılır** — "ilerde
lazım olur" gerekçesi kabul edilmez.

---

## 12. SON KURULUM DOSYA YAPISI

```
C:\Users\TozSolutions\TOZ_AI_GROUP\        ← yeni proje kökü
│
├── 00_SIRKET\
│   ├── anayasa.md                  kurallar, tek yazıcı ilkesi
│   ├── kararlar\                   ADR'ler (karar günlüğü)
│   │   ├── ADR-001-beyin-tek-hermes.md
│   │   ├── ADR-002-task-state-tasks-db.md
│   │   ├── ADR-003-obsidian-kurulmaz.md
│   │   ├── ADR-004-munder-rulo-open-dots-cikarildi.md
│   │   ├── ADR-005-agentmemory-kaldirildi.md
│   │   ├── ADR-006-telegram-kanali-policy.md
│   │   └── ADR-007-skill-azaltma.md
│   ├── hizmetler\                  8 hizmet sayfası
│   ├── paketler\                   3 paket
│   └── marka\                      logo, renk, ton
│
├── 10_AJANLAR\                    ajan sözleşmeleri (tek sahip: Hermes)
│   ├── 00- kadro-tanimlari.yaml   7 ajan: yetki, danışma eşiği, bırakma koşulu
│   ├── seo.md
│   ├── reklam.md
│   ├── urun-marka.md
│   ├── veri-analisti.md
│   ├── medya-youtube.md
│   ├── satis.md
│   └── mimari.md
│
├── 20_VERI\                       görev durumu — TEK YAZICI
│   ├── tasks.db                    SQLite (görev sahibi)
│   ├── tasks.db.yedek\             günlük yedek
│   └── olcum.jsonl                 haftalık metrik (append-only)
│
├── 30_HAFIZA\
│   ├── MEMORY.md                   ajan çalışma hafızası
│   ├── haftalik\                   2026-W41.md ...
│   └── arsiv\                     24 aydan eski haftalık notlar
│
├── 40_PROJE\                      kod işleri (OpenCode'un tek çalışma alanı)
│   ├── site\                       kurumsal web sitesi
│   ├── onlar/                     hizmet kod depoları
│   └── _gecici\                   task klasörü (iş bitince silinir — istisna: commit öncesi)
│
├── 50_GUVENLIK\
│   ├── yetki_matrisi.md
│   ├── onay_kurallari.yaml        fail-closed tanımı
│   ├── sir_rotasyonu.md            prosedür (değer yok)
│   └── test_kapilari.md           20 kapı
│
├── 60_IS_AKISI\
│   ├── teklif-sablonu.md
│   ├── sozlesme-sablonu.md
│   └── kvkk-izinler.md
│
└── 90_MIMARI\                     bu klasörün kendisi
    ├── 00-TOZ-AI-GROUP-NIHAI-MIMARI.md
    ├── 01-ESKI-TASLAKLARIN-ELESTIRISI.md
    ├── 02-KURULUM-KOMUTLARI.md
    ├── 03-KARAR-DAYANAKI-RAPORU.md
    └── _ajan-ciktilari\            10 uzman çıktısı (kanıt)
```

**Kural:** Bu yapıya yeni klasör eklenmez. Var olan bir klasör genişler.

---

## 13. KURULUM KOMUTLARI

Ayrıntılı, adım adım ve doğrulanabilir sürüm: **`02-KURULUM-KOMUTLARI.md`**.

Özet sıra: **0** anahtar rotasyonu → **1** Hermes güvenlik → **2** OpenCode izin →
**3** binary çözümü → **4** `tasks.db` → **5** klasörler+git → **6** worker testi →
**7** ajan kadrosu → **8** skill azaltma → **9** indeks → **10-13** site, KVKK, ölçüm, pilot.

Her adım: **komut → PASS ölçütü → ROLLBACK.**

---

## 14. SON KARAR

# TOZ AI GROUP İÇİN KULLANILACAK SİSTEM BUDUR

```
HERMES AGENT        tek beyin, tek onay otoritesi, tek görev durumu yazıcısı
OPENCODE            tek uzman işçi — kod, terminal, test, git, build
AGENCY AGENTS       7 iş kadrosu ajanı (Hermes'e bağlı, zaten kurulu)
DÜZ MARKDOWN + GIT  hafıza ve şirket bilgisi (Obsidian yok)
TEK SQLite tasks.db görev durumu (kanban/state.db yok)
NATIVE WINDOWS      PowerShell 5.1, Git, Node 24 — WSL/Docker yok
```

**SIFIR BÜTÇE:** Hermes ücretsiz OpenRouter modeli + OpenCode Zen (73 model) +
ücretsiz web/SEO araçları. Ücretli servis ancak gelir başladığında ve kanıtlanmış
fayda varsa.

### KULLANILMAYACAK SİSTEMLER (gerekçesiyle)

| Sistem | Karar | Gerekçe |
|---|---|---|
| **Munder / Munder-Difflin** | ❌ **TAMAMEN ÇIKAR** | Kendi "god orchestrator"ı, kendi router'ı, kendi hafızası, kendi onay kuyruğu → Hermes ile **izin çakışması en yüksek** sistem. 186 MB Electron + ayrı süreç. Ticari katkısı yok. (Kriter 2,3,4,9,10) |
| **Ruflo / claude-flow** | ❌ **ÇIKAR** | Değer önerisi tamamen Claude Code'a bağlı → **kullanıcının kırılmaz kararını ihlal eder**. 314 MCP aracı + 35 plugin = istenmeyen karmaşa. (Kriter 3,7,10) |
| **Open Dots** | ❌ **ÇIKAR** | Kendi README'si "prototype, üütem hazır değil". Kalıcı memory, zamanlama, multi-user yok. İkinci orkestrator + ikinci onay sistemi. (Kriter 1,2,3,5) |
| **OpenClaw** | ⏸️ **BEKLE** | Mevcut sistemde olmayan tek yetenek: müşterinin WhatsApp/Slack kanalından asistan. Ama Hermes'te Telegram gateway var → ikinci kanal ikinci risk yüzeyi. **Müşteri kanal talebi gelirse izole pilot.** (Kriter 3,9) |
| **Claude Code / CCR** | ❌ **KULLANILMAZ** | Kullanıcı kararı. |
| **Gemini CLI / Cursor CLI / Antigravity** | ❌ **KULLANILMAZ** | Sırf "alternatif" oldukları için eklenmesi yasak. |
| **OpenCode `F3_orchestrator`** | ❌ **KALDIR** | 9 satırlık stub; orkestrasyon yeteneği yok. Çift beyin. |
| **OpenCode `firecrawl` MCP** | ❌ **KALDIR** | `enabled:false` + anahtar gerekiyor. Ölü tanım. |
| **`agentmemory` MCP** | ❌ **KALDIR** | Sunucu health 000. `write_approval=False`. Ölü bellek katmanı. |
| **Obsidian** | ❌ **KURMA** | Vault = klasör. Harici uygulama değer katmıyor. `obsidian_sync` Hermes'te **yok**. Karar geri alınabilir. |
| **AnythingLLM** | ❌ **KURMA** | İkinci vektör veritabanı + ikinci arayüz. Sıfır ek yetenek. |
| **LiteLLM / OmniRoute** | ❌ **KURMA** | Çift router. Hermes `fallback_model` aynı işi yapar. |
| **Own Python coordinator motoru** | ❌ **ÜRETİME ALMA** | `worker.py` AttributeError → hiçbir iş tamamlanamıyor. Hermes + `tasks.db` aynı işi yapar. Yeniden yazılması gereksiz. |
| **Hermes `kanban.db` / `state.db` iş verisi** | ❌ **KULLANMA** | Şema Hermes'e ait. TOZ'un görev durumu `tasks.db`'de. |

### KULLANILAN SİSTEMLER (gerekçesiyle)

| Sistem | Karar | Gerekçe |
|---|---|---|
| **Hermes Agent** | ✅ **BEYİN** | Ölçülen tek aday: 105 skill, 2 MCP, 10 paralel delegasyon, cron, fail-closed onay altyapısı, native Windows, **zaten kurulu ve kullanılıyor**. Kullanıcının tercih edilen sistemi. |
| **OpenCode** | ✅ **UZMAN İŞÇİ** | Ölçülen yetenek: `edit/bash/git` hazır, 18 ajan (16'sı gerçek uzman), `codebase-memory` MCP, **headless çalıştığı doğrulandı**. Orkestrasyon yeteneği yok — olması da gerekmiyor. |
| **Agency Agents** | ✅ **AJAN KADROSU** | **Zaten Hermes'e kurulu** (`agency-agents-router`, ≈282 ajan), MIT, ücretsiz, izole edilebilir, ikinci beyin/router/memory **yaratmıyor**. 7'si etkinleştirilir. |
| **Git + Düz Markdown** | ✅ **HAFIZA** | Sürdürülebilir, izlenebilir, geri alınabilir, maliyetsiz. |
| **SQLite (`tasks.db`)** | ✅ **GÖREV DURUMU** | Tek yazıcı, eşzamanlı güvenli, silme yasağı uygulanabilir, Hermes'in şemasına bağımlı değil. |

---

## 15. DOĞRULANAMAYANLAR

| Konu | Neden |
|---|---|
| 20 güvenlik/fonksiyon kapısının 7'si | Test çalıştırılmadı — **"BİLİNMİYOR"** olarak işaretlendi |
| `firecrawl_interact` canlı tarayıcı davranışı | Kaynak kodda bulunamadı |
| OpenCode izin deseni öncelik sırası | Dokümantasyonda belirtilmemiş |
| `${env:VAR}` YAML interpolasyonu | Hermes config şemasında doğrulanmadı |
| Munder/Ruflo/OpenClaw Windows kurulum başarısı | Sistemler kurulu değil, denenmedi |
| Kurumsal site `npm run validate` çıktısı | Bu oturumda çalıştırılmadı |
| Plausible/GA4 ücretsiz katman limitleri | Ölçülmedi |

> **Bu belge bir fikir listesi değildir.** Her satır ya ölçülmüş, ya kaynak koddan
> doğrulanmış, ya da `[DOĞRULANMADI]` işaretlidir. İşaretlenmeyen hiçbir iddia yoktur.

---

**BELGE SONU — TOZ AI GROUP NİHAİ MİMARİ**