# TOZ AI GROUP — KURULUM KOMUTLARI

> **Ortam:** PowerShell 5.1 · native Windows · Node 24.21.0 · npm 11.19.0 · Git 2.55.0
> **Kural:** Her adımta **komut → PASS ölçütü → ROLLBACK** vardır.
> **Bir adımın PASS ölçütü sağlanmadan sonraki adım çalıştırılmaz.**
> **Hiçbir komut veri silmez, sürücü biçimlendirmez, `git push` yapmaz.**
> ⚠️ `npm.cmd` / `npx.cmd` kullanılır (`npx` değil) — PowerShell 5.1 `.ps1` sarmalayıcı
> engelidir. Dosya yazarkir `[System.IO.File]::WriteAllText` kullanılır (`Set-Content`
> UTF-8 bozar).

---

## ADIM 0 — YEDEK (hiçbir şeyden önce)

```powershell
$Yedek = "D:\AI\Yedek\TOZ_$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $Yedek -Force | Out-Null
Copy-Item "$env:APPDATA\hermes" "$Yedek\hermes" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$env:LOCALAPPDATA\hermes" "$Yedek\hermes-local" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$env:USERPROFILE\.config\opencode" "$Yedek\opencode-config" -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $Yedek | Select-Object Name
```

**PASS:** `hermes`, `hermes-local`, `opencode-config` klasörleri listelenir.
**ROLLBACK:** Silme yok — yedek klasörü olduğu gibi durur.

---

## ADIM 1 — API ANAHTARI ROTASYONU (P0-1, P0-2)

**Neden ilk sırada:** `config.yaml:199` içinde `FIRECRAWL_API_KEY` düz metin.
`TELEGRAM_BOT_TOKEN` (46 karakter, gerçek) `.env` içinde düz metin.

### 1.1 Yapılacaklar (SIRA BOZMA)

1. Firecrawl panelinden **anahtarı iptal et** ve yenisini üret.
2. Aynı şekilde Telegram bot token'ı `/revoke` ile geçersiz kıl.
3. Yeni anahtarları **kullanıcı ortam değişkeni** olarak tanımla.
4. Config'den düz metni temizle.

### 1.2 Önce kanıt al (hiçbir şeyi değiştirmeden)

```powershell
$p = "$env:LOCALAPPDATA\hermes\config.yaml"
Select-String -Path $p -Pattern '^\s*[A-Za-z_]*(KEY|TOKEN|SECRET)[A-Za-z_]*:\s*\S+' |
  ForEach-Object { "SATIR $($_.LineNumber): $($_.Matches[0].Value.Split(':')[0].Trim())  <-- DEGER DOLU" }
```

**PASS:** Yalnız anahtar **adları** listelenir. Hiçbir `DEGER DOLU` satırı yoksa temiz.
**Şu an:** 1 eşleşme (`FIRECRAWL_API_KEY`) → **temizlenmeli**.

### 1.3 Ortam değişkenine taşı

```powershell
# Yeni değerleri elle gir: - değer ekrana basılmasın
$newFirecrawl = Read-Host "Yeni FIRECRAWL_API_KEY (0 ise girme)"
if ($newFirecrawl -and $newFirecrawl.Length -ge 20) {
  [System.Environment]::SetEnvironmentVariable('FIRECRAWL_API_KEY', $newFirecrawl, 'User')
  "FIRECRAWL_API_KEY -> User ortam degiskeni (gorunur: $(([System.Environment]::GetEnvironmentVariable('FIRECRAWL_API_KEY','User')).Length) karakter)"
} else { "Atlandi: anahtar gerekli degilse firecrawl sunucusu kapali kalsin" }
```

### 1.4 Config'den düz metni temizle (UTF-8 korumalı)

```powershell
$YedekCfg = "$env:LOCALAPPDATA\hermes\config.yaml.bak.toz"
Copy-Item $p $YedekCfg -Force
$t = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
$t = [regex]::Replace($t, '(?m)^(\s*FIRECRAWL_API_KEY:\s*).+$', '$1${FIRECRAWL_API_KEY}')
[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))
Select-String -Path $p -Pattern 'FIRECRAWL_API_KEY'
```

