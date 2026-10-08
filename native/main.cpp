// MineClone.exe — tek dosya Windows başlatıcısı.
// Gövdesinde gömülü oyun dosyalarını %LOCALAPPDATA%\MineClone altına çıkarır,
// WebView2 (Windows'ta kurulu Chromium motoru) içinde oyunu açar.
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <objbase.h>
#include <shlobj.h>
#include <stdio.h>
#include <WebView2.h>
#include "embedded.h"

// IID'ler normalde WebView2LoaderStatic.lib'ten gelir; dinamik yükleme
// kullandığımız için GUID'leri kendimiz tanımlıyoruz.
static const GUID G_IID_WebView2_3 =
    {0xA0D6DF20,0x3B92,0x416D,{0xAA,0x0C,0x43,0x7A,0x9C,0x72,0x78,0x57}};
static const GUID G_IID_EnvDone =
    {0x4e8a3389,0xc9d8,0x4bd2,{0xb6,0xb5,0x12,0x4f,0xee,0x6c,0xc1,0x4d}};
static const GUID G_IID_CtrlDone =
    {0x6c4819f3,0xc9b7,0x4260,{0x81,0x27,0xc9,0xf5,0xbd,0xe7,0xf6,0x8c}};

static HWND g_hwnd = nullptr;
static ICoreWebView2Controller* g_ctrl = nullptr;
static wchar_t g_wwwdir[MAX_PATH];
static wchar_t g_appdir[MAX_PATH];

// ---- COM handler tabanı ----
template<typename T>
struct RefCounted : T {
    ULONG refs = 1;
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (IsEqualIID(riid, IID_IUnknown)) { *ppv = this; AddRef(); return S_OK; }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs; }
    ULONG STDMETHODCALLTYPE Release() override { return --refs; }
};

struct CtrlDone : RefCounted<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler> {
    HRESULT STDMETHODCALLTYPE Invoke(HRESULT res, ICoreWebView2Controller* ctrl) override {
        if (FAILED(res) || !ctrl) return res;
        g_ctrl = ctrl; ctrl->AddRef();
        ICoreWebView2* wv = nullptr;
        ctrl->get_CoreWebView2(&wv);
        RECT rc; GetClientRect(g_hwnd, &rc);
        ctrl->put_Bounds(rc);
        ctrl->put_IsVisible(TRUE);
        if (wv) {
            // localStorage'ın düzgün çalışması için yerel klasörü sanal host'a bağla
            ICoreWebView2_3* wv3 = nullptr;
            if (SUCCEEDED(wv->QueryInterface(G_IID_WebView2_3, (void**)&wv3)) && wv3) {
                wv3->SetVirtualHostNameToFolderMapping(
                    L"mineclone.app", g_wwwdir, COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                wv3->Release();
                wv->Navigate(L"https://mineclone.app/index.html");
            } else {
                wchar_t url[MAX_PATH + 16];
                swprintf(url, L"file:///%ls/index.html", g_wwwdir);
                for (wchar_t* p = url; *p; p++) if (*p == L'\\') *p = L'/';
                wv->Navigate(url);
            }
            wv->Release();
        }
        return S_OK;
    }
};

struct EnvDone : RefCounted<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler> {
    HRESULT STDMETHODCALLTYPE Invoke(HRESULT res, ICoreWebView2Environment* env) override {
        if (FAILED(res) || !env) {
            MessageBoxW(g_hwnd,
                L"WebView2 Runtime bulunamadı.\n\n"
                L"Microsoft Edge WebView2 Runtime'i kurmalısın:\n"
                L"https://developer.microsoft.com/microsoft-edge/webview2",
                L"MineClone", MB_ICONERROR | MB_OK);
            PostQuitMessage(1);
            return res;
        }
        env->CreateCoreWebView2Controller(g_hwnd, new CtrlDone());
        return S_OK;
    }
};

// ---- dosya çıkarma ----
static bool extractAll() {
    CreateDirectoryW(g_appdir, nullptr);
    CreateDirectoryW(g_wwwdir, nullptr);
    for (int i = 0; i < EMBEDDED_COUNT; i++) {
        const EmbeddedFile& f = EMBEDDED_FILES[i];
        wchar_t path[MAX_PATH];
        bool isLoader = (strcmp(f.name, "WebView2Loader.dll") == 0);
        swprintf(path, L"%ls\\%hs", isLoader ? g_appdir : g_wwwdir, f.name);
        HANDLE h = CreateFileW(path, GENERIC_WRITE, 0, nullptr,
                               CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (h == INVALID_HANDLE_VALUE) return false;
        DWORD w = 0; WriteFile(h, f.data, f.size, &w, nullptr); CloseHandle(h);
        if (w != f.size) return false;
    }
    return true;
}

static LRESULT CALLBACK WndProc(HWND h, UINT msg, WPARAM w, LPARAM l) {
    switch (msg) {
    case WM_SIZE:
        if (g_ctrl) { RECT rc; GetClientRect(h, &rc); g_ctrl->put_Bounds(rc); }
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0); return 0;
    }
    return DefWindowProcW(h, msg, w, l);
}

typedef HRESULT (STDAPICALLTYPE* CreateEnvFn)(
    PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions*,
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*);

int WINAPI WinMain(HINSTANCE inst, HINSTANCE, LPSTR, int show) {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);

    wchar_t base[MAX_PATH];
    if (!GetEnvironmentVariableW(L"LOCALAPPDATA", base, MAX_PATH))
        lstrcpyW(base, L".");
    swprintf(g_appdir, L"%ls\\MineClone", base);
    swprintf(g_wwwdir, L"%ls\\www", g_appdir);
    if (!extractAll()) {
        MessageBoxW(nullptr, L"Oyun dosyaları çıkarılamadı.", L"MineClone", MB_ICONERROR);
        return 1;
    }

    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc); wc.lpfnWndProc = WndProc; wc.hInstance = inst;
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = L"MineCloneWnd";
    RegisterClassExW(&wc);
    g_hwnd = CreateWindowExW(0, wc.lpszClassName, L"MineClone",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE, CW_USEDEFAULT, CW_USEDEFAULT,
        1280, 800, nullptr, nullptr, inst, nullptr);
    ShowWindow(g_hwnd, show);

    wchar_t loader[MAX_PATH];
    swprintf(loader, L"%ls\\WebView2Loader.dll", g_appdir);
    HMODULE mod = LoadLibraryW(loader);
    if (!mod) mod = LoadLibraryW(L"WebView2Loader.dll"); // exe yanında da olabilir
    CreateEnvFn fn = mod ? (CreateEnvFn)GetProcAddress(
        mod, "CreateCoreWebView2EnvironmentWithOptions") : nullptr;
    if (!fn) {
        MessageBoxW(g_hwnd, L"WebView2Loader.dll yüklenemedi.", L"MineClone", MB_ICONERROR);
        return 1;
    }
    // userDataFolder = %LOCALAPPDATA%\MineClone\udata → kayıtlar kalıcı
    wchar_t udata[MAX_PATH];
    swprintf(udata, L"%ls\\udata", g_appdir);
    HRESULT r = fn(nullptr, udata, nullptr, new EnvDone());
    if (FAILED(r)) {
        MessageBoxW(g_hwnd, L"WebView2 başlatılamadı.", L"MineClone", MB_ICONERROR);
        return 1;
    }

    MSG m;
    while (GetMessageW(&m, nullptr, 0, 0)) { TranslateMessage(&m); DispatchMessageW(&m); }
    return 0;
}
