#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <wrl.h>
#include <wrl/event.h>

#include <WebView2.h>

#include "calcotone/desktop_shell.hpp"

#include <atomic>
#include <filesystem>
#include <string>
#include <system_error>
#include <utility>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace calcotone {
namespace {

constexpr wchar_t kWindowClass[] = L"CalcotoneDesktopShell";
constexpr wchar_t kFaceplateHost[] = L"app.calcotone";
constexpr wchar_t kFaceplateOrigin[] = L"https://app.calcotone/";
constexpr wchar_t kFaceplateUrl[] = L"https://app.calcotone/index.html?native-shell=1";
constexpr int kInitialClientWidth = 1500;
constexpr int kInitialClientHeight = 940;

std::filesystem::path webview_user_data_folder() {
  std::wstring local_app_data(32'768, L'\0');
  const DWORD size = GetEnvironmentVariableW(
      L"LOCALAPPDATA", local_app_data.data(), static_cast<DWORD>(local_app_data.size()));
  if (size > 0 && size < local_app_data.size()) {
    local_app_data.resize(size);
    return std::filesystem::path(local_app_data) / L"CALCOTONE" / L"WebView2Data";
  }
  return std::filesystem::temp_directory_path() / L"CALCOTONE-WebView2Data";
}

void enable_per_monitor_dpi_awareness() {
  using SetProcessDpiAwarenessContextFn = BOOL(WINAPI*)(DPI_AWARENESS_CONTEXT);
  const HMODULE user32 = GetModuleHandleW(L"user32.dll");
  if (!user32) return;
  const auto set_awareness = reinterpret_cast<SetProcessDpiAwarenessContextFn>(
      GetProcAddress(user32, "SetProcessDpiAwarenessContext"));
  if (set_awareness) {
    set_awareness(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  }
}

RECT window_rect_for_client(HWND hwnd, int client_width, int client_height) {
  RECT rect{0, 0, client_width, client_height};
  const DWORD style = static_cast<DWORD>(GetWindowLongPtrW(hwnd, GWL_STYLE));
  const DWORD ex_style = static_cast<DWORD>(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));

  using AdjustWindowRectExForDpiFn = BOOL(WINAPI*)(LPRECT, DWORD, BOOL, DWORD, UINT);
  const HMODULE user32 = GetModuleHandleW(L"user32.dll");
  const auto adjust_for_dpi = user32
      ? reinterpret_cast<AdjustWindowRectExForDpiFn>(
            GetProcAddress(user32, "AdjustWindowRectExForDpi"))
      : nullptr;
  if (adjust_for_dpi) {
    adjust_for_dpi(&rect, style, FALSE, ex_style, GetDpiForWindow(hwnd));
  } else {
    AdjustWindowRectEx(&rect, style, FALSE, ex_style);
  }
  return rect;
}

class DesktopShell {
 public:
  DesktopShell(
      std::filesystem::path faceplate_root,
      std::filesystem::path webview_runtime_root)
      : faceplate_root_(std::move(faceplate_root)),
        webview_runtime_root_(std::move(webview_runtime_root)),
        user_data_root_(webview_user_data_folder()) {}

  int run(std::string& error) {
    enable_per_monitor_dpi_awareness();

    if (!std::filesystem::is_regular_file(faceplate_root_ / L"index.html")) {
      error = "The packaged faceplate is missing web/index.html.";
      return -1;
    }
    if (!std::filesystem::is_regular_file(webview_runtime_root_ / L"msedgewebview2.exe")) {
      error = "The bundled fixed WebView2 runtime is missing runtime/msedgewebview2.exe.";
      return -1;
    }
    std::error_code directory_error;
    std::filesystem::create_directories(user_data_root_, directory_error);
    if (directory_error) {
      error = "Could not create CALCOTONE's local desktop UI data folder.";
      return -1;
    }

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
        CW_USEDEFAULT, CW_USEDEFAULT, kInitialClientWidth, kInitialClientHeight,
        nullptr, nullptr, GetModuleHandleW(nullptr), this);
    if (!hwnd_) {
      error = "Could not create the CALCOTONE desktop window.";
      CoUninitialize();
      return -1;
    }

    const RECT initial_window = window_rect_for_client(
        hwnd_, kInitialClientWidth, kInitialClientHeight);
    SetWindowPos(
        hwnd_, nullptr, 0, 0,
        initial_window.right - initial_window.left,
        initial_window.bottom - initial_window.top,
        SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);

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
      case WM_DPICHANGED: {
        const auto* suggested = reinterpret_cast<const RECT*>(lparam);
        SetWindowPos(
            hwnd, nullptr,
            suggested->left, suggested->top,
            suggested->right - suggested->left,
            suggested->bottom - suggested->top,
            SWP_NOZORDER | SWP_NOACTIVATE);
        shell->resize();
        return 0;
      }
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
        (error_ + "\n\nRe-extract the complete CALCOTONE package; the faceplate and runtime folders must remain beside the EXE.").c_str(),
        "CALCOTONE desktop shell", MB_OK | MB_ICONERROR);
    DestroyWindow(hwnd_);
  }

