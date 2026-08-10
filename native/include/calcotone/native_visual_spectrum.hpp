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
// atomic stores; the control thread performs the FFT when /spectrum is read.
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
    available_.store(std::min<std::size_t>(kFftSize, available_.load(std::memory_order_relaxed) + frames), std::memory_order_release);
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

    constexpr float pi = 3.14159265358979323846F;
    std::ostringstream output;
    output << "{\"frame\":" << published_frames_.load(std::memory_order_relaxed)
           << ",\"sampleRate\":" << sample_rate_.load(std::memory_order_relaxed)
           << ",\"bins\":[";
    for (std::size_t bin = 0; bin < kBins; ++bin) {
      float real = 0.F;
      float imaginary = 0.F;
      for (std::size_t sample = 0; sample < kFftSize; ++sample) {
        const float window = .5F - .5F * std::cos(2.F * pi * static_cast<float>(sample) / static_cast<float>(kFftSize - 1U));
        const float phase = -2.F * pi * static_cast<float>(bin * sample) / static_cast<float>(kFftSize);
        const float value = input[sample] * window;
        real += value * std::cos(phase);
        imaginary += value * std::sin(phase);
      }
      const float magnitude = std::sqrt(real * real + imaginary * imaginary) / (static_cast<float>(kFftSize) * .5F);
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
