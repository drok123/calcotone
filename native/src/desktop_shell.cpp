#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <wrl.h>
#include <wrl/event.h>

#include <WebView2.h>

#include "calcotone/desktop_shell.hpp"

#include <atomic>
#include <string>
#include <utility>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace calcotone {
namespace {

constexpr wchar_t kWindowClass[] = L"CalcotoneDesktopShell";

class DesktopShell {
 public:
  explicit DesktopShell(std::wstring faceplate_url)
      : faceplate_url_(std::move(faceplate_url)) {}

  int run(std::string& error) {
    const HRESULT apartment = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(apartment)) {
      error = "Could not initialize the desktop UI apartment.";
      return -1;
    }

    WNDCLASSEXW window_class{};
    window_class.cbSize = sizeof(window_class);
    window_class.style = CS_HREDRAW | CS_VREDRAW;
    window_class.lpfnWndProc = &DesktopShell::window_proc;
    window_class.hInstance = GetModuleHandleW(nullptr);
    window_class.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
    window_class.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    window_class.lpszClassName = kWindowClass;
    RegisterClassExW(&window_class);

    hwnd_ = CreateWindowExW(
        0, kWindowClass, L"CALCOTONE", WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 1500, 940, nullptr, nullptr,
        GetModuleHandleW(nullptr), this);
    if (!hwnd_) {
      error = "Could not create the CALCOTONE desktop window.";
      CoUninitialize();
      return -1;
    }

    ShowWindow(hwnd_, SW_SHOWDEFAULT);
    UpdateWindow(hwnd_);
    begin_webview();

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }

    controller_.Reset();
    webview_.Reset();
    CoUninitialize();
    error = std::move(error_);
    return failed_.load(std::memory_order_acquire) ? -1 : 0;
  }

 private:
  static LRESULT CALLBACK window_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
    DesktopShell* shell = reinterpret_cast<DesktopShell*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
      const auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
      shell = static_cast<DesktopShell*>(create->lpCreateParams);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(shell));
    }
    if (!shell) return DefWindowProcW(hwnd, message, wparam, lparam);
    switch (message) {
      case WM_SIZE:
        shell->resize();
        return 0;
      case WM_CLOSE:
        DestroyWindow(hwnd);
        return 0;
      case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
      default:
        return DefWindowProcW(hwnd, message, wparam, lparam);
    }
  }

  void fail(std::string message) {
    error_ = std::move(message);
    failed_.store(true, std::memory_order_release);
    MessageBoxA(
        hwnd_,
        (error_ + "\n\nInstall or repair the Microsoft Edge WebView2 Runtime, then restart CALCOTONE.").c_str(),
        "CALCOTONE desktop shell", MB_OK | MB_ICONERROR);
    DestroyWindow(hwnd_);
  }

  void begin_webview() {
    const HRESULT started = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, nullptr, nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
              if (FAILED(result) || !environment) {
                fail("The WebView2 Runtime is unavailable.");
                return S_OK;
              }
              const HRESULT creating = environment->CreateCoreWebView2Controller(
                  hwnd_,
                  Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                      [this](HRESULT controller_result, ICoreWebView2Controller* controller) -> HRESULT {
                        if (FAILED(controller_result) || !controller) {
                          fail("The embedded faceplate could not be created.");
                          return S_OK;
                        }
                        controller_ = controller;
                        if (FAILED(controller_->get_CoreWebView2(&webview_)) || !webview_) {
                          fail("The embedded faceplate did not expose a WebView2 instance.");
                          return S_OK;
                        }
                        ComPtr<ICoreWebView2Settings> settings;
                        if (SUCCEEDED(webview_->get_Settings(&settings)) && settings) {
                          settings->put_IsScriptEnabled(TRUE);
                          settings->put_IsWebMessageEnabled(TRUE);
                          settings->put_AreDefaultScriptDialogsEnabled(TRUE);
                          settings->put_AreDevToolsEnabled(FALSE);
                          settings->put_AreDefaultContextMenusEnabled(FALSE);
                          settings->put_IsStatusBarEnabled(FALSE);
                        }
                        EventRegistrationToken navigation_token{};
                        webview_->add_NavigationStarting(
                            Callback<ICoreWebView2NavigationStartingEventHandler>(
                                [this](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                                  LPWSTR uri = nullptr;
                                  if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
                                    const std::wstring target(uri);
                                    CoTaskMemFree(uri);
                                    if (!target.starts_with(faceplate_url_)) args->put_Cancel(TRUE);
                                  }
                                  return S_OK;
                                }).Get(),
                            &navigation_token);
                        resize();
                        controller_->put_IsVisible(TRUE);
                        const HRESULT navigation = webview_->Navigate(faceplate_url_.c_str());
                        if (FAILED(navigation)) fail("The local CALCOTONE faceplate could not be loaded.");
                        return S_OK;
                      }).Get());
              if (FAILED(creating)) fail("WebView2 refused the CALCOTONE desktop window.");
              return S_OK;
            }).Get());
    if (FAILED(started)) fail("The WebView2 environment could not be started.");
  }

  void resize() {
    if (!controller_ || !hwnd_) return;
    RECT bounds{};
    GetClientRect(hwnd_, &bounds);
    controller_->put_Bounds(bounds);
  }

  std::wstring faceplate_url_;
  HWND hwnd_{};
  ComPtr<ICoreWebView2Controller> controller_;
  ComPtr<ICoreWebView2> webview_;
  std::atomic<bool> failed_{};
  std::string error_;
};

}  // namespace

int run_desktop_shell(const std::wstring& faceplate_url, std::string& error) {
  return DesktopShell(faceplate_url).run(error);
}

}  // namespace calcotone
#endif