> ⚠️ **Şema doğrulaması yapılmadı.** `${VAR}` interpolasyonunun Hermes config'inde
> desteklenip desteklenmediği `[DOĞRULANMADI]`. Desteklenmiyorsa **güvenli alternatif**:
> firecrawl MCP'yi `enabled: false` yapıp `env:` bloğunu **tamamen kaldır** — sunucu
> zaten kullanılmıyor.

### 1.5 Telegram kararı

**Seçenek A (önerilen, en sade): kanalı kapat.**

```powershell
$env2 = "$env:LOCALAPPDATA\hermes\.env"
Copy-Item $env2 "$env2.bak.toz" -Force
$t = [System.IO.File]::ReadAllText($env2, [System.Text.Encoding]::UTF8)
$t = [regex]::Replace($t, '(?m)^TELEGRAM_.*$', '# TELEGRAM_KAPALI $&')
[System.IO.File]::WriteAllText($env2, $t, (New-Object System.Text.UTF8Encoding($false)))
Select-String -Path $env2 -Pattern '^TELEGRAM'
```

**Seçenek B:** Kanal açık kalacaksa `config.yaml:74-97` arasındaki `telegram`
toolset listesinden `terminal`, `file`, `computer_use`, `browser`, `delegation`
**kaldırılır** — yalnız `clarify`, `memory`, `session_search` kalsın.
*Bir bot token'ı + toolset kısıtlaması olmadan = uzaktan tam makine erişimi.*

**PASS (A):** `Select-String '^TELEGRAM'` → 0 eşleşme.
**PASS (B):** Telegram toolset listesinde terminal/computer_use yok.
**ROLLBACK:** `Copy-Item $YedekCfg $p -Force`

---

## ADIM 2 — HERMES GÜVENLİK (P0-3 … P0-7, P0-11)

**Neden:** Hermes `approvals.deny` boş, pre-exec taraması çalışmıyor, `computer_use`
açık, 10 çocuk × 86 MCP aracı miras ediyor.

```powershell
$cfg = "$env:LOCALAPPDATA\hermes\config.yaml"
Copy-Item $cfg "$cfg.bak.toz-guvenlik" -Force
```

### 2.1 `computer_use` ve `browser` kapat

```powershell
$t = [System.IO.File]::ReadAllText($cfg, [System.Text.Encoding]::UTF8)
# computer_use backend'i kaldır
$t = $t -replace '(?m)^computer_use:\r?\n(?:  .*\r?\n)+', ''
# browser backend'i kaldır
$t = $t -replace '(?m)^browser:\r?\n(?:  .*\r?\n)+', ''
# platform_toolsets ve known_* listelerinden computer_use ve browser satirlarini sil
$t = $t -replace '(?m)^\s*-\s*computer_use\s*\r?\n', ''
$t = $t -replace '(?m)^\s*-\s*browser\s*\r?\n', ''
[System.IO.File]::WriteAllText($cfg, $t, (New-Object System.Text.UTF8Encoding($false)))
Select-String -Path $cfg -Pattern 'computer_use|browser'
```

**PASS:** 0 eşleşme (yorum satırları hariç).

### 2.2 `approvals.deny` doldur (fail-closed)

```powershell
$deny = @'

approvals:
  mode: smart
  timeout: 300
  deny:
    - "rm -rf"
    - "rm -fr"
    - "Remove-Item -Recurse -Force"
    - "Remove-Item.*-Recurse"
    - "format"
    - "diskpart"
    - "cipher /w"
    - "dd if="
    - "mkfs"
    - "del /s /q"
    - "rd /s /q"
    - "vssadmin delete shadows"
    - "bcdedit"
    - "Set-ItemProperty"
    - "New-ItemProperty"
    - "reg delete"
    - "git push --force"
    - "git reset --hard"
    - "git clean -fd"
    - "Invoke-Expression"
    - "cmd /c"
    - "powershell -enc"
  cron_mode: deny
  single_query_mode: deny
  unattended_mode: deny
  transport_fallback: deny
'@
$t = [System.IO.File]::ReadAllText($cfg, [System.Text.Encoding]::UTF8)
if ($t -notmatch '(?m)^approvals:') { $t = $t + $deny }
[System.IO.File]::WriteAllText($cfg, $t, (New-Object System.Text.UTF8Encoding($false)))
Select-String -Path $cfg -Pattern '^\s*-\s*"rm -rf"|^approvals:'
```

