# R3 · Draft_5 → Draft_8 Analizi

**Kapsam:** `Toz_Ai_Office_Draft_5`, `_6`, `_7`, `Toz_Ai_Office_Draft_8.md`, `_0` (özet)
**Yöntem:** Tüm dosyalar okundu; her iddia dosya yolu + satır numarasıyla kanıtlandı. Salt okuma.

## 0. KISA TESPİT

| Soru | Cevap |
|---|---|
| Beyin kim? | 4 isim, 1 ortak ilke: **tek yazıcı** |
| Draft_8 en kapsamlı mı? | Evet — ama **en sessiz değiştiren**: Munder/Ruflo/Agency/Obsidian/MCP/3D **hiç geçmiyor** |
| Munder? | Üretimde reddedildi, ayrı sandbox pilotuna atıldı. **Görsel değil, kontrol mantığıydı** — reddedilme sebebi de bu |
| Obsidian ↔ Hermes hafıza? | **Evet, 3-4 katman.** Bugün aktif: 0 |
| Task-state sahibi | **5 farklı mekanizma** — en büyük yapısal çakışma |
| MCP sunucusu | Taslakta 0-2; makinede **2 (1 aktif)** |
| 1 yıl ücretsiz | **Strateji yok.** Tek satır, bozuk bir şablonda |
| Token maliyet modeli | Draft_5'te en olgun (ağırlık × önbellek-duyarlı). Draft_8'de **kaybolmuş** |

## 1. BEYİN / ORKESTRATÖR: HER TASLAK KİMİ SEÇİYOR

| Taslak | Seçim | Kanıt |
|---|---|---|
| Draft_0 | `KoordinatörÇekirdegi` (Munder reddi, D-02) | `Draft_0/00_TEK_OTORITE/KARAR_GUNLUGU.md:55` |
| Draft_1 | Önce **Munder Difflin** (3. nesil "FINAL"), sonra OpenCode | `Draft_1/FINAL_MASTER_ARCHITECTURE.md:44`, `:58`, `:62` |
| Draft_2 | **Hermes** (Chief of Staff) | `Draft_2/presentation-system/final-architecture.md:28` |
| Draft_3 | Orkestra şefi **ayrı ajan değil** = kullanıcının Hermes oturumu | `Draft_3/TOZ_VAULT/02_Orkestrasyon/ORKEPRA.md:5-6`, `:17` |
| Draft_4 | `KoordinatörÇekirdegi` (SQLite kuyruk) | `Draft_4/00_OKU_BENI.md:34`, `00-core/01-kuyruk/kuyruk-olustur.sql:16` |
| Draft_5 | **Kod tabanlı** `KoordinatorCekirdegi`, dosya kilidi | `Draft_5/docs/adr/0002:20`, `01_KORDINATOR/kordinator/coordinator.py:39` |
| Draft_6 | **Hermes** ilk omurga; OpenCode sadece yazılım alanı | `Draft_6/00_OKU_BENI_ILK.md:12-14` |
| Draft_7 | **OpenCode KATMAN 1** orkestrator + F3 rolü | `Draft_7/00_Anayasa/TOZ_ANAYASA.yaml:8`, `10_Teknik/mimari/GENEL_MIMARI.md:26` |
| Draft_8 | **Hermes A01**, yıldız topoloji | `Draft_8.md:216`, `:97` (P9), `:247` |

Ortak ilke: **tek global otorite.** Draft_0 bunu Markdown yasağıyla denedi ve işe yaramadı
(`Draft_0/00_OKU_BENI.md:31-33`: *"3 günde 3 koordinatör kararı... 4 gün sonra yine tartışıldı"*);
Draft_5 **dosya kilidine** taşıdı (`coordinator.py:39-43`, `_OTOMATIK_YASAK_YETKI = {4}`).

### 1.1 Munder: neden reddedildi, gerçekten neydi?

**Red gerekçesi — doğrulanamazlık:**
- 8 dosyada "tek global koordinator" ilan edilmiş; **kaynağı, versiyonu, kurulumu yok**
  → `Draft_5/docs/adr/0002-koordinator-cekirdegi-munderin-yerine.md:3-8`
- Qwen: *"Munder bir harness (kabuk). Claude Code/Codex'i sarıyor. Motoru elediysen, gövdeyi
  kullanmanın anlamı yok."* → `Draft_5/09_BILINMEYENLER_VE_VARSAYIMLAR.md:113-116`
- Draft_0 isimden çözdü → `KARAR_GUNLUGU.md:55`; Draft_3 daha keskin: "Munder **kurulmaz**" (K-002),
  gerekçe "iki yığın = iki kontrol dili" → `Draft_3/.../KARAR_GUNLUGU.md:61`, `README.md:89`
- Tamamen kapanmadı: **ayrı sandbox pilotunda benchmark** → `Draft_5/docs/adr/0005:6-16`

**Sorunun cevabı — Munder GÖRSEL DEĞİL, kontrol mantığıydı** (`HERMES-AUDIT-RAPORU.md:365-379`):
> "Munder'ın gerçek değerleri (token ledger, circuit breaker, worktree) **kullanılmıyor** — onlar
> iş mantığı, UI değil."
> *"Uyarı: 'Munder = sadece UI' denirse `approvals queue`, `per-agent budget`, `circuit breaker`
> **kullanılamaz** — bunlar UI değil, kontrol mantığı."*

