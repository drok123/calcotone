#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>

#include "calcotone/control_server.hpp"

#include <algorithm>
#include <array>
#include <cctype>
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

bool safe_origin(std::string_view request) noexcept {
  const auto start = request.find("\r\nOrigin:");
  if (start == std::string_view::npos) return true;
  const auto value_start = start + 9;
  const auto end = request.find("\r\n", value_start);
  const auto origin = trim(request.substr(value_start, end - value_start));
  return origin == "null" || origin.starts_with("http://localhost:") ||
      origin.starts_with("http://127.0.0.1:") || origin.starts_with("https://localhost:") ||
      origin.starts_with("https://127.0.0.1:");
}

void send_response(SOCKET client, int status, std::string_view body) noexcept {
  const char* label = status == 200 ? "OK" : status == 403 ? "Forbidden" : "Bad Request";
  std::string response = "HTTP/1.1 " + std::to_string(status) + ' ' + label +
      "\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *"
      "\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS"
      "\r\nAccess-Control-Allow-Headers: Content-Type"
      "\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: " +
      std::to_string(body.size()) + "\r\n\r\n";
  response.append(body);
  send(client, response.data(), static_cast<int>(response.size()), 0);
}
}  // namespace

ControlServer::ControlServer(Handler handler, unsigned short port)
    : handler_(std::move(handler)), port_(port) {}

ControlServer::~ControlServer() { stop(); }

void ControlServer::start() {
  if (running_.exchange(true)) return;
  WSADATA data{};
  if (WSAStartup(MAKEWORD(2, 2), &data) != 0) {
    running_.store(false);
    throw std::runtime_error("WSAStartup failed");
  }
  network_started_ = true;
  thread_ = std::thread([this] { run(); });
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
  if (listener == kInvalidSocket) { running_.store(false); return; }
  listener_.store(static_cast<std::uintptr_t>(listener));
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = htons(port_);
  if (bind(listener, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR ||
      listen(listener, 4) == SOCKET_ERROR) {
    closesocket(listener); listener_.store(~std::uintptr_t{}); running_.store(false); return;
  }

  while (running_.load()) {
    const SOCKET client = accept(listener, nullptr, nullptr);
    if (client == kInvalidSocket) continue;
    std::array<char, 8192> bytes{};
    const int size = recv(client, bytes.data(), static_cast<int>(bytes.size()), 0);
    if (size <= 0) { closesocket(client); continue; }
    const std::string_view request(bytes.data(), static_cast<std::size_t>(size));
    if (!safe_origin(request)) {
      send_response(client, 403, R"({"error":"origin denied"})");
    } else if (request.starts_with("OPTIONS ")) {
      send_response(client, 200, "{}");
    } else if (request.starts_with("GET /health ")) {
      send_response(client, 200, handler_("health"));
    } else if (request.starts_with("POST /command ")) {
      const auto separator = request.find("\r\n\r\n");
      const auto command = separator == std::string_view::npos ? std::string_view{} : trim(request.substr(separator + 4));
      send_response(client, command.empty() ? 400 : 200, command.empty() ? R"({"error":"empty command"})" : handler_(command));
    } else {
      send_response(client, 400, R"({"error":"unknown route"})");
    }
    shutdown(client, SD_BOTH);
    closesocket(client);
  }
}

}  // namespace calcotone
#endif
