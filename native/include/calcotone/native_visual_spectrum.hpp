#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <sstream>
#include <string>

namespace calcotone {

// Realtime-safe mono snapshot ring. The audio thread only performs relaxed
// atomic stores; the control thread performs a small radix-2 FFT when /spectrum
// is read. This keeps all spectral work away from the realtime render thread.
class NativeVisualSpectrum final {
 public:
  static constexpr std::size_t kFftSize = 256;
  static constexpr std::size_t kBins = kFftSize / 2;

  void configure(float sample_rate) noexcept {
    sample_rate_.store(std::clamp(sample_rate, 8'000.F, 384'000.F), std::memory_order_relaxed);
  }

  void publish(const float* interleaved_stereo, std::size_t frames) noexcept {
    if (!interleaved_stereo || frames == 0U) return;
    auto write = write_index_.load(std::memory_order_relaxed);
    for (std::size_t frame = 0; frame < frames; ++frame) {
      const float mono = .5F * (interleaved_stereo[frame * 2] + interleaved_stereo[frame * 2 + 1]);
      samples_[write].store(std::clamp(mono, -1.5F, 1.5F), std::memory_order_relaxed);
      write = (write + 1U) % kFftSize;
    }
    write_index_.store(write, std::memory_order_release);
    const auto prior_available = available_.load(std::memory_order_relaxed);
    const auto next_available = prior_available + frames >= kFftSize ? kFftSize : prior_available + frames;
    available_.store(next_available, std::memory_order_release);
    published_frames_.fetch_add(static_cast<std::uint64_t>(frames), std::memory_order_relaxed);
  }

  std::string json() const {
    std::array<float, kFftSize> input{};
    const auto available = available_.load(std::memory_order_acquire);
    if (available >= kFftSize) {
      auto read = write_index_.load(std::memory_order_acquire);
      for (std::size_t index = 0; index < kFftSize; ++index) {
        input[index] = samples_[read].load(std::memory_order_relaxed);
        read = (read + 1U) % kFftSize;
      }
    }

    std::array<float, kFftSize> real{};
    std::array<float, kFftSize> imaginary{};
    const auto& window = hann_window();
    const auto& cosine = cosine_table();
    const auto& sine = sine_table();

    for (std::size_t index = 0; index < kFftSize; ++index) {
      const auto destination = reverse_bits(index);
      real[destination] = input[index] * window[index];
    }

    for (std::size_t size = 2U; size <= kFftSize; size <<= 1U) {
      const std::size_t half = size >> 1U;
      const std::size_t table_step = kFftSize / size;
      for (std::size_t start = 0U; start < kFftSize; start += size) {
        for (std::size_t offset = 0U; offset < half; ++offset) {
          const std::size_t table_index = offset * table_step;
          const std::size_t even = start + offset;
          const std::size_t odd = even + half;
          const float odd_real = real[odd] * cosine[table_index]
              - imaginary[odd] * sine[table_index];
          const float odd_imaginary = real[odd] * sine[table_index]
              + imaginary[odd] * cosine[table_index];
          const float even_real = real[even];
          const float even_imaginary = imaginary[even];
          real[even] = even_real + odd_real;
          imaginary[even] = even_imaginary + odd_imaginary;
          real[odd] = even_real - odd_real;
          imaginary[odd] = even_imaginary - odd_imaginary;
        }
      }
    }

    std::ostringstream output;
    output << "{\"frame\":" << published_frames_.load(std::memory_order_relaxed)
           << ",\"sampleRate\":" << sample_rate_.load(std::memory_order_relaxed)
           << ",\"bins\":[";
    for (std::size_t bin = 0; bin < kBins; ++bin) {
      const float magnitude = std::sqrt(real[bin] * real[bin] + imaginary[bin] * imaginary[bin])
          / (static_cast<float>(kFftSize) * .5F);
      const float safe_magnitude = magnitude > 1e-7F ? magnitude : 1e-7F;
      const float decibels = 20.F * std::log10(safe_magnitude);
      const int byte = static_cast<int>(std::clamp((decibels + 90.F) / 78.F * 255.F, 0.F, 255.F));
      if (bin) output << ',';
      output << byte;
    }
    output << "]}";
    return output.str();
  }

 private:
  static std::size_t reverse_bits(std::size_t value) noexcept {
    std::size_t reversed = 0U;
    for (unsigned bit = 0U; bit < 8U; ++bit) {
      reversed = (reversed << 1U) | (value & 1U);
      value >>= 1U;
    }
    return reversed;
  }

  static const std::array<float, kFftSize>& hann_window() noexcept {
    static const std::array<float, kFftSize> values = [] {
      std::array<float, kFftSize> result{};
      constexpr float pi = 3.14159265358979323846F;
      for (std::size_t index = 0; index < kFftSize; ++index) {
        result[index] = .5F - .5F * std::cos(
            2.F * pi * static_cast<float>(index) / static_cast<float>(kFftSize - 1U));
      }
      return result;
    }();
    return values;
  }

  static const std::array<float, kBins>& cosine_table() noexcept {
    static const std::array<float, kBins> values = [] {
      std::array<float, kBins> result{};
      constexpr float pi = 3.14159265358979323846F;
      for (std::size_t index = 0; index < kBins; ++index) {
        result[index] = std::cos(-2.F * pi * static_cast<float>(index) / static_cast<float>(kFftSize));
      }
      return result;
    }();
    return values;
  }

  static const std::array<float, kBins>& sine_table() noexcept {
    static const std::array<float, kBins> values = [] {
      std::array<float, kBins> result{};
      constexpr float pi = 3.14159265358979323846F;
      for (std::size_t index = 0; index < kBins; ++index) {
        result[index] = std::sin(-2.F * pi * static_cast<float>(index) / static_cast<float>(kFftSize));
      }
      return result;
    }();
    return values;
  }

  std::array<std::atomic<float>, kFftSize> samples_{};
  std::atomic<std::size_t> write_index_{};
  std::atomic<std::size_t> available_{};
  std::atomic<std::uint64_t> published_frames_{};
  std::atomic<float> sample_rate_{48'000.F};
};

inline NativeVisualSpectrum& native_visual_spectrum() noexcept {
  static NativeVisualSpectrum spectrum;
  return spectrum;
}

}  // namespace calcotone
