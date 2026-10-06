# TOZ AI GROUP — ESKİ TASLAKLARIN ELEŞTİRİSİ

> Ana karar belgesi: `00-TOZ-AI-GROUP-NIHAI-MIMARI.md` · Bölüm 2 özeti, buradadır.
> Bu belge **taslak taslak** eleştiridir: hangi taslak ne önerdi, neyi doğru bulduk,
> neyi reddettik ve **neden**.

---

## 0. İNCELEME KAPSAMI

| Kaynak | Tür | Altında ne var |
|---|---|---|
| `Toz_Ai_Office_Draft_0` | taslak | erken anayasa denemeleri |
| `Toz_Ai_Office_Draft_1` | taslak | Python `KoordinatorÇekirdeği`, 12 ADR, `FINAL_MASTER_ARCHITECTURE.md` |
| `Toz_Ai_Office_Draft_2` | taslak | sunum/proje yönetim sistemi, Hermes'i beyin yapan metin |
| `Toz_Ai_Office_Draft_3` | taslak | `TOZ_VAULT` — güvenlik en güçlü burada, 4 skill, 6 ADR |
| `Toz_Ai_Office_Draft_4` | taslak | `V3_MASTER_MIMARI` (84 KB), çalışan SQLite motoru, `V3_DURUM_RAPORU` |
| `Toz_Ai_Office_Draft_5` | taslak | 13 faz + kapı sistemi, en olgun maliyet modeli |
| `Toz_Ai_Office_Draft_6` | taslak | 20 numaralı kurulum belgesi, GitHub repo listesi |
| `Toz_Ai_Office_Draft_7` | taslak | `ROL_DONUSUMU` (18 KB), model routing, ajan kataloğu |
| `Toz_Ai_Office_Draft_8.md` | taslak | 1413 satır, 23 bölüm — en kapsamlı |
| `HERMES-AUDIT-RAPORU.md` | audit | 577 satır, 10 güvenlik testi |
| `OPENCODE-AUDIT-REPORT.md` | audit | 338 satır, 16 test planı, T1–T16 |
| `Ben Özkan Toz Ai SAHIBi Kimdir..md` | bağlam | kurucu profili, kısıtlar |

**Kanıt dosyaları:** `_ajan-ciktilari/R1-draft1-2-analizi.md`,
`R2-draft3-4-analizi.md`, `R3-draft5-8-analizi.md`

---

## 1. TASLAK BAZINDA KARAR

### Draft_0 — BAŞLANGIÇ
**Ne önerdi:** Anayasa/protokol taslakları, rollerin sözleşmeyle tanımlanması.
**Karar:** 🔶 **KISMEN KORUNDU** — protokol fikri (`İÇ DÖNGÜ` / `DIŞ DÖNGÜ` / `GÜNLÜK
TOPLANTI` / `PASİF İŞÇİ`) ajan sözleşmelerine dönüştürüldü.
**Neden kısmen:** Dosya kilidi yazılımla zorlanamadı. Metinle kural, kural değil
kural tavsiyesidir. Taslakların kendi notu da bunu kabul ediyor.
**Ders:** "Yazılı kural" ile "yazılımla zorlanan kural" ayrımı Draft_1'den itibaren
temel ilke yapıldı.

### Draft_1 — MİMARİ + İLK KOD
**Ne önerdi:** Python `KoordinatorÇekirdeği` (kuyruk, durum makinesi, token kapısı,
önbellek, bağlam mührü, sigorta), 12 ADR, Draft_2'deki Hermes önerisini reddetti.
**Korunan:**
- **ADR-0001 tek global koordinator, kod ile zorlanır** → nihai mimarinin omurgası
- **ADR-0006 roller modele değil yetkiye bağlı** → en değerli fikir
- **ADR-0008/0009 dondurma, token maliyeti** → maliyet sayımının tohumu
- **ADR-0005 munder ayrı sandbox pilotu** → izolasyon ilkesi (kullanıcı kriteri 8)
- Kodun en olgun modülleri: `token_kapisi.py` (ağırlıklı kota + 429 öncesi degrade),
  `baglam_muhru.py` (O(1) parmak izi + ret ledgeri — **gerçekten çalışıyor**)

**Reddedilen:**
- **KoordinatorÇekirdeği'nin kendisi** → Hermes'te aynı işi yapabilen bir katman varken
  ikinci bir orkestrator kurmak. Kriter 3 ve 4.
