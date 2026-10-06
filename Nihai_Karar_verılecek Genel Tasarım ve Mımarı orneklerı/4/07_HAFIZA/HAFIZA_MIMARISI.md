# HAFIZA MİMARİSİ

> Çelişki C-09 çözümü: JSONL + Obsidian **iki katman**, rakip değil.
> Tarih: 2026-10-06

---

## ÇELİŞKİ

| Kaynak | İddia |
|---|---|
| `12_OBSIDIAN_SECOND_BRAIN.md:5` | *"Obsidian kalıcı bilgi ve karar deposudur"* — **YES** |
| `FINAL_MASTER:123` | K4 Hafıza: **"Muhur (O(1)) + Kanıt + JSONL"** — Obsidian **yok** |

Bu bir çelişki **gibi** görünüyor. Değil.

> `12_OBSIDIAN:35-39` — *"**Memory = bilgi deposu. Coordinator = görev
> yönetimi. İkisi aynı şey değildir.**"*

---

## ÜÇ KATMAN

```text
┌────────────────────────────────────────────────────────┐
│  1. MUHUR (O(1) — çalışma anı)                        │
│  00-core/03-beyin/00_Muhurler/{gorev_id}.json         │
│                                                        │
│  Ne: Görevin modelden bağımsız, küçük, bütün görünümü  │
│  Amaç: FAILOVER'DA SIFIR BAGLAM KAYBI                  │
│  Ömür: Görev boyunca, sonra arşiv                       │
│  Kimlik: TASIMA — gecmisten TÜRETİLMEZ                │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│  2. JSONL / MD (makine-içi kayıt — değişmez)           │
│  00-core/03-beyin/01_Kararlar/{karar_id}.md           │
│  00-core/03-beyin/02_Ogrenilenler/{tarih}.md          │
│  kuyruk.db: loglar tablosu                             │
│                                                        │
│  Ne: Değişmez kayıt. Üstüne yazılmaz, arşivlenir.     │
│  Amaç: Denetim + sorumluluk + geri alma                │
│  Özellik: fsync, append-only, DLQ (ölüm kutusu)       │
└────────────────────────────────────────────────────────┘
                          ↓
┌────────────────────────────────────────────────────────┐
│  3. OBSIDIAN (insan-okur derin bilgi — opsiyonel)      │
│  Obsidian vault: karar, SOP, müşteri hafızası, bağlantı│
│                                                        │
│  Ne: Bağlantılı düşünce, insan metni                    │
│  Amaç: İnsan okusun — model değil                      │
│  Durum: D10 kararı. Şu an KURULMUYOR.                  │
└────────────────────────────────────────────────────────┘
```

---

## 1 · MUHUR — O(1) FAILOVER

`kordinator/baglam_muhru.py`

### Sorun (V2'de)

```python
prompt = f"{ajan}/{baslik}/{detay}"
```

Geçmiş yok. Karar yok. **Ret yok.** Kanıt yok.

> Sonuç: *"Failover çalışıyordu ama **bağlam kayboluyordu.** En pahalı
> kayıp: 'bunu zaten reddettik' bilgisi. Sistem aynı işi tekrar tekrar
> dener."*

### Çözüm

```python
muhur = Muhur(hedef)
muhur.gecmis_ekle()              # sayaç artar, İÇERİK TASNIMAZ
muhur.kisit_ekle("SEO sayfa 2000 kelimeyi geçmemeli")
muhur.karar_kaydet("K-1", "Playwright kullanılacak", "Daha güvenilir")
muhur.red_kaydet("K-2", "n8n kurma", "İkinci orkestratör riski")
```

### Neden O(1)

Gecmiş muhrun **parçası değildir.** Sayaç tutulur (raporlama), içerik taşınmaz.

```
5 mesajlık koşu     →  143 token
5.000 mesajlık koşu →  143 token   ← AYNI
```

