#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0600
#endif
#ifndef SHGFI_JUMBOICON
#define SHGFI_JUMBOICON 0x00040000
#endif
// node-gyp defines NOMINMAX by default; the old Windows SDK (10.0.16299)
// GDI+ headers require the min/max macros, so restore them before windows.h.
// NOTE: never use bare min()/max() in this file afterwards (use explicit comparisons).
#ifdef NOMINMAX
#undef NOMINMAX
#endif
#include <napi.h>
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <gdiplus.h>
#include <vector>
#include <string>
#include <algorithm>

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "gdiplus.lib")

using namespace Gdiplus;

class MemoryStream : public IStream {
private:
    std::vector<BYTE> data;
    ULONG refCount;
    ULONG position;
public:
    MemoryStream() : refCount(1), position(0) {}
    const std::vector<BYTE>& getData() const { return data; }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppvObject) override {
        if (riid == IID_IUnknown || riid == IID_ISequentialStream || riid == IID_IStream) { *ppvObject = static_cast<IStream*>(this); AddRef(); return S_OK; }
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refCount; }
    ULONG STDMETHODCALLTYPE Release() override { ULONG c = --refCount; if (c == 0) delete this; return c; }
    HRESULT STDMETHODCALLTYPE Read(void* pv, ULONG cb, ULONG* pcbRead) override {
        if (pcbRead) *pcbRead = 0;
        if (position >= data.size()) return S_FALSE;
        ULONG t = (cb < (ULONG)(data.size() - position)) ? cb : (ULONG)(data.size() - position);
        memcpy(pv, data.data() + position, t); position += t;
        if (pcbRead) *pcbRead = t; return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Write(const void* pv, ULONG cb, ULONG* pcbWritten) override {
        const BYTE* s = static_cast<const BYTE*>(pv);
        data.insert(data.end(), s, s + cb); position += cb;
        if (pcbWritten) *pcbWritten = cb; return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Seek(LARGE_INTEGER d, DWORD o, ULARGE_INTEGER* p) override {
        LARGE_INTEGER n;
        if (o == STREAM_SEEK_SET) n.QuadPart = d.QuadPart;
        else if (o == STREAM_SEEK_CUR) n.QuadPart = position + d.QuadPart;
        else if (o == STREAM_SEEK_END) n.QuadPart = (LONGLONG)data.size() + d.QuadPart;
        else return STG_E_INVALIDFUNCTION;
        if (n.QuadPart < 0) return STG_E_INVALIDFUNCTION;
        position = (ULONG)n.QuadPart;
        if (p) p->QuadPart = position; return S_OK;
    }
    HRESULT STDMETHODCALLTYPE SetSize(ULARGE_INTEGER l) override { data.resize((size_t)l.QuadPart); return S_OK; }
    HRESULT STDMETHODCALLTYPE CopyTo(IStream*, ULARGE_INTEGER, ULARGE_INTEGER*, ULARGE_INTEGER*) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE Commit(DWORD) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE Revert(void) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE LockRegion(ULARGE_INTEGER, ULARGE_INTEGER, DWORD) override { return STG_E_INVALIDFUNCTION; }
    HRESULT STDMETHODCALLTYPE UnlockRegion(ULARGE_INTEGER, ULARGE_INTEGER, DWORD) override { return STG_E_INVALIDFUNCTION; }
    HRESULT STDMETHODCALLTYPE Stat(STATSTG* s, DWORD) override { if (!s) return STG_E_INVALIDPOINTER; memset(s, 0, sizeof(STATSTG)); s->cbSize.QuadPart = data.size(); s->type = STGTY_STREAM; return S_OK; }
    HRESULT STDMETHODCALLTYPE Clone(IStream**) override { return E_NOTIMPL; }
};

static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
std::string b64enc(const unsigned char* in, size_t len) {
    std::string r; int i = 0, j = 0;
    unsigned char a3[3], a4[4];
    while (len--) { a3[i++] = *(in++); if (i == 3) { a4[0]=(a3[0]&0xfc)>>2; a4[1]=((a3[0]&3)<<4)+((a3[1]&0xf0)>>4); a4[2]=((a3[1]&0xf)<<2)+((a3[2]&0xc0)>>6); a4[3]=a3[2]&0x3f; for(i=0;i<4;i++) r+=b64[a4[i]]; i=0; } }
    if (i) { for(j=i;j<3;j++) a3[j]=0; a4[0]=(a3[0]&0xfc)>>2; a4[1]=((a3[0]&3)<<4)+((a3[1]&0xf0)>>4); a4[2]=((a3[1]&0xf)<<2)+((a3[2]&0xc0)>>6); for(j=0;j<i+1;j++) r+=b64[a4[j]]; while(i++<3) r+='='; }
    return r;
}

static ULONG_PTR gdiToken = 0;
static bool gdiInit = false;
void ensureGDI() { if (!gdiInit) { GdiplusStartupInput si; GdiplusStartup(&gdiToken, &si, NULL); gdiInit = true; } }

std::string iconToPng(HICON hIcon) {
    if (!hIcon) return "";
    
    ICONINFOEXW ii;
    ii.cbSize = sizeof(ICONINFOEXW);
    if (!GetIconInfoExW(hIcon, &ii)) { 
        DestroyIcon(hIcon); 
        return ""; 
    }
    
    int w = 32, h = 32;
    
    if (ii.hbmColor) {
        BITMAP bm;
        if (GetObject(ii.hbmColor, sizeof(BITMAP), &bm)) {
            w = bm.bmWidth;
            h = ii.hbmMask ? bm.bmHeight / 2 : bm.bmHeight;
        }
    }
    if (w == 0 && ii.hbmMask) {
        BITMAP bm;
        if (GetObject(ii.hbmMask, sizeof(BITMAP), &bm)) {
            w = bm.bmWidth;
            h = bm.bmHeight / 2;
        }
    }
    if (w == 0) { DestroyIcon(hIcon); return ""; }
    
    int size = (w > h) ? w : h;
    w = size;
    h = size;
    
    Bitmap* bmp = new Bitmap(w, h, PixelFormat32bppARGB);
    if (!bmp || bmp->GetLastStatus() != Ok) { if (bmp) delete bmp; DestroyIcon(hIcon); return ""; }
    
    Graphics* graphics = Graphics::FromImage(bmp);
    if (!graphics || graphics->GetLastStatus() != Ok) { 
        if (graphics) delete graphics; 
        delete bmp; 
        DestroyIcon(hIcon); 
        return ""; 
    }
    
    graphics->Clear(Color(0, 0, 0, 0));
    graphics->SetInterpolationMode(InterpolationModeHighQualityBicubic);
    graphics->SetSmoothingMode(SmoothingModeHighQuality);
    
    HDC hdc = graphics->GetHDC();
    DrawIconEx(hdc, 0, 0, hIcon, w, h, 0, NULL, DI_NORMAL);
    graphics->ReleaseHDC(hdc);
    
    delete graphics;
    DestroyIcon(hIcon);
    
    CLSID pngClsid;
    UINT num = 0, sz = 0;
    GetImageEncodersSize(&num, &sz);
    if (sz == 0) { delete bmp; return ""; }
    ImageCodecInfo* ici = (ImageCodecInfo*)malloc(sz);
    if (!ici) { delete bmp; return ""; }
    GetImageEncoders(num, sz, ici);
    bool found = false;
    for (UINT j = 0; j < num; j++) {
        if (wcscmp(ici[j].MimeType, L"image/png") == 0) { pngClsid = ici[j].Clsid; found = true; break; }
    }
    free(ici);
    if (!found) { delete bmp; return ""; }
    
    MemoryStream* ms = new MemoryStream();
    Status st = bmp->Save(ms, &pngClsid, NULL);
    delete bmp;
    if (st != Ok) { delete ms; return ""; }
    
    const std::vector<BYTE>& d = ms->getData();
    std::string r = b64enc(d.data(), d.size());
    delete ms;
    return r;
}

HICON GetIconForPath(LPCWSTR path, bool isClsid) {
    SHFILEINFOW shfi;
    ZeroMemory(&shfi, sizeof(shfi));
    UINT flags = SHGFI_ICON | SHGFI_JUMBOICON;
    
    if (isClsid) {
        // System virtual folder: resolve to PIDL via SHParseDisplayName first.
        // Passing `::{CLSID}` string directly makes SHGetFileInfo fall back to generic folder icon
        LPITEMIDLIST pidl = nullptr;
        SFGAOF attrs = 0;
        if (SUCCEEDED(SHParseDisplayName(path, nullptr, &pidl, 0, &attrs)) && pidl) {
            ZeroMemory(&shfi, sizeof(shfi));
            if (SHGetFileInfoW((LPCWSTR)pidl, 0, &shfi, sizeof(shfi), flags | SHGFI_PIDL)) {
                return shfi.hIcon;
            }
            ZeroMemory(&shfi, sizeof(shfi));
            if (SHGetFileInfoW((LPCWSTR)pidl, 0, &shfi, sizeof(shfi), SHGFI_ICON | SHGFI_PIDL)) {
                return shfi.hIcon;
            }
        }
        // Fallback: extract directly from the string
        ZeroMemory(&shfi, sizeof(shfi));
        if (SHGetFileInfoW(path, 0, &shfi, sizeof(shfi), flags) == 0) {
            if (SHGetFileInfoW(path, FILE_ATTRIBUTE_DIRECTORY, &shfi, sizeof(shfi), flags | SHGFI_USEFILEATTRIBUTES) == 0) {
                return nullptr;
            }
        }
        return shfi.hIcon;
    } else {
        if (SHGetFileInfoW(path, 0, &shfi, sizeof(shfi), flags) == 0) {
            DWORD a = GetFileAttributesW(path);
            DWORD attr = (a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY)) ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_NORMAL;
            if (SHGetFileInfoW(path, attr, &shfi, sizeof(shfi), flags | SHGFI_USEFILEATTRIBUTES) == 0) {
                return nullptr;
            }
        }
    }
    return shfi.hIcon;
}