> `[DOĞRULANMADI]` — `approvals.deny` desen eşleştirme sözdizimi (glob/regex/kelime)
> kaynak kodda doğrulanmalı. Doğrulama:
> ```powershell
> Select-String -Path "D:\AI\npm-global\hermes-agent\hermes_cli\config.py" -Pattern 'deny' -Context 2,2
> ```
> Desenler yanlış ise Hermes'in **kendi `approvals.deny`** anahtarını kullan; liste
> kabul edilmeyecekse **sistem kapalı kalır** (fail-closed).

### 2.3 Pre-exec taraması fail-closed yap

```powershell
$sec = @'

security:
  redact_secrets: true
  tirith_enabled: true
  tirith_fail_open: false
'@
$t = [System.IO.File]::ReadAllText($cfg, [System.Text.Encoding]::UTF8)
if ($t -notmatch '(?m)^security:') { $t = $t + $sec }
[System.IO.File]::WriteAllText($cfg, $t, (New-Object System.Text.UTF8Encoding($false)))
Get-Command tirith -ErrorAction SilentlyContinue | Select-Object Source
```

**PASS:** `Get-Command tirith` bir yol döndürür. **Döndürmüyorsa tirith kurulu
değildir** — `tirith_fail_open: false` bu durumda tüm komutları reddedecektir.
O zaman: (a) tirith'i kur, veya (b) `tirith_enabled: false` + `deny` listesine güven
ve bunu risk olarak kaydet. **(a) önerilir.**

### 2.4 MCP mirasını kapat

```powershell
$t = [System.IO.File]::ReadAllText($cfg, [System.Text.Encoding]::UTF8)
$t = $t -replace '(?m)^(\s*)inherit_mcp_toolsets:\s*true\s*$', '$1inherit_mcp_toolsets: false'
[System.IO.File]::WriteAllText($cfg, $t, (New-Object System.Text.UTF8Encoding($false)))
Select-String -Path $cfg -Pattern 'inherit_mcp_toolsets'
```

**PASS:** `inherit_mcp_toolsets: false`.

### 2.5 Doğrulama

```powershell
hermes --version
hermes mcp list
hermes tools list
```

**PASS:** Hermes açılıyor, hata vermiyor, `computer_use` listede yok.
**ROLLBACK:** `Copy-Item "$cfg.bak.toz-guvenlik" $cfg -Force`

---

## ADIM 3 — OPENCODE İZİN SERTLEŞTİRME (P0-8 … P0-10)

**Neden:** `bash "*": "allow"` + `external_directory "*": "allow"` kombinasyonu
sınır kavramını fiilen yok ediyor. **`ask` fail-closed DEĞİLDİR** (`--auto` düşürür);
`deny` fail-closed'dur.

```powershell
$oc = "$env:USERPROFILE\.config\opencode\opencode.jsonc"
Copy-Item $oc "$oc.bak.toz" -Force
```

### 3.1 Yeni config