> `baglam_muhru.py:52-58` — *"Bilinçli tasarım kararı: geçmiş muhrun
> parçası **DEĞİLDİR**."*

### Ret ledger'ı ASLA atılmaz

```text
KISITLAR:
  - SEO sayfa 2000 kelimeyi geçmemeli
KARARLAR (degistirilmez):
  K-1: Playwright kullanilacak (daha guvenilir)
REDDEDILENLER (TEKRAR DENEME):
  K-2: n8n kurma (ikinci orkestrator riski)
---
HEDEF: Landing page hazirla
SONRAKI ADIM: Anahtar kelime listesini cikar
GUVEN: 0.85
```

### Bütünlük doğrulaması (K-03)

```python
Muhur.dogrula(kaynak, ack)
```

Yeni model muhuru okur, özetini döner. **Uyuşmazlık = failover REDDEDİLİR.**

> `MuhurDogrulanmaHatasi` — *"Sessiz bağlam kaybı, kayıp geçmişten
> **DAHA KOTUDUR:** iş, kaybolduğunu **BİLMEDEN** hatalı devam eder."*

### Şifre kontrolü (K-04)

```python
muhur.kontrol()   # yazmadan önce 6 desen taranır
```

Bulgursa `SirBulundu` fırlatır. **Kayıt reddedilir.**

---

## 2 · BEYİN — KALICI KAYIT

`kordinator/beyin.py`

### 4 alt klasör

| Klasör | Ne | Özellik |
|---|---|---|
| `00_Muhurler/` | Görev mühürleri (JSON) | Soğuk uyanma |
| `01_Kararlar/` | Kararlar (MD) | **Üstüne yazılmaz** |
| `02_Ogrenilenler/` | Hatalar + öğrenmeler (MD) | Tarih bazlı |
| `03_Indeksler/` | Etiket → dosya | Arama |

### Atomik yazım

```python
tmp = yol + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    f.write(icerik)
os.replace(tmp, yol)      # ATOMİK
```

> Yarım kalmış dosya **olamaz.** Process çökse bile ya tam ya hiç yok.

### Kararlar arşivlenir

```
---
karar_id: K-1
tarih: 2026-10-06
kaynak: insan
---

# Model sabitlenmez

**Gerekce:** Saglayici coktugunde ajan kimligi degismemelidir.

> Bu karar arsivlenir ve USTUNE YAZILMAZ.
> Yeniden dusunulduyse YENI karar acilir.
```

### Öğrenilen yazımı

```python
beyin.hata_yaz(hata, kok_neden, cozum)
→ 02_Ogrenilenler/2026-10-06.md
   ## Hata: ...
   **Kok neden:** ...
   **Cozum:** ...
   `#hata` `#kok-neden`
```

> **Kök neden boşsa "Bilinmiyor — incelenmeli" yazılır.**
> Bu, `06_TEKNIK_HAZIRLIK_KONTROL` ilkesidir: uydurma yok.

---

## 3 · OBSİDİN — D10 KARARI

### Bu katman şu an YOK

`obsidian_sync.py` adı Obsidian diyor ama **Obsidian'dan bahsetmiyor.**
Sadece git senkronu yapıyor. Bu bir **isim kalıntısı.**

### Saklanacaklar / Saklanmayacaklar

`12_OBSIDIAN:22-26`:

| Saklanır | Saklanmaz |
|---|---|
| Kararlar | **API keys** |
| SOP | Passwords |
| Şirket kuralları | Access tokens |
| Araştırma | Private secrets |
| Müşteri bilgileri | |
| Sektör bilgileri | |
| Lessons learned | |
| Worker sonuçları | |
| Hatalar | |
| Skill açıklamaları | |

> **Bu tablo kodla zorlanıyor:** `beyin.py:39-43` her yazımdan önce
> 6 sır deseni tarar. Bulursa **yazma reddedilir.**

### Retrieval ilkesi

> `12_OBSIDIAN:29-31` — *"Her worker **tüm şirket hafızasını yüklemez**.
> Göreve uygun bilgi retrieval yapılır."*

**Bu, mührün felsefesiyle aynı:** her şeyi yükleme, gerekeni getir.

### Obsidian eklenirse sınırları

```
Obsidian:
  ✗ Muhur değildir
  ✗ Router değildir
  ✗ İkinci kaynak olmaz
  ✗ Koordinatör olmaz
  ✓ İnsan-okur derin bilgi katmanı
