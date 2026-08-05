#include "calcotone/stomp_parity_processor.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <vector>

namespace {
constexpr float kRate = 48'000.F;

std::vector<float> render(float mode, float drive, float tone, float level,
                          float character, float body, float mix) {
  calcotone::StompParityProcessor processor(kRate);
  assert(processor.set_parameter("mode", mode));
  assert(processor.set_parameter("drive", drive));
  assert(processor.set_parameter("tone", tone));
  assert(processor.set_parameter("level", level));
  assert(processor.set_parameter("character", character));
  assert(processor.set_parameter("body", body));
  assert(processor.set_parameter("mix", mix));
  processor.reset();

  constexpr std::size_t frames = 24'000U;
  std::vector<float> audio(frames * 2U, 0.F);
  for (std::size_t frame = 0; frame < frames; ++frame) {
    audio[frame * 2U] = .26F * std::sin(static_cast<float>(frame) * .043F);
    audio[frame * 2U + 1U] = .22F * std::cos(static_cast<float>(frame) * .037F + .5F);
  }
  for (std::size_t offset = 0; offset < frames; offset += 128U)
    processor.process(audio.data() + offset * 2U, std::min<std::size_t>(128U, frames - offset));
  return audio;
}
}  // namespace

int main() {
  const auto low_clamped = render(-20.F, -.5F, -.25F, -1.F, -.2F, -.8F, -.4F);
  const auto low_explicit = render(0.F, 0.F, 0.F, 0.F, 0.F, 0.F, 0.F);
  assert(low_clamped == low_explicit);

  const auto high_clamped = render(99.F, 4.F, 2.F, 8.F, 3.F, 9.F, 7.F);
  const auto high_explicit = render(13.F, 1.F, 1.F, 1.F, 1.F, 1.F, 1.F);
  assert(high_clamped == high_explicit);
}