```powershell
$yeni = @'
{
  "$schema": "https://opencode.ai/config.json",

  "plugin": [
    "~/.config/opencode/node_modules/superpowers"
  ],

  "mcp": {
    "codebase-memory": {
      "type": "local",
      "command": [
        "C:\\Users\\TozSolutions\\AppData\\Roaming\\Python\\Python314\\Scripts\\codebase-memory-mcp.exe"
      ],
      "enabled": true
    }
  },

  "permission": {
    "edit": "allow",
    "write": "allow",
    "bash": {
      "*": "deny",
      "npm.cmd *": "allow",
      "npx.cmd *": "ask",
      "node *": "allow",
      "git status": "allow",
      "git diff*": "allow",
      "git log*": "allow",
      "git add*": "allow",
      "git commit*": "allow",
      "git push*": "deny",
      "git reset*": "deny",
      "git clean*": "deny",
      "npm.cmd install*": "ask",
      "npm.cmd i *": "ask",
      "pip install*": "deny",
      "curl *": "deny",
      "Invoke-WebRequest *": "deny",
      "Start-Process *": "deny",
      "Invoke-Expression *": "deny",
      "cmd /c *": "deny",
      "powershell -enc *": "deny",
      "Remove-Item *": "deny",
      "reg *": "deny",
      "regedit *": "deny",
      "Set-ItemProperty *": "deny",
      "New-ItemProperty *": "deny",
      "mkdir *": "allow",
      "echo *": "allow",
      "pwd": "allow",
      "cd *": "allow",
      "Get-*": "allow",
      "Test-Path *": "allow",
      "Select-String *": "allow",
      "exit": "allow"
    },
    "external_directory": {
      "*": "deny",
      "D:\\AI\\**": "allow",
      "C:\\Users\\TozSolutions\\Desktop\\Nihai Karar\\**": "allow"
    }
  },

  "experimental": {
    "mcp_timeout": 120000
  },

  "tool_output": {
    "max_lines": 200,
    "max_bytes": 16384
  }
}
'@
[System.IO.File]::WriteAllText($oc, $yeni, (New-Object System.Text.UTF8Encoding($false)))
```

**Değişikliklerin gerekçesi:**

| Değişiklik | Eski | Yeni | Neden |
|---|---|---|---|
| `bash["*"]` | `allow` | **`deny`** | Varsayılan reddedilir → fail-closed. `ask` `--auto` ile düşer, `deny` düşmez. |
| `external_directory` | `"*": allow` | `deny` + beyaz liste | Proje dışına çıkış izinsiz |
| `git push/reset/clean` | `ask` | `deny` | Fail-closed; insan ayrıca izin verir |
| `pip install`, `curl`, `Invoke-WebRequest` | `ask` | `deny` | Dışa veri çıkışı / paket kurulumu |
| `firecrawl` MCP | `enabled:false` | **kaldırıldı** | Ölü tanım + anahtar yüzeyi |
| `mcp_timeout` | 45 sn | **120 sn** | İlk `index_repository` native runtime indiriyor → 45 sn yetersiz |

> **Not:** `ask` desenlerinin öncelik sırası `[DOĞRULANMADI]`. `"*": deny` kuralı
> özgül desenlerden **önce** geliyorsa izin hiç işlemez. Doğrulama:
> ```powershell
> opencode.cmd run "denetim: bash izni ne? sadece 'pwd' calistir ve sonucu yaz"
> ```
> Sonuç `pwd` çıktısı veriyorsa öncelik doğru; `PermissionDenied` veriyorsa sıra
> ters → `*` kuralı sona alınır.

### 3.2 `--auto` engeli

```powershell
# Ayarlar > Kısayollar altinda "opencode" calistirma komutunu kontrol et.
# `--auto` bayraginin TUM gorunur kullanim noktalarinda kaldirilmasini oner.
# Asagidaki dogrulama her oturumda:
opencode.cmd --help | Select-String 'auto'
```

**PASS:** `--auto` hiçbir kısayolda geçmiyor.
**ROLLBACK:** `Copy-Item "$oc.bak.toz" $oc -Force`

### 3.3 Doğrulama

```powershell
opencode.cmd --version
opencode.cmd mcp list
opencode.cmd run --model opencode/space-bunny-free "pwd calistir ve sadece sonucu yaz"
```

**PASS:** `PERM_TEST`-tipi yanıt; `bash` reddi bekleniyorsa `PermissionDenied` **doğru
davranıştır**.

---

## ADIM 4 — SHADOWED BINARY ÇÖZÜMÜ

**Neden:** `Get-Command opencode -All` 3 konum gösteriyor; aktif 1.18.32, PATH'te
ikinci 1.18.34. Hangi sürümün çalıştığı belirsiz.

