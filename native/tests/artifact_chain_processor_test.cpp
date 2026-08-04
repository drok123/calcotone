#include "calcotone/artifact_chain_processor.hpp"

#include <array>
#include <cassert>
#include <cmath>
#include <set>

int main() {
  using namespace calcotone;
  std::set<long long> signatures;
  for (unsigned console = 0; console < 6; ++console) {
    for (unsigned tube = 0; tube < 6; ++tube) {
      for (unsigned order = 0; order < 2; ++order) {
        ArtifactChainProcessor processor(48'000.F);
        processor.set_parameter("console", static_cast<float>(console));
        processor.set_parameter("tube", static_cast<float>(tube));
        processor.set_parameter("order", static_cast<float>(order));
        processor.set_parameter("drive", .62F);
        processor.set_parameter("character", .48F);
        processor.set_parameter("tone", .57F);
        processor.set_parameter("mix", 1.F);
        std::array<float, 512 * 2> audio{};
        audio[0] = .75F;
        audio[1] = -.5F;
        processor.process(audio.data(), 512);
        double signature = 0.0;
        for (std::size_t i = 0; i < audio.size(); ++i) {
          assert(std::isfinite(audio[i]));
          signature += static_cast<double>(audio[i]) * static_cast<double>((i % 31) + 1);
        }
        signatures.insert(std::llround(signature * 1'000'000.0));
      }
    }
  }
  // Bypass/bypass is identical across order, so 71 distinct responses is the
  // theoretical maximum for 72 matrix selections.
  assert(signatures.size() >= 60);
  return 0;
}
