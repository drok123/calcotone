#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <wrl.h>
#include <wrl/event.h>

#include <WebView2.h>

#include "calcotone/control_server.hpp"
#include "calcotone/desktop_shell.hpp"
#include "calcotone/native_visual_spectrum.hpp"

#include <atomic>
#include <cctype>
#include <string>
#include <string_view>
#include <utility>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace calcotone {
namespace {

constexpr wchar_t kWindowClass[] = L"CalcotoneDesktopShell";
constexpr int kInitialClientWidth = 1500;
constexpr int kInitialClientHeight = 940;
constexpr std::string_view kBridgePrefix = "calcotone:";

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

std::string utf8_from_wide(std::wstring_view text) {
  if (text.empty()) return {};
  const int size = WideCharToMultiByte(
      CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string result(static_cast<std::size_t>(size), '\0');
  WideCharToMultiByte(
      CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size, nullptr, nullptr);
  return result;
}

std::wstring wide_from_utf8(std::string_view text) {
  if (text.empty()) return {};
  const int size = MultiByteToWideChar(
      CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
  if (size <= 0) return {};
  std::wstring result(static_cast<std::size_t>(size), L'\0');
  MultiByteToWideChar(
      CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size);
  return result;
}

bool decimal_id(std::string_view value) noexcept {
  if (value.empty()) return false;
  for (const char character : value) {
    if (!std::isdigit(static_cast<unsigned char>(character))) return false;
  }
  return true;
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
  explicit DesktopShell(std::wstring faceplate_url)
      : faceplate_url_(std::move(faceplate_url)) {}

  int run(std::string& error) {
    enable_per_monitor_dpi_awareness();

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
        (error_ + "\n\nInstall or repair the Microsoft Edge WebView2 Runtime, then restart CALCOTONE.").c_str(),
        "CALCOTONE desktop shell", MB_OK | MB_ICONERROR);
    DestroyWindow(hwnd_);
  }

  bool source_is_local_faceplate(std::wstring_view source) const noexcept {
    const auto query = faceplate_url_.find(L'?');
    const auto base = query == std::wstring::npos
        ? std::wstring_view(faceplate_url_)
        : std::wstring_view(faceplate_url_).substr(0, query);
    return !base.empty() && source.starts_with(base);
  }

  void post_bridge_response(
      std::string_view kind,
      std::string_view id,
      std::string_view payload) {
    if (!webview_) return;
    std::string envelope;
    envelope.reserve(payload.size() + kind.size() + id.size() + 96U);
    envelope += R"({"type":"calcotone-native-response","kind":")";
    envelope.append(kind);
    envelope += R"(","id":)";
    envelope.append(id);
    envelope += R"(,"payload":)";
    envelope.append(payload);
    envelope += '}';
    const auto wide = wide_from_utf8(envelope);
    if (!wide.empty()) webview_->PostWebMessageAsJson(wide.c_str());
  }

  void handle_web_message(ICoreWebView2WebMessageReceivedEventArgs* args) {
    if (!args || !webview_) return;

    LPWSTR source_raw = nullptr;
    if (FAILED(args->get_Source(&source_raw)) || !source_raw) return;
    const std::wstring source(source_raw);
    CoTaskMemFree(source_raw);
    if (!source_is_local_faceplate(source)) return;

    LPWSTR message_raw = nullptr;
    if (FAILED(args->TryGetWebMessageAsString(&message_raw)) || !message_raw) return;
    const std::wstring message_wide(message_raw);
    CoTaskMemFree(message_raw);
    const std::string message = utf8_from_wide(message_wide);
    if (!message.starts_with(kBridgePrefix)) return;

    const std::string_view body(message.data() + kBridgePrefix.size(), message.size() - kBridgePrefix.size());
    const auto kind_end = body.find(':');
    if (kind_end == std::string_view::npos) return;
    const auto kind = body.substr(0, kind_end);
    const auto id_start = kind_end + 1U;
    const auto id_end = body.find(':', id_start);
    const auto id = id_end == std::string_view::npos
        ? body.substr(id_start)
        : body.substr(id_start, id_end - id_start);
    if (!decimal_id(id)) return;
    const auto payload = id_end == std::string_view::npos
        ? std::string_view{}
        : body.substr(id_end + 1U);

    if (kind == "command") {
      if (payload.empty()) {
        post_bridge_response(kind, id, R"({"error":"empty command"})");
      } else {
        post_bridge_response(kind, id, dispatch_embedded_control(payload));
      }
      return;
    }
    if (kind == "health") {
      post_bridge_response(kind, id, dispatch_embedded_control("health"));
      return;
    }
    if (kind == "spectrum") {
      post_bridge_response(kind, id, native_visual_spectrum().json());
    }
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
                        controller_->put_ZoomFactor(1.0);
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

                        EventRegistrationToken web_message_token{};
                        webview_->add_WebMessageReceived(
                            Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                  handle_web_message(args);
                                  return S_OK;
                                }).Get(),
                            &web_message_token);

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

  std::wstring faceplate_url_;
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

int run_desktop_shell(const std::wstring& faceplate_url, std::string& error) {
  return DesktopShell(faceplate_url).run(error);
}

}  // namespace calcotone
#endif
