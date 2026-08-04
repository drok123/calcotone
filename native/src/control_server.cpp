#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>

#include "calcotone/control_server.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <utility>

namespace calcotone {
namespace {
constexpr SOCKET kInvalidSocket = INVALID_SOCKET;

std::string_view trim(std::string_view value) noexcept {
  while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) value.remove_prefix(1);
  while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) value.remove_suffix(1);
  return value;
}

bool case_equal(std::string_view left, std::string_view right) noexcept {
  return left.size() == right.size() && std::ranges::equal(left, right, [](char a, char b) {
    return std::tolower(static_cast<unsigned char>(a)) == std::tolower(static_cast<unsigned char>(b));
  });
}

std::string_view request_origin(std::string_view request) noexcept {
  auto cursor = request.find("\r\n");
  while (cursor != std::string_view::npos) {
    const auto start = cursor + 2;
    const auto end = request.find("\r\n", start);
    if (end == std::string_view::npos || end == start) break;
    const auto line = request.substr(start, end - start);
    const auto colon = line.find(':');
    if (colon != std::string_view::npos && case_equal(line.substr(0, colon), "origin")) return trim(line.substr(colon + 1));
    cursor = end;
  }
  return {};
}

bool host_matches(std::string_view host, std::string_view suffix) noexcept {
  return host == suffix || (host.size() > suffix.size() && host.ends_with(suffix) && host[host.size() - suffix.size() - 1] == '.');
}

bool safe_origin(std::string_view origin) noexcept {
  if (origin.empty() || origin == "null") return true;
  const auto scheme_end = origin.find("://");
  if (scheme_end == std::string_view::npos) return false;
  const auto scheme = origin.substr(0, scheme_end);
  auto host = origin.substr(scheme_end + 3);
  const auto port = host.find(':');
  if (port != std::string_view::npos) host = host.substr(0, port);
  if ((scheme == "http" || scheme == "https") && (host == "localhost" || host == "127.0.0.1")) return true;
  if (scheme != "https") return false;
  return host_matches(host, "stackblitz.com") || host_matches(host, "stackblitz.io") ||
      host_matches(host, "webcontainer.io") || host_matches(host, "webcontainer-api.io") ||
      host_matches(host, "staticblitz.com");
}

void send_response(
    SOCKET client,
    int status,
    std::string_view body,
    std::string_view origin,
    std::string_view content_type = "application/json") noexcept {
  const char* label = status == 200 ? "OK" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : "Bad Request";
  const std::string_view allowed_origin = origin.empty() ? std::string_view{"*"} : origin;
  std::string response = "HTTP/1.1 " + std::to_string(status) + ' ' + label +
      "\r\nContent-Type: " + std::string(content_type) + "\r\nAccess-Control-Allow-Origin: " + std::string(allowed_origin) +
      "\r\nVary: Origin\r\nAccess-Control-Allow-Private-Network: true"
      "\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS"
      "\r\nAccess-Control-Allow-Headers: Content-Type"
      "\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: " +
      std::to_string(body.size()) + "\r\n\r\n";
  response.append(body);
  std::size_t sent = 0;
  while (sent < response.size()) {
    const int written = send(
        client,
        response.data() + sent,
        static_cast<int>(std::min<std::size_t>(response.size() - sent, 64U * 1024U)),
        0);
    if (written <= 0) break;
    sent += static_cast<std::size_t>(written);
  }
}

std::string_view content_type_for(const std::filesystem::path& path) {
  const auto extension = path.extension().string();
  if (extension == ".html") return "text/html; charset=utf-8";
  if (extension == ".js") return "text/javascript; charset=utf-8";
  if (extension == ".css") return "text/css; charset=utf-8";
  if (extension == ".svg") return "image/svg+xml";
  if (extension == ".png") return "image/png";
  if (extension == ".json") return "application/json";
  if (extension == ".f32") return "application/octet-stream";
  return "application/octet-stream";
}

std::string_view request_target(std::string_view request) noexcept {
  const auto first_space = request.find(' ');
  if (first_space == std::string_view::npos) return {};
  const auto second_space = request.find(' ', first_space + 1);
  if (second_space == std::string_view::npos) return {};
  return request.substr(first_space + 1, second_space - first_space - 1);
}

std::size_t request_content_length(std::string_view request) noexcept {
  auto cursor = request.find("\r\n");
  while (cursor != std::string_view::npos) {
    const auto start = cursor + 2, end = request.find("\r\n", start);
    if (end == std::string_view::npos || end == start) break;
    const auto line = request.substr(start, end - start);
    const auto colon = line.find(':');
    if (colon != std::string_view::npos && case_equal(line.substr(0, colon), "content-length")) {
      std::size_t value = 0;
      for (char character : trim(line.substr(colon + 1))) {
        if (!std::isdigit(static_cast<unsigned char>(character))) return 0;
        value = value * 10 + static_cast<unsigned>(character - '0');
      }
      return value;
    }
    cursor = end;
  }
  return 0;
}
}  // namespace

