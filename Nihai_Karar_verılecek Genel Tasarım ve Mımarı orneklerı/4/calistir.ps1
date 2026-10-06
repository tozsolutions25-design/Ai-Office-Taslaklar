<#
  TOZ SOLUTIONS OTONOM AI OFISI v3 — TEK KURULUM NOKTASI

  ONCE OKU: 40_Kurulum\00_ADIM_ADIM_KURULUM.md

  Bu dosya sirayla 6 sey yapar:
     0. Onay verilmis anayasayi kontrol et      -> ihlal varsa DUR
     1. Semayi kur  (0core/01-kuyruk/kuyruk.db)
     2. Sir taramasi yap
     3. Env degiskenlerini kontrol et
     4. Yerel modeli kontrol et
     5. Mimari testlerini calistir              -> kirmizi varsa DUR

  Kirmizi isik = sistem acilmaz.
  Bu bir kural degil, bir arac.

  Calistir:  .\calistir.ps1          (sistem)
             .\calistir.ps1 -Kurulum (kurulum)
#>

[CmdletBinding()]
param(
    [switch]$Kurulum,   # Sadece kurulum: kur + test, kuyrugu isleme
    [switch]$Test,      # Sadece test
    [switch]$Anayasa,   # Sadece anayasa kontrolu
    [switch]$Durum      # Sadece durum raporu
)

$ErrorActionPreference = "Continue"
$ROOT = $PSScriptRoot
$ARAC = Join-Path $ROOT "00-core\07-araclar"

function Bas {
    Write-Host ""
    Write-Host ("=" * 66) -ForegroundColor Cyan
    Write-Host "  $($args[0])" -ForegroundColor Cyan
    Write-Host ("=" * 66) -ForegroundColor Cyan
}
function Adim {
    param([string]$Mesaj)
    Write-Host ""
    Write-Host ">> $Mesaj" -ForegroundColor Yellow
}
function Tamam {
    param([string]$Mesaj)
    Write-Host "   [TAMAM] $Mesaj" -ForegroundColor Green
}
function Hata {
    param([string]$Mesaj)
    Write-Host "   [HATA] $Mesaj" -ForegroundColor Red
}
function Uyar {
    param([string]$Mesaj)
    Write-Host "   [UYARI] $Mesaj" -ForegroundColor Yellow
}

# ------------------------------------------------------------- 0) ANAYASA
function AnayasaKontrol {
    Adim "ADIM 0/5 — Anayasa kontrolu (8 kural)"
    $r = & python (Join-Path $ARAC "anayasa_kontrolu.py") 2>&1
    $r | ForEach-Object { Write-Host "   $_" }
    return ($LASTEXITCODE -eq 0)
}

# -------------------------------------------------------------- 1) SEMA
function SemaKur {
    Adim "ADIM 1/5 — Kuyruk semasi"
    $r = & python (Join-Path $ARAC "db_init.py") 2>&1
    $r | ForEach-Object { Write-Host "   $_" }
    return ($LASTEXITCODE -eq 0)
}

# ------------------------------------------------------------ 2) SIR
function SirTara {
    Adim "ADIM 2/5 — Sir taramasi"
    $r = & python (Join-Path $ARAC "sir_tara.py") 2>&1
    $r | ForEach-Object { Write-Host "   $_" }
    return ($LASTEXITCODE -eq 0)
}

# ------------------------------------------------------- 3) ENV
function EnvKontrol {
    Adim "ADIM 3/5 — Ortam degiskenleri"
    $gerekli = @("OPENROUTER_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY")
    $bulunan = 0
    foreach ($a in $gerekli) {
        $v = [Environment]::GetEnvironmentVariable($a)
        if ($v) {
            # Sir DEGERI ASLA gosterilmez; yalnizca uzunlugu.
            Tamam ("{0} = {1} karakter" -f $a, $v.Length)
            $bulunan++
        }
        else {
            Uyar ("{0} YOK. Bu saglayici rota disi kalir." -f $a)
        }
    }
    if ($bulunan -eq 0) {
        Hata "Hicbir bulut anahtari yok."
        Uyar "Sistem YALNIZCA yerel modelle calisir (kalite dusuk)."
        Uyar "En az bir anahtar ekle: 40_Kurulum\00_ADIM_ADIM_KURULUM.md"
        return $false
    }
    return $true
}

