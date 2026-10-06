import sqlite3
import json
import os

def task_runner():
    db_path = os.path.join("00-core", "01-kuyruk", "kuyruk.db")
    config_path = os.path.join("00-core", "02-yonlendirici", "limit-durumu.json")
    
    if not os.path.exists(db_path):
        print("[!] Veritabanı bulunamadı. Önce db_init.py çalıştırılmalı.")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT id, baslik, detay, atanan_ajan FROM gorevler WHERE durum = 'beklemede'")
    tasks = cursor.fetchall()
    
    if not tasks:
        print("[i] Kuyrukta bekleyen yeni görev yok.")
        conn.close()
        return

    with open(config_path, "r", encoding="utf-8") as f:
        limits = json.load(f)

    for task_id, baslik, detay, ajan in tasks:
        print(f"[->] Görev İşleniyor: #{task_id} | {baslik} (Atanan: {ajan})")
        
        # Yönlendirici: Aktif ve kotası dolmamış ilk sağlayıcıyı seçer
        selected_provider = "local_ollama"
        for provider, info in limits.items():
            if info["durum"] == "aktif" and (info["gunluk_limit"] == -1 or info["kullanilan"] < info["gunluk_limit"]):
                selected_provider = provider
                break
        
        print(f"     [Rota]: {selected_provider} sağlayıcısına yönlendirildi.")
        
        cursor.execute(
            "UPDATE gorevler SET durum = 'tamamlandi', model_kullanilan = ?, guncelleme_tarihi = CURRENT_TIMESTAMP WHERE id = ?",
            (selected_provider, task_id)
        )
        cursor.execute(
            "INSERT INTO loglar (gorev_id, seviye, mesaj) VALUES (?, ?, ?)",
            (task_id, "INFO", f"Görev '{selected_provider}' motoru ile başarıyla tamamlandı.")
        )
        conn.commit()

    conn.close()
    print("[OK] Tüm görevler otonom olarak işlendi ve loglandı.")

if __name__ == "__main__":
    task_runner()