Yani "Munder = 3D ofis görseli" konumu **gerçek ihtiyaç değil, boşa gitmiş kabiliyet** olurdu.
"Doğru" konum ("Munder = Ops/Control") ise izin çakışması "EN YÜKSEK" (`HERMES-AUDIT:390-393`).

| Model | Puan | En büyük sorunu |
|---|---|---|
| A) Munder + Hermes + OpenCode | 4/10 | 3 katman × 3 kontrol = 9 karar noktası |
| B) Hermes + OpenCode, Munder = UI | 6/10 | Gerçek kabiliyetleri boşa |
| C) Munder = Ops, Hermes = Intel, OpenCode = Exec | 5/10 | En pahalı, izin belirsizliği en yüksek |
| **D) Hermes + OpenCode (Munder yok)** | **8/10** | Token ledger eksik (çözülebilir) |

→ `HERMES-AUDIT-RAPORU.md:492-499` (rapor `:571` bunun ölçüm değil değerlendirme olduğunu itiraf eder)

---

## 2. DRAFT_8: NİHAİ TEZİ, KURULAN VE REDDEDİLENLER

### 2.1 Tez (`Draft_8.md:50-52`)

> "Yerelde çalışan, AI destekli bir **analiz ve öneri sistemi**. Veri topla → Analiz et → Öneri üret →
> Önceliklendir → İnsan onayına sun → (Onay sonrası) yürüt → Sonucu ölç → Öğren"

`:65-75` kapsam dışı: 9 madde, hepsi "insan onayı olmadan". `:79`: *"100+ ajan değil. **10 ajan,
tek markada, tek uçtan uca akışla**, onay kapısı kanıtlanmış bir sistem."*

**Evet, en kapsamlı ve en olgun taslak:** 1413 satır, 23 bölüm + 4 ek. Onay sınıfları, güven bölgeleri,
veri şemaları, kill switch, test kapıları, ölçekleme planı. Draft_2'nin `final-architecture.md`'i
(10.1-10.6) bunun özeti — aynı 10 ajan, aynı klasör ağacı.

### 2.2 Kurulanlar

| Sistem | Rol | Kanıt |
|---|---|---|
| **Hermes** | Görev alma, sınıflandırma, yönlendirme, delegasyon | `:153` |
| **OpenCode** | Sandbox içinde dosya/araç/kod yürütme | `:154` |
| **n8n** | Zamanlama, webhook, deterministik entegrasyon, bildirim | `:155` |
| **Twenty CRM** | Müşteri/ilişki tek doğruluk kaynağı | `:156` |
| **AnythingLLM** | Marka bazlı retrieval servisi | `:157` |
| **Approval Gate + Executor** | Yeni — yazılacak altyapı, ürün değil | `:159`, `:281-312` |

Çakışma kuralı `:173`: *"Bir iş iki sisteme sığıyorsa, daha deterministik ve daha az yetkili olan seçilir."*

### 2.3 Reddedilenler ve **sessiz düşüşler**

