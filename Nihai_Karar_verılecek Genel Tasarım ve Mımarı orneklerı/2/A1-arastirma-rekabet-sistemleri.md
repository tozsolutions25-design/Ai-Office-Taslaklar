# A1 — Dış Sistem Araştırması: Rekabet ve Alternatif Sistemler

**Rol:** TOZ AI GROUP · Dış Sistem Araştırmacısı
**Tarih:** 2026-10-06
**Kapsam:** 5 dış sistem + Hermes Agent doğrulamaları
**Kural:** Her iddia yanında kaynak URL. Doğrulanamayan → `[DOĞRULANMADI]`

**Bağlam (kırılmaz kararlar):**
- Claude Code / CCR kullanılmayacak. Gemini CLI / Cursor / Antigravity sadece alternatif oldukları için eklenmeyecek.
- Mevcut ve doğrulanmış: Hermes Agent v0.21.5 (Python 3.14.7, native Windows, `D:\AI\npm-global\hermes-agent`), OpenCode 1.18.32/1.18.34 (headless `opencode run` çalışıyor).
- TOZ ihtiyacı: uzun süre çalışan, sade, güvenli, ücretsiz, **tek otoriteli** sistem.

---

## 0. Künye (GitHub API ile doğrulandı, 2026-10-06)

| Repo | URL | Lisans | Dil | Yıldız | Çatal | Son commit | Açık issue | Oluşturma |
|---|---|---|---|---|---|---|---|---|
| Munder Difflin | https://github.com/chaitanyagiri/munder-difflin | MIT | TypeScript | 8.495 | 1.148 | 2026-10-05 | 230 | 2026-05-31 |
| Ruflo (claude-flow) | https://github.com/ruvnet/ruflo | MIT | TypeScript | 73.964 | 8.796 | 2026-10-06 | 1.116 | 2025-06-02 |
| OpenClaw | https://github.com/openclaw/openclaw | MIT | TypeScript | 391.483 | 82.296 | 2026-10-06 | 9.431 | 2025-11-24 |
| Open Dots | https://github.com/Anil-matcha/open-dots | MIT | Python | 5.486 | 650 | 2026-10-05 | 2 | 2023-05-25 |
| Agency Agents | https://github.com/msitarzewski/agency-agents | MIT | Shell/Markdown | 157.498 | 25.398 | 2026-10-04 | 185 | 2025-10-13 |

> Not: "yıldız sayısı" karar gerekçesi **değildir**. Sadece bakım canlılığı ve topluluk baskısı göstergesi olarak okundu.

---

## 1. Munder Difflin

**Ne olduğu:** Electron masaüstü uygulaması; Claude Code / Antigravity / Codex / Grok / Kimi / Gemini CLI / Qwen / OpenCode / Crush / pi / Copilot / Cursor gibi 12 terminal ajan CLI'sını `node-pty` PTY içinde sarıp, kendi router + memory + mailbox katmanıyla bir "hive" haline getiriyor ve ajanları Pixi.js 2D ofis katında avatar olarak gösteriyor.
Kaynaklar: https://github.com/chaitanyagiri/munder-difflin · https://raw.githubusercontent.com/chaitanyagiri/munder-difflin/main/README.md · https://raw.githubusercontent.com/chaitanyagiri/munder-difflin/main/HIVE.md · https://munderdiffl.in/

**Kullanıcının sorduğu 3 özellik — doğrulandı:**

| Özellik | Sonuç | Kanıt |
|---|---|---|
| Approvals queue | **VAR** (README: "…into an approvals queue you act on", `ApprovalsPanel` bileşeni) | README.md, `renderer/src/components/ApprovalsPanel` |
| Per-agent budget | **VAR** ("Budgets & telemetry: per-agent token budgets, real cost from transcripts, a durable ledger, OTel spans, and a tool waterfall") | README.md |
| Circuit breaker | **VAR** ("Circuit breaker: a steer → constrain → stop ladder for agents that loop, storm errors, or blow their budget") | README.md |

