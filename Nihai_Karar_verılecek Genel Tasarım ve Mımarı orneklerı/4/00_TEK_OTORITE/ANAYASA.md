# TOZ AI — TEK OTORİTE ANAYASASI

> **Bu dosya tek otoritedir.** Burada olmayan bir kural, projede kural değildir.
> Tarih: 2026-10-06 | Sürüm: 1.0 | Bağlayıcı

---

## NEDEN BU DOSYA VAR

226 taslak dosyanın teşhisi tek cümlede:

> *"Ozonometre: 3 günde 3 koordinatör kararı. `25_DEGISIKLIK_KAYDI.md`
> 'bir daha tartışılmasın' diye yazıldı — 4 gün sonra **yine** tartışıldı."*
> — `_MASAUSTU_TASLAKLARI/Son Taslak - Kopya/FINAL_MASTER_ARCHITECTURE.md:59-69`

Sorun mimari değil. **Otorite.** 7 farklı "coordinator" tanımı, 28 çelişki,
3 koordinatör, 5 mimari nesil.

**Kural:** Yeni bir mimari iddia, ancak `KARAR_GUNLUGU.md`'na kayıt varsa
mimari sayılır. Aksi halde taslaktır.

---

## 1. ÜÇ KURUCU KARARI

Bu üç karar senin tarafından 2026-10-06'da verildi. 28 çelişkinin
çoğunun kökü budur.

| # | Karar | Değer |
|---|---|---|
| **D-01** | İş modeli | **HİBRİT: ajan + operasyon** |
| **D-02** | Koordinatör adı | **KOORDİNÖRÇEKİRDEĞİ** |
| **D-03** | Kod tabanı | **V3 taşındı + üstüne kuruldu** |

### D-01 · Hibrit: ajan + operasyon

| Hat | Ne satıyoruz | Fatura | Çıkış |
|---|---|---|---|
| **AJAN HATTI** | Kendi ürünümüzü kendimiz yapıyoruz (marka, içerik, SEO) | — | İç |
| **OPERASYON HATTI** | Müşterinin işini yürütüyoruz (teklif + yürütme) | Aylık | Sözleşme bitene kadar |

**Ortak analiz motoru** ikisinin arasında: bir kez çalışır, iki tarafa da gider.
Kazanım: analiz maliyeti iki kez ödenmez + **moat'ın ilk maddesi (sektörel bilgi)**.

**Satış-pazarlama birimi yalnızca OPERASYON hattındadır.** Gerekçesi dört kalem:
yetki (seviye 2-3 gerekir), mevzuat (İYS/KVKK), kadro, akış farkı.

> Bu karar hibrit olduğu için **fiyat iki kalemlidir**: kurulum (tek seferlik)
> + aylık işletme. `06_IS_MODELI/FIYATLANDIRMA.md` bunu böyle işler.

### D-02 · KoordinatörÇekirdeği

```
CEZİR
  ↓
KOORDİNÖRÇEKİRDEĞİ          ← TEK global koordinator. Rol adı, paket adı DEĞİL.
  ├── AI_KODLAMA_İŞÇİSİ      (OpenCode üzerinde)
  ├── ARAŞTIRMA_İŞÇİSİ       (Hermes / web)
  ├── BİLGİ_İŞÇİSİ
  └── ...
        ↓
  MCP KATMANI
```

**"Munder Difflin" bir ROL ADIDIR.** Kaynağı, sürümü, kurulumu yoktur —
`FINAL_MASTER_ARCHITECTURE.md:365-367` bunu açıkça söylüyordu. Bu yüzden
paket adı olarak kullanılamaz. Kodda zaten `kordinator/` paketi var.

**Bu, 26 dokümanı geçersiz kılar.** Çünkü hepsi "Munder tek global
coordinator" diyordu — ama Munder yok. Şimdi var: `KoordinatörÇekirdeği`.

### D-03 · V3 taşındı