Açık liste (`Draft_2/.../final-architecture.md:159`, Draft_8'de aynı): AnythingLLM ajan özelliği ·
n8n içi LLM kararları · OpenCode otonom görev doğurma · ajan-ajan mesh (P9, `:97`) · yeni framework ·
ilk sürümde otomatik dış yazma (`:63-75`).

**Kelime sayısı 0 olan aday sistemler:**

| Sistem | Draft_8 | Draft_6/7'de |
|---|---|---|
| **MCP** | **0** | Draft_7: 2 sunucu (`12_MCP/mcp_konfigurasyon.md:8-17`) |
| **Obsidian** | **0** | Draft_6 tam bölüm; Draft_7 KATMAN 3 |
| **Ruflo** | **0** | Draft_6 `:105-113`; Draft_7 KATMAN 2 |
| **Agency Agents** | **0** | Draft_6 `:39-53`; Draft_7 286+ rol |
| **3D ofis** | **0** | Draft_6 tam dosya; Draft_7 `11_3D_Ofis/` |
| **OpenClaw / Open Dots** | 0 | Draft_3 `docs/adr/0001:15` — değerlendirilmiş |
> **Bulgu, eksik değil.** Draft_8 P13 (`:101`, `:1212-1222`) yeni bileşen eklemeyi zaten yasaklıyor;
> her adayın "hangi sorunu çözüyor, mevcut olan neden yetmiyor" cevabı gerekli. Hiçbiri cevaplamadığı
> için kurulmadılar — **ve gerekçeleri de yazılmadı.** ADR 001-010 listesinde (`:1238-1249`) yok.
> Sessiz düşüş. Kapatılmalı.

---

## 3. OBSİDİAN VE HERMES BELLEK ÇAKIŞMASI

| Taslak | Obsidian'in rolü | Kanıt |
|---|---|---|
| Draft_6 | "İkinci beyin" — insan-okur kurumsal katman | `06_OBSIDIAN_2_BEYIN_KURULUMU.md:102-110` |
| Draft_7 | KATMAN 3: kalıcı hafıza + AgentDB (HNSW) | `GENEL_MIMARI.md:30`, `KATMAN_SORUMLULUKLARI.md:21-25` |
| Draft_5 | **Yok** — hafıza = mühür + JSONL | `FINAL_MASTER_ARCHITECTURE.md:124`, `adr/0003:18-21` |
| Draft_0 | D10 **bekliyor**: "JSONL + sonra Obsidian" | `KARAR_GUNLUGU.md:140` |
| Draft_8 | **Yok** — yerini AnythingLLM aldı | `:438`, `:526` |

### 3.1 Çakışma: EVET, 3-4 katman (`HERMES-AUDIT-RAPORU.md:250`)

> "agentmemory'nin kalıcı hafızası + `MEMORY.md` + Obsidian **üç ayrı katman**. Munder'ın hive
> memory'si **dördüncü**."

`MEMORY.md`/`USER.md` **yok**, `memory_enabled=True` olmasına rağmen (`:240`) · `agentmemory` sunucusu
**kapalı** (health 000) (`:241`) · `memory.write_approval=False` → çocuk ajanlar onaysız yazıyor
(`:242`, `:297`) · Child'lar `memory` aracını kullanamıyor (`:246`) · OpenCode'da `agentmemory` skill'de
var ama **MCP config'de yok** (`OPENCODE-AUDIT-REPORT.md:97`).

### 3.2 En net sınır koyuş (Draft_0 — kopyalanmalı)

`Draft_0/07_HAFIZA/HAFIZA_MIMARISI.md:223-235`:
```
Obsidian:  ✗ Muhur değildir   ✗ Router değildir
           ✗ İkinci kaynak olmaz  ✗ Koordinatör olmaz
           ✓ İnsan-okur derin bilgi katmanı
```
> "Bu sınırlar yazılmazsa Obsidian ikinci bellek olur ve iki kaynak çelişmeye başlar."

`:193`: *"`obsidian_sync.py` adı Obsidian diyor ama **Obsidian'dan bahsetmiyor.** Sadece git senkronu.
Bu bir **isim kalıntısı**."* — dosya adının yarattığı yanlış güven. Draft_6'nın yaklaşımı doğru:
*"Obsidian + Hermes yeterliyse ek karmaşıklık oluşturulmaz"* (`:116`). Şu an hiçbiri kurulmamış → karar bekliyor.

---

## 4. TASK-STATE SAHİBİ VE KUYRUK SAYISI

**5 farklı mekanizma:**

| # | Mekanizma | Sahibi | Kanıt |
|---|---|---|---|
| 1 | **SQLite kuyruk** (`gorevler`/`loglar`/`onaylar`/DLQ trigger) | `router.py`+`worker.py` | `Draft_4/00-core/01-kuyruk/kuyruk-olustur.sql:16-97` |
| 2 | **Dosya kuyruğu** (`gorev.json`+`olaylar.jsonl`) | `KoordinatorCekirdegi` | `Draft_5/02_KUYRUK/README.md:3-13` |
| 3 | **Cron/tetikleyici** (Hermes zamanlanmış görevler) | Hermes | `Draft_6/05_HERMES_RUFLO_OPENCODE_MIMARISI.md:16` |
| 4 | **Geri bildirim kuyruğu** (`00_Kuyruk/geri_bildirim.md`) | F3 | `Draft_7/02_Orkestrasyon/ROL_DONUSUMU.md:58-61` |
| 5 | **Onay kuyruğu + durum makinesi** | Approval Gate | `Draft_8.md:296`, `:334-364` |

**Durum makineleri de çelişiyor:** 11 durum (D1/D5, `durum_makinesi.py:29-43`) ↔ 16 geçiş (D8 `:334-358`).
Draft_5'in DLQ mantığı ölçülebilir ve doğru: *"Sessiz FAILED → insan öğrenmez, veri kaybolur; DLQ
ikisinin arasını alır: **görünür durur**"* (`durum_makinesi.py:12-18`).

**Kök neden D8'in kendi risk kaydında:** R5 "Üç orkestratörün iş mantığı biriktirmesi" (`:1314`).
Teşhis doğru, tedavi eksik — **5 sayılmamış.** Çözüm: `schemas/task.schema.yaml` (`:864-880`) tek
sözleşme; SQLite/JSONL/Onay onun görünümü.

---

## 5. MCP / SKILL / PLUGIN POLİTİKASI

**Draft_8'in skill ilkeleri (en net, MCP'siz):** S2 her skill'in kabul kriteri olmalı (`:505`) ·
S3 yeni skill **aynı iş 3 kez tekrarlanınca** (`:506`) · S5 ajanlar skill oluşturamaz (`:508`) ·
S8 marka adı skill'e gömülmez (`:511`).

| Kaynak | MCP sunucu | Kanıt |
|---|---|---|
| Draft_7 | **2** — `ruflo`, `agency-agents` | `12_MCP/mcp_konfigurasyon.md:8-17` |
| Draft_6 | Kural, sayı yok: *"gerekli oldukça açılır"* | `05:124-131` |
| Draft_0 | **0** — `araclar: [] # su an MCP yok` | `01_MIMARI/KATMANLAR.md:84-85` |
| Draft_8 | **0 kelime** | — |
| Draft_3 | 2 sunucu, **81 araç** | `10_MCP/MCP_KATALOGU.md:7-10` |
| Makine (Hermes) | 2 sunucu, 86 araç | `HERMES-AUDIT:428` |
| Makine (OpenCode) | 2 tanımlı, **1 aktif** | `OPENCODE-AUDIT:104-122` |

