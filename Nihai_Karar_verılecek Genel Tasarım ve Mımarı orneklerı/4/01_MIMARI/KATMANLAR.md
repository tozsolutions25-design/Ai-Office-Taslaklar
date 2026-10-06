# MİMARİ KATMANLAR

> Bağlayıcı belge: `00_TEK_OTORITE/ANAYASA.md` (D-02)
> Tarih: 2026-10-06

---

## SORUN

226 dokümanda **7 farklı "coordinator" tanımı** vardı:

| # | Belge | Kim coordinator? |
|:--:|---|---|
| 1 | `FINAL_ARCHITECTURE/*` (26 dosya) | Munder Difflin |
| 2 | `MASTER-BUILD-PROMPT` v2 | OpenCode ("Takım Lideri") |
| 3 | `blueprint_2026/05` | Hermes ("HERMES MERKEZİ") |
| 4 | `Qwen_*` Katman 7 | OmniRoute ("Trafik polisi") |
| 5 | `ben olsam fıye...:56` | Ollama & Docker |
| 6 | `gemini-code-...:10` | claude-task-master |
| 7 | `FINAL_MASTER_ARCHITECTURE.md:117` | KoordinatörÇekirdeği |

Bu, `FINAL_MASTER_ARCHITECTURE.md:79`'un verdiği skora yansıdı:

> *"Orkestrasyon netliği | **3** | En kötü boyut"*

**Çözüm D-02:** Tek koordinator, `KoordinatörÇekirdeği`. Aşağıda.

---

## KATMANLAR

```text
┌─────────────────────────────────────────────────┐
│  SAHİP (Seviye 4)                               │
│  Para · hukuk · deploy · kalıcı silme           │
│  AI BUNU YAPAMAZ. HİÇBİR ZAMAN.                 │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  KOORDİNÖRÇEKİRDEĞİ                    ← TEK     │
│  K-01: Tek global koordinator                  │
│  Kod: 00-core/07-araclar/kordinator/            │
│  Kilit: kilit_al()  ·  Test: TekOtoriteTestleri  │
└──────────────────────┬──────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼──────────┐
│ AI_KODLAMA   │ │ ARAŞTIRMA  │ │ BİLGİ          │
│ İŞÇİSİ       │ │ İŞÇİSİ     │ │ İŞÇİSİ         │
│              │ │            │ │                │
│ OpenCode     │ │ Web/Hermes │ │ Muhur + JSONL  │
│ üzerinde     │ │ (dikkatli) │ │ Obsidian       │
│              │ │            │ │                │
│ Yetki: 1     │ │ Yetki: 0   │ │ Yetki: 0       │
└───────┬──────┘ └─────┬──────┘ └─────┬──────────┘
        │              │              │
        └──────────────┼──────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  ROTA KATMANI                                     │
│  Sağlayıcı sırası · devre kesici · kotalar       │
│  Kod: kordinator/router.py + sigorta.py           │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  MCP KATMANI (başlangıçta 1 tane)                 │
│  Az MCP > çok MCP.  Şu an: mcp-filesystem         │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  HARİCİ ARAÇLAR VE SİSTEMLER                     │
│  OpenRouter · Gemini · Groq · Ollama             │
└─────────────────────────────────────────────────┘

  BİLGİ YANLARI (koordinator değil):
    03-beyin/00_Muhurler/   O(1) bağlam, failover
    03-beyin/01_Kararlar/   karar arşivi, üstüne yazılmaz
    03-beyin/02_Ogrenilenler/  hata + öğrenme
```

---

## HER KATMANIN NEREDE KODU VAR

| Katman | Kod | Satır | Test |
|---|---|---|---|
| KoordinatörÇekirdeği | `00-core/07-araclar/kordinator/` | 2166 | 58 |
| Kuyruk + durum makinesi | `kordinator/kuyruk.py` | 249 | `DurumMakinesiTestleri` |
| Rota | `kordinator/router.py` | 170 | — |
| Devre kesici | `kordinator/sigorta.py` | 192 | `SigortaTestleri` (8) |
| Sağlayıcı istemcileri | `kordinator/saglayici_istemcileri.py` | 260 | — |
| Bağlam mührü | `kordinator/baglam_muhru.py` | 207 | `MuhurTestleri` (8) |
| Onay kapısı | `kordinator/onay_kapisi.py` | 124 | `OnayTestleri` (4) |
| Token muhasebesi | `kordinator/onbellek.py` | 104 | `OnbellekTestleri` (7) |
| Hafıza yazıcı | `kordinator/beyin.py` | 133 | — |
| Hata taksonomisi | `kordinator/hata.py` | 67 | — |
| .env okuyucu | `kordinator/dotenv.py` | 105 | — |
| Git senkronu | `kordinator/obsidian_sync.py` | 167 | `SirTaramaTestleri` |
| Anayasa kapısı | `anayasa_kontrolu.py` | 205 | 8/8 kural |
| Sır taraması | `sir_tara.py` | 238 | `SirTaramaTestleri` |
| Worker | `worker.py` | 201 | — |

**Toplam: 3307 satır Python, 58 test, sıfır harici bağımlılık.**

---

## BU MİMARİDE OLMAYAN ŞEYLER

Sadelik, gösteriş değildir. **Aşağıdakilerin hiçbiri yok:**

