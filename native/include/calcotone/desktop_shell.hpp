#pragma once

#ifdef _WIN32

#include <filesystem>
#include <string>

namespace calcotone {

// Runs CALCOTONE's packaged faceplate in an embedded fixed-version WebView2
// runtime. Both folders must live in the standalone application package; the
// shell never falls back to an installed browser or a hosted faceplate.
// The function owns the calling thread's STA/message pump and returns when the
// window is closed. A negative result means the offline UI could not start.
int run_desktop_shell(
    const std::filesystem::path& faceplate_root,
    const std::filesystem::path& webview_runtime_root,
    std::string& error);

}  // namespace calcotone

#endif
