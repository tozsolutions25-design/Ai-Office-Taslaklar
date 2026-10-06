# AJAN LİSTESİ — 7 İŞÇİ

> Kaynak: `15_ILK_AI_CALISANLARI.md` (7 işçi) + `13_90_GUNLUK_KURULUM_PLANI.md`
> Çelişki C-05, C-16, C-27 çözüldü.
> Tarih: 2026-10-06

---

## NEDEN 7, NEDEN 295 DEĞİL

| Kaynak | İddia | Karar |
|---|---|---|
| `15_ILK_AI_CALISANLARI.md` | 7 işçi | ✅ **7** |
| `12_AI_CALISAN_KATALOGU.md` | ~60 rol | ❌ Rol ≠ işçi |
| `AUTONOMOUS_WEB_AGENCY.md` | 19 ajan | ✅ **Ajan hattına** ayrıldı |
| `gemini-code-1791115040305.md` | "100+ otonom ajan" | ❌ **En eski, en gerçekçi olmayan** |
| `BUGUN-2026-09-13:17` | "295 agent kopyalandı" | ❌ **İhlal** (C-16) |
| `13_90_GUNLUK:80` | "**90 günde 100+ ajan yapılmaz**" | ✅ **Bu kazanır** |

**295 ajanın neden sorun:**

```
09_AGENCY_AGENTS.md:13   "Tüm Agency Agents yüklenmez."
blueprint:119-121        "seçilir, incelenir, SADELESTIRILIR, TOZ rol standardına uygun hale getirilir"
```

> **1.000 karakterlik üçüncü taraf ajan dosyası, şirket standardı değildir.**
> 295 → önce 7 rol seç → sadeleştir → TOZ standardına çevir.

---

## KATMAN A — İLK 7 İŞÇİ

`15_ILK_AI_CALISANLARI.md` kelimesi kelimesineyle:

> *"Başlangıçta minimum ekip:"*

| # | İşçi | Yetki | Faz | Kod durumu |
|:--:|---|:--:|:--:|---|
| 1 | **AI Koordinatör / Ofis Müdürü** | Onay kapısı | 3 | ✅ `00_orkestrator.yaml` |
| 2 | **Araştırma & İstihbarat** | 0 (okuma) | 8 | ⬜ |
| 3 | **Bilgi & Hafıza** | 0 (okuma) | 7 | ✅ `beyin.py` |
| 4 | **Yazılım / OpenCode** | 1 (taslak) | 10 | ✅ `01_kodlama.yaml` |
| 5 | **Pazarlama & Satış** | 1 (taslak) | 11 | ⬜ |
| 6 | **YouTube & Medya** | 1 (taslak) | 13+ | ⬜ |
| 7 | **Kalite / Güvenlik** | 2 (insan onaylı) | 9 | ✅ `anayasa_kontrolu.py` |

### Çalışma prensibi

`15_ILK_AI_CALISANLARI.md:17`:

> *"Workerlar sürekli `STANDBY → WAKE → WORK → REVIEW → SLEEP` şeklinde
> çalıştırılmaz. Gerektiğinde göreve çağrılır."*

```
STANDBY  →  WAKE  →  WORK  →  REVIEW  →  SLEEP
   ↑                                            │
   └────────────────────────────────────────────┘
                     (token harcanmaz)
```

> ⚠️ Metinde bir yazım hatası var: *"çalıştırılmaz"* yazıyor,
> kastedilen **"çalıştırılır"**. Bu düzeltildi.

**Neden önemli:** Sürekli açık ajanlar token yakar. Boştayken
`STANDBY`'de olmalı — `worker.py:156-158`:

```python
print("\n[i] Kuyruk bos. Sistem BEKLEMEDE "
      "(pasif ajan protokolu: token harcanmaz).")
```

---

## İŞÇİ DOSYASI STANDARTI

`12_AI_CALISAN_KATALOGU:119` + `01_SIRKET_MIMARISI:204-217` birleştirildi:

```text
11_Ajanlar/
├── 00_orkestrator.yaml     ← ZORUNLU alanlar aşağıda
├── 01_kodlama.yaml
└── 02_arastirma.yaml       (yazılacak)
```

| Zorunlu alan | Kural | Neden |
|---|---|---|
| `id` | benzersiz | Kuyruk ataması |
| `ad` | insan okur | — |
| `departman` | Yönetim / Bilgi / Yazılım / Pazarlama / Medya / Kalite | Hiyerarşi |
| `yetki_seviyesi` | **0-3. 4 ASLA.** | K-05 + K-06 |
| `kabul_edilen_tipler` | görev sınıfları | K-02: rota belirler |
| `sorumluluklar` | ne yapar | — |
| `yapamayacaklari` | **ne yapmaz** | Negatif sınır |
| `bilgi_kapsami.okur` | dosya yolları | Yetki |
| `bilgi_kapsami.yazamaz` | **dosya yolları** | K-04 |
| `sistem_promptu` | davranış kuralları | — |
| `insana_devir` | ne zaman devreder | K-06 |
| `token_zarfi` | üst sınır | Maliyet |

