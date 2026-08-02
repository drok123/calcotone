#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>

#include "calcotone/control_server.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <iostream>
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

void send_response(SOCKET client, int status, std::string_view body, std::string_view origin) noexcept {
  const char* label = status == 200 ? "OK" : status == 403 ? "Forbidden" : "Bad Request";
  const std::string_view allowed_origin = origin.empty() ? std::string_view{"*"} : origin;
  std::string response = "HTTP/1.1 " + std::to_string(status) + ' ' + label +
      "\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: " + std::string(allowed_origin) +
      "\r\nVary: Origin\r\nAccess-Control-Allow-Private-Network: true"
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
    } else {
      send_response(client, 400, R"({"error":"unknown route"})", origin);
    }
    shutdown(client, SD_BOTH);
    closesocket(client);
  }
}

}  // namespace calcotone
#endif