**Diğer gerçek özellikler (HIVE.md'den):**
- On-disk hive: `agents/<id>/{identity.md, memory.md, inbox/, outbox/}`, `board.md`, `tasks.json`, `log.jsonl`.
- Memory: markdown-first + MemPalace CLI ( opsiyonel; yoksa no-op'a düşer).
- God agent ("Michael"): roster, router, adjudication, `board.md` tek yazıcı.
- Git = koordinasyon/denetim katmanı, **tek committer** (Electron main process).

**Bakım durumu:** Son commit 2026-10-05 (bugün). 4 aylık repo, çok hızlı gelişiyor. 230 açık issue. MIT lisans.

**Kurulum maliyeti:**
- Hazır build indirilebiliyor (Windows dahil) — imzalı/notarize yalnızca macOS buildlerinde (`munderdiffl.in`).
- Kaynaktan kurulum: `npm install` (postinstall `node-pty`'yi Electron ABI'sine göre yeniden derler) + `npm run dev` → **native build zorunluluğu = yüksek kurulum riski**.
- Ücretsiz katman: build ücretsiz. **Pro $150/yıl** (Stapler dictation + yeni sidebar). `[DOĞRULANMADI]` Pro'da başka neler kilitli — README'de sadece bunlar geçiyor.

### 10 kriter tablosu — Munder Difflin

| # | Kriter | Değerlendirme |
|---|---|---|
| 1 | Gerçek iş yapıyor mu | **EVET** — gerçek PTY, gerçek hook sunucusu, gerçek git ledger. Kanıtlanmış tasarım dokümanı var. |
| 2 | Mevcut sistem tekrarı mı | **BÜYÜK ÖLÇÜDE EVET** — Hermes'in delegasyon + memory + plugin yöneticisi ile OpenCode'un agent yönetiminin üstüne 3. bir orkestratör. |
| 3 | Çakışma var mı | **EVET, kritik** — Hermes'in `agency-agents-router` + MCP/router'ı ile, Munder'ın kendi router/GOD agent/memory'si çakışır. Hangi router otoritete sahip net değil. |
| 4 | Kendi router/memory/MCP/agent yönetimi karmaşa yaratıyor mu | **EVET** — üçüncü bir "hive" katmanı ekleniyor. TOZ'nun "tek otorite" ilkesini doğrudan ihlal ediyor. |
| 5 | Windows'ta güvenilir mi | **ORTA** — build mevcut, ama Windows için imza/notarizasyon yok, `node-pty` yerel derleme gerektiriyor. Üretim güvenilirliği `[DOĞRULANMADI]`. |
| 6 | Ücretsiz katmanı var mı | **EVET** (build) + Pro $150/yıl. |
| 7 | Sürdürülebilir mi | **EVET** (çok aktif, MIT) — ama 4 aylık proje, API kararları sık değişiyor. |
| 8 | Tamamen kaldırılabilir mi | **EVET** — Electron uygulaması, `harnessHome` klasörü dışında kalıcı iz bırakmıyor. |
| 9 | İzole edilebilir mi | **EVET** — kendi klasörü ve kendi PTY süreçleri var. |
| 10 | TOZ'un ticari faaliyetine katkısı var mı | **DÜŞÜK** — görsel "ofis" demosu müşteriye gösterilebilir ama teslimat hızına katkısı yok; hatta dikkat dağıtır. |

### KARAR: **AL-AMA** (izole demo kabuğu olarak, üretim ortamına sokmadan)

Gerekçe: approvals queue / per-agent budget / circuit breaker gerçek ve Hermes'in **docs'unda aynı kavramları** ayrıntılı. Özellikle "circuit breaker" ve "durable cost ledger" Hermes'te karşılığı yok gibi görünüyor `[DOĞRULANMADI]` — bu, ileride Hermes'e geri beslenebilecek bir fikir. Ama Munder'ın kendi router'ı + god agent'ı + memory'si TOZ'nun iki ajanlı mevcut kurulumuyla **doğrudan çakışıyor** ve Windows'ta imzasız/yerel-d derleme riski var. Kurulacaksa: hiçbir mevcut Hermes/OpenCode dizinine dokunmadan, tek klasöre, deneme amaçlı.

---

## 2. Ruflo (claude-flow)

**Ne olduğu:** Kendi ifadesiyle "agent meta-harness" — Claude Code ve Codex'in **üzerine** takılan bir koordinasyon katmanı. `npx ruflo init` ile kuruluyor.
Kaynaklar: https://github.com/ruvnet/ruflo · https://raw.githubusercontent.com/ruvnet/ruflo/main/README.md · https://github.com/ruvnet/claude-flow/blob/HEAD/docs/USERGUIDE.md

**Gerçek özellikler (README'den):**
- **314 MCP aracı** (README'de "314 MCP tools"; USERGUIDE'de "313 ruflo MCP tools" — sürüm farkı, `[DOĞRULANMADI]` hangisinin güncel olduğu).
- **35 plugin**, 98 ajan, 60+ komut, 30 skill.
- HNSW vektör memory + "neural learning", federation (mTLS + ed25519), daemon, hooks.
- MetaHarness: "setup audit" (1-100 puan), güvenlik taraması, `ruflo eject`.
- Doğrudan Claude Code'a bağlı: `claude mcp add claude-flow -- npx ruflo@latest mcp start`, `.claude/` + `.claude-flow/` + `CLAUDE.md` yazıyor.

**Bağımlılıklar:** Claude Code veya Codex **zorunlu**. Node/npx. Bazı kurulum `curl | bash` istiyor → Windows'ta Git-Bash/WSL/MSYS gerekiyor (`npx ruflo@latest init wizard` native çalışıyor). Rust tabanlı "Cognitum.One" motoru iddiası var.

**Bakım durumu:** Son commit 2026-10-06 (bugün). 73.964 yıldız, **1.116 açık issue** — çok yüksek churn.

### 10 kriter tablosu — Ruflo

| # | Kriter | Değerlendirme |
|---|---|---|
| 1 | Gerçek iş yapıyor mu | **EVET** — gerçek bir meta-harness, 314 MCP aracı. |
| 2 | Mevcut sistem tekrarı mı | **TAMAMEN EVET** — Hermes'in + OpenCode'un yaptığı her şeyi (swarm, memory, router, plugin) tekrar ediyor. |
| 3 | Çakışma var mı | **EVET, ÖLÜMCÜL** — `.claude/` ve `.claude-flow/` yazıyor; Claude Code kullanmayacağımız için temel değeri hedef platforma bağlı. |
| 4 | Kendi router/memory/MCP/agent yönetimi karmaşa yaratıyor mu | **EVET, EN YÜKSEK** — 314 MCP aracı + 35 plugin + daemon + federation. TOZ için tam olarak istenmeyen karmaşa. |
| 5 | Windows'ta güvenilir mi | **KISMİ** — `npx` yolu native, curl-bash yolu değil. Rust bileşeni native Windows'ta `[DOĞRULANMADI]`. |
| 6 | Ücretsiz katmanı var mı | **EVET** (MIT, tamamı ücretsiz). |
| 7 | Sürdürülebilir mi | **EVET ama riskli** — 1.116 açık issue, Claude Code'a bağımlı, isim değiştirmiş (claude-flow → ruflo). |
| 8 | Tamamen kaldırılabilir mi | **ZOR** — `.claude/`, `.claude-flow/`, `CLAUDE.md`, MCP kaydı, daemon kalıyor. Temizlik riski yüksek. |
| 9 | İzole edilebilir mi | **KISMİ** — MCP sunucusu olarak ayrı çalışabilir, ama `init` çalışma dizinine yazıyor. |
| 10 | TOZ'un ticari faaliyetine katkısı var mı | **YOK** — Claude Code'a bağlı olması kırılmaz kararı ihlal ediyor. |

### KARAR: **ÇIKAR** (tartışmasız)

Gerekçe: Ruflo'nun tek değer önerisi "Claude Code'a sinir sistemi takmak"tır. TOZ Claude Code'u kırılmaz olarak dışladığı için **gereksinim tabanı yok**. Üstelik 314 MCP aracı ve 35 plugin, "sade ve tek otoriteli sistem" hedefiyle tam ters. Kurulum ve söküm de temiz değil.

---

## 3. OpenClaw

**Ne olduğu:** Kişisel asistan gateway'i. Tek bir "Gateway" süreci Discord / iMessage / Slack / Teams / Telegram / WhatsApp / Signal / Matrix / Zalo gibi 20+ kanala bağlanıyor; model ve ajan harness'leri plugin.
Kaynaklar: https://github.com/openclaw/openclaw · https://docs.openclaw.ai/ · https://docs.openclaw.ai/start/openclaw

**Gerçek özellikler:**
- Gateway = "tek doğruluk kaynağı" (sessions, routing, channel connections). Control UI + CLI + TUI.
- Model ve agent harness'ler plugin olarak değiştirilebilir (Claude, Codex, local modeller).
- Companion app'ler: ses, Canvas, kamera, ekran, device-local aksiyon.
- MIT, OpenClaw Foundation (501(c)(3)) yönetiminde, ücretli katman **yok**, varsayılan telemetry yok (sadece günlük sürüm kontrolü — `update.checkOnStart: false` ile kapanır).
- Config: `~/.openclaw/openclaw.json`. `openclaw gateway install` ile arka plan servisi.

**Windows desteği:** Native Windows uygulaması **VAR** (docs.openclaw.ai "native apps for macOS, iOS, Android, Windows, and Linux").
**Gereksinim:** Node 26 (önerilen) veya Node 24.16+ / 26.1. Depo **pnpm workspace**; kökte `npm install` desteklenmiyor.

**Bakım durumu:** Son commit 2026-10-06 (bugün). 391.483 yıldız, **9.431 açık issue** — çalışma alanı en büyük ve en kalabalık.

### 10 kriter tablosu — OpenClaw

| # | Kriter | Değerlendirme |
|---|---|---|
| 1 | Gerçek iş yapıyor mu | **EVET** — kanallar, session, routing, cihaz node'ları gerçek. |
| 2 | Mevcut sistem tekrarı mu | **HAYIR** — Hermes mesajlaşma kanalı sunmuyor. Bu bir **eksik** alan. |
| 3 | Çakışma var mı | **DÜŞÜK-ORTA** — her ikisi de "ajan yönetimi" konuşuyor ama OpenClaw mesaj katmanında, Hermes iş katmanında. Yine de iki ayrı session/router var. |
| 4 | Kendi router/memory/MCP/agent yönetimi karmaşa yaratıyor mu | **ORTA-YÜKSEK** — ayrı bir Gateway + ayrı config + ayrı agent registry + kendi memory'si. İki otorite riski. |
| 5 | Windows'ta güvenilir mi | **EVET** (native app belgelenmiş) — ancak Node 26 gereksinimi ve Windows daemon kurulumu TOZ'da test edilmedi. |
| 6 | Ücretsiz katmanı var mı | **TAMAMEN EVET** — ücretli katman yok, hosting yok, token yok. |
| 7 | Sürdürülebilir mi | **ÇOK GÜÇLÜ** — 391k yıldız, 82k fork, 501(c)(3), günlük commit. |
| 8 | Tamamen kaldırılabilir mi | **EVET** — tek config dizini (`~/.openclaw`) + daemon servisi. |
| 9 | İzole edilebilir mi | **EVET** — ayrı gateway portu, ayrı workspace. |
| 10 | TOZ'un ticari faaliyetine katkısı var mı | **ORTA-YÜKSEK** — müşteriye WhatsApp/Telegram'dan 7/24 yanıt, "otomasyon hizmeti" satışı. En somut ticari katkı bu. |

### KARAR: **BEKLE** (izole pilot, kanallı ticari senaryo için)

Gerekçe: OpenClaw TOZ'nun **mevcut sisteminde olmayan tek yeteneği** getiriyor: müşterinin kullandığı mesajlaşma kanallarından 7/24 asistan. Bu, doğrudan gelir üretir. Ama şu anda iki ayrı orkestratör + iki ayrı session modeli olur; bu "tek otorite" ilkesine aykırı. Karar şartı: **müşteriden kanallı asistan talebi gelirse** tek başına, Hermes'e dokunmadan, tek klasörde pilot edilmesi.

---

## 4. Open Dots

**Ne olduğu:** MIT lisanslı, self-hosted AI workspace. OpenAI Dots / Meta Muse / Claude Cowork benzeri "chat + tools + approvals + connectors + computer tasks".
Kaynaklar: https://github.com/Anil-matcha/open-dots · https://raw.githubusercontent.com/Anil-matcha/open-dots/main/README.md · https://aicrier.com/post/6q5b14fsckw70leboer2 · https://thakicloud.com/tech-blog/en/news/open-dots-self-hosted-agent-workspace/

**Gerçek özellikler:**
- Chat (streaming, görsel ekleri), deny-by-default **action gateway**, yüksek riskli aksiyonlarda **onay duraklaması**, **audit event'leri**.
- Connector'lar (Composio üzerinden dar kapsamlı: GitHub issue lookup/create).
- Opsiyonel **computer use**: `fake` (lokal), `docker` (Playwright imajı) veya `remote` provider.
- Next.js istemci + FastAPI API + SQLite yerel durum.
- `/search` komutu keyless You.com free profil ile çalışıyor.

**Kendi ifadesiyle sınırlar (README "Current limitations"):**
- Tek yerel sahip; kullanıcı/rol/multi-user yok.
- SQLite yerel; koordineli çok-örnekli depolama ve yedekleme yok.
- Sadece *Responses*-uyumlu API; Chat Completions ve generic provider plugin arayüzü yok.
- Computer runtime "hardened güvenlik sınırı **değil**".
- **Masaüstü/ mobil istemci yok, kalıcı memory servisi yok, zamanlanmış rutin motoru yok.**
- Status: "Prototype / active development... production ready değil".

**Windows desteği:** README'de Windows'a özel kurulum yok; Docker yolu `./runtime` altında. `[DOĞRULANMADI]` native Windows kurulumu test edilmiş mi.

**Bakım durumu:** Son commit 2026-10-05. **Sadece 2 açık issue**, 5.486 yıldız. Depo 2023'te açılmış ama son push bugün — aktif.

### 10 kriter tablosu — Open Dots

| # | Kriter | Değerlendirme |
|---|---|---|
| 1 | Gerçek iş yapıyor mu | **KISMİ** — action gateway + approvals + audit gerçek ve iyi tasarlanmış. Ama "prototype" ve eksikler çok. |
| 2 | Mevcut sistem tekrarı mu | **EVET** — sohbet arayüzü + onay akışı = Hermes'in terminal deneyiminin başka bir yüzü. |
| 3 | Çakışma var mı | **EVET** — üçüncü bir kullanıcı yüzü ve üçüncü bir onay mekanizması. |
| 4 | Kendi router/memory/MCP/agent yönetimi karmaşa yaratıyor mu | **ORTA** — kalıcı memory **yok**, zamanlama yok; ama ayrı bir FastAPI servis ve ayrı bir veri modeli var. |
| 5 | Windows'ta güvenilir mi | **ZAYIF** — Windows'a özel dokümantasyon yok; Docker + Playwright runtime Linux varsayıyor. |
| 6 | Ücretsiz katmanı var mı | **EVET** (MIT). |
| 7 | Sürdürülebilir mi | **ORTA** — tek geliştirici (Anil Matcha), "early prototype" beyanı, az issue = az kullanıcı. |
| 8 | Tamamen kaldırılabilir mi | **EVET** — Docker konteyner + yerel dosyalar. |
| 9 | İzole edilebilir mi | **EVET** — konteyner, port 8080. |
| 10 | TOZ'un ticari faaliyetine katkısı var mı | **DÜŞÜK** — onay/audit deseni ilham verici, ürün olarak kullanılabilirliği düşük. |

### KARAR: **ÇIKAR** (fakat tasarım çalışması olarak oku)

Gerekçe: Kendi README'si "üretime hazır değil" diyor; kalıcı memory, zamanlama ve çok kullanıcı yok. Windows'ta kanıtlanmış kurulum yolu yok. TOZ'nun yerine `desktop UI + approve/audit` ihtiyacı doğarsa, Open Dots'ın **action gateway + audit event** deseni referans alınacak — kod kopyalanmayacak. Binary olarak alınmayacak.

---

## 5. Agency Agents (The Agency)

**Ne olduğu:** Prompt-persona koleksiyonu — "uzmanlaşmış ajan kişilikleri". Araç değil, içerik. 14+ hedef araca dönüştürücü script'leriyle kuruluyor.
Kaynaklar: https://github.com/msitarzewski/agency-agents · https://github.com/msitarzewski/agency-agents/tree/main · https://github.com/msitarzewski/agency-agents/blob/main/integrations/opencode/README.md

**Lisans:** MIT (GitHub API ile doğrulandı).

**Ajan sayısı (2 ayrı kaynaktan, bu makineden doğrulandı):**
- Upstream repo bölümlerinde README'ler hariç **275 adet `.md` ajan dosyası** (özet: engineering 65, specialized 59, marketing 37, gis 13, security 12, design 10, sales 9, testing 9, paid-media 7, project-management 7, academic/game-development/spatial-computing/support 6'şar, product 6, finance 5, examples 5, strategy 3, healthcare 3, research 1).
- **Bu makinede:** `C:\Users\TozSolutions\.hermes\plugins\agency-agents-router\data\agents.json` → **282 ajan kaydı** (kurulu router).
- Upstream README'de "The Agency Roster" başlığı altında bölüm listesi var; tam sayı README'de `[DOĞRULANMADI]` (dosya sayısı güvenilir ölçüm).

**Hermes entegrasyonu doğrulandı:** README'de `Hermes — lazy-router plugin → ~/.hermes/plugins/`. Bu makinede `~/.hermes/plugins/agency-agents-router/` mevcut (`plugin.yaml` + `__init__.py` + `data/agents.json`, 282 kayıt). Ayrıca `D:\AI\npm-global\hermes-agent\agency-agents\` upstream klonu duruyor. **Yani zaten kurulu ve çalışır durumda.**

**İstenen mesleksel ajanların varlığı (kurulu klon üzerinden doğrulandı):**

| Alan | Ajan dosyaları (örnek) |
|---|---|
| SEO | `marketing-seo-specialist.md`, `marketing-agentic-search-optimizer.md`, `marketing-ai-citation-strategist.md`, `marketing-aeo-foundations.md`, `marketing-app-store-optimizer.md`, `marketing-baidu-seo-specialist.md` |
| Reklam / Paid Media | `paid-media-ppc-strategist.md`, `paid-media-paid-social-strategist.md`, `paid-media-programmatic-buyer.md`, `paid-media-auditor.md`, `paid-media-tracking-specialist.md`, `paid-media-creative-strategist.md`, `paid-media-search-query-analyst.md` |
| Ürün Yöneticisi | `product-manager.md`, `product-sprint-prioritizer.md`, `product-feedback-synthesizer.md`, `product-trend-researcher.md`, `product-dx-engineer.md`, `product-behavioral-nudge-engine.md` |
| Veri Analisti | `sales-pipeline-analyst.md`, `paid-media-search-query-analyst.md`, `marketing-x-twitter-intelligence-analyst.md` — **genel "data analyst" ajanı yok**; `[DOĞRULANMADI]`/`YOK` |
| Mimar (Software Architect) | `engineering/` altında mimari ajanlar; depodaki `D:\AI\npm-global\hermes-agent\software_architect.md` ayrıca mevcut |
| Strateji | `strategy/nexus-strategy.md` (+ `EXECUTIVE-BRIEF.md`, `QUICKSTART.md`) |
| Satış | `sales-account-strategist.md`, `sales-deal-strategist.md`, `sales-outbound-strategist.md`, `sales-offer-lead-gen-strategist.md`, `sales-proposal-strategist.md`, `sales-discovery-coach.md`, `sales-coach.md`, `sales-engineer.md`, `sales-pipeline-analyst.md` |
| Diğer | Growth, içerik üretimi (LinkedIn/X/Reddit/TikTok/YouTube…), e-posta, PR, gizlilik/veri (private-domain), sağlık, finans, test, güvenlik |

### 10 kriter tablosu — Agency Agents

| # | Kriter | Değerlendirme |
|---|---|---|
| 1 | Gerçek iş yapıyor mu | **EVET** — saf prompt/UX uzmanlığı; çıktısı doğrudan kullanılabilir ajan tanımı. |
| 2 | Mevcut sistem tekrarı mu | **HAYIR** — Hermes'e özgü içerik; Hermes bu ajanları **kullanmıyor**, router ile sunuyor. |
| 3 | Çakışma var mı | **YOK** — router plugin'i lazy-load; mevcut agent'lara dokunmuyor. |
| 4 | Karmaşa yaratıyor mu | **HAYIR** — 282 kayıt tek `agents.json` içinde, talep üzerine yükleniyor. |
| 5 | Windows'ta güvenilir mi | **EVET** — sadece JSON/markdown dosyaları, platform bağımsız. |
| 6 | Ücretsiz katmanı var mı | **TAMAMEN EVET** — MIT, hiçbir şey ücretli değil. |
| 7 | Sürdürülebilir mi | **ÇOK GÜÇLÜ** — son commit 2026-10-04, 157k yıldız, 14+ araç entegrasyonu. |
| 8 | Tamamen kaldırılabilir mi | **EVET** — `~/.hermes/plugins/agency-agents-router/` klasörünü silmek yeterli. |
| 9 | İzole edilebilir mi | **EVET** — tek plugin dizini. |
| 10 | TOZ'un ticari faaliyetine katkısı var mı | **EN YÜKSEK** — SEO, reklam, ürün, satış, strateji ajanları doğrudan **müşteri hizmeti** üretir. |

### KARAR: **AL** (zaten kurulu — bu, tek "al" kararıdır)

Gerekçe: Tek başına tek otoriteli, ücretsiz, izole edilebilir, kaldırılabilir, doğrudan gelir üreten ve **hâlihazırda çalışır durumda** olan tek dış sistem. Riski sıfır. Bir sonraki adım: router'ın 282 ajanından TOZ işine uygun alt kümeyi (SEO + paid-media + product + sales + strategy ≈ 70 ajan) öne çıkarıp lazy-router'da önceliklendirmek.

---

## 6. Hermes Agent Dokümantasyon Doğrulamaları

### 6.1 `opencode` skill'inin belgelediği binary yolu bu makinede doğru mu?

**HAYIR — YANLIŞ. Düzeltme gerekli.**

Kaynak (skill dosyası): `D:\AI\npm-global\hermes-agent\skills\autonomous-ai-agents\opencode\SKILL.md`, satır 45:
```
terminal(command="$HOME/.opencode/bin/opencode run '...'", workdir="~/project", pty=true)
```
Bu satır, PATH çakışması yaşanırsa kullanılacak **açık yol** olarak sunuluyor.

Bu makinede doğrulanan gerçek durum:

| Kontrol | Sonuç |
|---|---|
| `(Get-Command opencode).Source` | `C:\Users\TozSolutions\AppData\Roaming\npm\opencode.ps1` |
| `Test-Path "$env:USERPROFILE\.opencode\bin\opencode"` | **False** |
| `opencode --version` | `1.18.32` |

Sonuç: Skill'in önerdiği `$HOME/.opencode/bin/opencode` yolu **bu makinede mevcut değil**. Doğru yol `C:\Users\TozSolutions\AppData\Roaming\npm\opencode.ps1`. Ayrıca skill `platforms: [linux, macos, windows]` diyor ama örnek komutlar POSIX'a özgü (`$HOME`, `which -a`, `mktemp -d`, `~/.hermes/cache/scratch/`) — Windows'ta **PowerShell uyarlaması gerekiyor**.

Ayrıca: skill sürümü `1.2.0`; TOZ kurulu sürüm 1.18.32 → skill güncel değil `[DOĞRULANMADI]` (upstream'de daha yeni opencode skill'i var mı, kontrol edilmedi).

**Öneri:** Bu skill'i TOZ dallarında düzelt — Windows yolunu sabitle, POSIX örneklerini PowerShell'e çevir. `SKILL.md:45` satırı anahtardır.

### 6.2 Hermes'ın obsidian_sync / haftalık not / memory özellikleri var mı?

| Özellik | Sonuç | Kanıt |
|---|---|---|
| **`obsidian_sync` adlı bir araç/özellik** | **YOK** — bu isimle hiçbir yerde geçmiyor. Tüm `.py`/`.md`/`.json`/`.yaml` altında arandı, sıfır eşleşme. |
| **Obsidian desteği** | **VAR, ama skill seviyesinde.** `D:\AI\npm-global\hermes-agent\skills\note-taking\obsidian\SKILL.md` (68 satır, v1.0.0, yazar "Teknium (teknium1), Hermes Agent", MIT). Mekanizma: `OBSIDIAN_VAULT_PATH` env değişkeni (yoksa `~/Documents/Obsidian Vault`), `read_file` / `search_files` / `write_file` / `patch` ile düz dosya işlemi, `[[wikilink]]` desteği. Obsidian API'si/CLI'si/plugin'ı **yok**. |
| **Haftalık not (weekly note) özelliği** | **YOK** — `weekly-note` / `weekly_note` desenine hiçbir dosyada eşleşme yok. `daily_note` de yok. Obsidian skill'i not oluşturmayı tarif ediyor ama şablon/otomasyon yok. |
| **Kalıcı memory** | **VAR ve güçlü.** `agent/memory_manager.py`, `agent/memory_provider.py`, `agent/learning_graph.py`, `agent/curator.py`, `agent/learning_mutations.py`; plugin tarafında `plugins/memory/{store.py, retrieval.py, holographic.py, query_rewrite.py, config_schema.py}` + `_openai_llm.py` / `_oss_providers.py`. Ayrıca `hermes_state*.py` (30+ dosya) kalıcı oturum/mesaj durumu ve FTS arama. |
| **Not alma becerileri** | `skills/note-taking/` (obsidian), `optional-skills/productivity/siyuan` — yani Siyuan da destekleniyor. |
| **Vault backends** | `agent/vault_backends/{local.py, bitwarden.py, onepassword.py}` — bu **sır kasası**, Obsidian değil. |

**Net sonuç:** TOZ'un "Obsidian'a otomatik haftalık not yazdır" ihtiyacı **mevcut değil**. Skill dosyasına eklenmesi gereken bir şey — ya skill'e bir haftalık-not prosedürü eklenmeli ya da bu TOZ kendi skill'i olarak yazılmalı.

### 6.3 Hermes kaç model sağlayıcısını destekliyor, ücretsiz olanlar hangileri?

**Sayı:** `plugins/model-providers/` altında **38 provider plugin** var (her biri `plugin.yaml` + `__init__.py` içeriyor, doğrulandı).
Keşif mekanizması: `providers/__init__.py._discover_providers()` bu dizini ve `$HERMES_HOME/plugins/model-providers/` altını tarar; kullanıcı plugin'leri aynı isimle **last-writer-wins** (güçlü çalışma yolu).

Tam liste: actual, ai-gateway, alibaba, alibaba-coding-plan, anthropic, arcee, azure-foundry, bedrock, commandcode, copilot, copilot-acp, **custom**, deepinfra, deepseek, fireworks, gemini, gmi, huggingface, kilocode, kimi-coding, meta-ai, minimax, nebius-token-factory, nous, novita, nvidia, ollama-cloud, openai-codex, opencode-zen, openrouter, qwen-oauth, router, stepfun, upstage, vertex, xai, xiaomi, zai.

**Ücretsiz / maliyetsiz olanlar:**

| Sağlayıcı | Durum | Kanıt |
|---|---|---|
| **`custom`** | **GERÇEKTEN ÜCRETSİZ** — `plugin.yaml` tanımı: *"Custom / Ollama / local OpenAI-compatible endpoint"`. Tamamen yerel çalışır, API maliyeti sıfır. | `plugins/model-providers/custom/plugin.yaml` |
| **`ollama-cloud`** | Ollama Cloud — `[DOĞRULANMADI]` ücretsiz katman var mı; plugin `Nous Research` imzalı. | `plugins/model-providers/ollama-cloud/plugin.yaml` |
| **`opencode-zen`** | "OpenCode (Zen + Go)" — TOZ zaten OpenCode kullanıyor; ücretsiz kredi/haber modeli `[DOĞRULANMADI]`. | `plugins/model-providers/opencode-zen/plugin.yaml` |
| `nous` (Nous Research Portal) | `[DOĞRULANMADI]` ücretsiz kredi veriyor mu | plugin.yaml |
| `deepseek`, `xiaomi`, `minimax`, `zai`, `qwen-oauth` | Çoğu düşük/ücretsiz katman sunar | `[DOĞRULANMADI]` — doğrulamadım |
| `router` | "Ramp Router" — ücretli | plugin.yaml |
| Diğerleri (anthropic, openai-codex, openrouter, google-gemini vb.) | Ücretli | plugin.yaml |

**Kesin doğrulanmış tek ücretsiz katman: `custom` (yerel Ollama / OpenAI-uyumlu endpoint).**
README'de ücretsiz sağlayıcı listesi **bulunamadı** (`README.md` içinde `ollama|lmstudio|openrouter|deepseek|groq` desenine sıfır eşleşme). Bu yüzden "kaç ücretsiz" sorusunun kesin cevabı: **1 kesin (`custom`), geri kalanı `[DOĞRULANMADI]`.**

---

## 7. Karar Özeti

| Sistem | Karar | Tek cümlelik gerekçe |
|---|---|---|
| **Agency Agents** | **AL** | Tek otoriteyi bozmayan, ücretsiz, izole, zaten kurulu ve doğrudan gelir üreten mesleksel ajan koleksiyonu. |
| **Munder Difflin** | **AL-AMA** | approvals queue / per-agent budget / circuit breaker gerçek ve ilham verecek, ama kendi router'ı + god agent'ı mevcut iki sistemle çakışıyor. |
| **OpenClaw** | **BEKLE** | Tek gerçek eksik: müşteri kanallarından 7/24 asistan. Müşteri talebi gelirse izole pilot. |
| **Open Dots** | **ÇIKAR** | Kendi README'si "prototype, üretime hazır değil" diyor; eksikleri çok. Sadece action-gateway/audit deseni referans alınır. |
| **Ruflo** | **ÇIKAR** | Değer önerisi tamamen Claude Code'a bağlı — kırılmaz kararı ihlal ediyor; 314 MCP aracı + 35 plugin = istenmeyen karmaşa. |

**Ayrıca: TOZ'un kendi işi (Hermes doğrulamaları)**
1. `skills/autonomous-ai-agents/opencode/SKILL.md:45` — yanlış binary yolu düzeltilmeli. Gerçek: `C:\Users\TozSolutions\AppData\Roaming\npm\opencode.ps1`. Pozix örnekleri PowerShell'e çevrilmeli.
2. Obsidian skill'i **dosya-okuma seviyesinde**, `obsidian_sync` veya haftalık-not otomasyonu **yok**. İhtiyaç varsa TOZ skill'i olarak yazılmalı.
3. 38 model sağlayıcısı var; kesin ücretsiz olanı yalnızca `custom` (yerel Ollama / OpenAI-uyumlu).

---

## 8. Kaynak Listesi

- https://github.com/chaitanyagiri/munder-difflin
- https://raw.githubusercontent.com/chaitanyagiri/munder-difflin/main/README.md
- https://raw.githubusercontent.com/chaitanyagiri/munder-difflin/main/HIVE.md
- https://github.com/chaitanyagiri/munder-difflin/blob/main/SPEC.md
- https://github.com/chaitanyagiri/munder-difflin/releases
- https://munderdiffl.in/
- https://github.com/ruvnet/ruflo
- https://raw.githubusercontent.com/ruvnet/ruflo/main/README.md
- https://github.com/ruvnet/claude-flow/blob/HEAD/docs/USERGUIDE.md
- https://github.com/openclaw/openclaw
- https://github.com/openclaw/openclaw/blob/main/README.md
- https://docs.openclaw.ai/
- https://docs.openclaw.ai/start/openclaw
- https://github.com/Anil-matcha/open-dots
- https://raw.githubusercontent.com/Anil-matcha/open-dots/main/README.md
- https://gitdiagram.com/anil-matcha/open-dots
- https://aicrier.com/post/6q5b14fsckw70leboer2
- https://thakicloud.com/tech-blog/en/news/open-dots-self-hosted-agent-workspace/
- https://github.com/msitarzewski/agency-agents
- https://github.com/msitarzewski/agency-agents/tree/main
- https://github.com/msitarzewski/agency-agents/blob/main/integrations/opencode/README.md
- GitHub REST API (`/repos/{owner}/{repo}`, `/commits`) — 2026-10-06 tarihinde künye verileri
- Yerel: `D:\AI\npm-global\hermes-agent\**` ve `C:\Users\TozSolutions\.hermes\plugins\agency-agents-router\**` (doğrudan okuma)
