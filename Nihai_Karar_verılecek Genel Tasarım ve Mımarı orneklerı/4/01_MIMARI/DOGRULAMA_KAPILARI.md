# DOĞRULAMA KAPILARI

> Kaynak: `17_TEST_GATES.md` (12 kapı, aynen) + `03_MUNDER_KARAR.md` (9 şart)
> D-02 sonrası yeniden yazıldı: "Munder" kaldırıldı, **KoordinatörÇekirdeği** geldi.
> Tarih: 2026-10-06

---

## NEDEN YENİDEN YAZILDI

`03_MUNDER_KARAR.md` Munder için 9 üretim şartı koyuyordu. D-02 ile Munder
bir paket değil, bir rol adı oldu. Şartlar geçerliydi ama **hiçbiri test
edilmemişti.** Gate eşlemesi şöyleydi:

| Munder şart | Gate | Durum |
|---|---|---|
| Windows startup | Gate 1 | ✅ |
| worker startup/shutdown | Gate 3 | ✅ |
| OpenCode integration | Gate 2, 4 | ✅ |
| task routing | Gate 5 | ✅ |
| duplicate task prevention | Gate 7 | ✅ |
| logging | — | ⚠️ **Gate listesinde YOK** |
| restart/recovery | Gate 6 | ✅ |
| permission control | Gate 8 | ✅ |
| **24 saatlik stability/soak** | Gate 11 | ❌ **YAPILMADI** |

**Eksik olan:** logging kapısı. Eklendi (Gate 4.5).

---

## 12 KAPI

### Gate 1 — Ortam
- [ ] Windows
- [ ] Git
- [ ] Python 3.11+
- [ ] Node (varsa)

**Otomatik doğrulama:** `calistir.ps1` adım 1
**Geçme kanıtı:** Konsol çıktısı

---

### Gate 2 — Anayasa
- [ ] `anayasa_kontrolu.py` **8/8** geçiyor
- [ ] Hiçbir ihlal listelenmiyor

**Otomatik doğrulama:**
```powershell
python 00-core\07-araclar\anayasa_kontrolu.py
```
**Geçme kanıtı:** `SONUC: GECTI - 8/8 kural saglandi.`
**Geçerse:** Sistem ayaga kalkabilir. Geçmezse **durmak zorunda**.

---

### Gate 3 — Sır taraması (K-04)
- [ ] Kodda anahtar kalıbı yok
- [ ] `.env` izlenen ağaçta **değil**

**Otomatik doğrulama:**
```powershell
python 00-core\07-araclar\sir_tara.py
```
**Geçme kanıtı:** `SONUC: TEMIZ.`
**Geçerse:** Commit'e izin verilir.

