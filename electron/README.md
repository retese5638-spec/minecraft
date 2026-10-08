# Electron paketi

Bu klasor ana dizindeki oyunu masaustu uygulamasina sarar.

## Windows exe paketi olusturma

1. https://github.com/electron/electron/releases adresinden `electron-vXX-win32-x64.zip` indir
2. Zipteki `electron.exe` yi `MineClone.exe` olarak yeniden adlandir
3. `resources/app/` icine bu klasordeki `main.js` + `package.json` ve ana dizindeki `index.html`, `game.js`, `three.min.js` yi kopyala
4. Klasoru zip le -> MineClone-win32-x64.zip
