"""
GERCEK SAGLAYICI ISTEMCILERI.

V2'deki router.py bulut yolunda HICBIR HTTP ISATEGI ATMIYORDU:

    return True, f"[{provider}] Basariyla islendi: {prompt[:50]}...", provider

Yani "Cloud First" ilkesi kodda UYGULANMAMISti; sistem her zaman
yerel modele duserdi.

Bu modul o boslugu doldurur. Her istemci:
  1. Kendi uc noktasina gider
  2. Kendi auth basligini kullanir
  3. GERCEK usage (token) sayacini dondurur
  4. HTTP 429'yi OZEL hata olarak yukseltir (devre kesici yakalasin)
  5. Kalici hatayi gecici hata ile KARIŞTIRMAZ
"""

import json
import os
import urllib.error
import urllib.request


class IstemciSonuc:
    """Bir cagrinin gercek sonucu."""

    def __init__(self, basarili, metin, saglayici, model,
                 token_girdi=0, token_cikti=0, maliyet_birim=0.0,
                 sure_sn=0.0):
        self.basarili = basarili
        self.metin = metin
        self.saglayici = saglayici
        self.model = model
        self.token_girdi = token_girdi
        self.token_cikti = token_cikti
        self.maliyet_birim = maliyet_birim
        self.sure_sn = sure_sn

    def temsili(self, n=200):
        t = (self.metin or "").replace("\n", " ")
        return t[:n] + ("..." if len(t) > n else "")

    def __repr__(self):
        return (f"<Sonuc {self.saglayici}/{self.model} "
                f"girdi={self.token_girdi} cikti={self.token_cikti} "
                f"{self.sure_sn:.1f}s>")


def _http_json(url, payload=None, headers=None, timeout=60, method="POST"):
    """Ortak HTTP katmani. HTTP kodunu hata turune CEVIRIR."""
    from .hata import (KotaHatasi, GeciciHata, KaliciHata, SaglayiciHatasi)

    veri = json.dumps(payload).encode("utf-8") if payload is not None else None
    hdr = {"Content-Type": "application/json", **(headers or {})}
    istek = urllib.request.Request(url, data=veri, headers=hdr, method=method)

    try:
        with urllib.request.urlopen(istek, timeout=timeout) as yanit:
            govde = yanit.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detay = ""
        try:
            detay = e.read().decode("utf-8")[:400]
        except Exception:
            pass
        # TAKSONOMI: 4xx kalici, 429 gecici-kota, 5xx gecici
        if e.code == 429:
            raise KotaHatasi(f"429 kota asimi: {detay}")
        if e.code in (401, 403):
            raise KaliciHata(f"{e.code} anahtar/yetki hatasi: {detay}")
        if e.code == 404:
            raise KaliciHata(
                f"404 bulunamadi — model adi yanlis olabilir: {detay}")
        if e.code >= 500:
            raise GeciciHata(f"{e.code} saglayici hatasi: {detay}")
        raise SaglayiciHatasi(f"HTTP {e.code}: {detay}")
    except urllib.error.URLError as e:
        raise GeciciHata(f"Baglanti hatasi: {e.reason}")
    except TimeoutError:
        raise GeciciHata(f"Zaman asimi ({timeout}s)")
    except json.JSONDecodeError:
        raise GeciciHata("Gecersiz JSON yaniti")

    try:
        return json.loads(govde)
    except json.JSONDecodeError:
        raise GeciciHata("Gecersiz JSON yaniti")


# --------------------------------------------------------------- OpenRouter
class OpenRouter:
    UCM = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(self, model):
        self.model = model
        self.saglayici = "openrouter"

    def cagir(self, sistem, mesaj, max_token=2000):
        from .hata import AnahtarYok
        import time
        anahtar = os.getenv("OPENROUTER_API_KEY")
        if not anahtar:
            raise AnahtarYok("OPENROUTER_API_KEY tanimli degil")

        bas = time.time()
        veri = _http_json(self.UCM, {
            "model": self.model,
            "messages": [{"role": "system", "content": sistem},
                         {"role": "user", "content": mesaj}],
            "max_tokens": max_token,
        }, {"Authorization": f"Bearer {anahtar}"})

        try:
            metin = veri["choices"][0]["message"]["content"]
        except (KeyError, IndexError):
            raise GeciciHataGuvenli("OpenRouter yanit formati beklenmedik")

        u = veri.get("usage") or {}
        g = int(u.get("prompt_tokens") or 0)
        c = int(u.get("completion_tokens") or 0)
        return IstemciSonuc(
            True, metin, self.saglayici, self.model, g, c,
            maliyet_birim=g * 0.1 + c * 1.0,
            sure_sn=time.time() - bas,
        )


