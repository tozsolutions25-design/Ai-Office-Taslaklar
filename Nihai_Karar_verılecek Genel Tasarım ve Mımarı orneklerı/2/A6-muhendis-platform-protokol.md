# A6 — Hermes ↔ OpenCode Worker Protokolü ve Windows Kurulum Sırası

Tarih: 2026-10-06 · PowerShell 5.1 · Node v24.21.0 · npm 11.19.0 · maks. 320 satır

## 0. Ölçülmüş gerçekler

| Kanıt | Komut | Sonuç |
|---|---|---|
| Aktif OpenCode | `opencode --version` | `1.18.32` |
| Shadowed | `Get-Command opencode -All` | `D:\AI\npm-global\opencode.cmd` = 1.18.34, ikinci |
| Headless run | `opencode run -m opencode/space-bunny-free "…"` | ÇALIŞIYOR |
| JSON akış | `opencode run --format json …` | her satırda `sessionID`; ilk `step_start`, son `step_finish` + token/cost; ID = `ses_<28 karakter>` |
| Fallback | `hermes fallback list` | `No fallback providers configured.` |
| Ücretsiz model | `opencode models \| Select-String free` | 10 model, hepsi `opencode/*` |

## 1. Worker protokolü

### 1.1 Hangi alt komut

| Komut | Karar | Gerekçe |
|---|---|---|
| `opencode run` | **VARSAYILAN** | Tek süreç, deterministik stdout, bittiğinde ölür |
| `opencode serve` | yalnızca worker havuzu | Süreç/port/cleanup maliyeti; 1 görevde gereksiz |
| `opencode acp` | HAYIR | IDE/Zed protokolü; Hermes JSON sözleşmesiyle konuşuyor |

### 1.2 Tam komut şablonu

`opencode` global `.cmd` olarak kurulu ama `.ps1` sarmalayıcısı var; PowerShell 5.1
execution policy onu reddedebilir. Bu yüzden **tam `.cmd` yolu** kullanılır:

```powershell
$Oc = "C:\Users\TozSolutions\AppData\Roaming\npm\opencode.cmd"
$WorkDir = "D:\AI\TozSolutions_Ai_Office"
$Task = "src/core/parser.ts içindeki FIXME'leri incele, SADECE raporla, dosya yazma."
$Timeout = 600

$p = Start-Process -FilePath $Oc `
  -ArgumentList @("run","--format","json","--model","opencode/space-bunny-free",
                  "--dir",$WorkDir,"--title","hermes-task",$Task) `
  -NoNewWindow -PassThru `
  -RedirectStandardOutput "$env:TEMP\oc-worker.out.json" `
  -RedirectStandardError  "$env:TEMP\oc-worker.err.txt"

if (-not $p.WaitForExit($Timeout * 1000)) { $p.Kill(); throw "TIMEOUT: $Timeout sn" }
$exit = $p.ExitCode
```

`Start-Process` seçildi: `& $Oc ...` çağrısında PowerShell `opencode.ps1`'in stderr
çıktısını `NativeCommandError` sanabiliyor; `Start-Process` stream'leri ayırıp
**gerçek** exit code veriyor.

### 1.3 Session ID yönetimi

```powershell
$lines = Get-Content "$env:TEMP\oc-worker.out.json" -Encoding UTF8 | Where-Object { $_.Trim() }
$sid = ($lines[0] | ConvertFrom-Json).sessionID
if ($sid -notmatch '^ses_[A-Za-z0-9]{20,}$') { throw "SESSION_ID_YOK: [$sid]" }
```

Devam turu (yarım kalan görevi kaybetmemek için yeni süreç DEĞİL, aynı session):

```powershell
& $Oc run --format json --session $sid --dir $WorkDir "Simdi sadece 3. maddenin cevabını yaz."
```

### 1.4 Sonuç okuma

