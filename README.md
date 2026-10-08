# MineClone — HTML5 Minecraft Klonu

Tamamen tarayıcıda çalışan, Three.js tabanlı voxel oyun motoru. Harici bağımlılık yok
(`three.min.js` repoya dahil) — `index.html`'i açman yeterli.

## Çalıştırma

```bash
# doğrudan aç
open index.html          # veya dosyaya çift tıkla

# veya yerel sunucuyla
python3 -m http.server 8080   # → http://localhost:8080
```

## Özellikler

- **Sonsuz prosedürel dünya** — chunk tabanlı akış (16×16×64), Perlin noise ile
  tepeler, dağlar, **mağaralar**, göller/okyanuslar
- **Biyomlar** — ova, çöl (kaktüslü), karlı zirveler, kumsallar
- **26 blok türü** — prosedürel piksel-art doku atlası (kod üretimi, görsel dosya yok)
- **Ambient occlusion** — vertex bazlı yumuşak gölgelendirme (0fps algoritması)
- **Madencilik** — kömür, demir, altın, elmas cevherleri derinlikte
- **TNT** — sol tıkla ateşle, zincirleme patlama, krater, geri tepme
- **Steve kolu** — birinci şahıs el: tutulan bloğu gösterir, yürürken sallanır,
  vururken/kırarken sallanma animasyonu
- **Domuz mobları** — gezinen, fizikli, animasyonlu yaratıklar; sol tıkla vur
  (hasar + kırmızı yanıp sönme + geri tepme + panik kaçışı + ölüm parçacıkları)
- **Gündüz/gece döngüsü** — güneş/ay/yıldızlar, alacakaranlık renkleri, bulutlar
- **Su & yüzme** — yarı saydam su, sualtı sisi, lav blokları
- **Partiküller**, WebAudio ile sentezlenmiş sesler (dosya yok, tamamı kod)
- **Kalıcı kayıt** — localStorage'a otomatik kayıt + "Kayıtlı Dünyayı Yükle"
- F3 debug paneli, uçuş modu, seed ile dünya üretimi, ayarlanabilir görüş mesafesi

## Kontroller

| Tuş | İşlev |
|---|---|
| W A S D | Hareket |
| Sol / Sağ / Orta tık | Kır / Koy / Blok seç |
| 1-9, tekerlek | Hotbar |
| Space / Shift | Zıpla-yüz / Koş-alçal |
| F | Uçuş aç/kapa |
| E | Envanter |
| F3 | Debug |
| M | Ses aç/kapa |
| - / + | Görüş mesafesi |
| Esc | Duraklat |