> **K-04'ün gerçek kuralı:** İhlal, anahtarın *dosyada* olması değil,
> Git'e *girmiş* olmasıdır. `.env` var olması normaldir — tasarımdır.
> (Bu ayrım V3'te düzeltildi; önceki sürüm aracı kullanılamaz yapıyordu.)

---

### Gate 4 — Testler
- [ ] `test_mimarisi.py` **58/58** geçiyor

**Otomatik doğrulama:**
```powershell
python 00-core\07-araclar\test_mimarisi.py
```
**Geçme kanıtı:** `Ran 58 tests` + `OK`
**Geçerse:** Çekirdek kanıtlandı.

---

### Gate 4.5 — Loglama  ← *YENİ*
- [ ] Her durum geçişi `loglar` tablosuna yazılıyor
- [ ] Log satırı: zaman, görev, kaynak, mesaj
- [ ] Arıza `loglar`'a düşüyor, sadece ekrana değil

**Geçme kanıtı:** Bir görev çalıştır, sonra:
```sql
SELECT * FROM loglar ORDER BY id DESC LIMIT 20;
```
**Geçerse:** Arıza sonradan görülebilir.

> Bu kapı `03_MUNDER_KARAR`'ın "logging" şartını karşılıyordu ama
> 12 kapı listesinde karşılığı yoktu. **Eklendi.**

---

### Gate 5 — Veritabanı
- [ ] `kuyruk.db` oluştu
- [ ] Tablolar var: `gorevler`, `onaylar`, `loglar`
- [ ] Terminal durum trigger'ı kurulu

**Otomatik doğrulama:**
```powershell
python 00-core\07-araclar\db_init.py
```
**Geçme kanıtı:** Tablo listesi
**Geçerse:** Kuyruk çalışabilir.

---

### Gate 6 — Kurtarma
- [ ] Yarım kalmış görev geri alınıyor
- [ ] Deneme sınırı aşan görev ölüm kutusuna gidiyor
- [ ] Zaman aşımı onaylar iptal ediliyor

**Otomatik doğrulama:** `DurumMakinesiTestleri.kurtarma_*`
**Geçme kanıtı:** Test çıktısı
**Geçerse:** Yarım görev **kalıcı olarak kaybolmaz**.

---

### Gate 7 — Tek otorite (K-01)
- [ ] Tek global koordinator
- [ ] `kilit_al()` dosya kilidi çalışıyor
- [ ] İkinci koordinator yok

**Geçme kanıtı:** `KOORDİNÖRÇEKİRDEĞİ` tek tanım.
**Geçerse:** 7 farklı coordinator sorunu (C-01, C-03, C-25) çözülmüştür.

> **Bu kapı 226 dokümanın en büyük dersidir.** "3 günde 3 koordinatör
> kararı" bu kapının eksikliğinden doğdu.

---

### Gate 8 — Yetki kontrolü
- [ ] Seviye 0-1 otomatik geçiyor
- [ ] Seviye 2-3 onay istiyor
- [ ] Seviye 4 **her zaman** reddediliyor
- [ ] Yetkisiz araç erişimi reddediliyor

**Otomatik doğrulama:** `OnayTestleri` (4 test)
**Geçme kanıtı:** `test_seviye_4_her_zaman_reddedilir ... ok`
**Geçerse:** Hiçbir AI çalışanı seviye 4 olamaz.

---

### Gate 9 — Token muhasebesi (K-08)
- [ ] Kota **tahmin değil sayım**
- [ ] Gerçek `usage` alanından okunuyor
- [ ] Önbellek farkı ölçülüyor
- [ ] Uçucu içerik önbelleği bozmuyor

**Otomatik doğrulama:** `OnbellekTestleri` (7 test)
**Geçme kanıtı:** Test çıktısı

> **Sabit 150 değeri** V2'deki en pahalı yalandı. Şimdi gerçek sayılıyor.

---

### Gate 10 — Bağlam bütünlüğü
- [ ] Muhur failover'da kaybolmuyor
- [ ] Ret ledger'ı atılmıyor
- [ ] Yükü O(1) kalıyor
- [ ] Sessiz bağlam kaybı reddediliyor

**Otomatik doğrulama:** `MuhurTestleri` (8 test)
**Geçme kanıtı:** `test_ret_ledgeri_korunur ... ok`

> **5 mesajlık koşu = 5.000 mesajlık koşu.** Yük sabit.

---

### Gate 11 — GERÇEK API ÇAĞRISI  ← *EN ÖNEMLİ KAPI*
- [ ] En az bir görev **gerçekten** bir API'ye gitti
- [ ] Gerçek HTTP yanıtı alındı
- [ ] Token sayacı **gerçek** (sabit değil)
- [ ] Sağlayıcı + model adı logda
- [ ] Maliyet hesaplandı

**Otomatik doğrulama:** `.\calistir.ps1` + görev ekle
**Geçme kanıtı:**
```
[TAMAM] gemini/gemini-2.0-flash
  token: girdi=412 cikti=187 maliyet=228.1 birim
```
**Geçerse:** Entegrasyon kanıtlandı.

> **Bu kapı 1-10'un hepsinden önemlidir.** 58 test yeşil olabilir ama
> hiçbir şey gerçekten çalışmıyor olabilir. V2'de tam olarak bu oldu.

---

### Gate 12 — 24 saatlik soak  ← ❌ YAPILMADI
- [ ] 24 saat kesintisiz çalıştı
- [ ] Bellek sızıntısı yok
- [ ] Devre kesici doğru açılıp kapanıyor
- [ ] Ölüm kutusuna düşen görevler var ve çözülüyor
- [ ] Maliyet beklenenden sapmadı

**Durum: ❌ YAPILMADI** — `FINAL_MASTER_ARCHITECTURE.md:327`
**Kim başlatacak: Sahibi (D7)**

> Bu kapı kapanmadan **production ilan edilmez.**

---

### Gate 13 — GERÇEK MÜŞTERİ İŞİ  ← *SON KAPI*
- [ ] Gerçek bir müşteri işi uçtan uca çalıştı
- [ ] 3 sayı ölçüldü: önce kaç saat → sonra kaç saat → tutar
- [ ] Karar beyine yazıldı
- [ ] Devir planı hazır

**Durum: ❌ YAPILMADI** — müşteri yok.

> **Bu kapı kapanmadan "çalışıyor" denemez.** Çekirdek test edildi,
> uçlar test edilmedi.

---

## KAPI AKIŞ ŞEMASI

```
Gate 1 Ortam
   ↓
Gate 2 Anayasa (8/8)         ← ihlal varsa DUR
   ↓
Gate 3 Sır taraması          ← anahtar varsa DUR
   ↓
Gate 4 Testler (58/58)       ← yeşil değilse DUR
   ↓
Gate 4.5 Loglama
   ↓
Gate 5 Veritabanı
   ↓
Gate 6 Kurtarma
   ↓
Gate 7 Tek otorite (K-01)
   ↓
Gate 8 Yetki kontrolü
   ↓
Gate 9 Token muhasebesi
   ↓
Gate 10 Bağlam bütünlüğü
   ↓
Gate 11 GERÇEK API  ← ❌ HENÜZ YAPILMADI
   ↓
Gate 12 24 saatlik soak  ← ❌ HENÜZ YAPILMADI
   ↓
Gate 13 Gerçek müşteri işi  ← ❌ HENÜZ YAPILMADI
   ↓
PRODUCTION
```

---

## ÜRETİM KABULÜ

`01_OKU_BENI.md` (klon):

> Sistem ancak: worker çalışması, routing, recovery, güvenlik, loglama,
> tekrar başlatma, gerçek görev testi başarılı olduktan sonra production
> kabul edilir.

### Kurulum kuralı

```
Her aşama:  KUR → TEST ET → SONUCU KAYDET → DOĞRULA → SONRA DEVAM ET
Bir test başarısızsa sonraki aşamaya geçilmez.
```

---

## ŞU AN NEREDEYİZ

| Gate | Durum | Kanıt |
|---|---|---|
| 1 Ortam | ✅ | Windows + Python 3.14 |
| 2 Anayasa | ✅ | 8/8 |
| 3 Sır taraması | ✅ | TEMIZ |
| 4 Testler | ✅ | 58/58 |
| 4.5 Loglama | ⬜ | Tablo var, sorgu yapılmadı |
| 5 Veritabanı | ⬜ | `db_init.py` çalıştırılmadı |
| 6 Kurtarma | ✅ | Testler |
| 7 Tek otorite | ✅ | D-02 uygulandı |
| 8 Yetki | ✅ | 4 test |
| 9 Token | ✅ | 7 test |
| 10 Bağlam | ✅ | 8 test |
| **11 Gerçek API** | ❌ | **Anahtar yok** |
| **12 Soak** | ❌ | **Zaman yok** |
| **13 Gerçek müşteri** | ❌ | **Müşteri yok** |

**3 kapı / 13.** Gate 11 olmadan hiçbir şey "çalışıyor" denemez.

---

## SIRADAKİ ADIM

```
1. .env dosyasına anahtar yaz
2. db_init.py çalıştır          → Gate 5
3. Tek basit görev ekle
4. calistir.ps1 çalıştır
5. loglara bak                  → Gate 4.5
6. GERÇEK token sayacını gör    → Gate 11
```

Kabul kriteri tek cümle:

> **Bir görev gerçekten bir API'ye gitti, gerçekten token saydı, gerçekten
> karar yazdı ve bunlar logda görülebiliyor.**
