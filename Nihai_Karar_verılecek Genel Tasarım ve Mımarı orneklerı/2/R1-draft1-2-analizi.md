# R1 — Draft_1 ve Draft_2 Mimari Analizi

**Kapsam:** `Toz_Ai_Office_Draft_1\` (44 dosya) ve `Toz_Ai_Office_Draft_2\` (6 dosya)
**Yontem:** Tum `.md` ve `.py` dosyalari okundu; `.pyc`/`__pycache__` atlandi. Kod **calistirildi** ve testler **kosuldu**.
**Tarih:** 2026-10-06 · **Ortam:** Python 3.14.7, pytest yok (unittest).

---

## 1. BEYIN / ORCHESTRATOR / TASK-OWNER: KAC TANE?

### 1.1 Draft_1 — beyin sayisi: 1 (tutarli)

| Rol | Sahip | Kanit |
|---|---|---|
| Tek global koordinator | `KoordinatorCekirdegi` | `01_KORDINATOR/kordinator/coordinator.py:154` |
| Ayaga kalkma kapisi | `AnayasaDenetleyicisi.acilis_kontrolu` | `01_KORDINATOR/kordinator/anayasa.py:130` |
| Gorev sahibi (task owner) | `Gorev` + `kordinator.gorevler` | `coordinator.py:95`, `coordinator.py:167` |
| Yurutucu (Katman 3) | OpenCode / Hermes — "muhurdan devam eder" | `FINAL_MASTER_ARCHITECTURE.md:147` |

Draft_1 yedi-dokuz koordinator adini **reddeden** taraf: "Munder Difflin, OpenCode, Hermes, OmniRoute, LiteLLM, DeepSeek Harness, AGENT 00 ve kuyruk katmaninin kendisi" (`docs/adr/0001:5-6`). Ana metin daha fazla isim sayiyor (`FINAL_MASTER_ARCHITECTURE.md:58-59`) ve "7 farkli koordinator" diyor (`:84`). **Sayim tutarsiz (metin 7, liste 8-10).** Kuralin kendisi saglam, sayim yanlis.

Munder reddi gerekceli ve test edilebilir: "Kaynagi (repository) korpusta yoktur. Versiyonu, kurulumu ve dogrulama kaniti yoktur" (`docs/adr/0002:8-10`).

### 1.2 Draft_2 — beyin sayisi: 2, hatta 3

| Rol | Sahip | Kanit |
|---|---|---|
| Beyin / delegasyon merkezi | **Hermes** (Office of the Chief of Staff) | `presentation-system/final-architecture.md:28`, `:35` |
| Sunum hattinin beyini | "Orchestrator / Creative Director" | `components/AGENT_SYSTEM.md:5` |
| Katman-1 orkestrasyon | "Orchestration - Stage management, agent delegation" | `architecture/ARCHITECTURE_LAYER.md:7` |
| Yurutme | OpenCode | `final-architecture.md:52` |

Draft_2 icinde **iki ayri organizasyon** yan yana duruyor: ofis (10 ajan, `final-architecture.md:56`) ve sunum sistemi (17 rol, `AGENT_SYSTEM.md:5-23`; `ARCHITECTURE_LAYER.md:8` "20 specialized agents"). Bunlar ayni ajan havuzunu iki kez sayiyor.

### 1.3 Capraz taslak catismasi (EN KRITIK)

**Hermes'in rolu iki taslakta zittir:**

- **Draft_1:** Hermes reddedilen koordinator adaylarindan biri (`FINAL_MASTER_ARCHITECTURE.md:41`, `:59`), ama Katman-3 yurutucu olarak kalir (`:147`) ve Test Kapisi 10'da "uzman isci"dir (`11_KURULUM/TEST_KAPILARI.md:20`, `:103`).
- **Draft_2:** Hermes **beyindir**; tum delegasyon ondan gecer (`final-architecture.md:35`), birlik hatirlik sahibidir (`:53`).

Draft_2 bunu fark edip bir "celiski" olarak listeliyor ama sahiplenmiyor: "Hermes belleği vs CRM vs AnythingLLM (gerçeklik kaynağı)" (`final-architecture.md:158`).

---

## 2. PYTHON "KORDINATOR" KODU: KAVRAMSAL MI, CALISIYOR MU?

### 2.1 Sonuc: **GERCEKTEN CALISIYOR.** Kanit:

**a) Uctan uca ornek betigi kosuldu** — `01_KORDINATOR/calistir.py` (162 satir):

```
AYNI: True                                     (5 mesaj vs 5.000 mesaj -> 143 token)
Dogru ack dogrulandi: True
Bozuk ack REDDEDILDI: MuhurDogrulanmaHatasi
1 kod gorevi -> 10 birim (10 birim = 10 ucuz gorev)
Geri donus REDDEDILDI: GecersizGecisHatasi
1 gorev kurtarildi. Durum: completed
Iki koordinator: KAPALI
    - [K-01] iki global koordinator: bulunan: A, B
