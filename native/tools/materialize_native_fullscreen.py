from pathlib import Path

path = Path('native/src/desktop_shell.cpp')
source = path.read_text(encoding='utf-8').replace('\r\n', '\n')

if 'void set_native_fullscreen(bool enabled)' not in source:
    source = source.replace(
        '  void resize() {\n',
        '''  void set_native_fullscreen(bool enabled) {\n    if (!hwnd_ || native_fullscreen_ == enabled) return;\n    native_fullscreen_ = enabled;\n\n    if (enabled) {\n      saved_style_ = static_cast<DWORD>(GetWindowLongPtrW(hwnd_, GWL_STYLE));\n      saved_ex_style_ = static_cast<DWORD>(GetWindowLongPtrW(hwnd_, GWL_EXSTYLE));\n      GetWindowRect(hwnd_, &saved_window_rect_);\n\n      MONITORINFO monitor_info{};\n      monitor_info.cbSize = sizeof(monitor_info);\n      const HMONITOR monitor = MonitorFromWindow(hwnd_, MONITOR_DEFAULTTONEAREST);\n      if (!GetMonitorInfoW(monitor, &monitor_info)) return;\n\n      SetWindowLongPtrW(\n          hwnd_, GWL_STYLE,\n          static_cast<LONG_PTR>(saved_style_ & ~(WS_CAPTION | WS_THICKFRAME)));\n      SetWindowLongPtrW(\n          hwnd_, GWL_EXSTYLE,\n          static_cast<LONG_PTR>(saved_ex_style_ & ~(WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE)));\n      SetWindowPos(\n          hwnd_, HWND_TOP,\n          monitor_info.rcMonitor.left, monitor_info.rcMonitor.top,\n          monitor_info.rcMonitor.right - monitor_info.rcMonitor.left,\n          monitor_info.rcMonitor.bottom - monitor_info.rcMonitor.top,\n          SWP_FRAMECHANGED | SWP_SHOWWINDOW);\n    } else {\n      SetWindowLongPtrW(hwnd_, GWL_STYLE, static_cast<LONG_PTR>(saved_style_));\n      SetWindowLongPtrW(hwnd_, GWL_EXSTYLE, static_cast<LONG_PTR>(saved_ex_style_));\n      SetWindowPos(\n          hwnd_, nullptr,\n          saved_window_rect_.left, saved_window_rect_.top,\n          saved_window_rect_.right - saved_window_rect_.left,\n          saved_window_rect_.bottom - saved_window_rect_.top,\n          SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW);\n    }\n    resize();\n  }\n\n  void resize() {\n''',
        1,
    )

anchor = '''                        EventRegistrationToken navigation_token{};\n                        webview_->add_NavigationStarting('''
if 'add_ContainsFullScreenElementChanged' not in source:
    replacement = '''                        EventRegistrationToken fullscreen_token{};\n                        webview_->add_ContainsFullScreenElementChanged(\n                            Callback<ICoreWebView2ContainsFullScreenElementChangedEventHandler>(\n                                [this](ICoreWebView2* sender, IUnknown*) -> HRESULT {\n                                  BOOL contains_fullscreen = FALSE;\n                                  if (sender && SUCCEEDED(sender->get_ContainsFullScreenElement(&contains_fullscreen))) {\n                                    set_native_fullscreen(contains_fullscreen == TRUE);\n                                  }\n                                  return S_OK;\n                                }).Get(),\n                            &fullscreen_token);\n\n                        EventRegistrationToken navigation_token{};\n                        webview_->add_NavigationStarting('''
    if anchor not in source:
        raise RuntimeError('navigation event anchor missing')
    source = source.replace(anchor, replacement, 1)

member_anchor = '''  ComPtr<ICoreWebView2> webview_;\n  std::atomic<bool> failed_{};'''
if 'bool native_fullscreen_' not in source:
    member_replacement = '''  ComPtr<ICoreWebView2> webview_;\n  bool native_fullscreen_{};\n  DWORD saved_style_{};\n  DWORD saved_ex_style_{};\n  RECT saved_window_rect_{};\n  std::atomic<bool> failed_{};'''
    if member_anchor not in source:
        raise RuntimeError('member anchor missing')
    source = source.replace(member_anchor, member_replacement, 1)

path.write_text(source, encoding='utf-8')
print('Native WebView2 fullscreen handling materialized.')
