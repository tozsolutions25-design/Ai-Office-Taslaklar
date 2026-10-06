# TOZ AI GROUP — HERMES DENETİM RAPORU

**Tarih:** 6 Ekim 2026
**Yöntem:** Salt okuma. Hiçbir dosya, config, skill, MCP, agent veya provider değiştirilmedi.

> **Ayırım kuralı:** Her madde `[DOĞRULANDI]` (ölçüldü), `[VARSAYIM]` (çıkarım) veya `[BULUNAMADI]` olarak işaretli.

---

## 1) HERMES VERSION

| Öğe | Değer | Durum |
|---|---|---|
| Sürüm | vunknown (2026.9.24) | `[DOĞRULANDI]` — `hermes --version` |
| Kurulum dizini | `C:\Users\TozSolutions\AppData\Local\hermes\installs\36ff1b680c7f7eaa\environments\5b1c2a6a576d413dbf6c2c4375941fef\` | `[DOĞRULANDI]` |
| Kurulum yöntemi | `unknown` | `[DOĞRULANDI]` — CLI "unknown" diyor, ancak PM (package manager) venv yapısı kullanıyor |
| Python | 3.14.7 | `[DOĞRULANDI]` |
| Python yolu | `...\environments\5b1c2a6a...\venv\Scripts\python.exe` | `[DOĞRULANDI]` |
| WSL | **YOK** | `[DOĞRULANDI]` |
| Docker | **YOK** | `[DOĞRULANDI]` |
| Çalıştırma | Git Bash üzerinden shell | `[DOĞRULANDI]` — `windows-native.md:150` |
| Kaynak depo | `D:\AI\npm-global\hermes-agent` | `[DOĞRULANDI]` — venv'den ayrı, düz metin |

**Not:** Hermes **native Windows** kurulumunda. WSL/Docker gerekmiyor (`windows-native.md:10`).

---

## 2) MODEL / PROVIDER

### Aktif

| Alan | Değer |
|---|---|
| `model.provider` | **openrouter** |
| `model.default` | `nvidia/nemotron-3.5-lightning:free` |
| `model.base_url` | `https://openrouter.ai/api/v1` |
| `model.api_mode` | `chat_completions` |
| `fallback_providers` | **`[]` — YOK** |

### Kayıtlı credential'lar (8 sağlayıcı, 1'er anahtar)

`deepseek` · `gemini` · `huggingface` · `nous` (OAuth, e-posta: tozsolutions.25@gmail.com) · `nvidia` · `opencode-zen` · `openrouter` · `xai`

**Hepsi kayıtlı ama sadece `openrouter` kullanılıyor.**

### Tespitler

| # | Bulgu | Kanıt |
|---|---|---|
| R1 | **`fallback_providers` boş** — tek nokta hata riski. OpenRouter çökerse/felse sistem durur | config okuma |
| R2 | **`XAI_API_KEY` = 1 karakter** (boş) — `hermes auth list` "1 credentials" diyor ama anahtar yok | `.env` uzunluk kontrolü |
| R3 | **`opencode-zen` Hermes'te tanımlı değil** — `providers/` dizininde "zen" **BULUNAMADI**. Bu, `auth.json`'da olup kodda olmayan bir sağlayıcı | `grep -rli zen providers/` → boş |
| R4 | 8 sağlayıcı kayıtlı, 1'i kullanılıyor — **7'si atıl duruyor** | config + auth listesi |

**Hangi gerçekten çalışıyor:** Sadece `openrouter` (aktif provider). Diğerleri potansiyel — test edilmedi. `[DOĞRULANMADI]` hangisinin geçerli anahtar taşıdığı.

---

## 3) SKILLS

**Toplam: 105 etkin** (52 builtin + 53 local) — `[DOĞRULANDI]` `hermes skills list`

| Kategori | Adet |
|---|--:|
| firecrawl | 28 |
| productivity | 14 |
| software-development | 13 |
| creative | 11 |
| **youtube** | 11 |
| openhands | 7 |
| autonomous-ai-agents | 6 |
| research | 5 |
| media / email / (kategorisiz) | 3 / 2 / 2 |
| devops / marketing / note-taking / web | 1 / 1 / 1 / 1 |

