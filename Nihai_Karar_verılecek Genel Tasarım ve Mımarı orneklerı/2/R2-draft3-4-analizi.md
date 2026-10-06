# R2 — Draft_3 ve Draft_4 Analizi (Mimari + Güvenlik Denetimi)

**Tarih:** 2026-10-06 · **Kapsam:** `Toz_Ai_Office_Draft_3\` (35 md, 1 yaml, 1 jsonl — kod yok),
`Toz_Ai_Office_Draft_4\` (24 py, 6 ps1, md/yaml/json/sql)
**Yöntem:** Tüm dosyalar okundu. Draft_4 kodu **geçici kopyada** (`%TEMP%\opencode\d4test`)
çalıştırıldı; orijinal klasöre yazılmadı.

## 0. Yönetici Özeti

| Bulgu | Durum |
|---|---|
| Draft_3 beyin | **Hermes Agent**; beyin = insanın kendi Hermes oturumu. 1 beyin. |
| Draft_4 beyin | **Kendi Python motoru** (`00-core/03-beyin`). Hermes/Ruflo/OpenCode 4 satırlık stub. |
| Draft_3 task-state | `kuyruk/<GG-AA-AA>.jsonl` — tek yazar, JSONL |
| Draft_4 task-state | `kuyruk.db` (SQLite, 11 durum) |
| **Çakışma** | **Kesin.** İkisi de "tek yazar"; formatlar farklı. |
| Draft_4 kodu çalışır mı? | **Kısmen.** 58 test geçiyor; **başarılı görev yolu 2 yerden çöküyor.** |
| `.env`de gerçek anahtar? | **Yok.** 3 API anahtarı da boş. |
| Üretim riski | Düşük. Anahtar girilince `.env` masaüstü düz metin kalıyor. |

---

## 1. Hangi sistem beyin/orchestrator/task-owner?

### Draft_3 → Hermes Agent (açık, kanıtlı)

| Kanıt | Satır |
|---|---|
| `README.md:7` | "**Orchestra:** Hermes Agent · **Yönetişim:** TOZ_VAULT" |
| `TOZ_VAULT/09_Teknik/MIMARI.md:5` | "**Orchestra: Hermes Agent.** Kod Hermes'te, kararlar bu klasörde." |
| `TOZ_ANAYASA.yaml:9` | `mimari: "Hermes Agent (orkestra) + TOZ_VAULT (yönetişim)"` |

**Beyin sayısı 1** ve bu beyin ajan **değil**:
> `ORKEPRA.md:5-6` — "**Ayrı bir ajan değildir.** Orkestra şefi = kullanıcının kendi
> Hermes oturumu + `toz-koordinasyon` becerisi." · `:17` — "Tek dağıtım otoritesi = kullanıcı."

Gerekçe zevk değil, yapısal:
- `ORKEPRA.md:14` → `delegate_tool_config.py:21` `max_spawn_depth = 1` → **iç içe orkestra imkânsız**
- `ORKEPRA.md:12` → 226 taslakta 7 koordinatör adı, hepsi "nihai" yazılmıştı
- `README.md:133` → "226 taslak → 14 klasör. 40 rol → 8 işçi. **7 koordinatör → 1 (siz).**"

**Task-state sahibi:** `kuyruk/<GG-AA-AA>.jsonl`, append-only, tek yazar (`MIMARI.md:93-94`,
`ORKEPRA.md:127`, `ADR-0001:30`). Kilit önerisi: `ADR-0001:58` → `os.open(O_CREAT|O_EXCL|O_WRONLY)`
("`exists()`+`open('w')` yarış koşuluna açık").

**Ajan:** 8 aktif işçi (A1–A8) + 282 pasif (`README.md:66-79`, `ORKEPRA.md:151`).
282 ajan önden yüklenmez (`MIMARI.md:71-72`: ≈975.000 token) — ad-hoc uyandırma.

### Draft_4 → Kendi motoru (Hermes'i dışlıyor)

| Kanıt | Satır |
|---|---|
| `30_Teknik/05_HERMES_RUFLO_OPENCODE_MIMARISI.md` | **4 satır, 3 madde.** Adı vaat ediyor, içeriği yok. |
| `V3_MASTER_MIMARI.md` içinde Hermes/Ruflo/OpenCode | **1 kez**, satır 478'de sadece şema dosya adı. Karar yok. |
| Grep (tüm Draft_4) | Bu 2 dosya dışında Hermes/Ruflo/Munder/OpenClaw/OpenDots/agency_agents **hiç geçmiyor**. |

Orkestratör = `worker.py` + `kordinator/`. **Beyin = `00-core/03-beyin/`**
(`V3_MASTER_MIMARI.md:506-510`, `beyin.py:31-35`: `00_Muhurler`, `01_Kararlar`,
`02_Ogrenilenler`, `03_Indeksler`). Obsidian "ikinci beyin" deniyor (`:2261`) ama
**kodda Obsidian yok** — sadece Markdown klasörü + `git`.
**Task-state:** `kuyruk.db` + `kuyruk.py`. **MVP 2 ajan** (`:333`, `:37`), `11_Ajanlar/` 2 YAML.

### TASK-STATE ÇAKIŞMASI

| | Draft_3 | Draft_4 |
|---|---|---|
| Sahip | İnsanın Hermes oturumu | `worker.py` (Python) |
| Format | JSONL dosya | SQLite tablo |
| Kurtarma | Yok (yok etme yasası) | `kurtar()` + `olum_kutusu` |

Draft_3 bu katmanı açıkça reddediyor:
> `MIMARI.md:150-152` — "`kuyruk.py`, `router.py`, `worker.py`, `sigorta.py`, `beyin.py` …
> Taşmak **ikinci durum makinesi ve ikinci yönlendirici** demek."

**Karar:** İkisi birlikte kurulamaz. Draft_3'ün reddi doğru (kendi Madde 4'ü: `README.md:54`).

---

## 2. V3_MASTER_MIMARI.md'nin ana tezi

**Tez (`:1-5, 313-348`):** V2'de ilkeler **prose** idi, kod karşılıkları yoktu.
V3'te 7 ilkenin **7'si de kodda zorlanır**. "10/10" yeniden tanımlanır:
> `:269-274` — "**10/10 = her kural makine tarafından zorlanır ve testle kanıtlanır.**
> Bu, kanıtlanabilir bir tanımdır. 'Kusursuz' değildir."

Tutumlu bir tez. Düzeltilen hata sayısı **18** (`:25-310`).

**Kurduğu sistemler**

| # | Ne | Kanıt |
|---|---|---|
| 1 | **Kendi Python motoru** (`kordinator/`, 12 dosya) | `:744-768` |
| 2 | **SQLite kuyruk** — 11 durum, terminal koruma trigger'ı | `kuyruk-olustur.sql:61-66` |
| 3 | **Gerçek HTTP istemcileri** (OpenRouter/Gemini/Groq/Ollama) | `saglayici_istemcileri.py:92-259` |
| 4 | **Devre kesici + tam jitter** | `sigorta.py` (192 satır, tam) |
| 5 | **Bağlam mührü (O(1) failover)** | `baglam_muhru.py` |
| 6 | **Onay kapısı** (seviye 4 kodda yasak) | `onay_kapisi.py:25` `OTOMATIK_YASAK={4}` |
| 7 | **58 mimari test**, bağımlılıksız `unittest` | `test_mimarisi.py` |
| 8 | **Beyin klasörü + güvenli git** | `beyin.py`, `kordinator/obsidian_sync.py` |

**Reddettiği şeyler**

| Reddedilen | Gerekçe | Satır |
|---|---|---|
| 2. model yönlendirici | Hermes `fallback_providers` zaten var | `Draft_3 MIMARI.md:118` |
| 3D sanal ofis | İş üretmez, 8 GB RAM | `Draft_3 MIMARI.md:115` |
| 282 ajan ön yükleme | 975.000 token | `Draft_3 MIMARI.md:116` |
| İkinci koordinatör | 7 koordinatör adı zaten kırık | `Draft_3 MIMARI.md:117` |
| Munder Difflin | İki yığın = iki kontrol dili | `Draft_3 MIMARI.md:120` |
| "Final eleştirmen" ajanı | Ajan kendine puan veriyor — ölçüm değil | `Draft_3 MIMARI.md:121` |
| V2 `git add .` | `.env` depoya gider | `V3:163-179` |
| `lmstudio: "local-model"` | Sahte model adı | `V3:203-212` |
| `model_tercihi` | Rol modele değil **yetkiye** bağlanmalı | `V3:229-239` |
| V2 klasör çakışmaları (11 klasör, 5'i dolu) | Tek seri | `V3:553-570` |

**Zayıf yanı:** aday sistem karşılaştırması yok. Draft_3'ün ölçümlü tablosu
(yıldız, sürüm, lisans, issue sayısı — `Draft_3 MIMARI.md:15-27`) Draft_4'te hiç yok.

---

## 3. V3_DURUM_RAPORU.md ne diyor?

**En dürüst doküman — korunmalı.**

Çalıştığı iddia edilenler (`:11-27`): 11 durumlu kuyruk, kurtarma, terminal koruması,
devre kesici (8 test), mühür (8 test), onay kapısı (4 test), önbellek maliyeti (7 test),
8/8 anayasa, sır taraması, kurulum sihirbazı, dotenv. `:27` — "**58 test, tamamı yeşil.**"

**Yapılmadığı, isim isim sayılmış (`:106-118`)**

| Konu | Durum |
|---|---|
| Gerçek API çağrısı | ❌ Yapılmadı (anahtar yok) |
| Kota rakamları | ❌ Doğrulanmadı |
| Telegram onay akışı | ❌ **Yazılmadı** |
| Obsidian senkronu | ⚠️ Kod var, denenmedi |
| Yerel model | ❌ Çalıştırılmadı |
| 24 saat dayanıklılık | ❌ Test edilmedi |
| Gerçek müşteri işi | ❌ Hiç çalıştırılmadı |

**Bu turda bulunan 10 gerçek hata (`:35-46`)** — hepsi test sayesinde yakalanmış.
Biri benim bulgumla aynı sınıf:
> `:43` — "`durum_raporu()` metaveriyi sağlayıcı sandı → Worker en sonda **çöküyordu**"
> `:48-49` — "Testler olmadan bu **görünmezdi**."

**Kabul kriteri (`:159-162`)** ölçülebilir ve doğru: "Bir görev gerçekten bir API'ye gitti,
gerçekten token saydı, gerçekten karar yazdı — ve bunlar logda **görülebiliyor**."

**Kabul edilmeyen risk (`:173, 176-177`):** "Onay tablosu var, UI yok → Onay gerekli iş
yığılır. **Engelleyici.**" `:185` zaten "onay arayüzünü yaz" diyor.

---

## 4. Draft_4 Python kodu GERÇEKTEN çalışır mı?

**Test edilen her şey çalışıyor. Test edilmeyen hiçbir şey çalışmıyor.**

### 4.1 Çalışanlar (doğrulandı)

| Bileşen | Sonuç |
|---|---|
| `test_mimarasi.py` | **58/58 PASS** (0.76 sn) |
| `anayasa_kontrolu.py` | `SONUC: GECTI - 8/8` |
| `db_init.py` | Şema OK — 27 sütun, 3 tablo + trigger |
| `worker.py` (boş kuyruk) | Çalıştı, kurtarma + istatistik bastı |
| `sir_tara.py` | `TEMIZ` + "git deposu değil" uyarısı |
| `kuyruk.kurtar()` | Testlerde yeşil (ama 4.4'e bak) |

### 4.2 ÇÖKEN YER 1 — `worker.py:114` AttributeError

```python
114:    kuyruk.muhr_yaz(gorev_id, m.digest())
```
`Kuyruk`'ta metot adı **`muhur_yaz`** (`kuyruk.py:214`); `muhr_yaz` yok.
(Beyin'de gerçekten `muhr_yaz` var — `beyin.py:55`. Karışmış.) Sahte sağlayıcı ile:
```
[GOREV #1] test is → muhur yuklendi: 6 token
WORKER CRASH: AttributeError 'Kuyruk' object has no attribute 'muhr_yaz'
```
`V3_DURUM_RAPORU.md:43`'teki 7. maddenin aynı sınıfı — biri düzeltilmiş, diğeri duruyor.
**`test_mimarasi.py`de `worker.py` için tek bir test yok** (Draft_3 bunu önceden tespit etmişti).

### 4.3 ÇÖKEN YER 2 — `worker.py:177` yasak durum geçişi

```
worker.py:170   durum_ata(gid, "rota_secildi")
worker.py:177   durum_ata(gid, "tamamlandi")     ← YASAK
```
`kuyruk.py:29-41` `IZINLI` tablosu `rota_secildi`'den yalnız
`beceri_cozuldu / bloke / basarisiz / olum_kutusu`'ya izin veriyor.
Doğruladım (yazma hatasını geçici yamayarak):
```
WORKER CRASH: GecersizGecis rota_secildi -> tamamlandi yasak.
Izin verilen: ['basarisiz','beceri_cozuldu','bloke','olum_kutusu']
```
**Hiçbir görev hiçbir koşulda `tamamlandi` olamaz. Sistem iş üretemez.**

Draft_3 bunu aylar önce kaydetmiş: `README.md:88` ("başarılı görev yolu kırık —
`worker.py:177` ↔ `kuyruk.py:32`"), `KARAR_GUNLUGU.md` K-004, `GOREV_GEHSLERI.md`
("**Atlanan adım = geçersiz geçiş = hata.**"). **Draft_4 düzeltmemiş, sadece belgelemiş.**

### 4.4 Kurtarma da çalışmıyor (testin kapsamadığı boşluk)

`kuyruk.py:91-93` yalnız `'calisiyor','dogrulaniyor'` arıyor. `worker.py` bu iki duruma
**hiç girmiyor** — `rota_secildi`'den direkt API çağrısına geçiyor. Çökme ölçümü:
```
crash sonrasi durum: rota_secildi
kurtar sonucu: {'kurtarilan': 0, 'olum_kutusu': 0, 'iptal': 0}
```
**Görev sonsuza kadar `rota_secildi`'de asılı kalır.** Test yeşil çünkü
`test_mimarisi.py:237-240` durumları elle kuruyor, gerçek worker yolunu değil.

### 4.5–4.7 V2 artıkları, hâlâ duruyor

| Dosya | Kanıt | Çalıştırma sonucu |
|---|---|---|
| `runner.py` | `:16` `durum='beklemede'` **yok**; `:33` `"durum"` alanı limit JSON'unda yok | `TypeError: string indices must be integers` |
| `07-araclar/router.py` | `:55` `used_tokens=150` sabit; `:56` **hiç HTTP yok** | `[WARN] kota dolu → local_ollama` |
| `07-araclar/obsidian_sync.py` | `git add .` + `.gitignore` YOK | En tehlikeli satır |

`worker.py` bunları kullanmıyor ama yerinde durması **bakım tuzağı**.
Draft_3 ikisini de önceden işaretlemişti (`MIMARI.md:133-136`).

### 4.8 Diğer modüller — gerçekten iyi

| Modül | Değerlendirme |
|---|---|
| `sigorta.py` | **Tam.** Hata oranı (saya değil), sağlayıcı başına ayrı sigorta, tam jitter, `KaliciHata` devreyi açmaz, kademeli toparlanma, tembel geçiş. |
| `saglayici_istemcileri.py` | **Gerçek HTTP.** Doğru taksonomi (429→`KotaHatasi`, 401/403/404→`KaliciHata`, 5xx→`GeciciHata`), gerçek `usage` okuma. |
| `baglam_muhru.py` | Failover yükü geçmişten bağımsız; ret ledger'ı sıkıştırmada atılmaz; `dogrula()` sessiz kaybı reddeder. |
| `onbellek.py` | 10× fiyat farkı; `ucuslu_isaretleri()` zaman damgası/session_id yakalıyor. |
| `dotenv.py` | Ortam değişkeni `.env`'i **ezmez** (testli). 88 satır, sıfır bağımlılık. |
| `beyin.py` | Atomik yaz (`os.replace`), yazmadan önce sır taraması, kararlar üstüne yazılmaz. |
| `onay_kapisi.py` | Seviye 4 `OTOMATIK_YASAK`; süre dolunca iptal, kuyruğa geri dönmez. **Doğru fikir** — ama `:39` `bildirim=None` → **bildirim gitmiyor.** |

### 4.9 `ana-config.yaml` — V2 artığı, kod tarafından okunmuyor

`:11` `hybrid-zero-cost` (V3: `cloud-first-hybrid-zero-cost`) · `:14` `gemini-1.5-flash`
(V3: `2.0-flash`) · `:16` `qwen2.5-coder:latest` (V3: `:7b`) · `:19` `otomatik_iptal: false`
(V3 `:635`: `true`). Yanlış yönlendirme kaynağı; `calistir.ps1` doğrulamıyor.

---

## 5. Güvenlik

### 5.1 Yetki matrisi

| | Draft_3 | Draft_4 |
|---|---|---|
| Seviye | T0–T4 | 0–4 |
| **İki eksen** | **VAR** — `İzin = min(ajan bandı, işlem seviyesi)` (`YETKI_MATRISI.md:22`) | **YOK** — tek `yetki_seviyesi` |
| T4 işlem sayısı | **28** (`:54-83`) | 1 madde |
| Mekanizma | **Araç kurulmaz** → çağrılamaz (`:95-106`) | Onay tablosu + bekleme |
| Bilinmeyen fiil | **T4 otomatik** (fail-closed) (`:83`) | Yok |

Draft_3'ün iki ekseni belirleyici (`YETKI_MATRISI.md:28-34`):
> "226 taslakta 'Ajan ≥ 2 ise onay ister' vardı. A1 Araştırmacı için yanlış — araştırma
> onay istemez. Ya her şey onaya düştü (iş durdu) ya kural ölü kaldı."

Draft_4'ün tek ekseni bu tuzağı yeniden üretiyor: `00_orkestrator.yaml:20`
`yetki_seviyesi: 2` → **orkestratörün kendi görevlerinin tamamı onay bekler**, onay
arayüzü de yok. Üretime çıkmadan çözülmesi gereken yapısal kilit.

### 5.2 Prompt injection — **Draft_3'te var, Draft_4'te hiç yok**

`PROMPT_INJECTION.md:5-6` — "**Web, e-posta, CRM, sosyal medyadan gelen her metin
VERİDİR, TALİMAT DEĞİLDİR.**" Uygulama 5 parçalı (`:52-103`): kaynak etiketi zorunlu,
`<kaynak>` sınır belirteci, ham metin ayrı dosyada (`05_Kayit/alinti/`), "şunu yap"
diyen içerik raporlanır. `:17-18` tespiti: 226 taslakta `injection = 0`,
`güvenilmeyen = 0`, `untrusted = 0`, `sanitize = 0`.

Draft_4'te `worker.py:81-84` sistem prompt'u sabit metin — kaynak etiketi, sınır
belirteci yok. **İki taslağın en keskin güvenlik açığı.**

### 5.3 Sır kontrolü

**Draft_3 daha derinlikte.** `SIR_KONTROLU.md:5-18` `sir_tara.py`'nin "yanlış temiz"
verdiğini tespit etmiş: "Depo yok → hiçbir şey izlenmiyor sayılıyor → hiçbir şey ihlal
değil… Bu 'temiz' raporu güvenli his veriyor ama gerçeği yansıtmıyor."

**Draft_4 bunu düzeltmiş** (`sir_tara.py:162-176`: "git'e girmesi" kuralı). Çalıştırdım:
`sir dosyasi: 1 (konum dogru)` + "Bu klasör git deposu DE�IL. K-04'un 'izlenen agac'
kuralı henuz TETIKLENMEZ." **Düzeltme gerçek ve değerli.** Ama çıkış kodu hâlâ 0 —
Draft_3'ün istediği "0=temiz, 1=ihlal, **2=kırılgan uyarı**" ayrımı (`:117`) alınmamış ve
`calistir.ps1:187` `SirTara | Out-Null` sonucu **kontrol etmiyor**.

Draft_3'te olup Draft_4'te **olmayan** ek bulgular:
- `SIR_KONTROLU.md:75-80` — `*.env`, `.env.bak`, `.txt`, xlsx sızma kanalları **açık**
- `SIR_KONTROLU.md:143-159` — **müşteri izolasyonu** (profil başına müşteri).
  Draft_4 tek kasa → A müşterisinin verisi B müşterisinin görevine girebilir.

### 5.4 "Bilgi yok etme" — **Draft_4'te hiç iz yok**

`BILGI_YOK_ETME_LISTESI.md:19-34` Tier 1, 11 komut kesin yasak: `Format-Volume`,
`Clear-Disk`, `diskpart`, `Remove-Partition`, `Remove-Item -Recurse -Force`, `rm -rf`,
`os.remove()`, `git clean -fdx`, `git filter-branch`, `Clear-RecycleBin`, `cipher /w`.

Gerekçe somut, gerçek bir olay (`:36-44`):
> `Format-Volume -DriveLetter D -DevDrive` — "**Depolama Mimarisinin Optimizasyonu**"
> başlığı altında "birkaç komut" tanımıyla sunulmuş. **Çalıştırılmamış — iyi ki.**
> D: yok olur, `D:\AI` dahil her şey.

`:68-84` "Her şey ya kalır ya da **taşınır**. Silme yok." · `:124-148` **11 adımlık geri
yükleme tatbikatı** — "Bu protokol uygulanana kadar 'yedek var' denmez."

Draft_4'te `kordinator/obsidian_sync.py:138` `git add -A` yapıyor; `git clean` /
`git filter-branch` kullanımına karşı koruma yok.

---

## 6. `.env` — hangi anahtarlar tanımlı?

**Değerler rapora yazılmadı. Sadece isimler ve doluluk durumu.**

| Anahtar | `.env` | `.env.example` | Not |
|---|:--:|:--:|---|
| `OPENROUTER_API_KEY` | **boş** | boş | `saglayici_istemcileri.py:102` |
| `OPENROUTER_MODEL` | dolu (32 krk) | dolu | **Kod okumuyor** |
| `GEMINI_API_KEY` | **boş** | boş | `saglayici_istemcileri.py:146` |
| `GEMINI_MODEL` | dolu (16 krk) | dolu | **Kod okumuyor** |
| `GROQ_API_KEY` | **boş** | boş | `saglayici_istemcileri.py:182` |
| `GROQ_MODEL` | dolu (23 krk) | dolu | **Kod okumuyor** |
| `OLLAMA_URL` | `localhost:11434` | aynı | `saglayici_istemcileri.py:212` **hard-code** |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` | aynı | `:213` hard-code; V2 `router.py:23` farklı (`:latest`) |
| `ALLOW_EXTERNAL` | `false` | `false` | **Hiçbir kod okumuyor** |
| `GIT_AUTO_PUSH` | `false` | `false` | **Hiçbir kod okumuyor** |

**Gerçek anahtar düz metin gömülü mü? HAYIR** — üçü de boş.
`anahtar-ayarla.ps1:160-161` anahtarı Windows **User ortam değişkenine** yazıyor (diske yazmıyor);
`:145-157` biçim doğrulaması yapıyor (yanlışsa yazmıyor); `:172` belleği temizliyor.
**Y13 ("`get_secret()` tek okuma noktası") kuralının en iyi uygulaması bu.**

**Üretim riski: şu an düşük, ileride orta.**

| Risk | Durum |
|---|---|
| Anahtar düz metin gömülü | ❌ Yok |
| `.env` git'e girebilir mi | `.gitignore:6-8` → **korumalı** |
| `19_Gizlilik/` | **BOŞ** — `00_OKU_BENI.md:22` "Git'e asla" diyor, klasör hiç oluşmamış |
| Gerçek risk | Klasör git deposu değil; `git init` edilirse `.env` yine korunur, ama `obsidian_sync.py:138` `git add -A` çalışırsa **beyin klasörü (müşteri verisi) sızabilir** |

**Ölü bayrak tespiti:** `ALLOW_EXTERNAL` ve `GIT_AUTO_PUSH` tanımlı ama **hiçbir
`.py`/`.ps1` okumuyor.** V3 "sessiz failover yasak" (`V3:629`) ve "push otomatik değil"
(`V3:650`) diyor — bu iki bayrak yalnız `.env`'de. **Politika metni = mekanizma yok.**

---

## 7. Hangileri KORUNMALI, hangileri REDDEDİLMELİ?

### KORUN

| # | Ne | Neden |
|---|---|---|
| K1 | **`sigorta.py`** | Tam devre kesici: oran tabanlı, sağlayıcı başına ayrı, tam jitter, kademeli toparlanma. Doğrulanmış kalite. |
| K2 | **`saglayici_istemcileri.py`** | Gerçek HTTP + doğru hata taksonomisi. V2'nin sahte çağrısının gerçek karşılığı. |
| K3 | **`baglam_muhru.py`** | Failover'da O(1) bağlam; ret ledger'ı korunur. Benzersiz. |
| K4 | **`onay_kapisi.py`** | Seviye 4'ün **kodda** yasak olması — politika değil mekanizma. |
| K5 | **SQL trigger** | Terminal durum dönemez; uygulama hatasına bağışık. |
| K6 | **`dotenv.py`** | Ortam değişkeni `.env`'i ezmez. 88 satır, sıfır bağımlılık. |
| K7 | **`anahtar-ayarla.ps1`** | Biçim doğrulamalı, diske yazmıyor, değeri göstermiyor. |
| K8 | **`V3_DURUM_RAPORU.md`** | En dürüst doküman: yapılmayanları isim isim sayıyor. |
| K9 | **`V3_MASTER_MIMARI.md` Bölüm 0** | 18 hatayı tek tek gerekçesiyle listelemesi — kalıcı değer. |
| K10 | **Draft_3 `YETKI_MATRISI.md`** | İki eksen + 28 T4 + fail-closed. Draft_4 bunu geriye götürüyor. |
| K11 | **Draft_3 `PROMPT_INJECTION.md` + `ADR-0005`** | Draft_4'te **hiç karşılığı yok**. |
| K12 | **Draft_3 `BILGI_YOK_ETME_LISTESI.md` + `ADR-0003`** | 11 komut yasağı + geri yükleme tatbikatı. Draft_4'te yok. |
| K13 | **Draft_3 `SIR_KONTROLU.md`** (müşteri izolasyonu + kırılgan uyarı) | Draft_4 tek kasa → çapraz sızıntı riski. |
| K14 | **Draft_3 `ARAC_KONTROLU.md`** | Ölçümle çürüttüğü kural; ölçüme dayalı politika. |
| K15 | **Draft_3 `AJAN_LISTESI.md`** | 8 işçi: her biri tek ölçülebilir sorumluluk + yazdığı dosya. |
| K16 | **Draft_3 4 `SKILL.md`** | Frontmatter dolu, Hermes metadata'lı — kurulabilir format. |

### REDDEDİLMEK

| # | Ne | Neden |
|---|---|---|
| R1 | **`worker.py`** | **İki ayrı yerde çöküyor** (`muhr_yaz` yazım hatası + yasak geçiş). Başarılı görev yolu yok. Yeniden yazılmalı. |
| R2 | **`runner.py`** | V2 artığı; çalıştırılınca `TypeError`. |
| R3 | **`07-araclar/router.py`** | Sahte API, `used_tokens=150`. Kullanılmıyor ama tuzak. |
| R4 | **`07-araclar/obsidian_sync.py`** | `git add .` + `.gitignore` yok — en tehlikeli satır. |
| R5 | **`ana-config.yaml`** | V2 artığı, okunmuyor, V3 ile çelişiyor. |
| R6 | **`yonlendirici-kurallari.yaml`** | 7 satır; `TELEGRAM_ONAY_ISTE` diyor, Telegram kodu **yok**. |
| R7 | **"58 test = hazır" iddiası** | Worker yolunda **tek test yok**. Mutasyon kanıtı eksik. |
| R8 | **Draft_3'ün Hermes'e tam bağımlılığı** | Hermes olmadan hiçbir şey çalışmıyor — bu da bir yığın riski. |
| R9 | **282 ajan kataloğu** | 975.000 token. Draft_3'ün "kurulmaz" kararı doğru; `agency_agents_search` referansı bağımlılık. |
| R10 | **Tüm `20_Is_Dokumanlari/`** | 3-8 satır V1 kalıntısı. `02_HIYERARSI:2` **3 ajan** diyor, `11_Ajanlar/` 2 tane içeriyor. |
| R11 | **8 sahipsiz boş klasör** | `12_Raporlar`, `13_Toplantilar`, `14_Kutuphane`, `15_Arsiv`, `16_Teknik`, `17_Skiller`, `18_Veri`, `19_Gizlilik` — **0 dosya.** |

---

## 8. Tek sahip ilkesine göre belirsiz / çakışık yetenekler

### 8.1 Kesin çakışma

| # | Yetenek | Çakışan sahipler |
|---|---|---|
| C1 | **Görev durumu** | Draft_3 `kuyruk/*.jsonl` ↔ Draft_4 `kuyruk.db` |
| C2 | **Beyin / kalıcı hafıza** | Hermes `MEMORY.md`+agentmemory ↔ `00-core/03-beyin/` ↔ (eski) Obsidian |
| C3 | **Model yönlendirici** | Hermes `fallback_providers` ↔ `kordinator/router.py` + `sigorta.py` |
| C4 | **Anayasa** | `TOZ_ANAYASA.yaml` (12 ilke) ↔ `10_Anayasa/anayasa.md` (8 kural) |
| C5 | **Sır taraması** | **4 ayrı implementasyon, 4 farklı regex seti**: `sir_tara.py`, `kordinator/obsidian_sync.py:_SIR`, `beyin.py:_SIR`, `baglam_muhru.py:_SIR` |
| C6 | **Ajansayısı** | `20_Is_Dokumanlari/02:2` → 3 ajan ↔ `11_Ajanlar/` → 2 YAML ↔ `V3:333` → 2 ajan |
| C7 | **Onay kanalı** | `onay_kapisi.bildirim=None` ↔ `yonlendirici-kurallari.yaml:7` ↔ `calistir.ps1` — **3 yer, 0 implementasyon** |

### 8.2 Belirsiz sahiplik

| # | Yetenek | Durum |
|---|---|---|
| B1 | Ortak analiz motoru | `Ortak/ortak-analiz/TASARIM.md:84` "Motor kodu ❌ **Yazılmadı**" |
| B2 | Onay arayüzü | `V3_DURUM_RAPORU.md:173` "**Engelleyici**". Kim yapacak belli değil. |
| B3 | Prompt injection koruması | Kural var (Draft_3), uygulayacak modül **yok** |
| B4 | Müşteri izolasyonu | `kapsam_musteri` alanı **zaten var** (`kuyruk.py:155`) ama ENFORCE edilmiyor |
| B5 | Yedekleme / geri yükleme | `BILGI_YOK_ETME_LISTESI.md:139` aylık tatbikat → Draft_4'te hiç yok |
| B6 | `.env` bayrakları | `ALLOW_EXTERNAL`/`GIT_AUTO_PUSH` var, okuyan kod yok |
| B7 | 2. ajan | `01_kodlama.yaml` var ama worker **tek döngü**, ajan seçimi yok |
| B8 | `19_Gizlilik/` | `00_OKU_BENI.md:22` "Git'e asla" → klasör boş |
| B9 | `calisiyor` / `dogrulaniyor` | Makinede var (`kuyruk.py:23`), worker hiç kullanmıyor → kurtarma boş |

### 8.3 Nihai tek-sahip önerisi

```
BEYİN/ORKESTRATOR → Hermes oturumu (insan). 1 tane. Draft_3'ün kararı.
TASK-STATE       → SQLite kuyruk.db (kordinator). Draft_3'ün "kuyruk.py taşınmaz"
                   gerekçesi TERSİNDE çözülür: Hermes'e SQLite yazdırılır,
                   Hermes'in kendi JSONL kuyruğu KULLANILMAZ.
MODEL YÖNLENDİRİCİ → kordinator/sigorta.py + router.py (Draft_4'ün özgün katmanı)
ANAYASA          → Tek dosya. 8 kural (D4) + 12 ilke (D3) birleştirilmeli.
SIR TARAMASI     → Tek modül (sir_tara.py). 4 kopyadan 3'ü silinmeli.
PROMPT INJECTION → Yeni modül. Draft_3'ün kuralı + Draft_4'ün kodu.
MÜŞTERİ İZOLASYONU → kapsam_musteri zaten var; sadece ENFORCE edilmeli.
ONAY ARAYÜZÜ     → Draft_4'ün en bizzat engeli. Yazılmadan üretim yok.
```

---

## 9. Bu denetimde çalıştırılan doğrulamalar

| Komut | Sonuç |
|---|---|
| `python test_mimarasi.py` | **58 test, OK** |
| `python anayasa_kontrolu.py` | `GECTI - 8/8` |
| `python db_init.py` | Şema OK — 27 sütun, 3 tablo |
| `python worker.py` (boş kuyruk) | Çalıştı; `HICBIR saglayici saglam degil` |
| `python worker.py` (sahte sağlayıcı) | **`AttributeError: 'Kuyruk' object has no attribute 'muhr_yaz'`** |
| aynı + yazma hatası yamalandı | **`GecersizGecis: rota_secildi -> tamamlandi yasak`** |
| `kuyruk.kurtar()` (`rota_secildi`'de) | `kurtarilan=0` — kurtarma çalışmıyor |
| `python runner.py` | **`TypeError: string indices must be integers`** |
| `python 07-araclar/router.py` | `local_ollama`'ya düştü; HTTP çağrısı yok |
| `python sir_tara.py` | `TEMIZ` + "git deposu değil" uyarısı; çıkış 0 |
| `.env` anahtar taraması | 10 anahtar; 3 API anahtarı **boş**; gerçek sır yok |

Orijinal `Toz_Ai_Office_Draft_4\` klasörüne hiçbir dosya yazılmadı/değiştirilmedi.

---

## 10. Karar

1. **Draft_3 kazanır — ama yalnızca yönetişim katmanı olarak.** Hermes seçimi, tek-yazar
   kuralı, iki eksenli yetki matrisi, prompt injection kuralı, sıfır yok etme yasağı ve
   8 işçi tanımı korunmalı; 282 ajan ve Hermes'e tam bağımlılık reddedilmeli.
2. **Draft_4'ün `worker.py`'si yeniden yazılmalı — olduğu gibi reddedilmeli.** İki ayrı
   yerde çöküyor, kurtarma boş, ve bu hatayı Draft_3 aylar önce kaydetmişti.
   `sigorta.py`, `saglayici_istemcileri.py`, `baglam_muhru.py`, `onay_kapisi.py`,
   `dotenv.py` ve SQLite trigger'ı ise doğrudan alınmalı.
3. **Canlıya çıkış iki engelle kapalı:** (a) onay arayüzü yok —
   `V3_DURUM_RAPORU.md:173` bunu zaten "engelleyici" diye yazmış; (b) prompt injection
   koruması Draft_4'te hiç yok. İkisi de Draft_3'te kural olarak mevcut.