def GeciciHataGuvenli(mesaj):
    from .hata import GeciciHata
    return GeciciHata(mesaj)


# ------------------------------------------------------------------- Gemini
class Gemini:
    UCM = ("https://generativelanguage.googleapis.com/v1beta/models/"
           "{model}:generateContent")

    def __init__(self, model):
        self.model = model
        self.saglayici = "gemini"

    def cagir(self, sistem, mesaj, max_token=2000):
        from .hata import AnahtarYok, GeciciHata
        import time
        anahtar = os.getenv("GEMINI_API_KEY")
        if not anahtar:
            raise AnahtarYok("GEMINI_API_KEY tanimli degil")

        bas = time.time()
        veri = _http_json(
            self.UCM.format(model=self.model),
            {"systemInstruction": {"parts": [{"text": sistem}]},
             "contents": [{"role": "user", "parts": [{"text": mesaj}]}],
             "generationConfig": {"maxOutputTokens": max_token}},
            {"x-goog-api-key": anahtar})

        try:
            metin = veri["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            raise GeciciHata("Gemini yanit formati beklenmedik")

        u = veri.get("usageMetadata") or {}
        g = int(u.get("promptTokenCount") or 0)
        c = int(u.get("candidatesTokenCount") or 0)
        return IstemciSonuc(True, metin, self.saglayici, self.model, g, c,
                            maliyet_birim=g * 0.1 + c * 1.0,
                            sure_sn=time.time() - bas)


# --------------------------------------------------------------------- Groq
class Groq:
    UCM = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, model):
        self.model = model
        self.saglayici = "groq"

    def cagir(self, sistem, mesaj, max_token=2000):
        from .hata import AnahtarYok, GeciciHata
        import time
        anahtar = os.getenv("GROQ_API_KEY")
        if not anahtar:
            raise AnahtarYok("GROQ_API_KEY tanimli degil")

        bas = time.time()
        veri = _http_json(self.UCM, {
            "model": self.model,
            "messages": [{"role": "system", "content": sistem},
                         {"role": "user", "content": mesaj}],
            "max_tokens": max_token,
        }, {"Authorization": f"Bearer {anahtar}"})

        try:
            metin = veri["choices"][0]["message"]["content"]
        except (KeyError, IndexError):
            raise GeciciHata("Groq yanit formati beklenmedik")

        u = veri.get("usage") or {}
        return IstemciSonuc(
            True, metin, self.saglayici, self.model,
            int(u.get("prompt_tokens") or 0),
            int(u.get("completion_tokens") or 0),
            sure_sn=time.time() - bas,
        )


# ------------------------------------------------------------ Local Ollama
class Ollama:
    """Yerel model. MALIYETI SIFIR — API fiyati uygulanmaz."""

    def __init__(self, model, ucm="http://localhost:11434"):
        self.model = model
        self.ucm = ucm.rstrip("/")
        self.saglayici = "local_ollama"

    def saglikli_mi(self, timeout=5):
        try:
            _http_json(f"{self.ucm}/api/tags", None, {}, timeout, "GET")
            return True
        except Exception:
            return False

    def yuklu_modeller(self):
        try:
            v = _http_json(f"{self.ucm}/api/tags", None, {}, 5, "GET")
            return [m.get("name") for m in v.get("models", [])]
        except Exception:
            return []

    def cagir(self, sistem, mesaj, max_token=2000):
        from .hata import GeciciHata, KaliciHata
        import time
        bas = time.time()
        veri = _http_json(f"{self.ucm}/api/chat", {
            "model": self.model,
            "messages": [{"role": "system", "content": sistem},
                         {"role": "user", "content": mesaj}],
            "stream": False,
            "options": {"num_predict": max_token},
        }, timeout=180)

        try:
            metin = veri["message"]["content"]
        except (KeyError, TypeError):
            raise GeciciHata("Ollama yanit formati beklenmedik")

        g = int(veri.get("prompt_eval_count") or 0)
        c = int(veri.get("eval_count") or 0)
        return IstemciSonuc(True, metin, self.saglayici, self.model,
                            g, c, maliyet_birim=0.0,
                            sure_sn=time.time() - bas)


ISTEMCILER = {
    "openrouter": OpenRouter,
    "gemini": Gemini,
    "groq": Groq,
    "local_ollama": Ollama,
}