| Yok | Neden |
|---|---|
| İkinci global koordinator | K-01 ihlali |
| İkinci router / orkestratör | n8n **MVP dışı** (C-17) |
| İkinci hafıza sistemi | Muhur + JSONL yeterli |
| Sabitlenmiş model | K-02 ihlali |
| Zamanlayıcı (cron/daemon) | Şu an yok. Gerekirse eklersin. |
| Web arayüzü | Onay kapısı hariç yok |
| 295 ajan | 7 rol yeter (C-16) |
| 16 MCP | 1 tane yeter (C-15) |
| 3D ofis | Faz 13 sonrası (D6) |
| Otomatik push | K-04 / yıkıcı politika |

> V2'de 11 klasör vardı, **5'i doluydu.** Bu, "16 boş klasör = 16 boş
> vaat" hatasının aynısıydı. Burada her klasörün bir işi var.

---

## VERİ AKIŞI — TEK GÖREV BAŞTAN SONA

```text
1. SAHİP talebi girer
        ↓
2. Kuyruk.ekle()  →  kapsam belirsizse BLOKE (kimlik uydurulmaz)
        ↓
3. Al()  →  olusturuldu → kapsam_cozuldu
        ↓
4. Muhur yüklenir (beyinden, O(1) — kasa değil)
        ↓
5. ONAY KAPISI  →  seviye 0-1 geç · 2-3 bekle · 4 REDDET
        ↓
6. rota_sec()  →  devre açık + kotası dolu olanlar elenir
        ↓
7. cagir_guvenli()  →  sırayla dene
   ├─ başarı → gerçek usage alanından token say
   ├─ 429    → tam jitter + Retry-After
   ├─ 401/403/404 → kalıcı hata, yeniden deneme ANLAMSIZ
   └─ hepsi başarısız → OLUM KUTUSU (sessiz kaybolma yok)
        ↓
8. Beyin'e yaz (mührü + karar + öğrenilen)
        ↓
9. durum_ata(tamamlandi)  →  terminal, ASLA dönmez
```

**Başarısız olursa:** `kurtar()` bir sonraki açılışta yarım kalan görevi
`olusturuldu`'ya geri alır veya `olum_kutusu`'na gönderir. **Kalıcı kayıp yok.**

---

## AKIŞ GÖRSELİ — İKİ İŞ KOLU (D-01)

```text
                     ORTAK ANALİZ MOTORU
                    (bir kez çalışır, tek maliyet)
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
   AJAN HATTI (A)                        OPERASYON HATTI (B)
   Marka & ürün tarafı                    Müşteri & hizmet tarafı
        │                                         │
   ┌────┴─────┐                          ┌───────┼───────┐
   │          │                          │       │       │
 Konum-     İçerik                   Müşteri  Teklif  **SATIŞ
 landırma   üretimi                  analizi  + fiyat  PAZARLAMA**
 Web/SEO    Görsel kimlik                          BİRİMİ**
 AEO                                    (YALNIZCA burada)
        │                                         │
   maliyet: iç                                 maliyet: gelir
```

**Ortak analiz motoru çift taraflıdır:**

| Analiz çıktısı | A tarafında | B tarafında |
|---|---|---|
| Pazar konumlanması | Marka stratejisi | Müşteriye teklif gerekçesi |
| Rakip haritası | İçerik farklılaştırma | Sektörel giriş analizi |
| Özellik haritası | İçerik üretimi | Kapsam tanımı (kapsam kaymasını önler) |
| Hedef kitle profili | Kanal seçimi | Nitelikli müşteri listesi |
| Fiyat aralığı | Ürün konumlandırma | Teklif fiyat bandı |
| İçerik fırsatları | SEO/AEO planı | Müşteriye ilk 90 gün önerisi |

> **Kazanım:** analiz maliyeti iki kez ödenmez, kâr marjı iki tarafta yükselir.
> Ve bu, moat'ın ilk maddesidir (sektörel bilgi).

**Satış birimi AI değil, insan fonksiyonudur.** AI taslak üretir, insan
gönderir. Bu K-06'nın gereğidir. Detay: `03_IS_KOLU/OPERASYON_HATTI.md`

---

## ÖLÇEKLENME

| Katman | 1. yıl | 3. yıl | 5. yıl |
|---|---|---|---|
| Gerçek insan | **1** | 3-5 | 8-15 |
| Sanal çalışan eşdeğeri | **7** | 20-30 | 60-150 |

> ⚠️ **DİKKAT:** 8-15 "eşdeğer" **aynı anda açık model çağrısı değildir.**
> Olay oldukça açılırlar. Bu ayrım karıştırılırsa maliyet 10 kat çıkar.

---

## BİR MİMARİ NEDEN HAYATTA?

`FINAL_MASTER_ARCHITECTURE.md:79`:

> *"Sürdürülebilirlik | **3** | 5 rakip, hiçbiri diğerini referans almıyor"*

5 mimari nesil vardı, hiçbiri bir öncekine referans vermedi. Bu yüzden her
biri sıfırdan yazıldı ve hepsi çelişti.

**Çözüm:** `00_TEK_OTORITE/ANAYASA.md` var. Yeni mimari önce oraya yazılır.
`KARAR_GUNLUGU.md`'na girmeyen iddia taslaktır.