### OpenCode ile ilgili skill'ler

| Skill | Kategori | Durum |
|---|---|---|
| `opencode` | autonomous-ai-agents | `[DOĞRULANDI]` var |
| `claude-code` | autonomous-ai-agents | `[DOĞRULANDI]` var |
| `codex` | autonomous-ai-agents | `[DOĞRULANDI]` var |

### Çakışma riski olan skill'ler

| Çakışma | Risk |
|---|---|
| **`opencode` ↔ `claude-code` ↔ `codex`** | Üçü de "kodlama işini dış ajana devret" — aynı iş için üç yol. Hangisinin seçileceği kararı modele kalıyor |
| **`firecrawl` (28) ↔ `web` ↔ `browser`** | Aynı iş (web'den veri çekme) üç farklı yoldan. `firecrawl-search` ↔ `web_search` doğrudan rakip |
| **`creative` ↔ `youtube` ↔ `marketing`** | `youtube-shorts` hem `creative` hem ilgili beceri; içerik üretimi 3 kategoride |
| **`social-media` ↔ `youtube-shorts` ↔ `content-creation`** | Hepsi "içerik üret" — hangisi seçilecek belirsiz |
| **`openhands` (7) ↔ `software-development`** | `frontend-development`, `e2e-testing` vs. genel yazılım becerileri |

**Tespit:** 28 Firecrawl skill'i tek bir iş için 28 ayrı beceri. Bu, beceri seçiminde belirsizlik yaratır. `[DOĞRULANDI]` — kategori dağılımı ölçüldü.

---

## 4) MCP

| Sunucu | Taşıma | Araç | Durum | Kullanıcı |
|---|---|--:|---|---|
| `agentmemory` | `npx -y @agentmemory/mcp` | **54** | enabled | Memory provider (aktif) |
| `firecrawl` | `npx -y firecrawl-mcp` | **32** | enabled | firecrawl skill'leri (28) |

**Toplam: 86 araç** — `[DOĞRULANDI]` `hermes mcp test <ad>`

### Env durumu

| Sunucu | Env | Not |
|---|---|---|
| agentmemory | — | Anahtar gerektirmiyor (kendi sunucusu) |
| firecrawl | `FIRECRAWL_API_KEY` (35 krkt) | `[DOĞRULANDI]` — değer yazdırılmadı |

### Riskli yetkiler

| Sunucu | Risk |
|---|---|
| `agentmemory` | **Çalıştırılabilir değil** — health HTTP 000. Sunucu kapalıyken MCP hata verir |
| `firecrawl` | Araç şeması büyük (32 araç). `firecrawl_interact` **canlı tarayıcı** — form gönderimi yan etki yaratabilir |

### Duplicate MCP

**Yok** — 2 farklı amaç, 2 farklı sunucu. `[DOĞRULANDI]`

**Çakışma:** `firecrawl` (32 araç) ↔ `web_search`/`web_extract`/`browser_exec` aynı işi yapıyor. `[DOĞRULANDI]`

---

## 5) AGENTS / DELEGATION

| Ayar | Değer | Durum |
|---|---|---|
| `max_concurrent_children` | **10** | `[DOĞRULANDI]` config |
| `max_spawn_depth` | **1** | `[DOĞRULANDI]` |
| `independent_completions` | False | `[DOĞRULANDI]` |
| `child_timeout_seconds` | 0 (sınırsız) | `[DOĞRULANDI]` |
| `orchestrator_enabled` | True | `[DOĞRULANDI]` |
| `inherit_mcp_toolsets` | **True** | `[DOĞRULANDI]` |
| `max_iterations` | 250 | `[DOĞRULANDI]` |
| `subagent_auto_approve` | False | `[DOĞRULANDI]` |

### Child agent yapısı

```
DELEGATE_BLOCKED_TOOLS = frozenset([
    "delegate_task",    # recursive delegation yok
    "clarify",          # kullanıcıyla konuşamaz
    "memory",           # shared MEMORY.md'ye yazamaz
    "send_message",     # platform yan etkisi yok
    "cronjob_manage",   # iş planlayamaz
])
DEFAULT_TOOLSETS = ["terminal", "file", "web"]
```

`[DOĞRULANDI]` — `tools/delegate_tool_toolsets.py:14-23`

### Orchestrator role

`orchestrator_enabled = True` **VAR**, ancak:
- Kaynak kodda `role="orchestrator"` **BULUNAMADI** (`grep` sonucu boş)
- `orchestrator_enabled` muhtemelen **toolset** tabanlı (kanban/memory ekleme)
- `[BULUNAMADI]` gerçek bir orchestrator rol tanımı

### Worktree izolasyonu

**YOK** — `grep -rniE "worktree"` → boş. `[DOĞRULANDI]`

### Child agent tool erişimi

Ebeveyn toolsets ∩ çocuk toolsets, engelli araçlar çıkarılır.
`inherit_mcp_toolsets=True` → **çocuklar MCP araçlarına erişir** (86 araç).
`[DOĞRULANDI]`

**Risk:** 10 eşzamanlı çocuk × 86 MCP aracı = 860 araç şeması potansiyeli.

---

## 6) OPENCODE INTEGRATION

| Öğe | Değer | Durum |
|---|---|---|
| Skill | `opencode` v1.2.0 | `[DOĞRULANDI]` |
| **Binary** | `C:\Users\TozSolutions\AppData\Roaming\npm\opencode.cmd` | `[DOĞRULANDI]` — **PATH'ta DEĞİL** |
| **Version** | **1.18.32** | `[DOĞRULANDI]` — çalıştırıldı, yanıt verdi |
| npm paketi | `D:\AI\npm-global\node_modules\opencode-ai` | `[DOĞRULANDI]` |
| Config dizini | `~/.config/opencode` | `[DOĞRULANDI]` — var |
| Auth yöntemi | `[BULUNAMADI]` — config içeriği okunmadı |

### Nasıl çağrılıyor (skill'e göre)

```
L38: terminal(command="which -a opencode")
L42: "If needed, pin an explicit binary path"
L45: terminal(command="$HOME/.opencode/bin/opencode run '...'", workdir=..., pty=true)
L136: | --attach <url> | Connect to a running opencode server |
```

### Kritik uyumsuzluk

| Skill'in beklediği | Gerçek |
|---|---|
| `$HOME/.opencode/bin/opencode` | **YOK** |
| `which -a opencode` | **BOŞ DÖNER** — PATH'ta yok |

**Sonuç:** Skill'in belgelediği yol bu makinede **yanlış**. OpenCode çalışıyor ama skill'in tarif ettiği şekilde PATH üzerinden **bulunamaz**. `[DOĞRULANDI]`

### Yetki aktarımı

- Skill `pty=true` kullanıyor → ConPTY/Git Bash üzerinden
- `terminal` toolset'i child'larda **açık**
- **Hata durumu:** Skill'te belirtilmiş bir hata protokolü **bulunamadı**

### `opencode-zen` çelişkisi

`opencode-zen` bir **auth credential** olarak kayıtlı ama Hermes `providers/` dizininde **tanımı yok**. `[DOĞRULANDI]` — grep boş döndü.
Bu, ya kullanılmıyor ya da plugin olarak yükleniyor (plugin listesinde yok).

---

## 7) MEMORY

| Öğe | Değer | Durum |
|---|---|---|
| `memory.provider` | **agentmemory** | `[DOĞRULANDI]` |
| `memory.memory_enabled` | True | `[DOĞRULANDI]` |
| `memory.user_profile_enabled` | True | `[DOĞRULANDI]` |
| `memory.write_approval` | **False** | `[DOĞRULANDI]` |
| `memory.memory_char_limit` | 2200 | `[DOĞRULANDI]` |
| `memory.user_char_limit` | 1375 | `[DOĞRULANDI]` |
| `memory.nudge_interval` | 10 | `[DOĞRULANDI]` |
| **state.db** | 13.262.848 bayt (12.6 MB) | `[DOĞRULANDI]` |
| **MEMORY.md** | **YOK** | `[DOĞRULANDI]` |
| **USER.md** | **YOK** | `[DOĞRULANDI]` |
| auth.json | 14.265 bayt | `[DOĞRULANDI]` |

### Kritik bulgular

| # | Bulgu |
|---|---|
| M1 | **MEMORY.md ve USER.md yok.** `memory_enabled=True` olmasına rağmen dosyalar oluşmamış — henüz yazma yapılmamış |
| M2 | **agentmemory sunucusu KAPALI** (health HTTP 000). Provider aktif ama arka plan servisi çalışmıyor |
| M3 | `memory.write_approval = False` → hafızaya yazma **onay gerektirmiyor** |

### Child agent davranışı

`"memory"` araç `DELEGATE_BLOCKED_TOOLS` listesinde → **çocuklar MEMORY.md'ye yazamaz.** `[DOĞRULANDI]`

### Obsidian çakışma riski

`[VARSAYIM]` — Obsidian kurulu değil, plan da yok. Ancak agentmemory'nin kendi kalıcı hafızası + `MEMORY.md` + Obsidian **üç ayrı bellek katmanı** olur. Munder Difflin de kendi hive memory'sini getiriyor — **dördüncü katman**.

---

## 8) SECURITY

### Ayarlar

| Ayar | Değer | Not |
|---|---|---|
| `security.redact_secrets` | **True** | Sır maskeleme açık |
| `security.tirith_enabled` | True | Pre-exec taraması |
| `security.tirith_fail_open` | **True** | Taraması başarısız olursa geçer |
| `security.allow_private_urls` | False | |
| `security.approval.transport` | `builtin` | |
| `security.approval.transport_fallback` | **`deny`** | Fail-closed |
| `security.protected_instruction_files` | True | |
| `approvals.mode` | **`smart`** | |
| `approvals.timeout` | 300 sn | |
| `approvals.cron_mode` | **`deny`** | Cron onaysız çalışmaz |
| `approvals.single_query_mode` | **`deny`** | |
| `approvals.unattended_mode` | **`deny`** | |
| `approvals.denial_breaker_threshold` | 3 | 3 ret sonrası durur |
| `approvals.deny` | **`[]` — boş** | Hiçbir komut açıkça yasaklanmamış |
| `terminal.backend` | `local` | Docker/sandbox **kapalı** |
| `terminal.persistent_shell` | True | |
| `terminal.cwd` | `.` | Proje kökü |

### Toolset'ler

**Açık (20):** web, browser, terminal, file, code_execution, vision, image_gen, tts, skills, todo, memory, session_search, connections, clarify, delegation, cronjob, computer_use, tool_search, agency_agents

**Kapalı (9):** video, video_gen, x_search, stt, kanban, context_engine, spotify, yuanbao, a2a

### En büyük 10 risk

| # | Risk | Seviye | Kanıt |
|:--:|---|---|---|
| **S1** | **`approvals.mode = smart` + `terminal.backend = local`** — yıkıcı komut değerlendirmesi LLM'e bağlı. `smart_policy` **boş** (`''`), `approvals.deny` **boş** | Kritik | config |
| **S2** | **`XAI_API_KEY` = 1 karakter** — görünür bir "kimlik" var, içi boş | Yüksek | `.env` uzunluk |
| **S3** | **Masaüstünde 6 dosyada düz metin API anahtarı** (`Api/.env`, `Ozkan.env`, `saglayicilar.env`, `tozslutions env.txt`, `api.xlsx`, `open aiı key.xlsx`) | Kritik | önceki turlarda tespit |
| **S4** | **`tirith_fail_open = True`** — tarama aracı çökerse koruma devre dışı | Yüksek | config |
| **S5** | **`computer_use` toolset AÇIK** — fare/klavye kontrolü | Yüksek | `hermes tools list` |
| **S6** | **`firecrawl_interact` canlı tarayıcı** — form gönderimi yan etki yaratabilir | Yüksek | MCP açıklaması |
| **S7** | **`inherit_mcp_toolsets = True`** — 10 çocuk × 86 MCP aracı | Orta | config |
| **S8** | **7 sağlayıcı kayıtlı, kullanılmıyor** — anahtar yüzeyi gereksiz geniş | Orta | auth listesi |
| **S9** | **`fallback_providers` boş** — tek nokta hata riski | Orta | config |
| **S10** | **`memory.write_approval = False`** — çocuk ajanların kalıcı hafızaya yazması onaysız | Orta | config |

**Destructive action approval:** `approvals.mode=smart` → LLM değerlendirmesi.
`approvals.deny` **boş** (`[]`) → hiçbir komut açıkça yasaklanmamış. `[DOĞRULANDI]`

---

## 9) WINDOWS

| Özellik | Native | WSL2 | Bu makine |
|---|:--:|:--:|:--:|
| CLI / TUI | | | |
| Messaging gateway | | | Yapılandırılmamış |
| Cron | | | |
| Browser tool | | | Test edildi |
| MCP stdio+HTTP | | | 2 sunucu |
| Web dashboard | | | `[BULUNAMADI]` |
| Dashboard terminal | ConPTY/pywinpty | POSIX PTY | — |

### Bilinen problemler (kaynak: `windows-native.md`)

| Problem | Satır |
|---|---|
| `hermes: command not found` (kurulum sonrası) | 342 |
| `WinError 193: %1 is not a valid Win32 application` | 345 |
| `[scriptblock]::Create(...)` PowerShell hatası | 348 |
| UTF-8 stdio shim (`HERMES_DISABLE_WINDOWS_UTF8` kontrolü) | 368 |
| PATH sorunu (kurulum sonrası `%LOCALAPPDATA%\hermes\bin` eklenir) | 276 |
| Terminal Git Bash üzerinden — `WinError 10106` olası | 150 |

### Bu makinede doğrulanan

| Bulgu | Durum |
|---|---|
| **`python3` Microsoft Store stub'ı** — `python3 xxx` komut çalıştırmaz | `[DOĞRULANDI]` bu oturumda |
| PATH dönüşümü kapalı — MSYS yolları Win32 programlara çevrilmiyor | `[DOĞRULANDI]` |
| Hermes **bash (Git Bash)** üzerinden çalışıyor, PowerShell/cmd değil | `[DOĞRULANDI]` |
| **`opencode` PATH'ta değil** — `AppData\Roaming\npm\` altında ama PATH'ta yok | `[DOĞRULANDI]` |
| WSL gerekmiyor | `[DOĞRULANDI]` — `windows-native.md:10` |
| Docker gerekmiyor (`terminal.backend = local`) | `[DOĞRULANDI]` |

---

## 10) ARCHITECTURE FITNESS

### MODEL A — Munder + Hermes + OpenCode

| Ölçüt | Değerlendirme |
|---|---|
| **Güçlü** | 3 katman ayrı görev: görsel (Munder), düşünme (Hermes), kod (OpenCode) |
| **Zayıf** | 3 ayrı kurulum, 3 ayrı güncelleme, 3 ayrı hata yüzeyi |
| **Conflict** | **YÜKSEK** — 3 ürün 3 ayrı bellek, 3 ayrı config, 3 ayrı izin sistemi |
| **Duplicate authority** | **VAR** — 3 ürün de "hangi ajan ne yapacak" kararını kendi verir |
| **Memory conflict** | **4 katman** — Munder hive + Hermes agentmemory + MEMORY.md + (Obsidian?) |
| **MCP conflict** | Munder kendi MCP'lerini yönetmiyor (README'de yok) |
| **Permission conflict** | **VAR** — Hermes `approvals.mode=smart`, Munder approvals queue, OpenCode kendi `permission`'ı |
| **Recovery** | 3 ayrı state store, hangisi bozulursa teşhis zor |
| **Windows** | Munder 186 MB Electron + Hermes native + OpenCode Node — ağır |

