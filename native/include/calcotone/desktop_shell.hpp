#pragma once

#ifdef _WIN32

#include <string>

namespace calcotone {

// Runs CALCOTONE's faceplate in an embedded WebView2 window. The function owns
// the calling thread's STA/message pump and returns when the window is closed.
// A negative result means WebView2 could not be initialized.
int run_desktop_shell(const std::wstring& faceplate_url, std::string& error);

}  // namespace calcotone

#endif