```powershell
$events = $lines | ForEach-Object { $_ | ConvertFrom-Json }
$answer = ($events | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.part.text }) -join "`n"
$final  = $events | Where-Object { $_.type -eq 'step_finish' } | Select-Object -Last 1
$tok    = $final.part.tokens.total
```

`opencode export $sid` tüm geçmişi (dosya okuma/yazma kayıtları dahil) verir —
denetim için, görev sonucu için değil; `step_finish` yeterli.

### 1.5 Hata durumu

```powershell
if ($exit -ne 0) { throw "WORKER_EXIT_$exit`n" + (Get-Content "$env:TEMP\oc-worker.err.txt" -Raw) }
if (-not $final) { throw "INCOMPLETE_NO_STEP_FINISH" }
```

`step_finish` yoksa görev tamamlanmamıştır; exit 0 olsa bile başarı sayılmaz.

### 1.6 Timeout ve yarış

| Katman | Değer | Gerekçe |
|---|---|---|
| `WaitForExit` | 600 sn | ilk açılışta MCP/index başlıyor |
| Eşzamanlılık | **ZORUNLU: 1** | iki worker aynı dosyaya `edit: allow` ile dokunursa yarış durumu |
| Başarısız sonrası | `--session` ile devam | görev kaybolmasın |

Aynı anda yalnız bir worker çalışır; ikinci görev ilk `step_finish` sonrası başlar.

### 1.7 Paralel worker `[DOĞRULANMADI]`

```powershell
$s = Start-Process -FilePath $Oc -ArgumentList @("serve","--port","4123","--hostname","127.0.0.1") -NoNewWindow -PassThru
& $Oc run --attach "http://127.0.0.1:4123" --dir $WorkDir "görev"
```

Denenmedi. Paralellik yalnızca **ayrık dosya ağaçlarında** (core / site) güvenli.

### 1.8 Worker'a neleri yaptırma

| Yasak | Gerekçe |
|---|---|
| `--auto` | "auto-approve permissions that are not explicitly denied (dangerous!)"; `command_allowlist`'i fiilen devre dışı bırakır |
| `git push` / `reset --hard` / `clean` | geri alınamaz, kullanıcı onayı şart |
| `npm install -g` / `update -g` | global durumu değiştirir, shadowed binary sorununu büyütür |
| `Remove-Item -Recurse -Force` | AGENTS.md: silme onaya tabi |
| `.env` okuma/yazma | anahtar sızıntısı |
| `D:\AI\` dışına yazma | `external_directory: "*": allow` var ama bu bir kazı değil |

Varsayılan davranış **salt-okunur**: görev metninde "dosya yazma" yazıyorsa yazar,
yazmıyorsa yazmaz. Yazma görevlerinde `git diff --stat` de raporlatılır.

### 1.9 `--auto` ne zaman

Yalnızca Hermes onay döngüsünden geçmiş sabit komut dizisi için. Tercih edilen:
`command_allowlist`'e o komutu eklemek — `--auto` `edit` ve `external_directory`
izinlerini de gevşetir, komut listesini değil.

## 2. Ajan → ajan görev sözleşmesi

### 2.1 Girdi: `task.json`

```json
{
  "schema_version": "1.0",
  "task_id": "H-2026-1006-001",
  "issuer": "hermes",
  "objective": "src/core/parser.ts içindeki FIXME'leri listele, her birini 1 cümleyle açıkla",
  "workdir": "D:\\AI\\TozSolutions_Ai_Office",
  "mode": "read-only",
  "model": "opencode/space-bunny-free",
  "timeout_sec": 600,
  "acceptance": [
    { "cmd": "npm.cmd run validate", "expect_exit": 0, "cwd": "D:\\AI\\TozSolutions_Ai_Office" }
  ],
  "forbidden": ["git push", "npm install -g", "Remove-Item -Recurse"],
  "context_files": ["src/core/parser.ts"],
  "deliverable": "worker_result.json"
}
```

`mode`: `read-only` (varsayılan) | `write-scoped` (+`scope`) | `verify` (yalnız acceptance).

### 2.2 Çıktı: `worker_result.json`

```json
{
  "schema_version": "1.0",
  "task_id": "H-2026-1006-001",
  "status": "pass",
  "session_id": "ses_eef3885bcffeRtDT8lldk5Tb6D",
  "model": "opencode/space-bunny-free",
  "exit_code": 0,
  "tokens_total": 21186,
  "summary": "3 FIXME bulundu, hepsi null-guard eksikliği",
  "findings": [
    { "file": "src/core/parser.ts", "line": 88, "note": "parse() null döndürebiliyor, çağıran denetlemiyor" }
  ],
  "files_changed": [],
  "commands_run": [{ "cmd": "npm.cmd run validate", "exit": 0 }],
  "acceptance": [
    { "cmd": "npm.cmd run validate", "expect_exit": 0, "actual_exit": 0, "verdict": "pass" }
  ],
  "error": null
}
```

### 2.3 `status` sabit kümesi

| Değer | Anlam |
|---|---|
| `pass` | tüm acceptance komutları beklenen çıkış kodunu verdi |
| `fail` | çalıştı, kabul kriteri sağlanmadı |
| `blocked` | eksik bağımlılık, kapalı MCP, yok dosya |
| `timeout` | `WaitForExit` doldu, süreç öldürüldü |
| `crash` | beklenmeyen çıkış kodu veya `step_finish` yok |

### 2.4 Hata dönerken

`error` alanı hata durumunda asla boş bırakılmaz:

```json
"error": {
  "code": "TIMEOUT_600",
  "stage": "worker_run",
  "message": "worker 600 saniyede kapanmadı",
  "stdout_tail": "son 20 satır",
  "stderr_tail": "son 20 satır",
  "recoverable": true,
  "retry_hint": "opencode run --session ses_... ile devam et"
}
```

`stage`: `worker_spawn` | `worker_run` | `acceptance_run` | `result_parse`.

### 2.5 Kabul kriteri ifadesi

Kabul kriteri **her zaman çalıştırılabilir komut**. "Kod temiz görünüyor" kabul
edilmez. Bu projede tek doğrulama komutu:

```powershell
Push-Location $WorkDir; npm.cmd run validate; $v = $LASTEXITCODE; Pop-Location
# PASS ölçütü: $v -eq 0
```

`status` otomatik hesaplanır, worker'a sorulmaz:

```powershell
$pass = $true
foreach ($a in $result.acceptance) { if ($a.actual_exit -ne $a.expect_exit) { $pass = $false } }
```

### 2.6 Hermes'e verilen prompt sarmalayıcısı

`Aşağıdaki task.json içeriğini uygula. Cevabının sonunda MUTLAKA tek bir json bloğu olsun;
içi worker_result.json şemasına birebir uysun. Başka metin yazma. { …task.json… }`

## 3. Windows kurulum sırası (mevcut sistemleri koruyarak)

Her adım: **komut → doğrulama → PASS → ROLLBACK**.

### ADIM 0 — PATH sırasını ölç (hiçbir şey değiştirmez)

`Get-Command opencode -All | Select-Object Name,Version,Source | Format-List`
**PASS:** tam bir `Source` = `…\Roaming\npm\opencode.cmd`. **ROLLBACK:** yok.

### ADIM 1 — Tam yol sabitle (müdahalesiz çözüm)

`$Oc = "C:\Users\TozSolutions\AppData\Roaming\npm\opencode.cmd"; & $Oc --version`
**PASS:** `1.18.32`. **ROLLBACK:** yok.
**Gerekçe:** 1.18.32/1.18.34 gölgesi hangi binary'nin çalıştığını belirler;
ölçmeden yükseltme kararı verilemez. Sabit yol PATH sırasını devre dışı bırakır.

### ADIM 2 — `$Oc` kalıcı hale getir

```powershell
$Prof = $PROFILE
if (-not (Test-Path -LiteralPath $Prof)) { New-Item -ItemType File -Path $Prof -Force | Out-Null }
Copy-Item -LiteralPath $Prof -Destination "$Prof.bak-20261006" -ErrorAction SilentlyContinue
Add-Content -LiteralPath $Prof -Value "`r`n`$Oc = 'C:\Users\TozSolutions\AppData\Roaming\npm\opencode.cmd'"
. $PROFILE; & $Oc --version
```
**PASS:** `$Oc` boş değil, sürüm `1.18.32`.
**ROLLBACK:** `Remove-Item -LiteralPath $Prof -Force; Copy-Item "$Prof.bak-20261006" $Prof -Force`
**Gerekçe:** ADIM 1 tek oturumda yaşar; yeni Hermes oturumu ADIM 2 olmadan `$Oc`'yi kaybeder.

### ADIM 3 — Execution policy (yalnız gerekirse)

`Get-ExecutionPolicy -List` → `Restricted`/`AllSigned` ise global policy'ye dokunmadan
`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.
**PASS:** `Get-ExecutionPolicy -List | Select-String CurrentUser` → `RemoteSigned`.
**ROLLBACK:** `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Restricted`
**Gerekçe:** ADIM 3 olmadan `npm`/`npx` yazan her komut NativeCommandError ile düşer.