# ------------------------------------------------------- 4) YEREL
function YerelKontrol {
    Adim "ADIM 4/5 — Yerel model (Ollama)"
    try {
        $v = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" `
            -TimeoutSec 4 -ErrorAction Stop
        $modeller = @($v.models | ForEach-Object { $_.name })
        if ($modeller.Count -gt 0) {
            Tamam ("Ollama calisiyor. {0} model yuklu:" -f $modeller.Count)
            foreach ($m in $modeller) { Write-Host "        - $m" }
            $qwen = $modeller | Where-Object { $_ -like "*qwen*" }
            if ($qwen) {
                Tamam "Rota hedefi bulundu: $($qwen[0])"
            }
            else {
                Uyar "qwen modeli YOK. Yerel fallback calismaz."
                Uyar "ollama pull qwen2.5-coder:7b"
            }
            return $true
        }
        Hata "Ollama ayakta ama model YOK: ollama pull qwen2.5-coder:7b"
        return $false
    }
    catch {
        Hata "Ollama yanit vermiyor."
        Uyar "Bulut anahtari varsa sorun DEGIL. Olmazsa failover kirilir."
        Uyar "Kurulum: https://ollama.com/download"
        return $false
    }
}

# ------------------------------------------------------- 5) TEST
function TestleriCalistir {
    Adim "ADIM 5/5 — Mimari testler"
    & python (Join-Path $ARAC "test_mimarisi.py")
    return ($LASTEXITCODE -eq 0)
}

# =========================================================== ANA AKI S
function Calistir {
    Bas "TOZ SOLUTIONS OTONOM AI OFISI v3 — KURULUM"
    Write-Host "  Kurulum once. Sirayla."
    Write-Host ""

    Write-Host "  1) Bu klasorde PowerShell'de calistir:"
    Write-Host "       .\calistir.ps1"
    Write-Host ""
    Write-Host "  2) Eksik anahtarlari ekle (bilmiyorsan BOS gec):"
    foreach ($a in @("OPENROUTER_API_KEY", "GEMINI_API_KEY",
            "GROQ_API_KEY")) {
        Write-Host "       `$env:$a = `"...`""
    }
    Write-Host ""
    Write-Host "  3) Yerel model (Opsiyonel ama onerilir):"
    Write-Host "       ollama pull qwen2.5-coder:7b"
    Write-Host ""
    Write-Host "  4) Sistem ac:"
    Write-Host "       .\calistir.ps1"
    Write-Host ""
    Write-Host "  Detayli anlatim: 40_Kurulum\00_ADIM_ADIM_KURULUM.md"
    Write-Host ""
}

function Sistem {
    Bas "TOZ SOLUTIONS OTONOM AI OFISI v3"

    Adim "ADIM 0/6 — Anayasa kontrolu"
    if (-not (AnayasaKontrol)) {
        Hata "ANAYASA IHLALI. Sistem acilmaz."
        Hata "Detay: 10_Anayasa\anayasa.md"
        return
    }
    Tamam "Anayasa 8/8"

    Adim "ADIM 1/6 — Kuyruk semasi"
    if (-not (SemaKur)) {
        Hata "Sema kurulamadi. Dosya kilitli olabilir."
        return
    }

    Adim "ADIM 2/6 — Sir taramasi"
    SirTara | Out-Null

    Adim "ADIM 3/6 — Ortam degiskenleri"
    $envOk = EnvKontrol

    Adim "ADIM 4/6 — Yerel model"
    $yerelOk = YerelKontrol
    if (-not $envOk -and -not $yerelOk) {
        Hata "NE bulut anahtari NE yerel model var. Calisacak yol yok."
        return
    }

    Adim "ADIM 5/6 — Mimari testler"
    if (-not (TestleriCalistir)) {
        Hata "TESTLER KIRMIZI. Sistem acilmaz."
        Uyar "Once testleri duzelt."
        return
    }

    Adim "ADIM 6/6 — Kuyruk isleme"
    & python (Join-Path $ARAC "worker.py")
}

# =========================================================== GIRIS
if ($Anayasa) { AnayasaKontrol | Out-Null; return }
if ($Test) { TestleriCalistir; return }
if ($Durum) {
    & python (Join-Path $ARAC "worker.py") --durum
    return
}
if ($Kurulum) { Calistir; return }
Sistem