```

**b) Anayasa kapisi kosuldu** — `kontrol/anayasa-kontrolu.py:88`: `SONUC: GECTI - 7/7 kural saglandi.`

**c) Testler kosuldu — 106 test topland, 104 GECTI, 2 HATA.**

### 2.2 Kritik bulgu 1: "106 test yesil" iddiasi **DOGRU DEGIL**

`README.md:16` "Beklenen cikti: ... **106 test yesil**", `11_KURULUM/KURULUM_SIRASI.md:53` Faz 2 gecis kosulu "106 test yesil".

Gercek calistirma:

```
Ran 106 tests
FAILED (errors=2)
  ERROR: test_kural_kodu_karsilik_gelir (test_anayasa_ihlalleri.AnayasaMetinTestleri)
  ERROR: test_her_kod_kurali_metinde_gecer (...)
  FileNotFoundError: 'D:\\Otonom_AI_Ofis_Master\\00_ANAYASA\\ANAYASA.md'
```

Sebep: `08_TESTLER/test_anayasa_ihlalleri.py:205` ve `:216` **sabit mutlak yol** icin yazilmis. Depo `Desktop\Toz_Ai_Office_Drafts\...` altinda oldugu icin iki test her zaman hata veriyor.

**Sonuc:** Faz 2'nin gecis kosulu **bu konumda hicbir zaman saglanamaz**. `calistir-testler.ps1:63` "TESTLER KIRMIZI. Mimari bozuk." yaziyor ve `exit 1` veriyor.

Metin-kod eslesmesinin **kendisi dogru**: `00_ANAYASA/ANAYASA.md` icinde K-01..K-07'nin tamami `**K-xx**` biciminde mevcut (dogruland). Yani tek hata yol sabiti; mekanizma calisiyor. Ama ADR 0008'in "pahali lastir" fikri geregi **bu bir kural degil, kapida gecilemeyen bir kusurdur** ve "kural + kod + metin birlikte guncel" disiplinini testte kanitlamaz.

### 2.3 Kritik bulgu 2: Test dagilimi iddiasi yanlis

| Mekanizma | `FINAL_MASTER` iddiasi | Gercek |
|---|---|---|
| Baglam muhru | "106 testin 26'si" (`:262`) | **19** |
| Token kapisi | "106 testin 40'i" (`:333`) | **31** |
| Anayasa | "106 testin 22'si" (`:380`) | **20** |
| Koordinator cekirdegi | — | **36** |

`README.md:70-72` ve `FINAL_MASTER:624-626` ayni yanlis rakamlari tekrarliyor. Uclu birlikte 88 iddia edilmis, gercek 70.

### 2.4 Kritik bulgu 3: JSONL **kurtarma kaynagi degil** (yaz-tek kayit)

`coordinator.py:297-321` `geri_yukle()` yalnizca `gorev.json` okur, JSONL'i **oynatmaz**.

Grep kaniti — `OlayKaydi.oku()` ve `.son()` **hicbir yerde cagrilmiyor**:

```
coordinator.py:297: def geri_yukle(self) -> int:
coordinator.py:320: self.olay.yaz("kordinator.geri_yuklendi", ...)
test_koordinator_cekirdegi.py:267: yeni.geri_yukle()
```

Ama dokumanlar bunu vaat ediyor:
- "JSONL, coktukten sonra durumu **YENIDEN OLUSTURMAYI** mumkun kilar" (`FINAL_MASTER:389`, `01_KORDINATOR/kordinator/olay_kaydi.py:9-10`)
- "durum kaldigi noktadan devam eder (**JSONL oynatimi**)" (`11_KURULUM/TEST_KAPILARI.md:86`, Kapi 7)
- "Olay kaydi bir *ayna*dir ... Ama JSONL coktuktan sonra durumu yeniden olusturur" (`FINAL_MASTER:392`)

Gecen test `test_tekrar_oynatma_durumu_geri_kutar` yalnizca `durum_ata()` her geciste `gorev.yaz()` cagrisi yaptigi icin gecer (`coordinator.py:264`). **Kapi 7 yazildigi gibi geçmez.** Bu, Draft_1'in "Kendini yalanlamama" ilkesinin en somut ihlali: vaad edilen mekanizma testle kanitlanmadan "kanitli" isaretlenmis.

### 2.5 Kritik bulgu 4: Mühür dogrulamasi **tautolojik**

`MuhurDogrulayici.dogrula` (`baglam_muhru.py:412`) digest'i karsilastirir. Ama `digest_ile_kur` (`baglam_muhru.py:311-330`) alanlari **kaynaktan kopyalar**:

```python
yeni.kisitlar = list(kaynak.kisitlar)
yeni.kararlar_ = list(kaynak.kararlar_)
```

Yani "yeni modelin okudugu muhur" degil, **kaynagin kopyasi** karsilastirilir. `FINAL_MASTER:252` "Uzusmazlik olursa failover reddedilir ... Olur muhtemelen ile devam edilmez" ve `adr/0003:44-49` "cift tirnak" vaadi — bu motor **hicbir gercek LLM round-trip'i olmadan** denenmemis. Gercek baglam kaybi bu yolla **yakalanamaz**.

### 2.6 Kritik bulgu 5: ADR'lar yanlis dosyayi gosteriyor

- `adr/0004` ve `adr/0007` "Mevcut kod: `kordinator/token_kapisi.py` `Sigorta`" diyor — dogru (`token_kapisi.py:162`). Ancak `__init__.py:31` `Sigorta`'yi `token_kapisi`'den import ediyor; **ayri `sigorta.py` ve `test_sigorta.py` dosyalari Draft_1'de YOK** (Draft_5'te var). `FINAL_MASTER:438` "03_YONLENDIRICI/ Token kapisi, sigorta, saglayici kaydi" diyor ama o klasorde yalnizca `SAGLAYICI_KAYDI.md` var.
- Onbellek: Draft_1'de **hicbir onbellek mekanizmasi yok** (README'de de yok). 6. bolumdeki "uc ozgun mekanizma" = muhur, token kapisi, anayasa; onbellek anlatmiyor.
- `adr/0002:32` `0003-munder-ayri-sandbox-pilotu.md`'ye atif yapiyor; dosya adi **`0005-munder-ayri-sandbox-pilotu.md`** — kirik capraz referans.
- ADR sayisi tutarsiz: `README.md:61` "8 karar kaydi", `FINAL_MASTER:447` "7 karar kaydi" (gercek: 8).

### 2.7 Kritik bulgu 6: 13 bos klasor

`01_KORDINATOR\config`, `03_YONLENDIRICI\config`, `04_BEYIN\seal`, `04_BEYIN\kanit`, `04_BEYIN\haftalik`, `05_CALISANLAR\contracts`, `05_CALISANLAR\roller`, `06_KAPASITE\registry`, `09_GUNLUK\gunluk`, `09_GUNLUK\haftalik`, `docs\arastirma`, `10_ARSIV`, `02_KUYRUK`.

`FINAL_MASTER:96` "16 bos klasor 16 bos vaattir" eleştirisini **kendisi uyguluyor**. Kritik olanlar: `04_BEYIN\seal\` (mühur dosyalarinin yazilacagi yer — `05_CALISANLAR/ISCI_SOZLESMESI.md:88` buraya yaziyor) ve `06_KAPASITE\registry\` (kayit defteri — `ARAC_KAYIT_SABLON.md` burayi sart kosuyor).

---

### 2.8 Kodun gercekte ne yaptigi (mekanizma envanteri)

**Kuyruk:** Ozel bir kuyruk sinifi **yok**. `02_KUYRUK/` altinda gorev klasoru + `olaylar.jsonl` + bellekte `gorevler: dict` (`coordinator.py:167`) + `_ozetler: set` (`:168`). Oncelik, worker havuzu, claim/lease, yeniden deneme sayaci **yok**.

**Durum makinesi:** 10 durum (`durum_makinesi.py:17-28`). Terminal `COMPLETED/FAILED/BLOCKED` (`:30`). `BLOCKED`'in **tek cikisi** `FAILED` (`:43`) — "kapanamayan is de kapanabilir olmali, ama geri donmez". Idempotent (`:47-50`). Geri donus yasak (`:53-59`).
*Bosluk:* `FINAL_MASTER:423` "`-Force` gecisler denetim izine **yazilir**" diyor; `durum_ata` (`coordinator.py:261-265`) yalnizca `olay.yaz` cagrisi yapiyor, `gorev.iz`'e kayit yazmiyor. Zorlu gecis izi **eksik**.

**Token kapisi (`token_kapisi.py`, 344 satir — korpusun en olgun modulu):**
- `GorevSinifi` 6 sinif, `arastirma`nin 3 kelime ile 40 sayfa arasindaki belirsizligine itiraz ederek genisletilmis (`:26-39`)
- `Agirlik.BIRIMLER` 1/2/4/6/10/12 (`:45-52`), `Agirlik.kalite_esigi` **ayri kirpma** (`:63-76`) — "maliyet bir yerde kirpilir, kalite baska yerde"
- `TokenKotasi.giris_yap` butceyi **giris aninda** ayirir (`:108-122`); `zaman_asimi` cevapsiz zarf'i serbest birakir (`:132-136`); `gidis_gununu_kontrol` yalnizca gercekten yeni gunde sifirlar (`:141-150`)
- `Sigorta` devre kesici: esik 3 hata/60sn -> ACILIR, soguma sonrasi **yarim acik = tek yoklama** (`:208-222`)
- `yigindan_mi` **goreceli** artis olcer, mutlak esik degil (`:230-246`) — "sabit gecikme yigin DEGILDIR", kanitli
- `RejimTahmini` yogunluk + yanma hizinden **projeksiyon**, 429 oncesi degrade (`:249-289`)
- `KademeMerdiveni` NORMAL baslangic noktasidir, atlanmaz (`:302-323`)
- `rota_sec` uc kirpma: kotasi dolan / sigortali / kalite esiginin alti elenir (`:326-344`)

**Baglam muhru (`baglam_muhru.py`, 434 satir):** `MUHUR_TAVAN_TOKEN=1200` (`:41`), `KANIT_GORUNTULEME=30` (`:45`). **O(1) iddiasi kodla gercekten destekleniyor:** `gecmis_ekle` icerigi degil **sadece sayaci** artirir (`:168-176`). `sikistir` ret/karar ledgerini hicbir zaman atmaz (`:221-234`) — "en pahali kayiptir". `sir_tasiyor_mu` ile girdi denetimi (`:61-63`). Yapisal kalicilik `dict()`/`dan()` (`:367-400`) — "projeksiyon bilerek kirpilabilir bir gorunumdur". Bu modul gercekten ise yarar.

**Sigorta:** yukarida.

**Tek otorite:** dosya kilidi + `kilit_al` (`coordinator.py:178-195`), kilit olmadan kabul reddi `_kilit_zorunlu` (`:206-217`). Ancak kilit **sahip adi esitse** sessizce yeniden yaziliyor (`:186`) — iki surec ayni `ad` ile acilirsa ikisi de calisir. K-01 zorlanmasi **ad benzersizligine** bagli.

**Yinelenen gorev engeli:** `kabul_et` ayni baslik+kapsam icin `None` doner (`:234-237`).

**Kapsam latch:** `Kapsam.BELIRSIZ = "_unresolved"`, cozulemeyen alan **uydurulmaz**, gorev `BLOCKED` olur (`:51-59`, `:249-255`).

**Yetki:** `yetki_uygula` seviye 4 **hicbir zaman** otomatik, seviye >=2 insan onayi zorunlu (`:269-290`).

---

## 3. DRAFT_1 ve DRAFT_2 BENZER MI?

**Benzerlikler (korunacak ortak cekirdek):**
1. "Her seyin tek sahibi olmasi" ilkesi ikisinde de acikca var.
2. Onay kapisi / insan onayi: Draft_1 `07_GUVENLIK/YETKI_MATRISI.md` 0-4; Draft_2 `final-architecture.md:3-12` A/B/C/D.
3. "Disariya yazma hicbir koşulda otomatik degildir" (`final-architecture.md:12`; `YETKI_MATRISI.md:20` "Her zaman insan onayi").
4. Markdown-only birakilmamasi gerektigi ikisinde de **var ama zitfarkli sonucla**: Draft_1 kurali koda tasidi, Draft_2 acikca **tasimayi reddetti**.

**Farklar:**

| Boyut | Draft_1 | Draft_2 |
|---|---|---|
| Konu | Genel sirket AI isletim altyapisi | Ajans **sunum/uretim hatti** + ofis org. |
| Kod | 1.100+ satir Python, 106 test | **Sifir kod**, 6 markdown |
| Kural vs kod | "Kural kod olur" | "Kural dosyalarini yaz. **Kod yok, sadece karar**" (`final-architecture.md:185`) |
| Modul | 11 klasor | `toz-ai-office/` 11 kok klasor |
| Ajan sayisi | 7 isci (`YETKI_MATRISI.md:37-45`) | 10 ajan (`final-architecture.md:56`), "7'ye dusabilir" (`:175`); sunumda 17-20 (`AGENT_SYSTEM.md:5-23`) |
| Arac seti | OpenCode + yerel model + MCP kayit defteri | Hermes + n8n + Twenty CRM + AnythingLLM + OpenCode (5 platform, `:52-53`) |
| Bellek | Baglam muhuru, gorev bazli, O(1) | "5 katman" + Hermes bellegi + marka bellegi + AnythingLLM + `learning-records/` |
| Kalite olcumu | 20 kanitlanabilir kosul (`FINAL_MASTER:514-535`) | "90/100 minimum, 95+ hedef" — **olcme yontemi yok** (`PRESENTATION_SYSTEM_SPECIFICATION.md`) |
| Butce | $0, agirligli kota, testli | "Free tier fallbacks for all models", **retry** (`ARCHITECTURE_LAYER.md:16-17`) |

**Draft_2'nin kalite kaniti:** `PRESENTATION_SYSTEM_SPECIFICATION.md` **bitmemis** — metin soyle bitiyor: `...for ,000+ agency-style presentations.` ve `Created:  + (Get-Date).ToString(` / `G) + "`. Yani sablon degistirken degistirilmemis. Draft_2'nin 5 `state/` ve `templates/` klasoru **bos**.