Draft_6'nın maliyet gerekçesi korunmalı: *"çok sayıda MCP sunucusunun token maliyetini
artırabildiği dokümanında açıkça belirtiliyor"* (`05:98`, `10_CALISMA_ZAMANI:43`).
Draft_0'ın 16 aktif MCP'yi ihlal sayması doğru (`04_GUVENLIK/IHLAL_RAPORU.md` İHLAL 2):
**bağlam maliyeti ölçülmeden MCP çoğaltma.**

**Skill kütüphanesi — gerçek boyut:**

| Ölçüm | Değer | Kanıt |
|---|---|---|
| Aktif skill (makine) | **~89**, 4 kaynak | `OPENCODE-AUDIT:85-92` |
| Ölü skill | **28 firecrawl** (MCP kapalı) | `:95`, `:169` |
| Agency Agents havuzu | **282 ajan ≈ 975.000 token** — önden yüklenemez | `Draft_7/ROL_DONUSUMU.md:16-17` |
| Katalog rolü | 43 (D6) / ~50 (D5) | `ROL_DONUSUMU.md:13`, `Draft_5/09_BILINMEYENLER:215` |

Draft_0'ın cümlesi korunmalı: *"295 ajan dosyası ≠ 295 işçi"* ve *"1.000 karakterlik üçüncü taraf
ajan dosyası, şirket standardı değildir"* (`02_AJANLAR/AJAN_LISTESI.md:27`, `:183`).

---

## 6. GÜVENLİK MİMARİSİ

### 6.1 Tasarım (Draft_8'de en güçlü taraf)

| Mekanizma | Kanıt |
|---|---|
| 5 güven bölgesi (Z1-Z5); Z1/Z2 → Z4 doğrudan çağrı **yok** | `:133-143` |
| 14 değişmez ilke; governance ajanlara **salt okunur** | `:87-102`, `:851` |
| A/B/C/D onay sınıfları; **C ve D hiçbir koşulda otomatikleştirilemez** | `:285-292` |
| **Hash bağlama:** onaydan sonra içerik değişirse onay geçersiz | `:299`, `:1109` (T3) |
| Onay son kullanma süresi (A=7g, B=48s, C=24s, D=12s) | `:300` |
| Secrets **yalnızca Z4**, marka başına ayrı, 90 gün rotasyon | `:581-588` |
| Prompt injection: dış içerik **veri** olarak etiketlenir, komut sayılmaz | `:572-577` |
| Kill switch KS-1…KS-4, **kimlik bilgisi gerektirmeyen tek adım** | `:723-732` |
| **Fail closed:** QA / Approval Gate / audit log düşerse sistem durur | `:721` |
| T1-T15 zorunlu güvenlik testleri, go-live engelleyici | `:1103-1121` |
| Marka izolasyon testi (canary) — sızıntı → kill switch | `:533-538` |

Draft_0/5/6'nın **kodla zorlanan** 8 kuralı (K-01…K-08) tasarımın en güçlü parçası
(`Draft_5/docs/adr/0008-dondurma-kod-olarak.md`, `coordinator.py:39-43`).
Kritik ilke (`adr/0009:47-49`): **"Maliyet bir yerde kırpılır, kalite başka yerde"** — Draft_8'de kaybolmuş.

### 6.2 Gerçek makine — taslakların varsaydığının tersi

| Risk | Seviye | Kanıt |
|---|---|---|
| `approvals.mode=smart` + `terminal.backend=local` + `smart_policy=''` + **`approvals.deny=[]`** | **KRİTİK** | `HERMES-AUDIT:288`, `:299-300` |
| Masaüstünde **6 dosyada düz metin API anahtarı** | **KRİTİK** | `:290` |
| `tirith_fail_open=True` → tarama çökerse koruma kapanır | Yüksek | `:263`, `:291` |
| `computer_use` toolset **açık** (fare/klavye) | Yüksek | `:292` |
| `external_directory:"*":allow` + `bash "*":allow` → **tüm disk + UNC** | Yüksek | `OPENCODE-AUDIT:137`, `:153`, `:165` |
| **PowerShell 5.1 alias bypass:** `ask` `rm` yakalar, `Remove-Item` **yakalamaz** | Yüksek | `:154`, `:164` |
| `--auto`: **tek bayrakla 17 `ask` kuralı düşer** | Yüksek | `:152`, `:163` |
| `edit: allow` → korumasız yazma | Orta-Yüksek | `:155` |
| `memory.write_approval = False` | Orta | `HERMES-AUDIT:242` |

**Draft_8'in sandbox kuralları (`:590-596`) bu gerçeğe göre yetersiz**; `:593` ve `:1036` zaten
**"DOĞRULA"** işaretli. Açık soru `:1331`: *"QA'yı ayrı ajan çalıştırma, sandbox ağ kısıtı ve araç
izinleri destekleniyor mu?"* → `HERMES-AUDIT:556-557`: *"10 testin 4'ü başarısız, 5'i yapılmamış.
**Production için hazır DEĞİL.**"*

**Önce yazılması gereken 5 madde:** (1) `approvals.deny` açık liste — LLM değerlendirmesine bağlı
kalmak kabul edilemez; (2) `external_directory` → `brands/<id>` + onaylı dizinler; (3) `bash`
desenlerine PowerShell native cmdlet'leri (`Remove-Item`, `Invoke-Expression`,
`[System.IO.File]::Delete`); (4) `--auto` config seviyesinde yasak; (5) 6 sır dosyası —
konum düzeltme + `file_safety` engeli.