```

> Bu sınırlar yazılmazsa Obsidian ikinci bellek olur ve iki kaynak
> çelişmeye başlar — **C-09'un kendisi.**

---

## SOĞUK UYANMA

```python
m = beyin.muhr_oku(gid) or Muhur(g["baslik"])
```

| Durum | Ne |
|---|---|
| Mühür varsa | Kasadan değil **mührdan** devam — O(1) |
| Mühür yoksa | Sıfırdan başla |
| Mühür okunamazsa | `None` → yeni mühur |

> `worker.py:166` — *"muhur yuklendi: 143 token (gecmis 1247 mesaj)"*
>
> **1247 mesajlık geçmiş 143 token'a sığdı.** Kasa değil, mühür.

---

## GÜVENLİ SENKRONİZASYON

`kordinator/obsidian_sync.py`

### V2'de ne vardı

```python
subprocess.run(["git", "add", "."], check=True)   # HER ŞEY
subprocess.run(["git", "commit", ...])
```

> Tehlikeler: `.env` stage edilir → anahtar depoya gider.
> Beyin push edilir → müşteri verisi sızar.

### V3'te ne var

| # | Kural | Kod |
|:--:|---|---|
| 1 | `.gitignore` zorunlu | `gitignore_hazirla()` |
| 2 | Commit **öncesi** sır taraması | `sir_tara()` |
| 3 | Değişiklik yoksa commit **atlanır** | `status --porcelain` |
| 4 | **Push otomatik değil** | `push=False` varsayılan |
| 5 | Kullanılmayan desen atlanır | `ATLA` listesi |

> `obsidian_sync.py:159` — *"Push YAPILMADI (otomatik push yasak)."*

---

## KAYIP SENARYOLARI VE KARŞILIKLARI

| Senaryo | V2'de | V3'te |
|---|---|---|
| Sağlayıcı çöktü, yeniden denendi | Bağlam **kayboldu** | Muhur O(1) ile taşındı |
| Process çöktü, görev yarım kaldı | **Kalıcı kayıp** | `kurtar()` geri alır |
| Aynı görev iki kez işlendi | Yan etki **tekrarlandı** | `idempotency_key` engeller |
| Beyine yazılmadı | Klasörler **boş** kaldı | Her iş yazıyor |
| Anahtar koda girdi | `git add .` ile **depoya** | `sir_tara()` commit'i **reddeder** |
| Yazma sırasında çöktü | Yarım dosya | `os.replace()` **atomik** |
| Onay beklerken çöktü | Onay **kayboldu** | `kurtar()` iptal eder |

---

## 4. AYRIŞTIRMA KURALI

> `test_mimarisi.py` — `RaporTestleri`

`limit-durumu.json` içinde hem açıklama hem sağlayıcı var:

```json
{
  "_aciklama": "SAGLAYICI KOTALARI",
  "openrouter": { "gunluk_limit": 200, ... },
  "_rota_sirasi": ["openrouter", "gemini", ...]
}
```

**`_` ile başlayan anahtarlar METADATIDIR.** Sağlayıcı değildir.

> `router.py:157` — `if ad.startswith("_") or not isinstance(o, dict): continue`
> Bu olmazsa `durum_raporu()` worker'ın **sonunda çökerdi.**
> Testler olmadan bu **görünmezdi.** — `V3_DURUM_RAPORU §2 madde 7`