### 4.1 Ölç

```powershell
Get-Command opencode -All | Select-Object Source
opencode.cmd --version
& "D:\AI\npm-global\opencode.cmd" --version
```

**PASS:** İki sürüm açıkça farklı → sorun doğrulandı.

### 4.2 Çözüm — Seçenek A (müdahalesiz, önerilen)

```powershell
# PATH'i degistirme. Tek bir sabit yol kullan ve HER komutta onu yaz.
$Oc = "C:\Users\TozSolutions\AppData\Roaming\npm\opencode.cmd"
& $Oc --version
```

Worker protokolünde (bkz. `_ajan-ciktilari/A6`) **her zaman** `$Oc` kullanılır.

### 4.3 Çözüm — Seçenek B (kalıcı, tek sürüm)

```powershell
npm.cmd uninstall -g opencode-ai            # calisi durumda oldugu icin ONCE durdur
# eski surumu D: uzerinden kaldir
Remove-Item "D:\AI\npm-global\opencode.ps1","D:\AI\npm-global\opencode.cmd" -Force
Get-Command opencode -All | Select-Object Source
opencode.cmd --version
```

**PASS:** Tek konum, tek sürüm.
**ROLLBACK:** `npm.cmd install -g opencode-ai`

---

## ADIM 5 — GÖREV DURUMU (`tasks.db`) — TEK YAZICI

**Neden:** Görev durumunun tek sahibi olmalı. Hermes `kanban.db` / `state.db` şeması
Hermes'e ait; TOZ'un şeması TOZ'a ait olmalı.

```powershell
$Kok = "C:\Users\TozSolutions\TOZ_AI_GROUP"
New-Item -ItemType Directory -Path "$Kok\20_VERI" -Force | Out-Null
New-Item -ItemType Directory -Path "$Kok\20_VERI\tasks.db.yedek" -Force | Out-Null
```

> **Şema bir sonraki adımda kodla oluşturulur.** Burada yalnızca yer hazırlanır —
> çünkü "kurulduktan sonra yeniden tasarlanacak" tuzağına girmemek için şema tek
> seferde, testleriyle birlikte yazılır. Şema: `tasks.db` (görev), `events` (append-only
> olay günlüğü), `olcum` (haftalık metrik). **Silme yok** — kapatma `status='closed'`
> ile yapılır.

**PASS:** Klasörler oluşur.
**ROLLBACK:** Yok (veri yazılmadı).

---

## ADIM 6 — KLASÖR YAPISI + GIT

```powershell
$dizi = @('00_SIRKET\kararlar','00_SIRKET\hizmetler','00_SIRKET\paketler','00_SIRKET\marka',
          '10_AJANLAR','20_VERI','30_HAFIZA\haftalik','30_HAFIZA\arsiv',
          '40_PROJE\_gecici','50_GUVENLIK','60_IS_AKISI','90_MIMARI\_ajan-ciktilari')
foreach ($d in $dizi) { New-Item -ItemType Directory -Path "$Kok\$d" -Force | Out-Null }
Get-ChildItem $Kok -Recurse -Directory | Select-Object -ExpandProperty FullName
```

```powershell
git init $Kok
Set-Location $Kok
@"
20_VERI/*.db
20_VERI/*.db-wal
20_VERI/*.db-shm
40_PROJE/_gecici/
.env
*.key
"@ | Set-Content -Path "$Kok\.gitignore" -Encoding UTF8
git add -A
git -c user.name="TOZ" -c user.email="toz@local" commit -m "Mimari: dizin yapisi ve .gitignore"
```

