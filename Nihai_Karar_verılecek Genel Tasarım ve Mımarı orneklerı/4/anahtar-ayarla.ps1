<#
  ANAHTAR AYARLA — API anahtarlarini guvenli tanimla

  Neden bu dosya var:
    Anahtari bir dosyaya yazarsan, o dosya git'e girer ve
    anahtar sizmis olur. Ortam degiskeni HAFIZADA kalir,
    diskte durmaz, ve Git bunu takip ETMEZ.

  Bu script:
    - anahtari EKRANA YAZDIRMAZ (gizli giris)
    - anahtari HICBIR DOSYAYA YAZMAZ
    - sadece Windows ortam degiskenine yazar (setx)
    - hangi saglayici oldugunu ve kac karakter oldugunu gosterir
      (degeri DEGIL)

  Calistir:
      .\anahtar-ayarla.ps1              -> OpenRouter
      .\anahtar-ayarla.ps1 -Saglayici gemini
      .\anahtar-ayarla.ps1 -Saglayici groq
      .\anahtar-ayarla.ps1 -Listele     -> hangileri tanimli
      .\anahtar-ayarla.ps1 -Sil openrouter
#>

[CmdletBinding()]
param(
    [ValidateSet("openrouter", "gemini", "groq")]
    [string]$Saglayici = "openrouter",
    [switch]$Listele,
    [string]$Sil
)

$ErrorActionPreference = "Stop"

$TANIM = @{
    "openrouter" = @{
        Ad      = "OpenRouter"
        Degisken = "OPENROUTER_API_KEY"
        Site    = "https://openrouter.ai/keys"
        Bicim   = "^sk-or-v1-[A-Za-z0-9]{32,}$"
        Aciklama = "Ucretsiz modeller icin ':free' sonekli olanlari sec."
    }
    "gemini" = @{
        Ad      = "Google Gemini"
        Degisken = "GEMINI_API_KEY"
        Site    = "https://aistudio.google.com/apikey"
        Bicim   = "^AIza[A-Za-z0-9_\-]{35}$"
        Aciklama = "Ucretsiz katman gunluk sinirli."
    }
    "groq" = @{
        Ad      = "Groq"
        Degisken = "GROQ_API_KEY"
        Site    = "https://console.groq.com/keys"
        Bicim   = "^gsk_[A-Za-z0-9]{40,}$"
        Aciklama = "Ucretsiz katman DAKIKA hiz limitli (gunluk degil)."
    }
}

function Bas {
    Write-Host ""
    Write-Host ("=" * 64) -ForegroundColor Cyan
    Write-Host "  $($args[0])" -ForegroundColor Cyan
    Write-Host ("=" * 64) -ForegroundColor Cyan
}

# ------------------------------------------------------------ SILME
if ($Sil) {
    if (-not $TANIM.ContainsKey($Sil)) {
        Write-Host "Bilinmeyen saglayici: $Sil" -ForegroundColor Red
        Write-Host "Secenekler: openrouter, gemini, groq"
        exit 1
    }
    $d = $TANIM[$Sil].Degisken
    [Environment]::SetEnvironmentVariable($d, $null, "User")
    Bas "SILINDI: $d"
    Write-Host "Bu terminal icin de silindi."
    [Environment]::SetEnvironmentVariable($d, $null, "Process")
    Write-Host "Yeni terminal acman gerekir."
    exit 0
}

# ------------------------------------------------------------ LISTELE
if ($Listele) {
    Bas "TANIMLI OLAN ANAHTARLAR"
    Write-Host ""
    $var = 0
    foreach ($k in $TANIM.Keys | Sort-Object) {
        $d = $TANIM[$k].Degisken
        $v = [Environment]::GetEnvironmentVariable($d)
        if ($v) {
            Write-Host "  [VAR]  $d" -ForegroundColor Green
            Write-Host "         $($v.Length) karakter  ($($TANIM[$k].Ad))"
            $var++
        }
        else {
            Write-Host "  [YOK]  $d" -ForegroundColor DarkGray
        }
    }
    Write-Host ""
    if ($var -eq 0) {
        Write-Host "  Hicbir anahtar tanimli degil." -ForegroundColor Yellow
        Write-Host "  Sistem YALNIZCA yerel modelle calisir."
    }
    else {
        Write-Host "  $var anahtar tanimli." -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "  Deger ASLA gosterilmez. Sadece uzunluk gosterilir." -ForegroundColor DarkGray
    exit 0
}

# ------------------------------------------------------------ AYARLA
$t = $TANIM[$Saglayici]

Bas "$($t.Ad) ANAHTARI"

Write-Host ""
Write-Host "  Adres    : $($t.Site)"
Write-Host "  Once oradanda 'Create Key' / 'Create API Key' ile anahtarini al."
Write-Host "  Not      : $($t.Aciklama)"
Write-Host ""
Write-Host "  ANAHTAR BU EKRANA GORUNMEZ. KOPYALAYIP YAPISTIR."
Write-Host "  Karsilarda gorunmez kalacak (yildiz degil, BOS)."
Write-Host ""

$anahtar = Read-Host "  Anahtari yapistirin" -AsSecureString

if (-not $anahtar) {
    Write-Host ""
    Write-Host "  [IPTAL] Anahtar girilmedi." -ForegroundColor Yellow
    exit 1
}

# SecureString -> duz metin (sadece setx icin, ekrana basilmaz)
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($anahtar)
try {
    $duz = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
}
finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

$duz = $duz.Trim()

# --- DOGRULAMA: bicim tutmuyorsa YAZMA ---
if ($duz -notmatch $t.Bicim) {
    Write-Host ""
    Write-Host "  [HATA] Anahtar bicimi tutmuyor." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Beklenen: $($t.Bicim)"
    Write-Host "  Aldigin : $($duz.Length) karakter"
    if ($duz.Length -gt 8) {
        Write-Host "           ilk 3: $($duz.Substring(0,3))...  son 2: $($duz.Substring($duz.Length-2))"
    }
    Write-Host ""
    Write-Host "  Tekrar dene. Anahtar YAZILMADI."
    exit 1
}

# --- YAZ ---
[Environment]::SetEnvironmentVariable($t.Degisken, $duz, "User")
[Environment]::SetEnvironmentVariable($t.Degisken, $duz, "Process")

Write-Host ""
Write-Host "  [TAMAM] $($t.Degisken) tanimlandi." -ForegroundColor Green
Write-Host "  Uzunluk : $($duz.Length) karakter"
Write-Host "  Kayit   : Windows ortam degiskeni (User)"
Write-Host "  Diskte  : Hicbir dosyada YOK"
Write-Host "  Git     : Takip EDILMEZ"
Write-Host ""

# Bellekteki duz metni temizle
$duz = $null

Write-Host "  YENI TERMINAL ACMAN GEREKIYOR." -ForegroundColor Yellow
Write-Host "  Mevcut terminalde `$env:` ile gosterilmez."
Write-Host ""
Write-Host "  Kontrol icin:"
Write-Host "    .\anahtar-ayarla.ps1 -Listele"
Write-Host ""
Write-Host "  Sistem ac:"
Write-Host "    .\calistir.ps1"
Write-Host ""