**Ortak zayiflik:** Ikisi de kurali **Markdown'ta** birakiyor; Draft_1 bunu koda cevirdi (dogru), Draft_2 bilerek birakmayi secme yolunu oneriyor (`final-architecture.md:185`) — bu, Draft_1'in reddettigi seyin aynisi.

---

## 4. ADR'LAR: NE KARAR VERDI, HANGISI GECERLI?

| ADR | Karar | Gecerlilik | Gerekce |
|---|---|---|---|
| `0001` | Tek global koordinator, **dosya kilidiyle** | **GECERLI** (sayim yanlis) | Kural saglam; metin "yedi" derken 8-10 isim sayiyor. Sayim duzeltilmeli. |
| `0002` | Koordinator cekirdegi Munder'in yerine | **GECERLI — en guclu karar** | Ucretsiz CLI kabugu; kaynak/versiyon/dogrulama kaniti yok. "Motoru elediysen govdeyi kullanmanin anlami yok" cevabi tutarli. |
| `0003` | Baglam muhuru, failover'da sifir kayip | **ILKE GECERLI, UYGULAMA YARIM** | O(1) kodda gercek; `dogrula` tautolojik (2.5). |
| `0004` | Failover test edilmeden kullanilamaz | **GECERLI** | K-03 + Sigorta ile gercekten zorlaniyor. Iki kosulu da sagliyor. |
| `0005` | Munder ayri sandbox pilotunda | **GECERLI, dusuk oncelik** | "Kanit yoktur; yokluk da kanit degildir" dogru. `adr/0002:32` capraz referansi kirik. |
| `0006` | Roller modele degil **yetkiye** baglanir | **GECERLI — en degerli fikir** | Model degisimi kimlik degisimi olmamali; ucretli modele kilitlenmemek. K-02/K-05 ile zorlaniyor ve calisiyor. |
| `0007` | Kota gorev agirligiyla olculur | **GECERLI — korunmasi gereken en onemli mekanizma** | Istek sayisi yanlis birim; 1500 ucuz istek 1 agir isi oldurur. Testli. |
| `0008` | Dondurma, Markdown degil **kod** olur | **GECERLI — temel ilke** | Ama metin-kod eslesme testi yol bagimli oldugu icin **fiilen devre disi** (2.2). |