> `tasks.db` **git'e girmez** (ikili dosya + kilit dosyaları). Yedekleme
> `20_VERI\tasks.db.yedek\` altına günlük alınır — **veri yedeklenir, sürümlenmez.**
> Görev durumunun git geçmişi değil, `events` tablosu vardır (append-only).

**PASS:** `git status` temiz, `.gitignore` yerinde.
**ROLLBACK:** `Remove-Item "$Kok\.git" -Recurse -Force` (veri klasörleri kalır).

---

## ADIM 7 — HERMES ↔ OPENCODE WORKER TESTİ

**Neden:** İki sistem arasındaki tek kritik bağ bu. Çalışmıyorsa mimari boş.

### 7.1 Sabit binary ile tek iş

```powershell
$Oc = "C:\Users\TozSolutions\AppData\Roaming\npm\opencode.cmd"
$job = @{
  id     = "T-0001"
  scope  = "C:\Users\TozSolutions\TOZ_AI_GROUP\40_PROJE\_gecici"
  goal   = "T-0001.md dosyasina tek satir yaz: worker-protokol-testi"
  accept = "Dosya var ve icerigi tam olarak 'worker-protokol-testi'"
} | ConvertTo-Json
[System.IO.File]::WriteAllText("$Kok\40_PROJE\_gecici\task.json", $job, (New-Object System.Text.UTF8Encoding($false)))

& $Oc run --model opencode/space-bunny-free "task.json dosyasini oku. Scopedaki dosyayi olustur. Bitti. Sonuc tek satir yaz: worker_result: pass"
```

**PASS:** `worker_result: pass` **ve** dosya içeriği doğru.

```powershell
Get-Content "$Kok\40_PROJE\_gecici\T-0001.md"
```

**ROLLBACK:** `Remove-Item "$Kok\40_PROJE\_gecici\T-0001.md" -Force`

### 7.2 Red durumu testi (dizin dışına çıkma denemesi)

```powershell
& $Oc run --model opencode/space-bunner-free" `
  "C:\Windows\System32\drivers\etc\hosts dosyasini okumaya calis. Sonuc tek satir yaz."
