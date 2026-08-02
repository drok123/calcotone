#pragma once

#ifdef _WIN32

#include <atomic>
#include <cstdint>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>

namespace calcotone {

class ControlServer final {
 public:
  using Handler = std::function<std::string(std::string_view)>;

  explicit ControlServer(Handler handler, unsigned short port = 48157);
  ~ControlServer();
  ControlServer(const ControlServer&) = delete;
  ControlServer& operator=(const ControlServer&) = delete;

  void start();
  void stop() noexcept;
  [[nodiscard]] unsigned short port() const noexcept { return port_; }

 private:
  void run() noexcept;

  Handler handler_;
  unsigned short port_;
  std::atomic<bool> running_{false};
  std::thread thread_;
  std::atomic<std::uintptr_t> listener_{~std::uintptr_t{}};
  bool network_started_{};
  std::mutex startup_mutex_;
  std::condition_variable startup_condition_;
  bool startup_complete_{};
  bool startup_ok_{};
};

}  // namespace calcotone

#endif