- **"106/106 test geçiyor" iddiası** → **YANLIŞ.** `test_anayasa_ihlalleri.py:205,216`
  sabit `D:\` yoluna bağlı → 2 test geçemez → Faz 2 kapısı hiç kapanmaz. Ayrıca JSONL
  kuyruk **yazılıyor ama hiç okunmuyor** (Kapi 7 sahte geçiyor) ve `digest_ile_kur`
  mührü kaynaktan kopyaladığı için doğrulama totolojik.
- **Markdown yasağıyla tek yazıcı** → yazılımla zorlanamaz (bkz. Draft_0)

### Draft_2 — SUNUM / PROJE YÖNETİMİ
**Ne önerdi:** Hermes'i beyin yaptı. Sunum sistemi, araştırma sistemi, ajan sistemi.
**Reddedilen:**
- **Hermes'i beyin yapma gerekçesi** → Draft_1'in Munder'e uyguladığı gerekçeyi
  (ikinci orchestrator) Hermes'e uygulamaması. Draft_2'nin kendi metni `:173` "yetenekleri
  doğrulanmalı" diyor — yani beyin seçimi **kanıtsız** kalmış.
- **"Kod yok, sadece karar" adımı** (`:185`) → reddettiği şeyin ta kendisi.
- **4'lü bellek** (Hermes + marka + AnythingLLM + learning-records) → 4 yazar = 4
  doğruluk kaynağı. Draft_2 `:158`'de çelişki olarak sayıp sahiplenmiyor.
- **Ruflo, LiteLLM/OmniRoute** → çift router.
- **Obsidian'ı ikinci beyin** → **ADR-0003 tam da bunu yasaklıyor.** Taslak kendi
  ADR'ini ihlal ediyor.

**En kritik bulgu:** 5 taslak 4 farklı beyin ismi seçiyor
(Hermes / OpenCode / KoordinatorÇekirdeği / Munder). **Tek yazıcı ilkesi yazılıydı,
uygulanmadı.**

### Draft_3 — GÜVENLİK VE YÖNETİŞİM (EN DEĞERLİ YÖNETİŞİM TASLAĞI)
**Ne önerdi:** Beyin = **kullanıcının kendi Hermes oturumu** (`ORKEPRA.md:5-6`), 8 aktif
işçi + 282 pasif ajan, `TOZ_VAULT` klasör yapısı, 4 skill, 6 ADR, iki eksenli yetki matrisi.
**Korunan — bu taslak en çok şeyi kazandı:**
- **İki eksenli yetki matrisi** (28 T4 işlem) → güvenlik mimarisinin temeli
- **Prompt injection kuralları** → Draft_4'te **kayboldu**, geri getirildi
- **Sıfır bilgi yok etme yasağı** → Draft_4'te kayboldu, geri getirildi
- **Sır kontrolü prosedürü** → korundu
- **Müşteri izolasyonu** → korundu
- **`KE-004` hata kaydı** → Draft_4'ün aynı hatayı düzeltmediğinin kanıtı
- **JSONL kuyruk** → SQLite'a geçirildi (atomik yazım + `fsync` fiksi korundu)

**Reddedilen:** `TOZ_VAULT` 13 klasörlü yapı → 8 klasöre indirildi (Draft_5'in sadeleştirme
yönü birleştirildi).

### Draft_4 — V3 MOTOR (EN FAZLA KOD, EN FAZLA HATA)
**Ne önerdi:** Kendi Python motoru beyin. SQLite kuyruk, router, worker, sigorta,
Obsidian senkronu, onay kapısı. `V3_MASTER_MIMARI` 84 KB.
**Korunan:**
- **V3'ün tezi:** "7 ilkenin 7'si kodda" — anayasa, karar değil kod. Bu doğru ve
  nihai kurulum sırasına işlendi.
- **`V3_DURUM_RAPORU`** → **en dürüst doküman.** Yapılmayanları isim isim sayıyor
  (API çağrısı yok, Telegram yok, yerel model yok, gerçek müşteri işi yok).
- Modül düzeyi: `sigorta.py`, `saglayici_istemcileri.py`, `baglam_muhru.py`,
  `onay_kapisi.py`, `dotenv.py` iyi yazılmış.

**Reddedilen — çalıştığı doğrulandı, İŞE YARAMIYOR:**
- **`worker.py:114`** → `kuyruk.muhr_yaz` çağrısı, metot adı `muhur_yaz` (`:214`)
  → **AttributeError**
- **`worker.py:177`** → `rota_secildi → tamamlandi` geçişi `IZINLI` tablosunda yok
  → **GeçersizGeçiş**
- **Sonuç: sistem hiçbir işi tamamlayamıyor.** `kurtar()` yalnız `calisiyor/dogrulaniyor`
  arıyor, worker bu durumlara hiç girmiyor → görev `rota_secildi`'de kalıcı asılı.
- **Draft_3'te aylar önce kayıtlı** (K-004) → **aylar sonra düzeltilmemiş, sadece
  belgelenmiş.** Bu, "belge güvenilir araç değildir"in kanıtı.
- **Güvenlik regresyonu:** Draft_4'te prompt injection kuralları ve bilgi yok etme
  yasağı **hiç yok**, yetki matrisi tek eksene düşmüş.
- **Ölü bayraklar:** `ALLOW_EXTERNAL`, `GIT_AUTO_PUSH` hiçbir kod tarafından okunmuyor.
- **Test iddiası "58/58 PASS" doğru**, ama başarılı görev yolu test edilmemiş.

**Karar:** Modül düzeyinde fikirler korundu; **motor üretime alınmadı ve yeniden
yazılmadı** — Hermes + `tasks.db` aynı ihtiyacı karşılıyor. Yazmak "kurulduktan sonra
yeniden tasarlamak zorunda kalacağın sistem" tuzağıdır.

### Draft_5 — FAZ + KAPI SİSTEMİ (PLANLAMA EN İYİ)
**Ne önerdi:** 13 faz, kapı sırası, 12 ADR'nin genişletilmiş hâli, token maliyet modeli.
**Korunan:**
- **Faz + kapı sistemi** → kurulum sırası ve 20 test kapısı bu taslaktan türedi
- **Token maliyet modeli** (ağırlık × önbellek-duyarlı fiyat) → **en olgun modül** ve
  ölçülmüş. Draft_8'de **tamamen kaybolmuştu**; geri getirildi.
  *Dürüstlüğü notu: taslak "şu an %0 kazanç" diye yazıyor — ölçülmüş ve negatif
  sonuç raporlamış. Bu, örnek alınacak davranış.*
- **Rol dosya kilidi denemesi** → metinle zorlanamadığı için nihai çözüm: yetki
  OpenCode config'inde, görev sahibi `tasks.db`'de.

**Reddedilen:** **Obsidian'ı tamamen silmesi** → gerekçesiz. Doğru karar, Obsidian'ı
silmek değil; **kararın gerekçesini yazmamaktı.** Nihai karar: Obsidian kurulmaz,
gerekçesiyle.

### Draft_6 — KURULUM KÜTÜPHANESİ
**Ne önerdi:** 20 numaralı doküman, GitHub aday repo listesi, 3D ofis tasarımı, token maliyet.
**Korunan:** **Kaynak ve doğrulama disiplini** (`14_KAYNAK_VE_DOGRULAMA_NOTLARI.md`) —
her iddianın kaynağı olsun. Nihai belgede de bu uygulandı.
**Reddedilen:** Repo listesi — büyük kısmı yasaklanmış sistemlere (Claude Code tabanlı)
ait. Değerlendirildi, elendi (bkz. `_ajan-ciktilari/A1`).

### Draft_7 — AJAN KATALOĞU VE ROL DÖNÜŞÜMÜ
**Ne önerdi:** 11 ajan (Finans, Hukuk, Kalite, Pazar İstihbaratı, Satış, Sekreterya,
Sosyal, DevOps, Yönetim, YouTube, Arşiv), `model_routing.yaml`, MCP konfigürasyonu,
3D ofis, haftalık analiz.
**Korunan:**
- **"10 yazma yetkisi + 10 tetikleyici" ayrımı** → 7 aktif ajanın yetki sınırı buna
  göre kesinleştirildi
- **Ajan kataloğu + ajan görselleştirme fikri** → kadro tanımları `10_AJANLAR/` altına
  alındı (ama **Obsidian değil**, düz Markdown)
- **`02_Defterler/hafiza_mimarisi.md`** → haftalık ritim bu taslaktan türedi
- **`TOZ_ANAYASA.yaml`** (1.8 KB, Draft_3'teki 10.7 KB'ın sadeleştirilmiş hâli) → sadeleştirme
  yönü doğru, alındı

**Reddedilen:**
- **Ajan sayısı 11 → 7.** 11 ajanın 4'ünün (`Hukuk`, `Kalite Kontrol`, `Sekreterya`,
  `Arşiv Kütüphane`) şirketin **şu anki faaliyetinde** karşılığı yok. Kriter 10.
- **`ruflo` / `agency-agents` komutları** → doğrulanmamış (Draft_3 zaten sürüm pini
  hatasını belgelemiş). Kurulum listesine **girmiyor.**
- **Güvenlik:** `09_Guvenlik/*` dosyaları var ama **`approvals`, `terminal`, `external
  directory` sınırları tanımlanmamış** — en çok atlanan bölüm.

### Draft_8 — EN KAPSAMLI, EN SESSİZ
**Ne önerdi:** 1413 satır, 23 bölüm. Tam güvenlik mimarisi (güven bölgeleri, hash
bağlama, fail-closed, kill switch, T1–T15 testleri), 10 ajan, model routing, token
limitleri, para bütçesi.
**Korunan:**
- **Güvenlik mimarisi tasarımı** → **tek tam güvenlik tasarımı bu taslakta.** Güven bölgeleri,
  fail-closed, kill switch, onay kapısı kavramı — hepsi alındı ve gerçek ayarlara bağlandı.
- **10 ajan** → 7'ye indirildi
- **Ayaklanma kapısı** → kurulum sırası

**Reddedilen — taslağın en ciddi kusuru:**
- **Munder, Ruflo, Agency Agents, Obsidian, MCP ve 3D ofis hiç geçmiyor (0 kelime).**
  Gerekçe de yazılmamış. **Sessiz eleme de elemedir.** Taslak kendi ilkesini ihlal ediyor.
- **Para modeli tamamen kaybolmuş.** 0 TL bütçe taahhüdü var, maliyet modeli yok.
  Aylık 180 TL elektrik gerçek kısıt olarak geçiyor ama **müşteri vaadi olarak
  tanımlanmamış.**
- **"Üç orkestratör" risk kaydı** → gerçekte **5 task-state mekanizması** var
  (SQLite, JSONL/gorev.json, Hermes cron, geri bildirim kuyruğu, Approval Gate) ve
  **2 farklı durum makinesi** (11 vs 16 durum). Risk kaydı eksik sayıyor.

---

## 2. ORTAK KANIT: TASLAKLARIN KENDİ İÇİNDEKİ ÇELİŞKİLERİ

| # | Çelişki | Kanıt | Nasıl çözüldü |
|---|---|---|---|
| 1 | Aynı ölçüt, iki farklı sonuç | Draft_1 Munder'i "ikinci orchestrator" diye reddetti ↔ Draft_2 Hermes'i beyin yaptı | Ölçüt uygulandı: Hermes'in **ölçülebilir** yetenekleri var, Munder'in yok |
| 2 | 5 taslak, 4 beyin | Draft_1 KoordinatorÇekirdeği ↔ Draft_2 Hermes ↔ Draft_3 Hermes ↔ Draft_4 kendi motoru ↔ Draft_7 Munder | Ölçüme dayalı tek seçim: **Hermes** |
| 3 | ADR kendini ihlal ediyor | Draft_2 Obsidian'ı ikinci beyin öneriyor ↔ Draft_1 ADR-0003 bunu yasaklıyor | ADR-0003 korundu, Obsidian kurulmaz |
| 4 | Task-state 5 sahip | SQLite ↔ JSONL ↔ Hermes cron ↔ geri bildirim kuyruğu ↔ Approval Gate | Tek: `tasks.db` |
| 5 | Bellek 4 katman | Munder hive ↔ agentmemory ↔ `MEMORY.md` ↔ Obsidian | Tek: `MEMORY.md` |
| 6 | Ajan sayısı 2/7/8/10/43/282/60–150 | Tüm taslaklarda farklı | 7 etkin ajan + kural (K8) |
| 7 | Test iddiası ≠ gerçek | Draft_1 "106/106" ↔ gerçek 104/106 | Ölçüm esas, iddia değil |
| 8 | Aynı hata aylarca | Draft_3 K-004 ↔ Draft_4 aynı hata | Üretime alma kararı |

---

## 3. SONUÇ: TASLAKLAR NE KATTI

Taslaklar **işe yaramadı** değildi. Üç şeyi doğru yaptılar ve bu taslakta
kullanıldı:

1. **Disiplin.** Test kapısı, ayaklanma kapısı, ADR disiplini, `[DOĞRULANMADI]`
   işaretleme. Bunlar fikirden değil, alışkanlıktan geldi.
2. **Güvenlik çekirdeği.** Prompt injection kuralları, yetki matrisi, silme yasağı,
   sır kontrolü — Draft_3'te doğru yazılmış, Draft_4'te unutulmuş, burada geri
   alınmıştır.
3. **Maliyet modeli.** Draft_5'in `ağırlık × önbellek-duyarlı fiyat` modeli, negatif
sonucu dürüstçe raporlamasıyla birlikte korunmuştur.

Taslakların **başarısızlığı** üç yerde: tek yazıcı ilkesini yazıp uygulamamaları,
kendi ADR'lerini ihlal etmeleri ve "çalışıyor" dedikleri kodun çalışmaması.

> **Bu çalışma bir fikir listesi DEĞİLDİR ve yeni fikir üretmemiştir.** Mevcut
> 8 taslağı + 2 audit'i ölçtü, eleme yaptı ve tek bir sonuç verdi.

**BELGE SONU**