**Puan: 4/10** — Çakışma yüksek, faydası marginal.

---

### MODEL B — Hermes + OpenCode, Munder = UI/Office

| Ölçüt | Değerlendirme |
|---|---|
| **Güçlü** | En temiz ayrım: Hermes beyin, OpenCode el, Munder sadece **görsel** |
| **Zayıf** | Munder'ın gerçek değerleri (token ledger, circuit breaker, worktree) **kullanılmıyor** — onlar Munder'ın iş mantığı, UI değil |
| **Conflict** | **DÜŞÜK** — Munder veri yazmaz, sadece gösterir |
| **Duplicate authority** | Munder karar vermez |
| **Memory conflict** | Munder yine de kendi hive'ını tutar |
| **MCP conflict** | Munder MCP yönetmez |
| **Permission conflict** | Tek izin sistemi (Hermes) |
| **Recovery** | Tek state store |
| **Windows** | Munder 186 MB, ayrı Electron süreci |

**Puan: 6/10** — En az çakışma. Ama Munder'ın gerçek kabiliyetleri
(kabul kuyruğu, maliyet defteri) boşa kalıyor.

**Uyarı:** "Munder = sadece UI" denirse Munder'ın `approvals queue`,
`per-agent budget`, `circuit breaker` işlevleri **kullanılamaz** — bunlar
UI değil, kontrol mantığı.