---

## 7. AI ÇALIŞAN KATALOĞU

| Taslak | Kaç | Kanıt |
|---|---|---|
| **Draft_8** | **10** (A01-A10), 3 birim + bağımsız governance | `:214-225` |
| Draft_7 | **10 aktif** + pasif havuz | `ROL_DONUSUMU.md:114-123` |
| Draft_6 | **~43 rol**, 8-15 çekirdek | `12_AI_CALISAN_KATALOGU.md` (`grep -c '^### '`=43, `ROL_DONUSUMU.md:13`) |
| Draft_5/0 | **7 işçi**, sırayla devreye girer | `Draft_0/02_AJANLAR/AJAN_LISTESI.md:38-46` |
| Draft_4 | **2 ajan** (MVP) | `Draft_4/.../V3_MASTER_MIMARI.md:37` |
| Draft_3 | **8 işçi** (A1-A8) + 282 pasif | `Draft_3/TOZ_VAULT/01_Ajanlar/AJAN_LISTESI.md` |

**Draft_8 kadrosu:** A01 Hermes (CoS, F1) · A02 QA & Compliance (Gov, F1) · A03 Briefing Officer (F1) ·
A04 Market & Competitor Analyst (F1) · A05 Customer & Trend Insight (F2) · A06 Content Strategist (F2) ·
A07 Content Drafter (F2) · A08 Campaign Planner (F3) · A09 Data & Performance Analyst (F3) ·
A10 Brand & Budget Controller (F3).
Güvenli başlangıç `:227`: *"Faz 1'de yalnızca **A01, A02, A03, A04** (+ gerekirse A07)."*

**Draft_7'nin değeri tasarımda değil ölçülebilirlikte** (`ROL_DONUSUMU.md:8-30`, "ÖNCE ÖLÇÜM"):
- 282 ajan = 3.899.942 karakter ≈ 975.000 token → önden yüklenemez (`:16-17`)
- Katalog toplamı 680.000/gün → aktif 10 rol = **650.000**; F2 45k + E2 15k = Teknik_DevOps 60k
  → `:141` (*"benim önerim, vault'ta böyle yazılı değil"*)
- **`max_spawn_depth = 1`** → alt ajan alt ajan doğuramaz → **tek dağıtım otoritesi zorunlu** (`:25-30`)
- `max_concurrent_children = 10` (`:24`); plugin bekleme süresi 330 sn (`:27`)

Çakışma kuralları ölçülebilir (`:266-275`): tek yazıcı · veri≠karar · kalıp/örnek · çevrimsiz çağrı ·
tek onaycı · tek dağıtım otoritesi · pasif=maliyet 0 · **raporlayan uygulamaz**.
Kurucu gerçeği `:145`: *"10 rol '10 ayrı insan' değil, **10 ayrı yazma yetkisi + 10 tetikleyicidir**."*
Draft_8 `:1263` bunu mimariye taşımış: *"Durumsuz ajan, harici durum."* İkisi uyumlu.

---

## 8. 1 YIL ÜCRETSİZ STRATEJİSİ VE TOKEN MALİYET MODELİ

### 8.1 "1 yıl ücretsiz" — strateji yok

Tüm korpus taramasında geçen **tek** yer:
`Draft_2/presentation-system/PRESENTATION_SYSTEM_SPECIFICATION.md:8` → *"1 year free operation guarantee"*

Bu dosya **bozuk bir üretim artefaktı** — `:19-20`'de PowerShell değişkeni literal yazılmış
(`Created:  + (Get-Date).ToString(` / `G) + "`). Sunum şablonu, operasyon planı değil.

**Gerçekte var olan 1. yıl kısıtları:**

| Kısıt | Kanıt |
|---|---|
| Yıl 1 araç maliyeti **~0 TL** (elektrik+internet hariç) | `Draft_5/06_TEKNIK_HAZIRLIK_KONTROL.md:188-195` |
| **Elektrik ≈180 TL/yıl** — "0 TL iddiasının gözden kaçan kalemi" | `:197-203` |
| **1. yıl bot kullanma** (dosya + manuel tetikleme) | `:230-231` |
| Ölçekleme/bulut **1. yıl yok** | `:256` |
| **Paket D (performans bazlı) 1. yıl KULLANILMAZ** | `Draft_5/05_HIZMET_KATALOGU_PAKETLER.md:250` |
| Sağlık/veteriner dikey **1. yıl YOK** | `Draft_0/06_IS_MODELI/HIZMET_KATALOGU.md:173` |
| 3D ofis **Faz 13+**, 1. yılda yapılmıyor | `Draft_0/03_IS_KOLU/AJAN_HATTI.md:135` |
| YouTube & Medya Stüdyosu **1. yıl yok** | `Draft_0/03_IS_KOLU/OPERASYON_HATTI.md:31` |
| İlk 6 ay **kimse işe alınmıyor** | `Draft_5/04_ORGANIZASYON:199-201` |
| 1. yıl insan sayısı **1** (+ dış uzman) | `Draft_5/04_ORGANIZASYON:209` |

**Sonuç:** "1 yıl ücretsiz" bir **müşteri vaadi olarak hiçbir yerde tanımlanmamış.** Bu bir kar.
Öneri: paketin içine konmalı (Kurulum + 3 ay Yönetilen Operasyon bedava) ve `FIYATLANDIRMA.md`'ye
yazılmalı — yoksa saha ekibi söz verir, ölçüm yoksa zarar TOZ'da.