### ADIM 4 — `npx.cmd` tuzağı kalıcı kural

Şablonlarda **her yerde** `npm.cmd`, `npx.cmd`, `pnpm.cmd`. Yanlış kullanım belirtisi:
`npx.ps1 cannot be loaded because running scripts is disabled on this system.`
**PASS:** `npx.cmd --version` çıktı verir, `npx --version` hata verir.

### ADIM 5 — Shadowed binary

`& "D:\AI\npm-global\opencode.cmd" --version` → 1.18.34 beklenir.
- **Seçenek A (önerilen, geri alınabilir):** hiçbir şey silme. `$Oc` ile 1.18.32,
  1.18.34 yalnız tam yolla açıkça çağrılır.
- **Seçenek B (kalıcı tekilleştirme, kullanıcı onayı gerekir):** PATH'te
  `D:\AI\npm-global`, `Roaming\npm`'ten **sonra** gelmeli. Ölç:
  `[Environment]::GetEnvironmentVariable("Path","User") -split ';' | Where-Object { $_ -match 'npm' }`

**PASS:** `opencode --version` tek değer verir ve `$Oc` ile aynıdır.
**ROLLBACK:** `[Environment]::SetEnvironmentVariable("Path",$savedPath,"User")`
**Gerekçe:** iki sürüm aynı anda PATH'te ise hangisinin çalıştığı ortama göre değişir.