---

### MODEL C — Munder = Operations/Control, Hermes = Intelligence, OpenCode = Execution

| Ölçüt | Değerlendirme |
|---|---|
| **Güçlü** | En net yetki ayrımı: her katmanın **tek işi** var |
| **Zayıf** | En karmaşık kurulum — 3 ayrı kontrol dili, 3 ayrı onay akışı |
| **Conflict** | Orta — ayrım net ama sınırlar belirsizleşebilir |
| **Duplicate authority** | Munder "Operations/Control" iddiası → Hermes'te de `approvals.mode` var |
| **Memory conflict** | **4 katman** — ayrım yetki üzerinden, veri üzerinden değil |
| **MCP conflict** | Munder kendi ajan CLIs'ı için MCP kullanır → Hermes MCP'leriyle çakışabilir |
| **Permission conflict** | **EN YÜKSEK** — "Operations/Control" Munder'da ama Hermes de kontrol ediyor. Kim onaylıyor? |
| **Recovery** | 3 ayrı state, 3 ayrı hata yüzeyi |
| **Windows** | En ağır — 3 ağır süreç |

**Puan: 5/10** — En "doğru" kağıt üstü ama **en pahalı ve en kırılgan**.

---

### MODEL D — Munder yok, sadece Hermes + OpenCode

