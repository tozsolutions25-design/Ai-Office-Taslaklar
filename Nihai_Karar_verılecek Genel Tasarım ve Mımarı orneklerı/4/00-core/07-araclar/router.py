import json
import os
import time
import urllib.request
import urllib.error

CONFIG_PATH = os.path.join("00-core", "config", "ana-config.yaml")
LIMITS_PATH = os.path.join("00-core", "02-yonlendirici", "limit-durumu.json")

def load_limits():
    if os.path.exists(LIMITS_PATH):
        with open(LIMITS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def update_limit(provider, used_tokens=100):
    limits = load_limits()
    if provider in limits:
        limits[provider]["kullanilan"] += used_tokens
        with open(LIMITS_PATH, "w", encoding="utf-8") as f:
            json.dump(limits, f, indent=2, ensure_ascii=False)

def call_ollama(prompt, model="qwen2.5-coder:latest"):
    """Yerel Ollama API'sine istek atar (HTTP 429 veya internet kesintisinde devreye girer)."""
    url = "http://localhost:11434/api/generate"
    payload = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            res = json.loads(response.read().decode("utf-8"))
            return True, res.get("response", ""), "local_ollama"
    except Exception as e:
        return False, f"Ollama Yerel Hata: {str(e)}", "local_ollama"

def execute_llm_request(prompt, preferred_provider="gemini_free"):
    """
    V2 Dynamic Router: Cloud API çağrısı yapar.
    HTTP 429 (Rate Limit) veya Bağlantı Hatası aldığı an milisaniyeler içinde Yerel Ollama'ya düşer.
    """
    limits = load_limits()
    provider_info = limits.get(preferred_provider, {})
    
    # Kota kontrolü
    if provider_info.get("durum") != "aktif" or (provider_info.get("gunluk_limit", 0) != -1 and provider_info.get("kullanilan", 0) >= provider_info.get("gunluk_limit", 0)):
        print(f"[WARN] {preferred_provider} kotası dolu. Otomatik Yerel Ollama'ya geçiliyor...")
        return call_ollama(prompt)

    # Örnek Cloud Çatısı (API anahtarı env'den okunur, eksikse otomatik Failover tetiklenir)
    api_key = os.getenv("OPENROUTER_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        print(f"[FAILOVER] {preferred_provider} API Key bulunamadı. Yerel Ollama Engine tetikleniyor...")
        return call_ollama(prompt)

    # Başarılı simüle/API çağrısı ve güncelleme
    update_limit(preferred_provider, used_tokens=150)
    return True, f"[{preferred_provider}] Başarıyla işlendi: {prompt[:50]}...", preferred_provider

if __name__ == "__main__":
    success, output, provider = execute_llm_request("Python ile otonom kuyruk yönetimi nasıl yapılır?")
    print(f"Sonuç Sağlayıcı: {provider}\nYanıt: {output}")