**Gecerlilik notu:** `0002`'nin reddi **yalnizca "koordinator" makamini** kapsiyor. Draft_1 Hermes'i hem reddedilen adaylarda sayip hem Katman-3 isci olarak tutuyor. Bu, ADR'nin kapsamini yazili hale getirmezse **0002 kendi icinde tutarsiz** olur.

---

## 5. KORUNMASI GEREKEN FIKIRLER (gerekceli)

1. **"Dokumantasyon bir karar degildir. Kod karardir."** + ayaga kalkma kapisi (`FINAL_MASTER:121-123`, `adr/0008`). *Gerekce:* 3 gunde 3 ayri koordinator karari, 3 kez yeniden yazilan mimari; Markdown uygulanmayan bir niyet metni.
2. **Baglam muhuru + O(1) failover + ret ledgerinin hicbir sikistirmada atilmamasi** (`baglam_muhru.py:221-234`). *Gerekce:* baglam diskte degil pencerede yasar; "bunu zaten reddettik" kaybi sistemi donguye sokar.
3. **Agirlikli kota + sigorta + 429 oncesi degrade + zarf** (`token_kapisi.py`, `adr/0007`). *Gerekce:* istek sayisi yanlis birim; sigorta gercek thundering herd engeli.
4. **Roller yetkiye, modele degil** (`adr/0006`). *Gerekce:* model degisimi veri degisikligidir, kimlik degisikligi degildir.
5. **Kapsam latch + `_unresolved` + BLOCKED** (`coordinator.py:51-59`). *Gerekce:* "Diskte olmayan bir kimlik, tahmin edilen bir kimlikten guvenlidir; tahmin edilen kimlik sessiz bir hatadir."
6. **Append-only JSONL + atomik yazim + fsync + yaz-bir-kez** (`olay_kaydi.py:29`, `coordinator.py:108-139`). *Gerekce:* 5/37 dosya 0 byte sonucu. **Ancak JSONL oynatimi yazilmalidir** (2.4).
7. **Cekirdek hicbir isi kendisi yapmaz**; "calistir" degil **"yetki ver"** (`FINAL_MASTER:158-174`). *Gerekce:* en pahali karisinliklar buradan dogar.
8. **Onay siniflari / yetki 0-4, seviye 4 asla otomatik** (`YETKI_MATRISI.md`, `ANAYASA.md:82-90`). *Gerekce:* iki taslakta da ayni ilke — en guclu ortaklik.
9. **Beceri != arac ayrimi; "az arac > cok arac"; kayit disi arac gecersiz** (`06_KAPASITE/BECERI_KAYIT_SABLON.md`, `ARAC_KAYIT_SABLON.md`). *Gerekce:* 52 klasorluk beceri kutuphanesinin buyuk bolumunun bos kalmasi.
10. **Onay kapisini ajanlardan ONCE kur, elle taslakla uctan uca dene** (`final-architecture.md:189`). *Gerekce:* dogru; kapi calisirsa ajanlar arkaya eklenir.
11. **13 faz + 12/13 kapi; "bir faz basarisizsa sonrakine gecilmez"** (`KURULUM_SIRASI.md:3`, `TEST_KAPILARI.md`). *Gerekce:* korpus bu listeyi yazmisti ve hicbir kapiyi gecmemisti.
12. **Draft_2'nin marka yatay genisleme klasor tasarimi** (`final-architecture.md:92-109`, `:146`). *Gerekce:* 5 marka -> 50 marka = sifir yeni kod.
13. **"Sekre deger asla dosyaya degil, ortam degiskenine"** (`ARAC_KAYIT_SABLON.md` `gizli_metin`) + secrets agacin disinda (`final-architecture.md:145`). *Gerekce:* 72 satirlik `.env` + log'da acik token kaydi.