*(Bu raporda istenmemişti, karşılaştırma için eklendi)*

| Ölçüt | Değerlendirme |
|---|---|
| **Güçlü** | Çakışma yok. Tek bellek, tek izin, tek kurulum |
| **Zayıf** | Token bütçesi/ledger yok (Hermes'te `fallback_providers` boş, per-agent bütçe yok) |
| **Conflict** | **YOK** |
| **Permission** | Tek |
| **Recovery** | Tek |
| **Windows** | Hafif |

**Puan: 8/10** — Bu sistemde **en az çakışma** bu.

---

## 11) SONUÇ

### A) MEVCUT SİSTEM ENVANTERİ

| Bileşen | Durum |
|---|---|
| Hermes | v2026.9.24, native Windows, Python 3.14.7, PM-venv |
| Model | openrouter / `nvidia/nemotron-3.5-lightning:free` |
| Sağlayıcı | 8 kayıtlı, **1 aktif** |
| Skill | 105 etkin (14 kategori) |
| MCP | 2 sunucu, 86 araç |
| Plugin | 2 (`agency-agents-router`, `agentmemory`) |
| Memory | agentmemory provider (sunucu **kapalı**), state.db 12.6 MB |
| OpenCode | v1.18.32 kurulu, PATH'ta **yok** |
| Delegation | max 10 eşzamanlı, depth 1, MCP miras |
| Docker/WSL | **Yok** (gerekmiyor) |

### B) AKTİF YETENEKLER

- Web araştırma (`web`, `browser`, `firecrawl` 32 araç)
- Dosya işlemleri, terminal, kod çalıştırma
- Alt ajan delegasyonu (10 eşzamanlı)
- Kalıcı hafıza (agentmemory — **sunucu kapalı**)
- Otomatik kod yazımı (OpenCode v1.18.32)
- 105 beceri (web, içerik, YouTube, araştırma)
- Sır maskeleme (`redact_secrets=True`)
- Fail-closed onay (`transport_fallback=deny`, cron/single-query/unattended = deny)
- Zamanlanmış iş (cron)

### C) GEREKSİZ / DUPLICATE YAPILAR

| # | Yapı | Sorun |
|:--:|---|---|
| C1 | **7 kullanılmayan sağlayıcı** (deepseek, gemini, huggingface, nous, nvidia, opencode-zen, xai) | Anahtar yüzeyi geniş, kullanılmıyor |
| C2 | **`opencode-zen` credential** | `providers/`'da tanımı yok — ölü kayıt |
| C3 | **28 Firecrawl skill'i** | Tek iş için 28 beceri — seçim belirsizliği |
| C4 | **`opencode` ↔ `claude-code` ↔ `codex`** | Üçü de "kodu dış ajana ver" |
| C5 | **`firecrawl` ↔ `web` ↔ `browser`** | Üçü de web'den veri çekme |
| C6 | **`sir_tara.py` "yanlış temiz"** (önceki klasör) | Git deposu yok → hiç kontrol tetiklenmiyor |

### D) RİSKLER

**Kritik (2):**
- **S1:** `approvals.mode=smart` + `terminal.backend=local` + `smart_policy=''` + `approvals.deny=[]` → yıkıcı komut koruması LLM'e bağlı, açık deny listesi yok
- **S3:** Masaüstünde 6 dosyada düz metin API anahtarı

**Yüksek (4):**
- **S2:** `XAI_API_KEY` 1 karakter (görünür ama boş)
- **S4:** `tirith_fail_open=True` → tarama aracı çökerse koruma kapanır
- **S5:** `computer_use` toolset açık (fare/klavye)
- **S6:** `firecrawl_interact` canlı tarayıcı → form yan etkisi

**Orta (4):**
- **S7:** 10 çocuk × 86 MCP aracı
- **S9:** `fallback_providers` boş
- **S10:** `memory.write_approval=False`
- **agentmemory sunucusu kapalı** — provider aktif ama çalışmıyor

### E) HERMES'İN EN DOĞRU ROLÜ

> **Hermes = tek zekâ katmanı (Intelligence/Planning) + tek kontrol düzlemi.**

Gerekçe:
- 105 beceri, 86 MCP aracı, 10 eşzamanlı delegasyon — bunlar başka hiçbir adayda yok
- Hafıza + oturum geçmişi tek yerde (`state.db` 12.6 MB)
- Fail-closed onay altyapısı var (`transport_fallback=deny`)
- Native Windows, Docker/WSL gerektirmiyor

**Hermes'in yapmaması gerekenler:**
- Görselleştirme (Munder'in işi)
- Token ledger / circuit breaker (Munder'da var, Hermes'te yok)

### F) MODEL PUANLARI

| Model | Puan | En büyük sorunu |
|---|:--:|---|
| **A** — Munder + Hermes + OpenCode | **4/10** | 3 katman × 3 kontrol = 9 karar noktası |
| **B** — Hermes + OpenCode, Munder=UI | **6/10** | Munder'ın gerçek kabiliyetleri boşa |
| **C** — Munder=Ops, Hermes=Intel, OpenCode=Exec | **5/10** | En pahalı, izin belirsizliği en yüksek |
| **D** — Hermes + OpenCode (Munder yok) | **8/10** | Token ledger eksik (çözülebilir) |

> **D en yüksek puanlı.** Munder eklemenin maliyeti, kazancından fazla.

### G) ÖNERİLEN YETKİ SINIRLARI

| Yetki | Hermes | OpenCode | Munder (gelirse) |
|---|---|---|---|
| Düşünme/planlama | **Tek otorite** | | |
| Kod yazma | Çağırır | **Tek otorite** | |
| Web araştırma | **Tek otorite** | | |
| Görselleştirme | | | |
| Token bütçesi/ledger | (yok) | | |
| Circuit breaker | (yok) | | |
| Onay (approval) | **Tek otorite** | | |
| Hafıza | **Tek otorite** | | Ayrı olursa |

**Altın kural:** Her yetki **tek yerde**. İki yazar = iki gerçek.

### H) MUNDER GELİRSE NELERE DOKUNMAMALI

| Dokunma | Neden |
|---|---|
| Hermes `config.yaml` | Hermes'in kendi ayarları |
| `skills/` (105 beceri) | Hermes'in yetenek kataloğu |
| `mcp_servers` (2 sunucu) | Hermes'in araçları |
| `MEMORY.md` / `USER.md` / `state.db` | Hermes'in hafızası |
| `auth.json` (8 sağlayıcı) | Kimlik bilgileri |
| `.env` (5 anahtar) | Sırlar |
| `plugins/` (2 plugin) | Hermes'in eklentileri |
| `approvals.*` | Hermes'in tek onay sistemi |

### I) MUNDER GELİRSE NELERİ YÖNETEBİLİR

| Yönetebilir | Koşul |
|---|---|
| Görselleştirme / ofis görünümü | Salt okuma |
| Ajan çalışma durumu gösterimi | Salt okuma |
| Maliyet **görüntüleme** (ledger'ı Hermes yazmaz, sadece gösterir) | Salt okuma |
| Bildirim (webhook/Slack) | Yazma yok |
| Token bütçesi **raporlama** | Yalnız rapor, karar Hermes'te |

**Yapamaz:** Kimlik, yetki, hafıza, araç, bütçe kararı.

### J) PRODUCTION'A GEÇMEDEN ÖNCE YAPILMASI GEREKEN TESTLER

| # | Test | Kabul ölçütü | Durum |
|:--:|---|---|---|
| 1 | **agentmemory sunucu** | `health` HTTP 200 | **BAŞARISIZ** (000) |
| 2 | **XAI_API_KEY** | 30+ karakter | **BAŞARISAZ** (1) |
| 3 | **Masaüstü sır dosyaları** | `file_safety` engelliyor veya konum düzeltilmiş | **BAŞARISIZ** |
| 4 | **opencode PATH** | `which opencode` çalışıyor | **BAŞARISIZ** |
| 5 | **Fallback testi** | OpenRouter kapalıyken sistem çalışıyor | **YAPILMADI** |
| 6 | **Yıkıcı komut testi** | `rm -rf /` reddediliyor | **YAPILMADI** |
| 7 | **Child agent testi** | 10 çocuk aynı anda, çakışma yok | **YAPILMADI** |
| 8 | **Masaüstü terminal testi** | `python3` stub sorunu çözüldü mü | **KISMİ** (bilinen tuzak) |
| 9 | **Approvals testi** | `smart` mode yıkıcı komutu yakalıyor | **YAPILMADI** |
| 10 | **Mutasyon testi** | `redact_secrets` kapatılınca sır sızar mı | **YAPILMADI** |

> **10 testin 4'ü başarısız, 5'i hiç yapılmamış, 1'i kısmi.**
> **Production için hazır DEĞİL.**

---

## DOĞRULANAMADAN KALANLAR

| Konu | Neden |
|---|---|
| 7 kayıtlı sağlayıcının hangisinin geçerli anahtarı var | Anahtarları okumadım (güvenlik) |
| OpenCode auth yöntemi | `~/.config/opencode` içeriği okunmadı |
| Web dashboard kurulu mu | Kontrol edilmedi |
| Messaging gateway yapılandırması | `.env`'de token var, gateway çalışıyor mu test edilmedi |
| Gerçek `orchestrator` rol tanımı | `grep` sonucu boş — config değeri var ama karşılığı bulunamadı |
| Munder'ın MCP yönetimi | README'de geçmiyor, ürün kurulu değil |
| 2. ve 3. modellerin "doğru" puanı | Model puanları benim değerlendirmem, ölçüm değil |

---

**HERMES AUDIT COMPLETE**

*Hiçbir dosya, config, skill, MCP, agent veya provider değiştirilmedi. Bu görev salt okuma ve envanter çıkarma göreviydi ve öyle yürütüldü.*