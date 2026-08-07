#include "calcotone/loop_processor.hpp"

#include <array>
#include <cassert>
#include <cmath>

int main() {
  calcotone::LoopProcessor loop(48'000.F);
  loop.set_enabled(true);
  loop.set_selected_track(0);
  loop.set_master_level(.8F);
  loop.set_track_level(0, .75F);
  loop.set_overdub(1.F);
  loop.set_fade(.1F);

  std::array<float, 256 * 2> block{};
  for (std::size_t frame = 0; frame < 256; ++frame) {
    block[frame * 2] = .2F;
    block[frame * 2 + 1] = -.2F;
  }

  loop.command(calcotone::LoopCommand::Record);
  loop.process(block.data(), 256);
  assert(loop.transport() == calcotone::LoopTransport::Recording);
  loop.command(calcotone::LoopCommand::Record);
  loop.process(block.data(), 256);
  assert(loop.loop_frames() == 256U);
  assert((loop.track_mask() & 1U) != 0U);
  assert(loop.transport() == calcotone::LoopTransport::Playing);

  for (auto& sample : block) sample = 0.F;
  loop.process(block.data(), 256);
  float peak = 0.F;
  for (const auto sample : block) peak = std::max(peak, std::abs(sample));
  assert(peak > .05F);

  loop.command(calcotone::LoopCommand::Overdub);
  loop.process(block.data(), 256);
  assert(loop.transport() == calcotone::LoopTransport::Overdubbing);
  loop.command(calcotone::LoopCommand::Clear);
  loop.process(block.data(), 1);
  assert(loop.track_mask() == 0U);
  assert(loop.loop_frames() == 0U);
  assert(loop.transport() == calcotone::LoopTransport::Empty);
  return 0;
}
