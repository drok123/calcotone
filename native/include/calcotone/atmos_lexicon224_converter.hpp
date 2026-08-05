#pragma once

#include <array>
#include <memory>

namespace calcotone {

enum class Lexicon224ConverterRole { Input, Output };

class AtmosLexicon224Converter final {
 public:
  explicit AtmosLexicon224Converter(
      float sample_rate = 48'000.F,
      Lexicon224ConverterRole role = Lexicon224ConverterRole::Input);
  ~AtmosLexicon224Converter();
  AtmosLexicon224Converter(const AtmosLexicon224Converter&) = delete;
  AtmosLexicon224Converter& operator=(const AtmosLexicon224Converter&) = delete;

  std::array<float, 2> process(float left, float right) noexcept;
  void reset() noexcept;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace calcotone