Napi::Value ExtractIcon(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "File path required").ThrowAsJavaScriptException();
        return Napi::String::New(env, "");
    }
    ensureGDI();
    
    std::string u8 = info[0].As<Napi::String>().Utf8Value();
    int wl = MultiByteToWideChar(CP_UTF8, 0, u8.c_str(), -1, NULL, 0);
    std::vector<wchar_t> wb(wl);
    MultiByteToWideChar(CP_UTF8, 0, u8.c_str(), -1, wb.data(), wl);
    std::wstring wp(wb.data());
    
    bool isClsid = (wp.size() >= 2 && wp[0] == L':' && wp[1] == L':');
    HICON hIcon = GetIconForPath(wp.c_str(), isClsid);
    if (!hIcon) {
        return Napi::String::New(env, "");
    }
    
    std::string b64 = iconToPng(hIcon);
    if (b64.empty()) {
        return Napi::String::New(env, "");
    }
    
    return Napi::String::New(env, ("data:image/png;base64," + b64).c_str());
}

Napi::Value ExtractIconsBatch(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "Array of file paths required").ThrowAsJavaScriptException();
        return result;
    }
    ensureGDI();
    
    Napi::Array paths = info[0].As<Napi::Array>();
    uint32_t len = paths.Length();
    
    for (uint32_t i = 0; i < len; i++) {
        Napi::Value val = paths.Get(i);
        if (!val.IsString()) continue;
        
        std::string u8 = val.As<Napi::String>().Utf8Value();
        int wl = MultiByteToWideChar(CP_UTF8, 0, u8.c_str(), -1, NULL, 0);
        std::vector<wchar_t> wb(wl);
        MultiByteToWideChar(CP_UTF8, 0, u8.c_str(), -1, wb.data(), wl);
        std::wstring wp(wb.data());
        
        bool isClsid = (wp.size() >= 2 && wp[0] == L':' && wp[1] == L':');
        HICON hIcon = GetIconForPath(wp.c_str(), isClsid);
        
        if (hIcon) {
            std::string b64 = iconToPng(hIcon);
            if (!b64.empty()) {
                result.Set(val, Napi::String::New(env, ("data:image/png;base64," + b64).c_str()));
            } else {
                result.Set(val, Napi::String::New(env, ""));
            }
        } else {
            result.Set(val, Napi::String::New(env, ""));
        }
    }
    
    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("extractIcon", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value { return ExtractIcon(info); }));
    exports.Set("extractIconsBatch", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value { return ExtractIconsBatch(info); }));
    return exports;
}

NODE_API_MODULE(icon_extractor, Init)