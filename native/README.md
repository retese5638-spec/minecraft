# MineClone.exe — tek dosya Windows başlatıcısı

Oyunu **Windows'ta zaten kurulu olan WebView2** (Chromium) içinde açar.
Exe ~1.2MB: gövdesinde index.html + game.js + three.min.js + WebView2Loader.dll
gömülüdür; ilk açılışta `%LOCALAPPDATA%\MineClone` altına çıkarır.

## Derleme (Linux'ta Zig ile çapraz derleme)

Gerekli: zig (ziglang.org), WebView2 nuget paketi (include başlıkları + x64 WebView2Loader.dll)

```bash
python3 gen_embed.py        # embedded.cpp + embedded.h üretir (önce dosyaları bu dizine koy)
zig c++ -target x86_64-windows-gnu -O2 -Wl,--subsystem,windows \
    -Istub -I<webview2 include> -o MineClone.exe main.cpp embedded.cpp \
    -lole32 -luser32 -lgdi32 -lshell32 -loleaut32
```
