from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, source: str) -> None:
    Path(path).write_text(source, encoding="utf-8")


def replace_required(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise RuntimeError(f"missing {label}")
    return source.replace(old, new, 1)


cpp_path = "native/src/halo_parity_processor.cpp"
cpp = read(cpp_path)

cpp = replace_required(
    cpp,
    "float triangle_wave(float phase) noexcept {\n  return (2.F / kPi) * std::asin(std::sin(phase));\n}\n",
    "float triangle_wave(float phase) noexcept {\n  return (2.F / kPi) * std::asin(std::sin(phase));\n}\n\n"
    "float seeded_noise(double seed) noexcept {\n"
    "  const double value = std::sin(seed * 12.9898) * 43758.5453;\n"
    "  return static_cast<float>(value - std::floor(value));\n"
    "}\n",
    "seeded scatter noise helper",
)

cpp = replace_required(
    cpp,
    "  std::array<float, 2> phase{};\n"
    "  std::array<float, 2> scatter_state{};\n"
    "  std::array<float, 2> pitch_semitones{};\n"
    "  std::size_t write{};\n"
    "  std::size_t pitch_scatter_countdown{};\n"
    "  std::uint32_t rng{0x48414c4fU};\n"
    "  std::uint32_t pitch_rng{0x50495443U};\n"
    "  int active_mode{-1};\n"
    "  bool pitch_scattered{};\n",
    "  std::array<float, 2> phase{};\n"
    "  std::array<float, 2> jitter_target{1.F, 1.F};\n"
    "  std::array<float, 2> jitter_value{1.F, 1.F};\n"
    "  std::array<float, 2> fragment_target{1.F, 1.F};\n"
    "  std::array<float, 2> orbit_target{};\n"
    "  std::array<float, 2> direct_gain{};\n"
    "  std::array<float, 2> cross_gain{};\n"
    "  std::array<float, 2> pitch_semitones{};\n"
    "  std::size_t write{};\n"
    "  std::size_t scatter_countdown{};\n"
    "  std::uint64_t sample_clock{};\n"
    "  int active_mode{-1};\n"
    "  bool pitch_scattered{};\n",
    "Halo scatter event state",
)

cpp = replace_required(
    cpp,
    "    pitch_scatter_countdown = static_cast<std::size_t>(std::lround(sample_rate * .42F));\n"
    "  }\n\n"
    "  float noise() noexcept {\n"
    "    rng ^= rng << 13;\n"
    "    rng ^= rng >> 17;\n"
    "    rng ^= rng << 5;\n"
    "    return static_cast<float>(rng & 0xffffU) / 32767.5F - 1.F;\n"
    "  }\n\n"
    "  float pitch_random() noexcept {\n"
    "    pitch_rng ^= pitch_rng << 13;\n"
    "    pitch_rng ^= pitch_rng >> 17;\n"
    "    pitch_rng ^= pitch_rng << 5;\n"
    "    return static_cast<float>(pitch_rng & 0xffffU) / 65535.F;\n"
    "  }\n",
    "    scatter_countdown = std::max<std::size_t>(1, static_cast<std::size_t>(std::lround(sample_rate * .42F))) - 1;\n"
    "    reset_scatter_mode(1);\n"
    "  }\n\n"
    "  void reset_scatter_mode(unsigned mode) noexcept {\n"
    "    const auto& profile = halo_parity_profile(std::min(11U, mode));\n"
    "    const float width = clamp01(target[5].load(std::memory_order_relaxed));\n"
    "    jitter_target.fill(1.F);\n"
    "    jitter_value.fill(1.F);\n"
    "    fragment_target.fill(1.F);\n"
    "    orbit_target.fill(0.F);\n"
    "    direct_gain.fill(profile.output_trim * (.52F + width * .46F));\n"
    "    cross_gain.fill(profile.output_trim * ((1.F - width) * .34F));\n"
    "    scatter_countdown = std::max<std::size_t>(1, static_cast<std::size_t>(std::lround(sample_rate * .42F))) - 1;\n"
    "  }\n\n"
    "  void run_scatter_tick(\n"
    "      unsigned mode,\n"
    "      const HaloParityProfile& profile,\n"
    "      float seconds,\n"
    "      float character) noexcept {\n"
    "    if (profile.scatter <= 0.F || character < .02F) {\n"
    "      jitter_target.fill(1.F);\n"
    "      fragment_target.fill(1.F);\n"
    "      orbit_target.fill(0.F);\n"
    "      return;\n"
    "    }\n"
    "    const double now = static_cast<double>(sample_clock) / static_cast<double>(sample_rate);\n"
    "    const float amount = profile.scatter * character;\n"
    "    for (unsigned channel = 0; channel < 2; ++channel) {\n"
    "      const double channel_offset = static_cast<double>(channel);\n"
    "      const float jitter = 1.F + (seeded_noise(now * 2.7 + channel_offset * 31.7) - .5F) * amount;\n"
    "      const float dropout = seeded_noise(now * .91 + channel_offset * 17.3);\n"
    "      jitter_target[channel] = std::clamp(jitter, .25F, 1.75F);\n"
    "      fragment_target[channel] = dropout < amount * (.16F + profile.reverse_chance * .22F) ? .16F : 1.F;\n"
    "      orbit_target[channel] = profile.orbit_depth * character\n"
    "          * std::sin(static_cast<float>(now * .73 + channel_offset * static_cast<double>(kPi)));\n"
    "      if (mode == 6 || mode == 11) {\n"
    "        const float choice = choose_constellation_pitch(\n"
    "            seeded_noise(now * 1.37 + channel_offset * 43.1), character);\n"
    "        pitch_semitones[channel] = channel == 0 ? choice : -choice * .72F;\n"
    "        pitch_scattered = true;\n"
    "      }\n"
    "    }\n"
    "    (void)seconds;\n"
    "  }\n",
    "deterministic Halo scatter event model",
)

cpp = replace_required(
    cpp,
    "  void reset_pitch_mode(unsigned mode) noexcept {\n"
    "    pitch.reset();\n"
    "    pitch_semitones[0] = mode == 11 ? 5.F : 7.F;\n"
    "    pitch_semitones[1] = -5.F;\n"
    "    pitch_scatter_countdown = static_cast<std::size_t>(std::lround(sample_rate * .42F));\n"
    "    pitch_rng = 0x50495443U;\n"
    "    pitch_scattered = false;\n"
    "  }\n",
    "  void reset_pitch_mode(unsigned mode) noexcept {\n"
    "    pitch.reset();\n"
    "    pitch_semitones[0] = mode == 11 ? 5.F : 7.F;\n"
    "    pitch_semitones[1] = -5.F;\n"
    "    pitch_scattered = false;\n"
    "  }\n",
    "shared scatter clock for pitch targets",
)

cpp = replace_required(
    cpp,
    "    phase.fill(0.F);\n"
    "    scatter_state.fill(0.F);\n"
    "    write = 0;\n"
    "    rng = 0x48414c4fU;\n"
    "    pitch.reset();\n"
    "    pitch_scatter_countdown = static_cast<std::size_t>(std::lround(sample_rate * .42F));\n"
    "    pitch_rng = 0x50495443U;\n"
    "    pitch_scattered = false;\n",
    "    phase.fill(0.F);\n"
    "    jitter_target.fill(1.F);\n"
    "    jitter_value.fill(1.F);\n"
    "    fragment_target.fill(1.F);\n"
    "    orbit_target.fill(0.F);\n"
    "    direct_gain.fill(0.F);\n"
    "    cross_gain.fill(0.F);\n"
    "    write = 0;\n"
    "    sample_clock = 0;\n"
    "    pitch.reset();\n"
    "    scatter_countdown = std::max<std::size_t>(1, static_cast<std::size_t>(std::lround(sample_rate * .42F))) - 1;\n"
    "    pitch_scattered = false;\n",
    "Halo scatter state reset",
)

cpp = replace_required(
    cpp,
    "      if (requested_mode == 6 || requested_mode == 11) {\n"
    "        reset_pitch_mode(static_cast<unsigned>(requested_mode));\n"
    "      }\n"
    "      active_mode = requested_mode;\n",
    "      if (requested_mode != 7) {\n"
    "        reset_scatter_mode(static_cast<unsigned>(requested_mode));\n"
    "        if (requested_mode == 6 || requested_mode == 11) {\n"
    "          reset_pitch_mode(static_cast<unsigned>(requested_mode));\n"
    "        } else {\n"
    "          pitch.reset();\n"
    "          pitch_scattered = false;\n"
    "        }\n"
    "      }\n"
    "      active_mode = requested_mode;\n",
    "scatter reset on algorithm changes",
)

cpp = replace_required(
    cpp,
    "      const float hardware_modulation = mode == 10 ? .35F + width * .95F : 1.F;\n\n"
    "      const std::array<float, 2> dry{data[frame * 2], data[frame * 2 + 1]};\n",
    "      const float hardware_modulation = mode == 10 ? .35F + width * .95F : 1.F;\n\n"
    "      if (profile.scatter > 0.F) {\n"
    "        if (scatter_countdown == 0) {\n"
    "          run_scatter_tick(mode, profile, seconds, character);\n"
    "          scatter_countdown = std::max<std::size_t>(1, static_cast<std::size_t>(std::lround(sample_rate * .42F))) - 1;\n"
    "        } else {\n"
    "          --scatter_countdown;\n"
    "        }\n"
    "      } else {\n"
    "        jitter_target.fill(1.F);\n"
    "        fragment_target.fill(1.F);\n"
    "        orbit_target.fill(0.F);\n"
    "      }\n"
    "      if (character < .02F) {\n"
    "        jitter_target.fill(1.F);\n"
    "        fragment_target.fill(1.F);\n"
    "        orbit_target.fill(0.F);\n"
    "      }\n"
    "      const float jitter_smoothing = 1.F - std::exp(-1.F / (sample_rate * .12F));\n"
    "      const float direct_smoothing = 1.F - std::exp(-1.F / (sample_rate * .08F));\n"
    "      const float cross_smoothing = 1.F - std::exp(-1.F / (sample_rate * .10F));\n"
    "      for (unsigned channel = 0; channel < 2; ++channel) {\n"
    "        jitter_value[channel] += (jitter_target[channel] - jitter_value[channel]) * jitter_smoothing;\n"
    "        const float positive_orbit = std::max(0.F, orbit_target[channel]);\n"
    "        const float desired_direct = profile.output_trim * direct_width * fragment_target[channel]\n"
    "            * (1.F - positive_orbit * .36F);\n"
    "        const float desired_cross = profile.output_trim * (cross_width + positive_orbit * .31F);\n"
    "        direct_gain[channel] += (desired_direct - direct_gain[channel]) * direct_smoothing;\n"
    "        cross_gain[channel] += (desired_cross - cross_gain[channel]) * cross_smoothing;\n"
    "      }\n\n"
    "      const std::array<float, 2> dry{data[frame * 2], data[frame * 2 + 1]};\n",
    "sample-accurate scatter target smoothing",
)

cpp = replace_required(
    cpp,
    "        const float delay_samples = std::max(1.F, (seconds * profile.time_ratios[channel] + modulation_seconds) * sample_rate);\n",
    "        const float delay_seconds = std::clamp(\n"
    "            seconds * profile.time_ratios[channel] * jitter_value[channel] + modulation_seconds, .015F, 6.35F);\n"
    "        const float delay_samples = delay_seconds * sample_rate;\n",
    "scatter jitter delay target",
)

cpp = replace_required(
    cpp,
    "          const float frequency = profile.diffusion_base + static_cast<float>(stage) * 430.F\n"
    "              + static_cast<float>(channel) * 97.F;\n"
    "          wet = biquad_allpass(wet, frequency, .65F, sample_rate, diffusion[channel][stage]);\n",
    "          const float frequency = profile.diffusion_base + static_cast<float>(stage) * 390.F\n"
    "              + character * 1450.F + static_cast<float>(channel) * 83.F;\n"
    "          const float q = .45F + character * (.8F + static_cast<float>(stage) * .13F);\n"
    "          wet = biquad_allpass(wet, frequency, q, sample_rate, diffusion[channel][stage]);\n",
    "character-dependent Halo diffusion",
)

cpp = replace_required(
    cpp,
    "      if (mode == 6 || mode == 11) {\n"
    "        if (pitch_scatter_countdown == 0) {\n"
    "          const float choice = choose_constellation_pitch(pitch_random(), character);\n"
    "          pitch_semitones[0] = choice;\n"
    "          pitch_semitones[1] = -choice * .72F;\n"
    "          pitch_scatter_countdown = static_cast<std::size_t>(std::lround(sample_rate * .42F));\n"
    "          pitch_scattered = true;\n"
    "        } else {\n"
    "          --pitch_scatter_countdown;\n"
    "        }\n"
    "        const float exponent = pitch_scattered ? 1.28F : 1.35F;\n",
    "      if (mode == 6 || mode == 11) {\n"
    "        const float exponent = pitch_scattered ? 1.28F : 1.35F;\n",
    "pitch updates on shared 420 ms scatter clock",
)

cpp = replace_required(
    cpp,
    "      for (unsigned channel = 0; channel < 2; ++channel) {\n"
    "        float wet = character_curve(precolor[channel], character, profile, mode);\n"
    "        if (profile.scatter > 0.F) {\n"
    "          scatter_state[channel] += (noise() - scatter_state[channel]) * .003F;\n"
    "          wet += scatter_state[channel] * profile.scatter * character * .035F;\n"
    "        }\n"
    "        tap[channel] = wet;\n"
    "      }\n",
    "      for (unsigned channel = 0; channel < 2; ++channel) {\n"
    "        tap[channel] = character_curve(precolor[channel], character, profile, mode);\n"
    "      }\n",
    "remove non-web scatter noise injection",
)

cpp = replace_required(
    cpp,
    "      float wet_left = (tap[0] * direct_width + tap[1] * cross_width) * profile.output_trim;\n"
    "      float wet_right = (tap[1] * direct_width + tap[0] * cross_width) * profile.output_trim;\n"
    "      if (profile.orbit_depth > 0.F) {\n"
    "        const float orbit = std::sin((phase[0] + phase[1]) * .5F) * profile.orbit_depth * width;\n"
    "        const float left = wet_left * (1.F - orbit * .32F) + wet_right * std::max(0.F, -orbit) * .22F;\n"
    "        const float right = wet_right * (1.F + orbit * .32F) + wet_left * std::max(0.F, orbit) * .22F;\n"
    "        wet_left = left;\n"
    "        wet_right = right;\n"
    "      }\n",
    "      const float wet_left = tap[0] * direct_gain[0] + tap[1] * cross_gain[1];\n"
    "      const float wet_right = tap[1] * direct_gain[1] + tap[0] * cross_gain[0];\n",
    "event-driven direct cross and orbit gains",
)

cpp = replace_required(
    cpp,
    "      write = (write + 1) % delay[0].size();\n",
    "      write = (write + 1) % delay[0].size();\n"
    "      ++sample_clock;\n",
    "Halo transport clock",
)

for forbidden in ("scatter_state", "pitch_scatter_countdown", "pitch_random()", "float noise()"):
    if forbidden in cpp:
        raise RuntimeError(f"stale Halo approximation remains: {forbidden}")

write(cpp_path, cpp)


test_path = "native/tests/halo_parity_processor_test.cpp"
test = read(test_path)

test = replace_required(
    test,
    "    std::vector<float> audio(16384 * 2, 0.F);\n",
    "    std::vector<float> audio(65536 * 2, 0.F);\n",
    "long deterministic scatter reset render",
)

test = replace_required(
    test,
    "void test_reset_is_deterministic() {\n",
    "void test_scatter_clock_applies_fragment_drop() {\n"
    "  calcotone::HaloParityProcessor processor(kSampleRate);\n"
    "  processor.set_parameter(\"algorithm\", 5.F);\n"
    "  processor.set_parameter(\"time\", .03F);\n"
    "  processor.set_parameter(\"feedback\", 0.F);\n"
    "  processor.set_parameter(\"color\", .7F);\n"
    "  processor.set_parameter(\"character\", 1.F);\n"
    "  processor.set_parameter(\"width\", 1.F);\n"
    "  processor.set_parameter(\"mix\", 1.F);\n"
    "  settle(processor);\n"
    "  std::vector<float> audio(42000 * 2, 0.F);\n"
    "  for (std::size_t frame = 0; frame < audio.size() / 2; frame += 1024) {\n"
    "    audio[frame * 2] = .42F;\n"
    "    audio[frame * 2 + 1] = .42F;\n"
    "  }\n"
    "  process_blocks(processor, audio);\n"
    "  auto channel_energy = [&audio](std::size_t first, std::size_t last, unsigned channel) {\n"
    "    double energy = 0.0;\n"
    "    for (std::size_t frame = first; frame < last; ++frame) {\n"
    "      energy += std::abs(static_cast<double>(audio[frame * 2 + channel]));\n"
    "    }\n"
    "    return energy;\n"
    "  };\n"
    "  const double pre_left = channel_energy(10000, 19000, 0);\n"
    "  const double pre_right = channel_energy(10000, 19000, 1);\n"
    "  const double post_left = channel_energy(27000, 39000, 0);\n"
    "  const double post_right = channel_energy(27000, 39000, 1);\n"
    "  assert(pre_left > 1e-5 && pre_right > 1e-5 && post_left > 1e-5);\n"
    "  const double pre_ratio = pre_right / pre_left;\n"
    "  const double post_ratio = post_right / post_left;\n"
    "  assert(post_ratio < pre_ratio * .72);\n"
    "}\n\n"
    "void test_reset_is_deterministic() {\n",
    "scatter clock regression test",
)

test = replace_required(
    test,
    "  test_width_cross_output_law();\n"
    "  test_reset_is_deterministic();\n",
    "  test_width_cross_output_law();\n"
    "  test_scatter_clock_applies_fragment_drop();\n"
    "  test_reset_is_deterministic();\n",
    "register scatter regression test",
)

write(test_path, test)
print("Materialized deterministic Halo scatter, fragment, orbit, pitch-clock, and diffusion parity.")