  void begin_webview() {
    const std::wstring runtime_path = webview_runtime_root_.wstring();
    const std::wstring user_data_path = user_data_root_.wstring();
    const HRESULT started = CreateCoreWebView2EnvironmentWithOptions(
        runtime_path.c_str(), user_data_path.c_str(), nullptr,
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
                        controller_->put_ZoomFactor(1.0);
                        if (FAILED(controller_->get_CoreWebView2(&webview_)) || !webview_) {
                          fail("The embedded faceplate did not expose a WebView2 instance.");
                          return S_OK;
                        }
                        ComPtr<ICoreWebView2_3> webview3;
                        const std::wstring faceplate_path = faceplate_root_.wstring();
                        if (FAILED(webview_.As(&webview3)) || !webview3 ||
                            FAILED(webview3->SetVirtualHostNameToFolderMapping(
                                kFaceplateHost,
                                faceplate_path.c_str(),
                                COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS))) {
                          fail("The packaged faceplate could not be mounted into the desktop shell.");
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
                        EventRegistrationToken fullscreen_token{};
                        webview_->add_ContainsFullScreenElementChanged(
                            Callback<ICoreWebView2ContainsFullScreenElementChangedEventHandler>(
                                [this](ICoreWebView2* sender, IUnknown*) -> HRESULT {
                                  BOOL contains_fullscreen = FALSE;
                                  if (sender && SUCCEEDED(sender->get_ContainsFullScreenElement(&contains_fullscreen))) {
                                    set_native_fullscreen(contains_fullscreen == TRUE);
                                  }
                                  return S_OK;
                                }).Get(),
                            &fullscreen_token);

                        EventRegistrationToken navigation_token{};
                        webview_->add_NavigationStarting(
                            Callback<ICoreWebView2NavigationStartingEventHandler>(
                                [this](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                                  LPWSTR uri = nullptr;
                                  if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
                                    const std::wstring target(uri);
                                    CoTaskMemFree(uri);
                                    if (!target.starts_with(kFaceplateOrigin)) args->put_Cancel(TRUE);
                                  }
                                  return S_OK;
                                }).Get(),
                            &navigation_token);
                        resize();
                        controller_->put_IsVisible(TRUE);
                        const HRESULT navigation = webview_->Navigate(kFaceplateUrl);
                        if (FAILED(navigation)) fail("The local CALCOTONE faceplate could not be loaded.");
                        return S_OK;
                      }).Get());
              if (FAILED(creating)) fail("WebView2 refused the CALCOTONE desktop window.");
              return S_OK;
            }).Get());
    if (FAILED(started)) fail("The WebView2 environment could not be started.");
  }

  void set_native_fullscreen(bool enabled) {
    if (!hwnd_ || native_fullscreen_ == enabled) return;
    native_fullscreen_ = enabled;

    if (enabled) {
      saved_style_ = static_cast<DWORD>(GetWindowLongPtrW(hwnd_, GWL_STYLE));
      saved_ex_style_ = static_cast<DWORD>(GetWindowLongPtrW(hwnd_, GWL_EXSTYLE));
      GetWindowRect(hwnd_, &saved_window_rect_);

      MONITORINFO monitor_info{};
      monitor_info.cbSize = sizeof(monitor_info);
      const HMONITOR monitor = MonitorFromWindow(hwnd_, MONITOR_DEFAULTTONEAREST);
      if (!GetMonitorInfoW(monitor, &monitor_info)) return;

      SetWindowLongPtrW(
          hwnd_, GWL_STYLE,
          static_cast<LONG_PTR>(saved_style_ & ~(WS_CAPTION | WS_THICKFRAME)));
      SetWindowLongPtrW(
          hwnd_, GWL_EXSTYLE,
          static_cast<LONG_PTR>(saved_ex_style_ & ~(WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE)));
      SetWindowPos(
          hwnd_, HWND_TOP,
          monitor_info.rcMonitor.left, monitor_info.rcMonitor.top,
          monitor_info.rcMonitor.right - monitor_info.rcMonitor.left,
          monitor_info.rcMonitor.bottom - monitor_info.rcMonitor.top,
          SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    } else {
      SetWindowLongPtrW(hwnd_, GWL_STYLE, static_cast<LONG_PTR>(saved_style_));
      SetWindowLongPtrW(hwnd_, GWL_EXSTYLE, static_cast<LONG_PTR>(saved_ex_style_));
      SetWindowPos(
          hwnd_, nullptr,
          saved_window_rect_.left, saved_window_rect_.top,
          saved_window_rect_.right - saved_window_rect_.left,
          saved_window_rect_.bottom - saved_window_rect_.top,
          SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    }
    resize();
  }

  void resize() {
    if (!controller_ || !hwnd_) return;
    RECT bounds{};
    GetClientRect(hwnd_, &bounds);
    controller_->put_Bounds(bounds);
  }

  std::filesystem::path faceplate_root_;
  std::filesystem::path webview_runtime_root_;
  std::filesystem::path user_data_root_;
  HWND hwnd_{};
  ComPtr<ICoreWebView2Controller> controller_;
  ComPtr<ICoreWebView2> webview_;
  bool native_fullscreen_{};
  DWORD saved_style_{};
  DWORD saved_ex_style_{};
  RECT saved_window_rect_{};
  std::atomic<bool> failed_{};
  std::string error_;
};

}  // namespace

int run_desktop_shell(
    const std::filesystem::path& faceplate_root,
    const std::filesystem::path& webview_runtime_root,
    std::string& error) {
  return DesktopShell(faceplate_root, webview_runtime_root).run(error);
}

}  // namespace calcotone
#endif
