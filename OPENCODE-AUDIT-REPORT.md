# TOZ AI GROUP — OPENCODE ARCHITECTURE AUDIT

Tarih: 2026-10-06
Kapsam: YALNIZCA audit / inventory. Hiçbir dosya, config, MCP, skill veya agent değiştirilmedi. Git commit yapılmadı.

---

## A) SYSTEM INVENTORY

| Öğe | Değer | Kaynak |
|---|---|---|
| OpenCode (aktif) | **1.18.32** | `opencode --version` |
| OpenCode (ikincil kopya) | **1.18.34** | `D:\AI\npm-global\opencode.cmd` |
| Aktif çalıştırılabilir | `C:\Users\TozSolutions\AppData\Roaming\npm\opencode.ps1` → `node_modules\opencode-ai\bin\opencode.exe` | `Get-Command opencode -All` |
| İkincil kurulum | `D:\AI\npm-global\opencode.*` (yeni sürüm, PATH'te ikinci) | aynı |
| Node.js | v24.21.0 | `node --version` |
| npm | 11.19.0 | `npm.cmd --version` |
| Git | 2.55.0.windows.3 | `git --version` |
| OS | win32, PowerShell 5.1, native Windows (WSL kullanılmıyor — `wsl` PATH'te yok) | ortam |
| Config | `C:\Users\TozSolutions\.config\opencode\opencode.jsonc` (61 satır) | okundu |
| Global AGENTS.md | `C:\Users\TozSolutions\.config\opencode\AGENTS.md` (var) | sistem prompt |
| State | `D:\AI\OpenCode\STATE.md` mevcut (okunmadı) | Test-Path |
| Çalışma dizini | `C:\Users\TozSolutions` | env |

**PATH sırası (önemli çakışma):** `D:\AI\NodeJS` → `C:\Users\TozSolutions\AppData\Roaming\npm` → `D:\AI\npm-global`.
Yani **aktif binary 1.18.32 (eski)**, PATH'te daha yeni 1.18.34 var ama shadowed.

**PATH çakışması doğrulanmış riski:** `npx` PowerShell'de `.ps1` sarmalayıcı yüzünden `npx.cmd` gerektiriyor; AGENTS.md bunu zaten not almış.

---

## B) ACTIVE PROVIDERS

| Öğe | Durum |
|---|---|
| `opencode auth list` | **1 credential**: "OpenCode Zen" (`api` tipi) |
| auth.json | `~/.local/share/opencode/auth.json` → sadece `opencode` anahtarı (`type`,`key`) |
| Aktif provider | `opencode` (OpenCode Zen gateway) |
| Model listesi | 73 model, **tamamı `opencode/*`** |
| Default model | Config'de **`model` anahtarı yok** → default çalışma anında seçiliyor. **Doğrulanamadı.** |
| Fallback | **Tanımlı değil** (config'de yok) |
| Ortam değişkeni sağlayıcısı | **Yok**: `OPENAI_*`, `ANTHROPIC_*`, `GEMINI_*`, `OPENROUTER_*`, `GROQ_*`, `FIRECRAWL_API_KEY` — hiçbiri set değil |
| Bu oturumun modeli | `opencode/space-bunny-free` (sistem prompt) |
| Çalışmayan provider | **Doğrulanmış 2 adet** (aşağıda) |

### Çalışmayan / kırık config

1. **F2_engineering** ve **F3_orchestrator** agent tanımlarında `Model: anthropic/claude-3.5-sonnet` yazıyor. Bu (a) `anthropic` provider'ı yok, (b) `claude-3.5-sonnet` listede yok. Bu primary agentlar model geçersizse düşecek.
2. **firecrawl MCP** `enabled: false` + `{env:FIRECRAWL_API_KEY}` set değil → çalışmaz.
3. `data-engineer.md` içinde `models:` bloğu var (içeriği doğrulanmadı).

---

## C) ACTIVE AGENTS

**Config dizini:** `C:\Users\TozSolutions\.config\opencode\agents\` → 18 custom agent.

### Primary (2)

| Agent | Satır | Not |
|---|---|---|
| `F2_engineering` | 9 | Model metadata'da `anthropic/claude-3.5-sonnet` (geçersiz) |
| `F3_orchestrator` | 9 | Model metadata'da `anthropic/claude-3.5-sonnet` (geçersiz) |

### Subagent (16)

`accessibility-auditor` (325), `B_research` (9), `C_sales_crm` (9), `data-engineer` (318),
`data-visualization-engineer` (149), `D_social_seo` (9), `E1_youtube` (9), `E2_it_security` (9),
`E3_secretariat` (9), `F1_obsidian` (9), `frontend-developer` (224), `performance-benchmarker` (277),
`search-relevance-engineer` (235), `secrets-credential-hygiene-engineer` (185),
`short-video-editing-coach` (410), `video-optimization-specialist` (118)

### Tespitler

- **Build/plan/review ayrımı yok.** `build`/`plan` agent tanımı yok; `code-review-and-quality`, `writing-plans` gibi review/plan yetenekleri **skill** olarak geliyor, agent olarak değil.
- **9 ajan "stub"**: 9 satırlık olanlar (B, C, D, E1, E2, E3, F1, F2, F3) sadece description + metadata içeriyor — gerçek görev talimatı yok. F3 "orkestra şefi" deniyor ama 9 satır.
- **Encoding belirsizliği:** `F2`/`F3` dosyaları PowerShell `Get-Content` ile okunduğunda `Muhendislik`, `yonetim` gibi karakterler bozuk göründü. Dosyanın gerçek encoding'i doğrulanmadı (UTF-8 olabilir, `Get-Content` varsayılanı bozuyor olabilir). **Dosyanın gerçekten bozuk kaydedilmiş olduğu doğrulanmadı.**
- **Agent permission farkı yok.** Hiçbir agent dosyasında `tools:` veya `permission:` bloğu yok → hepsi tam araç setiyle çalışıyor (bash, edit, MCP dahil).
- `task` subagent listesi bu oturumda 25 tip görünüyor (18 dosya + dahili/explore/general vb.).

---

## D) ACTIVE SKILLS

**Toplam ~89 skill, 4 kaynaktan.**

| Kaynak | Adet | Yol |
|---|---|---|
| Superpowers (plugin) | 15 | `~/.config/opencode/node_modules/superpowers/skills` |
| Firecrawl paketi | 28 | `~/.config/opencode/skills/` (aktif, MCP kapalı olduğu için **işlevsiz**) |
| Matt Pocock / `.agents` | 46 | `C:\Users\TozSolutions\.agents\skills` |
| Kütüphane (kaynak, pasif) | 62 dizin | `D:\AI\Skills` |

- **Duplicate kontrolü yapıldı:** superpowers (15) ile `.agents` (46) arasında **isim çakışması yok** (Compare-Object sonucu boş).
- **Çakışma riski:** `firecrawl-*` skilllerinin **28'i** MCP sunucusu kapalıyken yükleniyor. Bunlar `firecrawl_scrape`, `firecrawl_search` gibi MCP tool çağırmaya çalışacak → çalışmayacak tool hatası üretir.
- **Hermes çakışması:** `D:\AI\npm-global\node_modules\hermes-agent\.hermes` ve superpowers içinde `.hermes-plugin` mevcut → **Hermes skill'leri yükleme çakışması potansiyeli var, doğrulanmadı.**
- `agentmemory-mcp-tools` skill'i `.agents\skills` altında var ama **`agentmemory` MCP config'de tanımlı değil** → yönerge dosyası var, sunucu yok. Tutarsızlık.
- Kullanıcının AGENTS.md'si "kütüphanenin tamamını yükleme" diyor; 89 skill'in hepsi sistem prompt'una giriyor → **bağlam şişmesi riski yüksek** (kullanıcının kendi kuralına aykırı).

---

## E) ACTIVE MCP

`opencode mcp list` ile doğrulandı: **2 sunucu, 1 aktif.**

### codebase-memory — ✓ connected

- Tip: **local** (stdio)
- Exe: `C:\Users\TozSolutions\AppData\Roaming\Python\Python314\Scripts\codebase-memory-mcp.exe` (dosya mevcut ✓)
- **Araç sayısı: 19** (bu oturumda 17'si görünür)
  - Yazma/graph: `index_repository`, `delete_project`, `compare_graphs`, `ingest_traces`, `manage_adr`
  - Okuma: `search_graph`, `search_code`, `trace_path`, `get_code_snippet`, `get_file_outline`, `query_graph`, `get_graph_schema`, `get_architecture`, `check_index_coverage`, `index_status`, `detect_changes`, `list_projects`
- **Durum: index boş — `total: 0 project`.** MCP çalışıyor ama hiç repo indekslenmemiş. İlk `index_repository` çağrısında native runtime indirip checksum doğrulaması yapacak.
- `mcp_timeout: 45000` (45s) — büyük repo indekslemesi bu süreyi **aşabilir**.
- **Riskli yetkiler:** `index_repository` diske `.codebase-memory/graph.db.zst` yazar (kalıcı veri). `delete_project` indeks siler. `manage_adr` mode=`update` **tüm dosyayı ezme yetkisine sahip** — sessiz veri kaybı riski.
- **Kimin kullanabilir:** tüm primary + tüm subagent'lar (agent seviyesinde kısıt yok).

### firecrawl — ○ disabled

- Tip: remote, `https://mcp.firecrawl.dev/v2/mcp`
- `enabled: false`, header `{env:FIRECRAWL_API_KEY}` → **ortam değişkeni yok**
- Etkin: hayır. Etkinleştirilirse **dışarıya veri çıkışı** (web kazıma) + API maliyeti.

---

## F) PERMISSIONS

Config'de **sadece 3 anahtar** tanımlı. OpenCode'un varsayılanları dolduruyor.

| Tool | Durum | Kaynak |
|---|---|---|
| `read` | **allow** (varsayılan, config'de yok) | default |
| `edit` | **`"edit": "allow"`** — açıkça serbest | config:27 |
| `write` | **allow** (default; config'de yok) | default |
| `patch` | allow (default) | default |
| `bash` | **karma**: 17 pattern `ask`, `*: allow` | config:28-47 |
| `external_directory` | **`"*": "allow"`** — her dizine serbest | config:48-50 |
| `webfetch` | allow (default) | default |
| `websearch` | allow (default) | default |
| `task` | allow (default) | default |
| `skill` | allow (default) | default |
| `todowrite` | allow (default) | default |
| MCP tool'ları | allow (default) | default |
| `list` / `glob` / `grep` | allow (default) | default |

**bash `ask` listesi:** `rm *`, `del *`, `rmdir *`, `reg *`, `regedit *`, `Set-ItemProperty *`, `New-ItemProperty *`,
`pip install *`, `npm install *`, `npx *`, `winget install *`, `Invoke-WebRequest *`, `curl *`,
`Start-Process *`, `git push *`, `git reset --hard*`, `git clean *`

### Bu izin tablosundaki boşluklar (analiz)

1. **`--auto` bayrağı mevcut** (`opencode --help`: "auto-approve permissions that are not explicitly denied (dangerous!)"). Etkinleştirilirse **17 `ask` kuralı anlamını yitirir**, `ask` → `allow` olur. Bu en büyük tek risktir.
2. **`bash "*": "allow"` + `external_directory "*": "allow"` kombinasyonu** → shell üzerinden `D:\`, `C:\`, network path dahil her yere erişim. `mkdir / move / copy / del` desenleri `ask`'e düşmüyor (sadece `rm`/`del`/`rmdir`).
3. **`bash` `ask` desenleri PowerShell 5.1'de bypass kolay:** `Remove-Item` desenlere uymaz (`rm` alias'ı yakalar, `Remove-Item` yakalamaz). `& "$env:TEMP\x.exe"`, `powershell -c`, `cmd /c`, `Invoke-Expression`, `[System.IO.File]::Delete()` — hiçbiri `ask`'e düşmez ama `*: allow` içinden geçer. **Bu, `ask` listesinin güvenlik değerinin büyük kısmını boşaltır.**
4. `edit: allow` → tüm dosyalar, koruma yok.

---

## G) SECURITY RISKS

| # | Risk | Seviye | Kanıt |
|---|---|---|---|
| 1 | `--auto` ile `ask` katmanının tamamen düşmesi | **Yüksek** | `--help` çıktısı |
| 2 | `bash "*": allow` + PowerShell alias bypass → `ask` kuralları atlatılabilir | **Yüksek** | config:46 + desen analizi |
| 3 | `external_directory "*": allow` → tüm disk + UNC + kurulu tüm projeler erişilebilir | **Yüksek** | config:48-50 |
| 4 | `edit: allow` → korumasız yazma, geri alma yok | **Orta-Yüksek** | config:27 |
| 5 | Tek credential, tek provider (`opencode`), **fallback yok** → tek nokta başarısızlık | **Orta** | `auth list` |
| 6 | **MCP'de şifre yok ama 19 tool açık**, `manage_adr(update)` tüm dosyayı ezer | **Orta** | MCP listesi |
| 7 | 28 `firecrawl-*` skill yüklü ama sunucu kapalı → ölü yönerge + yanıltıcı | **Düşük-Orta** | skills dizini |
| 8 | `agentmemory` skill'i var, MCP yok | **Düşük** | config vs skills |
| 9 | Primary agent'larda geçersiz model referansı → runtime düşüşü | **Orta** | F2/F3 metadata |
| 10 | API anahtarı sadece `space-bunny-free` modelinde → **ücretli model çağrısı için kimlik doğrulama yolu yok** | **Orta** | env taraması |
| 11 | `--print-logs` / `--log-level DEBUG` ile prompt+yanıt loglanabilir → sır sızıntısı riski (kullanılmadı) | **Düşük** | `--help` |
| 12 | Secret dosyası `~/.local/share/opencode/auth.json` düz metin | **Düşük** (doküman) | auth list |

**İyi haber:** Hiçbir sır (API key/token) ortam değişkeninde veya config'de plaintext gömülü değil. `{env:}` placeholder doğru kullanılmış.

---

## H) HERMES INTEGRATION

**Uygun mu? Evet, mimari olarak uygun.** Kanıtlanmış altyapı:

- `opencode run [message..]` → **headless tek-atılık çalıştırma** (TUI gerekmez)
- `opencode serve --port N` → **headless HTTP sunucu**
- `opencode acp` → **Agent Client Protocol sunucusu** (Hermes ACP adapter ile konuşabilir)
- `opencode attach <url>` → çalışan sunucuya bağlanma
- `opencode export <sessionID>` → **session JSON dışa aktarma** (sonuç aktarımı için)
- `opencode --session <id>` / `--continue` / `--fork` → session devam/dallama
- `opencode --agent <name>` → agent seçimi (F2/F3 çağrılabilir)
- `opencode --model provider/model` → model sabitleme
- `hermes-agent` `acp_adapter` modülü `D:\AI\npm-global` alt mevcut

### Headless vs interactive

- `run` = non-interactive. PTY **gerekmez**. Onay gerektiren tool'lar (`ask` desenleri) headless'ta **otomatik reddedilir veya bloklanır** → bu, Hermes'in iş akışını sessizce kırabilir. **Doğrulanmadı, test edilmeli.**
- `serve`/`acp` = uzun ömürlü, session kalıcı.

### Session davranışı

Session ID verilmezse her `run` yeni session açar → bağlam kaybı. Hermes çağrıcısı **session ID'yi saklamak zorunda**.

### Sonuç aktarımı

`export` JSON veya `run`'ın stdout'u. Yapılandırılmış çıktı garantisi yok.

**Kritik uyumsuzluk:** Hermes "planning/reasoning", OpenCode "implementation" rolünü alacaksa, OpenCode'un 18 ajanı (özellikle B/C/D/E/F ajanları — satış, YouTube, sosyal medya) bu iş için **gerekli değil ve bağlam israfı**.

---

## I) MUNDER INTEGRATION

### Munder'a verilmesi gerekenler

| Yetki | Gerekçe |
|---|---|
| `opencode run --agent <agent> --model <m>` | Agent/model seçimi |
| `opencode export <sessionID>` | Sonuç okuma |
| `opencode session` | Session yönetimi |
| `opencode serve --port` + `attach` | Kalıcı bağlantı (opsiyonel) |
| Read-only MCP (`search_graph`, `get_architecture`, `search_code`) | Durum okuma |
| `tool_output` limitleri | Zaten 200 satır / 16 KB — **Munder için doğru ayarlanmış** |

### Munder'a **verilmemesi** gerekenler

| Yetki | Gerekçe |
|---|---|
| `--auto` | Tüm `ask` katmanını düşürür — **en kritik yasak** |
| `manage_adr(mode=update)` | Dosya ezme, sessiz veri kaybı |
| `index_repository` / `delete_project` | Disk yazma + indeks silme |
| `--port 0` yerine **sabit port**, `127.0.0.1` dışına çıkmama | `--mdns` ile `0.0.0.0`'a açılabilir → ağa açık sunucu |
| `write`/`edit` yetkisi (Munder planlayıcıysa) | Ayrılmış sınırın ihlali |
| `bash "*"` | Shell kaçışı |

### Munder permission sistemini bozar mı?

**Mekanik risk düşük, operasyonel risk yüksek.**

- Config **tek dosyada merkezi** (`opencode.jsonc`) → Munder buraya yazarsa OpenCode'un tüm oturumlarını etkiler ve kullanıcının AGENTS.md'deki "config değiştirme" kuralını ihlal eder.
- `external_directory: "*"` → Munder, OpenCode config'ine **istemeden erişebilir**.
- `--auto` tek bayrakla tüm `ask`'i düşürür → **paylaşılan bir sunucuda Munder `--auto` ile çalışırsa, aynı sunucudaki interaktif kullanıcıyı da korumasız bırakır** (paylaşılan state).
- **Öneri:** Munder için **ayrı bir config profili** kullan (`OPENCODE_CONFIG` veya ayrı dizin), `--auto` yasak, ayrı kullanıcı/servis hesabı.

---

## J) RECOMMENDED ROLE

### Öneri: **B) Specialist worker** (ağırlıkla) + **A) Worker** (sınırlı)

| Rol | Uygunluk | Gerekçe |
|---|---|---|
| **A) Worker** | ✅ Yüksek | Edit/write/bash/test/git hazır. `edit: allow` + `bash *: allow` bunun için. Bağımsız, bağlamı dar tutulabilir işler (linter düzeltme, test ekleme, migration, doküman). |
| **B) Specialist worker** | ✅ **En iyi** | 16 detaylı subagent (accessibility-auditor 325 satır, secrets-hygiene, data-engineer, frontend-developer, performance) gerçek uzman istemleri. `codebase-memory` MCP'si bağlam yönetimini ucuzlatır. Kapsam dar → kalite yüksek. |
| **C) Global orchestrator** | ⚠️ **Önerilmez** | 3 kanıt: (1) F3 "orchestrator" ajanı **9 satırlık bir stub** — gerçek orkestrasyon mantığı yok. (2) Tek provider + fallback yok → tek hata tüm zinciri düşürür. (3) `context compaction` gerektiren uzun orkestrasyon, tek bağlamda güvenilir değil. |

### Neden specialist worker?

1. **Yetenek dengesiz:** Uygulama yetenekleri (edit/bash/git) güçlü ve doğrulanmış. Orkestrasyon yeteneği **yok** (stub agent, sahte memory MCP, index boş).
2. **Provider kırılganlığı:** Tek credential. Orchestrator uzun görevde provider kesintisine dayanır; worker kısa görevde kesintiye dayanır.
3. **MCP hazır ama boş:** `codebase-memory` bağlı ama 0 proje. Orkestratör bunu kullanmadan yanlış karar verir.
4. **18 ajanın 9'u stub** → orchestrator bunları çağırırsa boş iş üretir.

**Orchestrator rolü için gerekenler (şu an karşılanmayan):** gerçek F3 ajanı, fallback provider model tanımı, indekslenmiş codebase-memory, `--auto` yasağı, ayrı config profili.

---

## K) ARCHITECTURE RISKS

| # | Risk | Etki |
|---|---|---|
| 1 | **İki OpenCode kurulumu, PATH'te yeni olan shadowed** | Yapılan güncelleme etkisiz; sürüm belirsizliği |
| 2 | **Tek provider, tek credential, fallback yok** | Tek nokta başarısızlık |
| 3 | **Primary agent'larda geçersiz model** (`anthropic/claude-3.5-sonnet`) | F2/F3 runtime'da düşebilir |
| 4 | **28 ölü firecrawl skill'i** yükleniyor | Bağlam şişmesi + yanıltıcı tool çağrıları |
| 5 | **89 skill tek oturuma giriyor** — kullanıcının kendi AGENTS.md kuralına aykırı | Bağlam maliyeti, seçim hatası |
| 6 | **9 ajan stub** | Orkestrasyon iddiası gerçek değil |
| 7 | **Ajan dosyalarında encoding belirsizliği** | Yükleme/okuma sorunları olası (doğrulanmadı) |
| 8 | **`agentmemory` MCP'si skill'de anlatılıyor, config'de yok** | Tutarsız durum |
| 9 | **`mcp_timeout: 45s` indeksleme için kısa** | Büyük repo'da indeksleme timeout → boşa maliyet |
| 10 | **`--auto` bayrağı mevcut ve korumasız** | Tek bayrakla tüm güvenlik katmanı düşer |
| 11 | **`external_directory: "*"` + `bash "*"`** | Sınır kavramı fiilen yok |
| 12 | **`D:\AI\Skills` (62) ile `~/.agents` (46) ve `~/.config` (43) üçlü kaynak** | Kaynak belirsizliği, senkronizasyon riski |

---

## L) TEST PLAN

Hiçbir madde **çalıştırılmadı** — audit kapsamı dışında. Aşağıdakiler doğrulanmamış.

| # | Test | Komut/yöntem | Beklenen |
|---|---|---|---|
| T1 | Aktif binary hangisi? | `Get-Command opencode -All; opencode --version` | 1.18.32 (shadow) |
| T2 | Shadow çözümü | `& "D:\AI\npm-global\opencode.cmd" --version` | 1.18.34 |
| T3 | Headless çalışma | `opencode run --agent F2_engineering "print cwd"` | F2 düşüyor mu? (geçersiz model) |
| T4 | Headless + permission | `opencode run "ls"` | `ask` gerektiren tool headless'ta ne olur? |
| T5 | `--auto` etkisi | `opencode --auto run "..."` | 17 `ask` kuralı düşüyor mu? |
| T6 | Read tool + MCP | `codebase-memory` read tool çağrısı | Çalışıyor mu, hangi ajan kullanabilir? |
| T7 | Edit/write | Kontrollü geçici dosya | `edit: allow` çalışıyor mu? |
| T8 | PowerShell bypass | `Remove-Item` deseni | `ask` tetikleniyor mu? |
| T9 | Session kalıcılığı | 2× `opencode run --session <id>` | Bağlam korunuyor mu? |
| T10 | Export | `opencode export <sessionID>` | JSON okunabilir mi? |
| T11 | Codex provider | `codex --version` | Hermes'in sağladığı sağlayıcı var mı? |
| T12 | Skill çakışması | `opencode run "list active skills"` | Kaç skill yüklü gerçekten? |
| T13 | Encoding | `F3_orchestrator.md` UTF-8 byte kontrolü | Bozuk mu, sadece `Get-Content` artefaktı mı? |
| T14 | Timeout | `index_repository` büyük repo + 45s | Kaç saniyede bitiyor? |
| T15 | Repo doğrulama | `npm run validate` (`TozSolutions_Ai_Office`) | Build/lint/typecheck gerçekten çalışıyor mu? |
| T16 | Git yeteneği | `git worktree list` (repo) | Worktree gerçekten kullanılabilir mi? |

### Repository / coding yeteneği — değerlendirme, test yapılmadı

| Yetenek | Durum | Dayanak |
|---|---|---|
| code modification | ✅ Mevcut | `edit: allow`, patch/write default allow |
| terminal | ✅ Mevcut | `bash *: allow` (kısıtlı `ask` ile) |
| tests | ❓ Doğrulanmadı | Runner'a bağlı; test komutu çalıştırılmadı |
| lint | ❓ Doğrulanmadı | Aynı |
| typecheck | ❓ Doğrulanmadı | Aynı |
| build | ❓ Doğrulanmadı | Aynı |
| Git | ✅ Mevcut | git 2.55.0; `push`/`reset --hard`/`clean` = `ask` |
| worktree | ❓ Doğrulanmadı | Komut mevcut; `D:\AI\Dashboard`, `D:\AI\Skills`, `D:\AI\OpenCode` **git deposu değil** (`git=False`); sadece `TozSolutions_Ai_Office` repo |
| parallel work | ⚠️ Kısmen | `task` + 18 subagent var, **ama tek provider → paralel çağrılar aynı credential'a yüklenir**; ayrıca `--auto` yoksa paralel agent'lar `ask`'e takılıp bloklanabilir |

---

## DOĞRULANMAMIŞ OLANLAR

Default model · T1–T16 testleri · `webfetch`/`websearch` fiili izinleri · F2/F3 runtime davranışı ·
encoding bozukluğunun gerçek olup olmadığı · Hermes–superpowers skill çakışması ·
`agentmemory` skillinin yüklenip yüklenmediği · tüm build/lint/test komutları.

---

## DEĞİŞİKLİK KAYDI

Hiçbir dosya, config, package, MCP, skill veya agent değiştirilmedi.
Hiçbir Git commit yapılmadı. Hiçbir dış sisteme veri gönderilmedi.

**OPENCODE AUDIT COMPLETE**