### ADIM 6 — Hermes memory provider (bilinçli karar)

Provider `agentmemory`, sunucu **KAPALI** → her açılışta bağlantı hatası beklentisi.
Kalsın → sunucu ayrı iş kalemi. Kapatılsın → önce `hermes memory --help` ile alt
komut adını teyit et: `[DOĞRULANMADI]`.
**Gerekçe:** ADIM 6 öncesi Hermes oturum açma süresi öngörülemez; timeout
kalibrasyonu yapılamaz.

### ADIM 7 — Doğrulama zinciri

`& $Oc --version` · `& $Oc run --model opencode/space-bunny-free "tek kelime yaz: CHAIN_OK"`
· `hermes --version` · `hermes fallback list` ·
`npm.cmd run validate --prefix "D:\AI\TozSolutions_Ai_Office"`
**PASS:** hepsi beklenen çıktı / sıfır çıkış. **ROLLBACK:** yok, salt okuma.

## 4. API anahtarı rotasyonu (config.yaml:199)

`mcp_servers.firecrawl.env.FIRECRAWL_API_KEY` düz metin.

**ADIM A — yedek**
```powershell
$Cfg = "$env:LOCALAPPDATA\hermes\config.yaml"
Copy-Item -LiteralPath $Cfg -Destination "$Cfg.bak-20261006" -Force
(Get-FileHash -LiteralPath $Cfg -Algorithm SHA256).Hash
```
**ROLLBACK:** `Copy-Item "$Cfg.bak-20261006" $Cfg -Force`

**ADIM B — önce yeni anahtarı üret (panelden).** Sıra önemli: eski anahtar hemen
iptal edilmez, çünkü ADIM D başarısız olursa MCP boş kalır.

**ADIM C — env değişkeni**
```powershell
[Environment]::SetEnvironmentVariable("FIRECRAWL_API_KEY","<YENI>","User")
$env:FIRECRAWL_API_KEY.Length    # yeni oturumda 0 olmamalı
```
**ROLLBACK:** `…SetEnvironmentVariable("FIRECRAWL_API_KEY",$null,"User")`

**ADIM D — config'den düz metni kaldır**
```powershell
$c = [System.IO.File]::ReadAllText($Cfg,[System.Text.Encoding]::UTF8)
$c = $c -replace '(?m)^(\s*FIRECRAWL_API_KEY:\s*).+$','$1${env:FIRECRAWL_API_KEY}'
[System.IO.File]::WriteAllText($Cfg,$c,(New-Object System.Text.UTF8Encoding($false)))
Select-String -LiteralPath $Cfg -Pattern 'fc-|FIRECRAWL_API_KEY'
```
`ReadAllText`/`WriteAllText` **zorunlu** — PowerShell 5.1 `Get-Content | Set-Content`
UTF-8'i bozar.
**PASS:** `fc-` öneki olan hiçbir satır kalmaz; kalan satır `${env:FIRECRAWL_API_KEY}` içerir.
**Gerekçe:** ADIM C olmadan ADIM D yapılandırılmamış env'e bağlanır → MCP sessizce
hiç bağlanmaz.

**ADIM E — temizle ve doğrula**
```powershell
hermes mcp list
Select-String -LiteralPath $Cfg -Pattern 'sk-|fc-'     # sıfır eşleşme
```
`.bak` dosyasını da sil (anahtar orada kalır).

`[DOĞRULANMADI]`: `${env:VAR}` deseninin Hermes YAML okuyucusunda gerçekten
genişlediği test edilmedi. ADIM E bunu doğrular; alternatif: `command`'ı `cmd /c`
launcher'a çevirip anahtarı orada okutmak.

## 5. Fallback model

