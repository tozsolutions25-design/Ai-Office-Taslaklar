import subprocess
import os
from datetime import datetime

def git_sync():
    print("[OBSIDIAN BEYİN] Git Otomatik Senkronizasyonu Başlatılıyor...")
    try:
        subprocess.run(["git", "add", "."], check=True)
        commit_msg = f"Auto-Sync (Beyin Hafızası Güncellendi): {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        subprocess.run(["git", "commit", "-m", commit_msg], check=True)
        print("[OK] Değişiklikler yerel Git deposuna işlendi.")
    except Exception as e:
        print(f"[!] Git Senkronizasyon Hatası (Henüz Git init yapılmamış olabilir): {e}")

if __name__ == "__main__":
    git_sync()