### `model_tercihi` veya `sabit_model` YASAK

K-02: **Rol modele değil yetkiye bağlanır.** Sebep: sağlayıcı çöktüğünde
ajan kimliği değişmemelidir.

`anayasa_kontrolu.py:75-78` bunu otomatik kontrol eder:

```python
if "sabit_model" in kod or "model_tercihi:" in kod:
    ihlaller.append(Ihlal("K-02", "Ajan modele sabitlenmis. ..."))
```

> Yorum satırları denetlenmez. Bir kuralı açıklamak için metinde geçmesi,
> kuralı ihlal etmek demek **değildir.**

---

## 7 İŞÇİ + ORTAK MOTOR — NASIL BAĞLANIR

`04_ORGANIZASYON:216` — en büyük eksik:

> *"7 işçi tanımlı ama **hiçbiri gerçek görev almadı**. İlk görevin
> tanımı bile yapılmadı."*

Bu, D9'a bağlı. Bkz. `08_GEREKLER/ACIK_KARARLAR.md`

---

## AJAN HATTI İŞÇİLERİ (D-01)

`AUTONOMOUS_WEB_AGENCY.md`'nin 19 ajanı genel katalogla **karıştırılmamalı.**
Bunlar kendi ürünümüzü üretmek için — müşteri işi yapmıyorlar.

| # | Ajan | # | Ajan |
|:--:|---|:--:|---|
| 00 | Orchestrator / Creative Director | 10 | SEO Engineer |
| 01 | Codebase Architect | 11 | AEO / GEO Engineer |
| 02 | Research Director | 12 | Local SEO Engineer |
| 03 | Viral Web Researcher | 13 | CRO Specialist |
| 04 | UX / Product Strategist | 14 | Performance Engineer |
| 05 | Art Director | 15 | Accessibility Engineer |
| 06 | 3D Engineer | 16 | Security Engineer |
| 07 | Motion / Scroll Director | 17 | QA / Red Team |
| 08 | Frontend Engineer | 18 | Final Creative Critic |
| 09 | Copywriter / Brand Strategist | | |

**Kalite kapısı:** `AUTONOMOUS_WEB_AGENCY:740-747`

> *"Minimum: **90/100**. Target: **95+**"*

**Bu, sistem sağlığı kapısı DEĞİLDİR** (C-14):

| Yüz | Ölçüm |
|---|---|
| Web çıktısı | 90/100 puan |
| Sistem sağlığı | PASS/FAIL kapı |

> Karıştırma. Web çıktısı yüksek puan alabilir, sistem sağlığı başarısız olabilir.

**Otonom mod kapsamı** (C-13):

```
✅ Otonom:  yalnızca AUTONOMOUS_WEB_AGENCY kapsamında
            yalnızca kod / SEO / UX kararlarında
❌ Onay:    para, silme, production deploy, credential değiştirme
❌ Onay:    şirket genelinde HER ZAMAN
```

---

## AJAN = İŞÇİ DEĞİLDİR

| Kavram | Ne | Örnek |
|---|---|---|
| **Rol** | Kim olduğu | "Mali müşavir" |
| **İşçi** | Sistemde çalışan ajan | `11_Ajanlar/02_arastirma.yaml` |
| **Ajan** | Üçüncü taraf beceri dosyası | `agency-agents/finance/*.md` |
| **Beceri** | Tek bir yetenek | "PDF tablo çıkarma" |

> `09_AGENCY_AGENTS.md:31` — ***"Role definition ≠ coordinator."***
> Rol tanımı koordinator değildir. Ajan dosyası işçi değildir.

**295 ajan dosyası ≠ 295 işçi.** 7 işçi + seçilmiş ajanlar + beceriler.

---

## ÖLÇEKLENME YOLU

```
Faz 3   → 1 işçi  (orkestratör)     — kapıları kapat
Faz 7   → 3 işçi  (+bilgi)           — hafıza çalışsın
Faz 8   → 4 işçi  (+araştırma)       — gerçek veri gelsin
Faz 10  → 5 işçi  (+yazılım)         — kod üretimi
Faz 11  → 6 işçi  (+pazarlama)       — ajan hattı
Faz 13+ → 7 işçi  (+medya)           — 3D ve medya
```

**Her adımda yeni işçi = yeni faz.** 90 günde 7'ye çık. 60'a değil.

---

## KONTROL

```powershell
python 00-core\07-araclar\anayasa_kontrolu.py
```

Bu komut her ajan dosyasını denetler:

| Kural | Kontrol |
|---|---|
| K-02 | `sabit_model` / `model_tercihi` yasak |
| K-05 | `yetki_seviyesi` zorunlu |
| K-06 | Seviye 4 yasak |
| K-05 | Geçersiz seviye yasak |

**İhlal varsa sistem ayaga kalkmaz.** Ajan eklemek = bu komutu yeşil tutmak.