```

**PASS:** **Reddedilir.** `PermissionDenied` veya açıklama. *Burada "reddedildi" demek
`PASS`'tır.* Reddedilirse `external_directory` kuralı çalışıyor demektir.

---

## ADIM 8 — AJAN KADROSU (7 ajan)

**Neden:** İş birimleri ancak ajan kadrosu bağlandıktan sonra çalışır.

```powershell
$yol = "$env:LOCALAPPDATA\hermes\plugins\agency-agents-router"
Test-Path $yol
Get-ChildItem $yol -ErrorAction SilentlyContinue | Select-Object -First 20 Name
```

> **PASS ölçütü değil, doğrulama adımı:** Eklentinin gerçek yolü bulunur.
> Bulunamazsa: `hermes plugins list` ile kayıt adı teyit edilir.

Kadro tanımı `10_AJANLAR\00-kadro-tanimlari.yaml` olarak yazılır: her ajan için
`yetki`, `danisma_esigi`, `calismayi_birakma`, `yapamaz`. **Boşta ajan tanımı yazılmaz.**

---

## ADIM 9 — SKILL AZALTMA (89 → ≤25)

```powershell
$sk = "$env:USERPROFILE\.config\opencode\skills"
if (Test-Path $sk) {
  "firecrawl-* skill sayisi: " + (Get-ChildItem $sk -Directory -Filter 'firecrawl-*' -EA SilentlyContinue).Count
  Get-ChildItem $sk -Directory -Filter 'firecrawl-*' | ForEach-Object {
    Rename-Item $_.FullName ($_.Name + '.pasif') -EA SilentlyContinue
  }
  "kalan: " + (Get-ChildItem $sk -Directory).Count
}
```

> **Yeniden adlandırma, silme değildir — geri alınabilir.** Yanlışlıkla silinirse
> kurulum notlarıyla geri gelir. `.pasif` yerine `Remove-Item` **kullanılmaz.**

**PASS:** Yüklü skill ≤ 25.
**ROLLBACK:** `Get-ChildItem $sk -Filter '*.pasif' | ForEach-Object { Rename-Item $_.FullName ($_.Name -replace '\.pasif$','') }`

---

## ADIM 10 — codebase-memory İNDEKSİ

**PASS öncüsü — checksum doğrulaması:**

```powershell
# Ilk cagri native runtime indirir ve checksum dogrular.
# Once indirilecek dosyanin SHA256'unu resmi kaynaktan al ve KARSILASTIR.
Get-FileHash "C:\Users\TozSolutions\.codebase-memory\*" -Algorithm SHA256 -EA SilentlyContinue
```

**Kural (AGENTS.md):** İndirilen binary **çalıştırılmadan önce** SHA256 checksum resmi
kaynaktan indirilip karşılaştırılmalıdır. Karşılaştırma yapılamıyorsa indeks adımı
**atlanır** — MCP'nin boş kalması zararsız, doğrulanmamış çalıştırma zararlıdır.

```powershell
$repo = "D:\AI\TozSolutions_Ai_Office"
# MCP araci uzerinden: index_repository(repo_path=$repo)
```

**PASS:** `list_projects` → ≥ 1 proje.
**ROLLBACK:** `delete_project` (indeks siler, kaynak koda dokunmaz).

---

## ADIM 11 — KURUMSAL SİTE DÜZELTMELERİ

```powershell
$site = "D:\AI\TozSolutions_Ai_Office"
Set-Location $site
npm.cmd run validate
```

**PASS:** exit code 0.
**Düzeltilmesi gerekenler (SEO uzmanı raporundan):** `lang="en"` → `lang="tr"` ·
`CANONICAL_ORIGIN = "https://example.invalid"` → gerçek alan adı · `Organization` /
`Person` / `sameAs` şeması · `og:image` · `llms.txt` · başlık hiyerarşisi testi.

**ROLLBACK:** `git checkout -- .`

---

## ADIM 12 — MEVZUAT SAYFALARI

`/kvkk-iletisim`, `/gizlilik`, `/izinler` yayına alınır. Reklam uzmanı raporuna göre
bunlar zorunlu. İçerik: reklam uzmanı çıktısı bölüm 6.

---

## ADIM 13 — GÖZLEM + MALİYET

`20_VERI\olcum.jsonl` — haftalık her oturumda satır: `tarih`, `sistem`, `is`, `sure_sn`,
`token`, `maliyet`, `durum`. `total_cost = 0` olsa da satır **silinmez** — ücretsiz
katmanın kullanımı da görünür olmalı.

---

## ADIM 14 — İLK PİLOT (kapalı kutu)

**Neden:** Gerçek müşteri verisi ancak 10 güvenlik kapısı yeşil olduktan sonra girer.

Kapı tablosu `50_GUVENLIK\test_kapilari.md`'de. **8 kapı şu an doğrulanmış olarak
BAŞARISIZ** (G1–G7 + F4). Pilot bu kapılar kapanmadan başlamaz.

---

## ÖZET: SIRALAMA GEREKÇESİ

| Adım | Neden bu sırada |
|---|---|
| 0 Yedek | Her şeyden önce geri dönülebilirlik |
| 1 Sır rotasyonu | Sızıntı diğer her şeyden hızlı büyür; anahtar geçersiz kılınmadan güvenlik ayarının anlamı yok |
| 2 Hermes güvenlik | Uzaktan erişim yüzeyi (Telegram + computer_use) kapanmadan hiçbir test güvenli değil |
| 3 OpenCode izin | İşçinin yetkisi en geniş; beyin güvenli olsa da işçi güvensizse sistem güvensiz |
| 4 Binary | Aşağıdaki tüm testler hangi sürümde çalıştığını bilmeli |
| 5 `tasks.db` | Görev durumu sahipsizse mimari eksik |
| 6 Klasörler + git | Hafıza mimarisi için ön koşul |
| 7 Worker testi | İki sistem bağının çalıştığı kanıtlanmadan gerisi boş |
| 8 Ajan kadrosu | İş birimleri |
| 9 Skill azaltma | Bağlam kalitesi; ajanlardan sonra |
| 10 İndeks | Kod grafiği; yavaş, riskli (checksum), en sona |
| 11–13 Site, mevzuat, ölçüm | Ticari hazırlık |
| 14 Pilot | Her şey geçtiğinde |

---

**BELGE SONU**