Fiyat bantları **gerçek değil** — dokümanın kendisi "hipotez bandı" diyor
(`Draft_5/02_IS_MODELI_GELIR_MOTORLARI.md:107-112`); öneri `:114-121` ilk müşteri deneme bedeli.
"Birim ekonomi" tablosundaki **beş değişkenin beşi de ölçülmemiş** (`:134-138`).

### 8.2 Token maliyet modeli

**En olgun — Draft_5 (korunmalı, Draft_8'e taşınmalı):**
`maliyet = Ağırlık(sınıf) × (okunan×0.1 + yazılan×1.25 + doğrudan)` → `adr/0009:35-37`

| Katman | Sorusu | Kod |
|---|---|---|
| Ağırlık | Bu iş ne kadar çalışıyor? | `Agirlik.birlik` |
| Maliyet | Bu gerçekten ne kadar tutuyor? | `Kullanim.maliyet` |
| Birim | Kotadan ne kadar yemek? | `Kullanim.birim` |

→ `:41-45`. Gerekçe `:47-48`: *"Ağır görev tanımı token fiyatını değiştirmez, sadece kotadan yer çeker."*

Ağırlıklar (`:31-38`, `FINAL_MASTER:196-204`): SINIFLANDIRMA 1 · RAPOR 2 · ARAŞTIRMA 4 · ANALİZ 6 ·
KOD_URETIMI 10 · KRITIK_HATTI 12 — her biri kendi kalite eşiğiyle.
Ölçülen dürüst sonuç (`FINAL_MASTER:155-167`): *"onek 625 token, sonnet eşiği 1024 → ONBELLEKLENMEZ.
**Önbellekleme şu an %0 kazanç sağlıyor.**"* Gizlenmemiş.

| Taslak | Bütçe | Kanıt |
|---|---|---|
| Draft_7 | `daily_total: $5.00`, uyarı %80, hard stop %100 | `10_Teknik/model_routing.yaml:25-28` |
| Draft_0/4 | D4: günlük tavan **0 + aşılırsa uyarı** | `KARAR_GUNLUGU.md:134` |
| Draft_7 | Rol bazlı: E1 150k … E2 15k = 650k/gün | `ROL_DONUSUMU.md:127-139` |
| Draft_1 | "$0 · $5/gün · 700.000 token/gün — **üçü birden doğru olamaz**" | `adr/0007:23-25` |
| **Draft_8** | Görev/marka limitleri var (`:655-683`) — **para modeli yok** | — |

**Sağlayıcı kotaları hiçbir taslakta doğrulanmamış** (`Draft_5/09_BILINMEYENLER:139-147`: OpenRouter 50,
Gemini 1500, DeepSeek 100, 700.000 token, $5/gün, 286+ ajan, 2089 beceri → hepsi "Doğrulanmadı").
Düzeltme: **Groq ücretsiz katman günlük değil dakika hız limitli** (`Draft_4/.../V3_MASTER_MIMARI.md:194-195`).

---

## 9. KORUNMASI VE REDDEDİLMESİ GEREKENLER

### 9.1 KORUNMASI GEREKEN

| # | Ne | Gerekçe | Kanıt |
|---|---|---|---|
| K1 | **Draft_8 güvenlik mimarisi** (güven bölgeleri, A/B/C/D, hash, fail-closed, kill switch, T1-T15) | Kullanılabilir taslakların **tek** tam güvenlik tasarımı. Diğerlerinde "prompt injection" kelimesi geçmiyor | `Draft_8:133-143`, `:285-292`, `:558-608`, `:723-732`, `:1103-1121` |
| K2 | **Draft_5 maliyet sayımı** (ağırlık × önbellek-duyarlı fiyat) | "Tahmin değil sayım." Prompt cache %90 tasarruf; bu olmadan Draft_8 bütçeyi ölçemez | `adr/0009:35-45`, `FINAL_MASTER:155-167` |
| K3 | **Draft_5/0 koda taşınmış anayasa** (K-01…K-08) | *"Markdown bir tarayıcı özelliğidir. Kimse sistemi ayağa kaldırırken o dosyayı okumaz."* | `adr/0001:9-10`, `coordinator.py:39-43` |
| K4 | **DLQ + idempotency + atomik yazım + kapsam latch** | Sessiz veri kaybını kapatır; "kimlik uydurulmaz" kodda | `durum_makinesi.py:12-18`, `02_KUYRUK/README.md:57-71` |
| K5 | **Draft_7 çakışma kuralları** (10 madde, ölçülebilir) | *"Ölçülebilir cümle yoksa rol tanımı bitmiş sayılmaz."* | `ROL_DONUSUMU.md:266-275` |
| K6 | **Draft_6 repo puanlaması** (+2 resmî, −3 lisans belirsizliği) | *"Çok güzel görünüyor bir kurulum sebebi değildir"* | `16_GITHUB_ADAY_REPO_LISTESI.md:79-96` |
| K7 | **Draft_6 kaynak hiyerarşisi** (kanon > doküman > GitHub > sektör > forum) | Reddit tek başına kanıt sayılmaz | `14_KAYNAK_VE_DOGRULAMA_NOTLARI.md:105-107` |
| K8 | **Draft_0 Obsidian sınır kutusu** | Sınırlar yazılmazsa Obsidian ikinci bellek olur — çakışmanın kaynağı | `Draft_0/07_HAFIZA/HAFIZA_MIMARISI.md:223-235` |
| K9 | **AJAN ≠ İŞÇİ ≠ ROL ayrımı** | 282/295 ajan dosyası tuzağını kapatır | `Draft_0/02_AJANLAR/AJAN_LISTESI.md:171-183` |
| K10 | **Draft_6 mevzuat haritası** + "Kesinlikle yasaldır" yasağı | 9 sektör, resmî kaynak önceliği, KVKK/İYS/SPK | `17_MEZUAT_HARITASI.md:138-147`, `:126-136` |
| K11 | **Yetki kademeleri** (0-3 otomatik/insan, 4 = asla) | *"Model yapabiliyor = çalışan yapabiliyor değildir"* | `Draft_5/04_ORGANIZASYON:68-93` |
| K12 | **Marka = tenant + canary izolasyon testi** | 50 markaya ölçeklenmenin tek yolu | `Draft_8:517-538`, `:1262` |
| K13 | **Her iki denetim raporunun dürüstlüğü** | "Skor 5.2, 10 değil." Ölçülmeyeni ölçülmüş gibi yazmama disiplini | `HERMES-AUDIT:556-557`, `OPENCODE-AUDIT:280` |

### 9.2 REDDEDİLMESİ GEREKEN

| # | Ne | Gerekçe | Kanıt |
|---|---|---|---|
| R1 | **Munder** (üretimde) | Kaynak/versiyon/kurulum/kanıt yok; 8 dokümanı geçersiz kıldı. Doğrulanmamış kabuğa tek otorite verilemez | `Draft_5/adr/0002:20-27`, `HERMES-AUDIT:494-499` |
| R2 | **Ruflo** (v1'de) | İkinci global orkestratör. Gerekçesi Munder'a dayanıyordu; Munder düşünce **gerekçesi de çöktü** (C-07) | `Draft_0/04_GUVENLIK/IHLAL_RAPORU.md` İHLAL 8; `Draft_6/05:105-113` |
| R3 | **OpenClaw / Open Dots** | Değerlendirilmiş ama sadece "ana mimari değişmedi" diye geçirilmiş; Hermes→Munder geçişinin izi yok | `Draft_3/docs/adr/0001:15-20` |
| R4 | **Draft_7 kurulum komutları** | Doğrulanmamış: `npx ruflo@latest mcp start`. Draft_3 zaten uyardı: sürüm pini (`firecrawl-mcp@3.27.3`) npx cache'i öldürüyor | `Draft_7/12_MCP/mcp_konfigurasyon.md:11-16`; `Draft_3/.../MCP_KATALOGU.md:75-80` |
| R5 | **Draft_7 model listesi** | `claude-haiku-4.5`, `claude-sonnet-4.6` gerçek listede yok; makinede 73 model **tamamı `opencode/*`** | `model_routing.yaml:6,12`; `OPENCODE-AUDIT:39` |
| R6 | **Draft_7 mimari dosyalarının içeriği** | 296 satırın 20'si mimari; gerisi PowerShell `Yaz()` ve boş şablon. `organizasyon_semasi.md` **27 byte, boş** | `GENEL_MIMARI.md:9-21`; `05_Sirket/organizasyon_semasi.md` |
| R7 | **"1 yıl ücretsiz"** (öyle bir strateji yok) | Tek geçtiği yer bozuk şablon dosyası; vaat tanımsız | `Draft_2/.../PRESENTATION_SYSTEM_SPECIFICATION.md:8`, `:19-20` |
| R8 | **Fiyat bantları** (25k-75k TL) | Dokümanın kendisi "hipotez" diyor; ölçülmemiş fiyat = kâr gizleme aracı | `Draft_5/02_IS_MODELI:107-124` |
| R9 | **Sağlayıcı kota rakamları** | Hepsi "doğrulanmadı"; Groq günlük değil dakika limitli | `Draft_5/09_BILINMEYENLER:139-147`; `Draft_4/...:194-195` |
| R10 | **Draft_8'in sessiz düşüşleri** | 6 sistem kaldırıldı, gerekçe/ADR yazılmadı → P13 ihlali | `Draft_8:101`, `:1212-1222` |
| R11 | **Draft_5 Faz 13 "PRODUCTION DONDURMA"** | 1-12 PASS ölçütü, uçların **0/10** olduğu kendi kaydında | `FINAL_MASTER:326-336` |
| R12 | **3D ofis / YouTube / Sağlık dikey** (1. yıl) | D6 ve C-13 kararları. "16 boş klasör = 16 boş vaat" | `Draft_0/03_IS_KOLU/AJAN_HATTI.md:135`; `OPERASYON_HATTI.md:31-32` |

---

## 10. EN BÜYÜK ÇELİŞKİLER

**Ç1 — Beyin kim? (4 isim, 5 taslak).** `Hermes` (D6, D8) ↔ `OpenCode` (D7) ↔ `KoordinatörÇekirdegi`
(D0, D4, D5) ↔ `Munder` (D1, reddedildi) ↔ `kullanıcının oturumu` (D3). Kök neden
`FINAL_MASTER:99`: *"Kimse karar sahibi değil."* → **Çözüm:** D8 üçlüsü (Hermes + Approval Gate +
Executor) en olgun, ama Hermes'in bu rolü kurulu sürümde taşıyabildiği `DOĞRULA` (`:1331`).
Onay kapısı altyapısı **önce**.

**Ç2 — Task-state (5 mekanizma).** SQLite (D4) ↔ JSONL/gorev.json (D5) ↔ Hermes cron (D6) ↔
`00_Kuyruk/geri_bildirim.md` (D7) ↔ Approval Gate (D8). D8 bunu R5 "üç orkestratör" sanıyor, 5 saymıyor.
→ **Çözüm:** `schemas/task.schema.yaml` tek sözleşme.

**Ç3 — Bellek katmanı (3-4 → 0).** Obsidian (D6, D7) ↔ Hermes agentmemory+MEMORY.md ↔ mühür+JSONL (D5)
↔ AnythingLLM+Hermes (D8). `HERMES-AUDIT:250` 4 katman diyor; hiçbiri etkin değil → bugün 0.
→ **Çözüm:** K8 ya da D8'in 5 katmanı. Obsidian ya da AnythingLLM, ikisi değil.

**Ç4 — Ruflo.** D6 `:16` "zorunda değil" ↔ D7 `:28` **KATMAN 2, `npm install -g`** ↔ D5 `adr/0005` üretimde yok ↔ D0 İHLAL 8 kurulmaz. → **Kurulmaz.** Gerekçe: "ölçülebilir faydası kanıtlanana kadar kurulmaz" (C-07).

**Ç5 — Ajan sayısı.** 2 (D4) ↔ 7 (D0/D5) ↔ 10 (D8) ↔ 43 rol (D6) ↔ 282 pasif (D7) ↔ 60-150
(`Draft_6/10_CALISMA_ZAMANI:77-80`). → **Çözüm:** D8'in 10'u + D7'nin "10 yazma yetkisi + 10 tetikleyici"
ayrımı. D6'nın 60-150 rakamı **vizyon** (3. yıl ölçeği).**Ç6 — Kalite kapısı kim?** D7 Ç4: `Q` tek yayıncı, F3 onaylayamaz (`:63-71`) ↔ D8: A02 Hermes'e
rapor vermez, Approval Gate'e gider (`:248`) ↔ D3 `ORKEPRA:45` aynı. → **Uyumlu, korunmalı.**

**Ç7 — Token bütçesi: $0 mı, $5/gün mi, 650k mi?** `adr/0007:23-25`: *"Üçü de canlı bir sistemde aynı
anda doğru olamaz."* → $0 yıl-1 (D0 D4), token/gün D4, gerçek maliyet D5'in ölçüm modeli.

**Ç8 — Yerel mi, bulut mu?** D5: yerel birincil ↔ D4: **Cloud First + Local Failover ("yanılmışım",
8 GB RAM'de yerel zayıf)** ↔ D0 D5: bulut önce (⏳). → Donanım verisine dayalı: 8 GB ise **bulut önce**.
Yerel sadece failover + gizli görevler.

**Ç9 — Obsidian statüsü.** D6 ikinci beyin ↔ D0 D10 bekliyor ↔ D5/D8 hiç yok. → Karar ver. Kurulacaksa
K8'deki sınırlar yazılır; kurulmayacaksa `obsidian_sync.py` **yeniden adlandırılmalı** (D0 `:193`:
isim kalıntısı yanlış güven üretiyor).

**Ç10 — 3D ofis: operasyonel mi, vitrin mi?** D6 `09_3D:58-64`: *"3B arayüz işin kendisini yürütmez.
İzleme ve yönetim arayüzü olur."* ↔ D7: önce 2D pano (`11_3D_Ofis/3d_ofis_mimarisi.md:11-14`) ↔ D0:
**beş yasak** — coordinator/database/ikinci memory/ikinci MCP router/workflow engine değil (`:120-133`),
**1. yılda yapılmıyor** (`:135`). → **Üçü de görsel/izleme diyor ve üçü de reddediyor.** Munder'ın "UI"
konumundan farkı: 3D ofis bir **ops görünümü**, kontrol mantığı değil. Draft_8'de düşmesi sorun değil —
sadece ADR'ye "Faz 13+, 1. yıl hayır" yazılmalı.

---

## 11. ÖNERİLEN NİHAİ MİMARİ

> **Draft_8 güvenlik + Draft_5 maliyet sayımı ve kodla zorlanan anayasa + Draft_7 ajan-seviyesi
> tek-yazıcı kuralları + Draft_6 kaynak/mevzuat disiplini** — Hermes + Approval Gate + Executor
> omurgasıyla; Munder, Ruflo, Agency Agents, Obsidian, 3D ofis ve v1 MCP genişletmesi **kapsam dışı**.

**İlk 3 iş:** (1) `approvals.deny` açık liste + `external_directory` daraltma + PowerShell cmdlet'leri
`ask`'e + 6 sır dosyası (D8 Faz 0.6-0.7 `:1017-1018`, gerçek config değerleriyle) (2) Approval Gate +
Executor + audit log, elle taslakla uçtan uca (`:1030-1031`) (3) D5 maliyet sayımını `schemas/`'a
taşı, marka kotasını gerçek `usage` ile besle.

*Salt okumadır: hiçbir dosya değiştirilmedi, komut çalıştırılmadı, git işlemi yapılmadı.*
