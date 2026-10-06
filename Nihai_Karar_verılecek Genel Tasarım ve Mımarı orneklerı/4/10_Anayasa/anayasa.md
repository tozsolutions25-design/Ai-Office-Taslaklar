# TOZ SOLUTIONS AI SISTEM ANAYASASI v3

> **8 kural. Her birinin calisan bir karsiligi var.**
> Ihlal varsa sistem **ayak kalkmaz** — `calistir.ps1` bunu kontrol eder.

| Kural | Ihlal | Calisan karsilik |
|---|---|---|
| **K-01** | Iki global koordinator | dosya kilidi |
| **K-02** | Calisana sabit model | `anayasa_kontrolu.py` |
| **K-03** | Test edilmemis / sessiz failover | rota dogrulamasi |
| **K-04** | Sir izlenen agacta | `sir_tara()` + `Beyin._kontrol` |
| **K-05** | Bildirilmemis yetki | kuyruk zorunlu alan |
| **K-06** | Seviye 4 otomatik | `OnayKapisi` |
| **K-07** | Kaynakli iddia yok | muhur kanit zorunlu |
| **K-08** | Ucucu icerik / kotali onbellek | token muhasebesi |

---

## 1. OTORITE — K-01

Ayni gorev zincirinde **yalnizca bir** global koordinator.
Iki isci olabilir. **Iki amir olmaz.**

---

## 2. KIMLIK — K-02

Calisanin **modeli sabitlenmez.** Roller modele degil **yetkiye** baglanir.

> Sebep: Saglayici coktugunde ajan kimligi degismemelidir.
> 2. ajanin `model_tercihi` alani **kaldirildi**.

---

## 3. GECIS — K-03

Failover ancak **test edilmis** ve **rapor veren** ise kullanilabilir.
**Sessiz gecis yasaktir.**

Her gecis loglanir:

```
[ROTA BASARISIZ] gemini: HTTP_429 | groq: AnahtarYOK
[FAILOVER] yerel_ollama'ya dusuldu
```

---

## 4. GIZLILIK — K-04

API anahtarlari ve sirlar:
- kodda **YOK**
- muhurda **YOK** (`Muhur.kontrol()` yazmadan once reddeder)
- duzluk dosyasinda **YOK**
- izlenen agacta **YOK** (`sir_tara()` bulursa commit reddeder)

`push` **otomatik degildir.**

---

## 5. YETKI — K-05, K-06

| Seviye | Ne | Otomatik mi? |
|:--:|---|---|
| 0 | Okuma, arastirma, analiz | Evet |
| 1 | Taslak, geri alinabilir is | Evet |
| 2 | **Disari gonderim** (mail, mesaj, teklif) | **Insan onayi** |
| 3 | **Kontrollu kayit yazma** (CRM, proje) | **Insan onayi** |
| 4 | Para, hukuki islem, deploy, kalici silme | **HICBIR ZAMAN** |

- **60 dakika** onay bekleyen is **otomatik iptal** edilir.
- Onaylanmayan is, onaylanmis olmaktan **iyidir**.
- Hiçbir AI iscisi seviye 4 **olamaz**.

---

## 6. DOGRULAMA — K-07

Her iddia bir **kaynaga** bagli olmali ya da `VERIFY_REQUIRED` isaretlenmeli.

Kanitsiz iddia kurumsal bilgi **-promlanamaz.**

Uydurma en pahali hatadir: bir kez yakalanan musteri bir daha gelmez.

---

## 7. MALIYET — K-08

**Token = 10 farkli fiyat:**

| Durum | Carpim |
|---|---|
| Onbelleksiz girdi | 1.0x |
| Onbellekli okuma | **0.1x** |
| Onbellekli yazma (5 dk) | 1.25x |
| Onbellekli yazma (1 saat) | 2.0x |

Kota **tahmin degil sayimdir.** Gercek `usage` alanindan okunur.
Sabit deger yazilmaz.

Onbelleklenmeyen is "onbellekli" **sayilmaz.**

---

## 8. AI KENDI KENDINI DEGISTIREMEZ

- global koordinator
- model / saglayici yonlendirici
- MCP kayit defteri
- beceri standardi
- sir yonetimi
- yetki matrisi
- cekirdek yapilandirma
- yikici politikalar

### Degisim proseduru

```
ONERI
  ↓
TEST (yesil olmadan devam edilmez)
  ↓
INSAN ONAYI
  ↓
YEDEK
  ↓
DEGISIKLIK
  ↓
SAGLIK KONTROLU
  ↓
YAYIN
```

> **PASS raporu degil, gercekte calisan ve dogrulanabilen sistem.**

---

## 9. "10/10" NE DEMEK

> **10/10 = her kural makine tarafindan zorlanir ve testle kanitlanir.**

Bu **kusursuz** demek DEGILDIR. V3'te 8 ilkenin 8'i de kodda
zorlanir ve `test_mimarisi.py` ile test edilir.

Ama:

- Yurutucu motor gercek bir isde **denenmedi**
- 24 saatlik dayaniklilik testi **yapilmadi**
- Kota rakamlari **dogrulanmadi**
- **Tek bir gercek musteri isi calistirilmadi**

> **Cekirdek test edildi, uclar test edilmedi.**

---

## 10. BILINEN SINIR

Bu bir **mimari tasarim ve sozlesme** calismasidir.
Calisan bir urun **değildir** — daha degildir.

Tek fark: hangi adimin **dogrulanmadigini** yaziyor.