`hermes fallback list` → boş. Yapısal yol: `hermes fallback add` (etkileşimli,
headless'ta çalıştırılamaz), `remove`, `clear`. Config düzeni `[DOĞRULANMADI]`:

```yaml
fallback_model:
  - provider: openrouter
    model: <model-id>
  - provider: opencode
    model: space-bunny-free
```
| Alan | Anlam |
|---|---|
| `provider` | `hermes --provider` ile kabul edilen sağlayıcı adı |
| `model` | sağlayıcının kendi model kimliği |
| kimlik bilgisi | config'e yazılmaz; `hermes auth add <provider>` |

Bu makinede anahtar gerektirmeyen tek ikinci kaynak `opencode/space-bunny-free`
(`opencode models` ile doğrulandı). **PASS:** `hermes fallback list` boş dönmez ve
2. girdi `opencode`. **Gerekçe:** birincil hız limitine girince Hermes durmamalı.

## 6. Gizlenmiş bağımlılık envanteri

| # | Bağımlılık | Ölçüm | Risk | Çözüm |
|---|---|---|---|---|
| 1 | PATH'te iki opencode | `Get-Command opencode -All` | yanlış sürüm | ADIM 1/5 `$Oc` |
| 2 | Execution policy | `Get-ExecutionPolicy -List` | `.ps1` reddi | ADIM 3, `*.cmd` |
| 3 | Node v24 | `node -v` | Hermes venv uyumsuzluğu | Python 3.14 ayrı; bağımsız |
| 4 | Birden çok npm kökü | `npm.cmd root -g` | hangisi aktif belirsiz | `$Oc` sabiti |
| 5 | Git identity yok | `git config --global user.email` | commit "unknown" | `git config --global user.email …` |
| 6 | Git safe.directory | `git config --global --get-all safe.directory` | `dubious ownership` | `git config --global --add safe.directory "D:/AI/TozSolutions_Ai_Office"` |
| 7 | codebase-memory index boş | MCP bağlı, index yok | worker boş sonuç döner | `index_repository` |
| 8 | firecrawl MCP disabled | `opencode mcp list` | araştırma sessizce başarısız | etkinleştir ya da görev verme |
| 9 | agentmemory sunucu kapalı | `hermes status` | açılış hatası | ADIM 6 |
| 10 | Workspace yolu | `Test-Path "D:\AI\TozSolutions_Ai_Office"` | yanlış proje | ADIM 0'da sabitle |
| 11 | `$env:TEMP` dolu | `Get-PSDrive C` | log yazma hatası | logları `D:\AI\OpenCode` altına al |

Tek doğrulama: `Get-Command opencode -All | Select Source; Get-ExecutionPolicy -List;
Test-Path "D:\AI\TozSolutions_Ai_Office"; git config --global --get-all safe.directory`

## 7. Aşamalı teslim ve gerekçe

```
ADIM 0 (ölç) ─> ADIM 1 (sabit yol) ─> ADIM 2 (kalıcı $Oc) ─> ADIM 7 (zincir)
                                            │
              ADIM 3 (policy) ─> ADIM 4 (npx.cmd) ─> ADIM 5 (shadow)
                                            │
                                     ADIM 6 (memory)
```

| Teslim | Bu adım olmadan sonraki neden çalışmaz |
|---|---|
| 0 | sürüm çatışması çözülemez; hangi binary çalışıyor bilinmeden yükseltme kararı verilemez |
| 1 | ölçüm tek oturumla bağlı; sonraki adımın çıktısı hangi sürüme ait doğrulanamaz |
| 2 | yeni Hermes oturumu `$Oc`'yi bulamaz, script boş yola düşer |
| 3 | `.ps1` reddedilir; `npm`/`npx` yazan her komut NativeCommandError |
| 4 | policy düzeltilse de yazım hatası `.ps1`'e düşer; kural teslimin parçası |
| 5 | iki sürüm aktifken "hangi çalıştı" belirsiz, hata teşhisi imkânsız |
| 6 | Hermes açılışı hata verirse timeout kalibrasyonu yapılamaz |
| 7 | altı adım doğrulanmadan protokolü devreye almak risktir |
| Bölüm 4 | sızıntı tüm worker loglarına ve `export` çıktılarına yayılır |
| Bölüm 5 | hız limiti olursa görev sahipsiz kalır |

**Sıra:** 0 → 1 → 2 → 3 → 4 → 5 → 7. Bölüm 6 ve Bölüm 5 kullanıcı kararı gerektirir,
paralel yürütülebilir. Bölüm 4 (anahtar rotasyonu) her durumda en yüksek öncelik.

## 8. Doğrulanmamış noktalar

`${env:VAR}` interpolasyonu (§4 D) · `serve`+`--attach` akışı (§1.7) ·
`hermes fallback add` headless (§5) · `fallback_model` kesin anahtar adları (§5) ·
`hermes memory disable` alt komut adı (§3 ADIM 6)