---

## 6. REDDEDILMESI GEREKEN FIKIRLER (gerekceli)

1. **Hermes'i beyin yapmak** (`final-architecture.md:28`, `:35`, `:53`). *Gerekce:* Draft_2 **kendisi** "Hermes'in gerçek yetenekleri doğrulanmalı ... test etmeden 'çalışır' demek doğru olmaz" diyor (`:173`). Draft_1 Munder'i **ayni gerekceyle** reddetti (`adr/0002`). Ayni olcutu Hermes'e uygulamak tutarsiz olur. *Sonuc:* Hermes ya olculmus olur ya da **yalnizca yurutucu** kalir.
2. **Draft_2'nin "Kod yok, sadece karar" ilk adimi** (`final-architecture.md:185`). *Gerekce:* Draft_1'in reddettigi ve olcutugu tam olarak bu. Kural kapiya baglanmazsa ihlal edilir; korpus 4 gunde dondurmayi 4 kez tartisti.
3. **Uc+ ayri bellek deposu** (Hermes bellegi / marka bellegi / AnythingLLM workspace / `learning-records/`) (`final-architecture.md:53`, `:101-108`, `:123-126`, `:158`). *Gerekce:* 4 yazar = 4 dogruluk kaynagi. Draft_2 celiskiyi sayiyor, cozmuyor. Mühur tek yazarli kalsin.
4. **Iki "audit log sahibi"** (`final-architecture.md:32` Governance & Quality Office ↔ `:33` Platform & Reliability). *Gerekce:* tek yazar ilkesi; ayni kayit iki yerde dogru/yanlis olabilir.
5. **Self-approval QA** (`final-architecture.md:30` QA ajan olarak ↔ `:155` bunu **kendi riski** olarak sayiyor). *Gerekce:* QA icerideyse sistem kendini denetleyemez. Draft_1'in cevabi dogru: denetleyici ajan disinda, **kodda** (`kontrol/anayasa-kontrolu.py`).
6. **`presentation-system/` klasorunu ayni mimari icinde tutmak** (`AGENT_SYSTEM.md`, `ARCHITECTURE_LAYER.md`). *Gerekce:* 26 asamali musteri sunum hatti, "TOZ AI Office" isletim altyapisinin degildir. Ayni ajan havuzu iki kez sayiliyor; tek sahip ve kapasite ihlali.
7. **Agency Agents, Open Dots, OpenClaw.** *Gerekce:* grep ile dogrulandi — korpusun **hicbir .md/.py dosyasinda gecmiyor**. `OpenClaw` yalnizca `Draft_3\docs\adr\0001-tek-yazar-kurali.md` ve `Draft_3\TOZ_VAULT\11_Arsiv\...\TOZ-AI-OFFICE-NIHAI-MIMARI-v1.0.md` icinde; "Agency Agents" yalnizca `Draft_7\10_Teknik\entegrasyon\agency_agents_kurulum.md` dosya **adi** olarak. Draft_1'in Munder'e uyguladigi test ("kaynagi, versiyonu, kurulumu, dogrulamasi yok") bunlara da uygulanmalidir: ya **ayri sandbox benchmark** ya da hic girmeme.
8. **Ruflo** (`FINAL_MASTER:60`, ADR metinlerinde referanslari). *Gerekce:* Ayni dokumanin iki karari celisiyor ("60+ ajan, HNSW" ↔ "NO INITIAL"). Draft_1'in 13 fazinda **hic gecmiyor**.
9. **Obsidian'i "ikinci beyin" yapmak** (`FINAL_MASTER:490` Faz 7 "Obsidian kasasi (ikinci beyin)"). *Gerekce:* ADR 0003 tam da bunu yasakliyor — "Vault okumak `O(vault)` maliyettir. Muhur okumak `O(1)` maliyettir." Ikinci kasa, muhrun kapattigi baglam kaybi yolunu geri acar. Kasıt kalsa **"bilgi deposu"** adıyla, **"beyin"** adıyla degil (`FINAL_MASTER:490`).
10. **LiteLLM / OmniRoute** (`FINAL_MASTER:46`, `:66`). *Gerekce:* model saglayici yonlendirme zaten `token_kapisi.rota_sec` icinde. Iki router = ayni isi yapan ikinci arac; `ARAC_KAYIT_SABLON.md` "Tek is, tek arac" ve "Ayni isi yapan ikinci bir arac" kurallarini ihlal eder.
11. **"106 test yesil" ve "10/10" iddialari oldugu gibi.** *Gerekce:* 104/106. Dokumanin kendi "PASS raporu degil, gercekte calisan ve dogrulanabilir sistem" ilkesini (`ANAYASA.md:136`) ihlal ediyor.
12. **Draft_2'nin 26-asama / 90-100 puan sistemi.** *Gerekce:* puanlama yontemi, olcutu ve kim degerlendirecek tanimli degil. Olculemeyen kalite kapisi, Draft_1'in "kanitlanabilir kosul" ilkesinin yerine gecmez. Destek dosyasi da bitmemis.
13. **Draft_1'in 11 modulle kalan klasor boslugu.** *Gerekce:* `FINAL_MASTER:96` "16 bos klasor 16 bos vaattir" diye eleştirdigi sey Draft_1'de 13 klasor olarak duruyor. `04_BEYIN\seal\` ve `06_KAPASITE\registry\` bos olmasi, muhrun ve kayit defterinin **yazilacagi yer** olmamasi demek.

---

## 7. "HER SEYIN TEK SAHIBI" ILKESINE GORE: SAHIBI BELIRSIZ/CAKISIK OLANLAR

| # | Yetenek | Catisma | Kanit |
|---|---|---|---|
| 1 | **Beyin / koordinasyon** | Hermes (Draft_2 beyin) ↔ KoordinatorCekirdegi (Draft_1 beyin) ↔ "Orchestrator/Creative Director" (Draft_2 sunum) → **3 beyin** | `final-architecture.md:28`, `coordinator.py:154`, `AGENT_SYSTEM.md:5` |
| 2 | **Hermes'in rolu** | Draft_1'de reddedilen koordinator adayi ↔ Draft_2'de beyin | `FINAL_MASTER:59` ↔ `final-architecture.md:28` |
| 3 | **Hafiza / gerceklik kaynagi** | Hermes bellegi ↔ marka bellegi ↔ AnythingLLM workspace ↔ `learning-records/` → **4 depo** | `final-architecture.md:53`, `:102`, `:126`, `:158` |
| 4 | **Audit log** | Governance & Quality Office "Audit log sahibi" ↔ Platform & Reliability "Audit log" → **2 sahip** | `final-architecture.md:32` ↔ `:33` |
| 5 | **Approval Gate / Executor** | Governance altinda "Approval Gate (altyapı)" ↔ Platform altinda "Secrets/Executor" ↔ karar matrisinde "Yalnızca onay sonrası Executor" | `final-architecture.md:31-32` ↔ `:32` ↔ `decision-matrix.md:6` |
| 6 | **Yetki dili** | Draft_1 sayili 0-4 ↔ Draft_2 harfli A/B/C/D — ayni kavram, iki sozluk | `YETKI_MATRISI.md:9-17` ↔ `final-architecture.md:5-10` |
| 7 | **Beceri kayit defteri** | Draft_1 `06_KAPASITE/BECERI_KAYIT_SABLON.md` (SKL-0001) ↔ Draft_2 `skills/` (3 seviye) + `_templates/`; Draft_1 "3. taraf beceri dosyasi kurum standardi sayilmaz" ↔ Draft_2 "Skill Library tum ajanlarla uyumlu" | `BECERI_KAYIT_SABLON.md:6-9` ↔ `final-architecture.md:86-90` ↔ `ARCHITECTURE_LAYER.md:27` |
| 8 | **Arac / MCP standardi** | Draft_1 `06_KAPASITE` tek kayit defteri + K-04 ↔ Draft_2 `integrations/` + `workflows/n8n` + `12_MCP`; Draft_1 "MCP kayit defteri AI'in degistiremeyecegi" ↔ Draft_2 ajan-ajan uyumu | `ANAYASA.md:128` ↔ `final-architecture.md:118-121`, `ARCHITECTURE_LAYER.md:20` |
| 9 | **Bilgi kasasi** | `04_BEYIN/` (muhrur+kanit) ↔ `brands/*/knowledge/` + `memory/` ↔ Obsidian Faz 7 → **3 kasa** | `04_BEYIN/README.md`, `final-architecture.md:101`, `FINAL_MASTER:490` |
| 10 | **Denetim / raporlama** | Draft_1 `09_GUNLUK` + `07_GUVENLIK` ↔ Draft_2 `observability/metrics` + QA & Compliance Reviewer | `FINAL_MASTER:444`, `final-architecture.md:30`, `:128-132` |
| 11 | **Yetki matrisi yazim yeri** | Draft_1 `07_GUVENLIK/YETKI_MATRISI.md` kodla zorlanir ↔ Draft_2 `governance/autonomy-tiers/` + `governance/approval-policy/` sadece dosya | `YETKI_MATRISI.md:3` ↔ `final-architecture.md:71-74` |
| 12 | **Otopermitif degistirmeme** | Draft_1 `ANAYASA.md:121-134` 8 ogeyi listeler ↔ Draft_2'de karsilikli bir liste **yok**; `GOVERNANCE.md` planlanmis ama bos | `ANAYASA.md:123-132` ↔ `final-architecture.md:67` |

---

## 8. NIHAI KARAR IÇIN NET CIKARIM

**Korunacak:** Draft_1'in **cekirdek + 3 mekanizma + anayasa kapisi** paketi. Draft_2'nin **marka yatay genisleme klasor tasarimi**, **onay kapisini ajanlardan once kurma** ve **onay siniflari** disinde kalani degerlendirilmeye deger. Draft_2'nin kurali koda cevirmeyi reddetmesi reddedilmeli.

**Reddedilecek:** Hermes'in beyinligi, Draft_2'nin kod-suz kural yaklasimi, 4 lu bellek, cift audit log sahibi, self-approval QA, sunum hattinin ayni mimariye karistirilmasi, ve **kaniti olmayan** Agency Agents / Open Dots / OpenClaw / Ruflo.

**Draft_1'de acilması gereken 5 kusur (kodla, once yuklemeden):** (1) `test_anayasa_ihlalleri.py:205,216` sabit yolu goreli yap — Faz 2 kapisi su an gecilemez; (2) `geri_yukle()` JSONL'i **oynatmali** — Kapi 7 yazildigi gibi gecmez; (3) `digest_ile_kur` kaynaktan **kopyalamamali**, gercek LLM ack'i okumali; (4) `durum_ata` zorlu gecisleri `gorev.iz`'e yazmali (`FINAL_MASTER:423`); (5) `kilit_al` ayni `ad` ile ikinci acilisi reddetmeli.

---

*Kanitlar bu klasorde calistirilarak uretilmistir: `calistir-testler.ps1` (106 test, 2 hata), `kontrol/anayasa-kontrolu.py` (7/7 GECTI), `01_KORDINATOR/calistir.py` (8 bolum tamam).*