ControlServer::ControlServer(Handler handler, unsigned short port, std::filesystem::path static_root)
    : handler_(std::move(handler)), port_(port), static_root_(std::move(static_root)) {}

ControlServer::~ControlServer() { stop(); }

void ControlServer::start() {
  if (running_.exchange(true)) return;
  WSADATA data{};
  if (WSAStartup(MAKEWORD(2, 2), &data) != 0) {
    running_.store(false);
    throw std::runtime_error("WSAStartup failed");
  }
  network_started_ = true;
  {
    std::lock_guard lock(startup_mutex_);
    startup_complete_ = false;
    startup_ok_ = false;
  }
  thread_ = std::thread([this] { run(); });
  {
    std::unique_lock lock(startup_mutex_);
    startup_condition_.wait_for(lock, std::chrono::seconds(2), [this] { return startup_complete_; });
    if (!startup_ok_) {
      lock.unlock();
      stop();
      throw std::runtime_error("Control bridge could not bind 127.0.0.1:48157; close any older calcotone_host process and retry");
    }
  }
}

void ControlServer::stop() noexcept {
  running_.store(false);
  const auto socket = static_cast<SOCKET>(listener_.exchange(~std::uintptr_t{}));
  if (socket != kInvalidSocket) {
    shutdown(socket, SD_BOTH);
    closesocket(socket);
  }
  if (thread_.joinable()) thread_.join();
  if (network_started_) {
    WSACleanup();
    network_started_ = false;
  }
}

void ControlServer::run() noexcept {
  const SOCKET listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (listener == kInvalidSocket) {
    running_.store(false);
    { std::lock_guard lock(startup_mutex_); startup_complete_ = true; startup_ok_ = false; }
    startup_condition_.notify_one();
    return;
  }
  listener_.store(static_cast<std::uintptr_t>(listener));
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = htons(port_);
  if (bind(listener, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR ||
      listen(listener, SOMAXCONN) == SOCKET_ERROR) {
    closesocket(listener); listener_.store(~std::uintptr_t{}); running_.store(false);
    { std::lock_guard lock(startup_mutex_); startup_complete_ = true; startup_ok_ = false; }
    startup_condition_.notify_one();
    return;
  }
  { std::lock_guard lock(startup_mutex_); startup_complete_ = true; startup_ok_ = true; }
  startup_condition_.notify_one();

  while (running_.load()) {
    const SOCKET client = accept(listener, nullptr, nullptr);
    if (client == kInvalidSocket) continue;
    DWORD timeout_ms = 1'000;
    setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeout_ms), sizeof(timeout_ms));
    std::string request_storage;
    request_storage.reserve(8'192);
    std::array<char, 8'192> bytes{};
    while (request_storage.size() < 65'536) {
      const int size = recv(client, bytes.data(), static_cast<int>(bytes.size()), 0);
      if (size <= 0) break;
      request_storage.append(bytes.data(), static_cast<std::size_t>(size));
      const auto separator = request_storage.find("\r\n\r\n");
      if (separator != std::string::npos) {
        const std::size_t expected = separator + 4 + request_content_length(request_storage);
        if (request_storage.size() >= expected) break;
      }
    }
    if (request_storage.empty()) { closesocket(client); continue; }
    const std::string_view request(request_storage);
    const auto origin = request_origin(request);
    if (!safe_origin(origin)) {
      std::cerr << "CALCOTONE control bridge denied browser origin: " << origin << '\n';
      send_response(client, 403, R"({"error":"origin denied"})", {});
    } else if (request.starts_with("OPTIONS ")) {
      send_response(client, 200, "{}", origin);
    } else if (request.starts_with("GET /health ")) {
      send_response(client, 200, handler_("health"), origin);
    } else if (request.starts_with("POST /command ")) {
      const auto separator = request.find("\r\n\r\n");
      const auto command = separator == std::string_view::npos ? std::string_view{} : trim(request.substr(separator + 4));
      send_response(client, command.empty() ? 400 : 200, command.empty() ? R"({"error":"empty command"})" : handler_(command), origin);
    } else if (request.starts_with("GET ") && !static_root_.empty()) {
      auto target = request_target(request);
      const auto query = target.find('?');
      if (query != std::string_view::npos) target = target.substr(0, query);
      if (target.empty() || target == "/") target = "/index.html";
      if (target.find("..") != std::string_view::npos || !target.starts_with('/')) {
        send_response(client, 403, "Forbidden", origin, "text/plain; charset=utf-8");
      } else {
        const auto path = static_root_ / std::string(target.substr(1));
        std::ifstream file(path, std::ios::binary);
        if (!file) {
          send_response(client, 404, "Not found", origin, "text/plain; charset=utf-8");
        } else {
          const std::string body((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
          send_response(client, 200, body, origin, content_type_for(path));
        }
      }
    } else {
      send_response(client, 400, R"({"error":"unknown route"})", origin);
    }
    shutdown(client, SD_BOTH);
    closesocket(client);
  }
}

}  // namespace calcotone
#endif