`AI_AUTONOMOUS_OFFICE` → `Ai_Office_Opencode`. 3307 satır Python, 58 test.
Doğrulandı: yeni klasörde de **58/58 geçiyor**.

Taşınırken: `.env` **kopyalanmadı**, `__pycache__` kopyalanmadı,
`kuyruk.db` kopyalanmadı, 2 `.ps1` dosyasındaki **UTF-8 BOM temizlendi**
(PowerShell 5.1 BOM'lu dosyayı ANSI okur → Türkçe bozulur).

---

## 2. ÇELİŞKİ ÇÖZÜM TABLOSU — 28 MADDE

Her satır: hangi kaynak ne diyordu, **ve hangisi kazandı**.

| # | Konu | Kaynak A | Kaynak B | ✅ KAZANAN | Gerekçe |
|:--:|---|---|---|---|---|
| C-01 | Global koordinator kim? | 26 doküman: "Munder tek global" | `blueprint:58` "HERMES MERKEZİ" | **KoordinatörÇekirdeği** | D-02 kurucu kararı. 3 koordinatörlüğü tek indirdi. |
| C-02 | Ana yazılım işçisi? | `04_OPENCODE`: "OpenCode ana mühendis" (YES) | `Qwen:60` "OpenHands" | **OpenCode** | OpenHands hiçbir yerde pilot/aşama geçmiyor — test edilmemiş alternatif. |
| C-03 | OpenCode coordinator mı worker mı? | `MASTER-BUILD:90` "OpenCode = Orkestratör" | `04_OPENCODE:46` "OpenCode global coordinator DEĞİLDİR" | **WORKER** | `04_OPENCODE` daha yeni ve mühürlü. Orkestrasyon sorumluluğu KoordinatörÇekirdeği'ne gitti. |
| C-04 | Model sabit mi seçilir mi? | K-02 "çalışana sabit model = ihlal" | `blueprint:24` "Model seçimini yapmak görevi" | **İKİSİ DE** | K-02 *yetki*→model bağı yasaklar. Model **görev sınıfına** göre seçilir, **çalışana** sabitlenmez. |
| C-05 | Kaç ajan? | `15_ILK`: 7 | `12_KATALOG`: ~60 | `gemini-code`: "100+" | **`13_90_GUNLUK`: "90 günde 100+ ajan YAPILMAZ"** | 7 işçiyle başla. 90 günlük plan Faz 2 tam 5 ajan tanımlıyor. |
| C-06 | Ruflo kurulacak mı? | `06_RUFLO`: "kurulmaz" (NO INITIAL) | `ben olsam fıye`: aktif katman, 100+ ajan | **RESERVE — kurulmaz** | Qwen gerekçesi ikna edici: "73.8k yıldız, arkasında bağımsız motor yok." |
| C-07 | Ruflo ret gerekçesi çöküyor ⚠️ | `06_RUFLO:11` "Munder zaten global coordination yapıyor" | `FINAL_MASTER:365` "Munder bu depoda değil" | **Gerekçe düzeltildi** | Ret gerekçesi "ikinci coordinator"a dayanıyordu. D-02 ile ikinci coordinator yok. **Yeni gerekçe:** eklenen katmanın ölçülebilir faydası kanıtlanana kadar kurulmaz. |
| C-08 | Hermes var mı? | `05_HERMES`: uzman çalışan (YES) | `Qwen:27` "8+ saat denemeye rağmen bağlantı kurulamadı" | **ROL: kabul / KULLANIM: dikkat** | Mimari rol doğru. Ama CLI bypass zorunlu, `.env` desteği yok. **Bu bilgi hiçbir dokümana geçmemişti.** |
| C-09 | Hafıza: Obsidian mı JSONL mi? | `12_OBSIDIAN`: "kalıcı bilgi deposu" (YES) | `FINAL_MASTER:123` "Muhur + Kanıt + JSONL" — Obsidian yok | **İKİ KATMAN — ikisi de** | JSONL = makine-içi değişmez kayıt (fsync, append-only). Obsidian = insan-okur derin bilgi. Tek sistem değil, iki katman. |
| C-10 | Ücretsiz sağlayıcı sırası | **6 FARKLI SIRa** var | — | **`provider-registry.yaml`** | Tek tablo. Görev sınıfı → birincil/yedek/yerel. Bkz. `01_MIMARI/PROVIDER_KAYIT_DEFTERI.md` |
| C-11 | 3D ofis ne zaman? | `20_3D`: "olmayacak gibi sınırlandır" | `MASTER-BUILD:74` "abonelik varsa" | **Faz 13 sonrası** | Hepsi aynı şeyi söylüyor. 1. yıl YAPMA. |
| C-12 | Claude Code | `24_FINAL`: **NO** | `Ozkan PROFILE:1341` "Önerilen: Claude Code" | **HAYIR** | Profil sohbet ortamı içindir (kişisel tavsiye). Kimlik zaten `Claude Code Router` ile bugün OpenCode'dur. |
| C-13 | Otonom mu onay mı? | `AUTONOMOUS_WEB_AGENCY:82` "tekrar onay isteme" | `16_SECURITY`: 6 işlem insan onayı | **KAPSAMLI OTONOM** | Otonom mod **yalnızca** `AUTONOMOUS_WEB_AGENCY` kapsamında, yalnızca kod/SEO/UX kararlarında. Şirket genelinde onay zorunlu. |
| C-14 | Kalite eşiği | Web: "90/100" | Sistem: "PASS/FAIL" | **İKİ AYRI YÜZ** | Web çıktısı = puan. Sistem sağlığı = kapı. Karıştırma. |
| C-15 | MCP sayısı | `11_MCP_POLICY:9` "Az MCP > çok MCP" | `BUGUN-ISLEMLER:27` "16 MCP enabled" | **1 MCP (mcp-filesystem)** | 16 MCP, 16 kat yetki yüzeyi. Gate 8 geçmeden 2.'si açılmaz. |
| C-16 | Agency Agents | `09_AGENCY_AGENTS:13` "Tümü yüklenmez" | `BUGUN-ISLEMLER:17` "295 agent kopyalandı" | **7 rol** | 295 → önce 7 rol seç → sadeleştir → TOZ standardına çevir. |
| C-17 | n8n otomasyon | `MASTER-BUILD:319` "Faz 8" | `Ozkan PROFILE:509` "önemli alan" | **MVP DIŞI** | İkinci orkestratör riski. Gate 8 geçmeden açılmaz. |
| C-18 | Kapıda Kirala ayrı departman mı? | `14_HIYERARSI:48` "ayrı departman DEĞİL" | `blueprint:121` "ayrı ticari iş kolu" | **ÜRÜN HATTI** | "İş kolu" ≠ "departman". Standart kelime **"ürün hattı"**. |
| C-19 | Ajans mı operasyon mu? | `01_ANAYASA:19` "Ajans DEĞİLİZ" | `02_IS_MODELI:238` "SANA BAĞLI" | **D-01 HİBRİT** | Kurucu kararı. Fiyat: kurulum + aylık. |
| C-20 | Klasör sayıları | `FINAL_MASTER:55` "TOZ_VAULT = 11" | Diskte **13** modül | **Disk gerçeği kazanır** | 13 modül doğrulandı. Doküman güncel değil. |
| C-21 | OpenCode kaynak URL'si | `MASTER-BUILD:207` `sst/opencode` | `blueprint:101` `anomalyco/opencode` | **`anomalyco/opencode`** | `sst` eski repo adı. `blueprint` doğru. |
| C-22 | Nihai mimari klasörü | `25_DEGISIKLIK_KAYDI`: "tekrar tartışılmasın" | `FINAL_MASTER:5` "BAĞLAYICI" | **BU DOSYA** | Yeni bağlayıcı belge. `99_ARSIV` dokunulmaz. |
| C-23 | Global skills yolu | **4 FARKLI YOL** var | — | **`D:\AI\Skills`** | `MASTER-BUILD:185`'in yedekleme kuralı hiç uygulanmamış. Tek yol. |
| C-24 | "Otomatik failover iddia etme" | `MASTER-BUILD:297` "iddia etme" | `BUGUN-ISLEMLER:8` "13 model, otomatik geçiş" | **ÇALIŞABİLİR, AMA BELGELENMİŞ OLMALI** | "İddia etme" ≠ "yapma". Ama belgelenmemiş otomatik geçiş = yapma. K-03. |
| C-25 | Koordinatör yazımı | 25 dosya "MUNDER DIFFLIN" | `ben olsam fıye`: "Muffin-Difler Dot" | **D-02 KOORDİNÖRÇEKİRDEĞİ** | B farklı bir isim. Üçüncü bir isim. Tek isim kalsın. |
| C-26 | Qwen CLI aracı mı model mi? | `24_FINAL`: "Qwen CLI NO INITIAL" | `BUGUN:8` "qwen3-coder:free ilk model" | **ARÇ = hayır / MODEL = evet** | Terminoloji düzeltmesi. İki kişi farklı okuyordu. |
| C-27 | "100+ ajanlı AI Şirketi" | `gemini-code:6` "100+ otonom ajan" | `FINAL_MASTER:79` "Orkestrasyon netliği: 3" | **7 işçi** | `gemini-code` en eski ve en gerçekçi olmayan belge. **Arşive.** |
| C-28 | "Kilitle" ifadesi | `03_MUNDER_KARAR:19` "ikinci coordinator çalıştırılmasın" | `FINAL_MASTER:240` K-01 `kilit_al()` | **KURAL + KOD** | A kuralı söyler, C kuralı zorlar. Kilit `kilit_al()` **olmadan** kural temennidir. |

---

## 3. ÜRETİM DEĞİŞTİRME PROSEDÜRÜ

`16_SECURITY_GOVERNANCE.md` ve `19_PRODUCTION_FREEZE.md` ile aynı, tek yerde:

```
ÖNERİ
  ↓
TEST (yeşil olmadan devam edilmez)
  ↓
İNSAN ONAYI
  ↓
YEDEK
  ↓
DEĞİŞİKLİK
  ↓
SAĞLIK KONTROLÜ
  ↓
YAYIN
```

Production sonrası rutin değişiklik yapılmaz: koordinator, router, hafıza
mimarisi, MCP standardı, skill standardı, sağlayıcı mimarisi.

Değişiklik **yalnızca**: güvenlik açığı · kritik hata · servis kapanması ·
lisans · kanıtlanmış performans yetersizliği.

### AI kendi kendini değiştiremez

- global koordinator
- model / sağlayıcı yönlendirici
- MCP kayıt defteri
- skill standardı
- sır yönetimi
- yetki matrisi
- çekirdek yapılandırma
- yıkıcı politikalar

---

## 4. İNSAN ONAYI İSTEYEN 6 İŞLEM

Para · hukuki işlem · toplu ticari iletişim · production deploy ·
geri dönüşü zor değişiklik · **kalıcı silme**

---

## 5. YETKİ KADEMELERİ

| Seviye | Ne | Otomatik mi? |
|:--:|---|---|
| **T0** | Okuma, araştırma, analiz | **Evet** |
| **T1** | Taslak, geri alınabilir iş | **Evet** |
| **T2** | Dışarı gönderim (mail, mesaj, teklif) | **İnsan onayı** |
| **T3** | Kontrollü kayıt yazma (CRM, proje) | **İnsan onayı** |
| **T4** | Para, hukuk, deploy, kalıcı silme | **HİÇBİR ZAMAN** |

> Yapay zeka çalışanı yetkisi kadar iş yapar. **"Model yapabiliyor" =
> "çalışan yapabiliyor" değildir.**

| Kim | Seviye |
|---|---|
| AI çalışanı | 0–2 |
| Dış uzman | 0–2 |
| Teknik (sahip) | 3 |
| **Sahip** | **4** |

> Hiçbir AI çalışanı seviye 4 **olamaz**. Bu kural bilinçli olarak kondu.

---

## 6. DOĞRULAMA İLKESİ — K-07

Her iddia bir **kaynaya** bağlı olmalı ya da `VERIFY_REQUIRED` işaretlenmeli.

Kanıtsız iddia kurumsal bilgi **promlanamaz.** Uydurma en pahalı hatadır:
bir kez yakalanan müşteri bir daha gelmez.

**Bu ilke ölçülmüş 3 ihlalle uygulanıyor:**

| İhlal | Kanıt |
|---|---|
| `.env` taslak klasörünün kökünde | `D:\AI\Toz AI Agency Taslaklar\.env` (8 anahtar) |
| 16 aktif MCP | `11_MCP_POLICY:9` "Az MCP > çok MCP" ihlali |
| 295 agent yüklü | `09_AGENCY_AGENTS:13` "Tümü yüklenmez" ihlali |

---

## 7. MOAT — MODEL DEĞİL

> *"Şirketin moat'ı model olmamalıdır."* — `01_SIRKET_ANAYASASI.md:66`

Model herkesin erişebildiği bir hammadde. Moat 8 bileşenden birikir:

| # | Bileşen | Durum |
|:--:|---|---|
| 1 | Sektörel bilgi | Tek müşteriyle çalışıldı |
| 2 | İş akışı grafikleri | ❌ Yok |
| 3 | Kuruma özel eval testleri | ❌ Yok |
| 4 | Müşteriye özel operasyon hafızası | ❌ Yok |
| 5 | Araç kütüphanesi | ❌ Yok |
| 6 | Yetki/yönetişim sistemi | ✅ V3 anayasa kapısı |
| 7 | Ölçülmüş sonuç geçmişi | ❌ Yok |
| 8 | Yeniden kullanılabilir beceri | Kısmi |

> **Bu sekiz bileşenin hiçbiri bugün tam değil.** 1 ve 6 dışında hiçbiri için
> tek bir müşteriyle bile çalışılmadı.

---

## 8. KALICI SİLME YASAK

Bu depoda **hiçbir dosya kalıcı olarak silinmez.**

| İşlem | Nerede |
|---|---|
| Devre dışı bırakma | `99_ARSIV/` altına taşı |
| Gizli dosya | `.gitignore` + taşı (silme değil) |
| Temizlik | Önce taşı, doğrula, sonra karar ver |

Gerekçe: `FINAL_MASTER_ARCHITECTURE.md:83` güvenlik puanını 4 verip
gerekçesini "ilkeler güçlü, **ihlal edilmiş**" yazdı. İhlallerin çoğu
kalıcı silmeydi. Bu depoda silme yok.

---

## 9. "10/10" NE DEMEK

> **10/10 = her kural makine tarafından zorlanır ve testle kanıtlanır.**

Bu **kusursuz** demek değildir.

| Katman | Durum |
|---|---|
| Çekirdek (kod + test) | ✅ 58 test |
| Yapılandırma tutarlılığı | ✅ 8/8 kural |
| Entegrasyon (gerçek API) | ❌ denenmedi |
| Uçlar (müşteri işi) | ❌ denenmedi |

> **Çekirdek test edildi, uçlar test edilmedi.**

---

## 10. BU DOSYAYI NASIL GÜNCELLEYİM

1. `KARAR_GUNLUGU.md`'na kayıt ekle
2. Buradaki ilgili maddeyi güncelle
3. Testleri çalıştır: `python 00-core\07-araclar\test_mimarisi.py`
4. Anayasa kapısını çalıştır: `python 00-core\07-araclar\anayasa_kontrolu.py`
5. Commit — `push` **otomatik değildir**

**Bu dosya olmadan projede mimari değişikliği yapılmaz.**
