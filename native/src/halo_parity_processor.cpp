#include "calcotone/halo_parity_processor.hpp"
#include "calcotone/halo_parity_profiles.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace calcotone {
namespace {
constexpr float kPi = 3.14159265358979323846F;
float clamp01(float x) noexcept { return std::clamp(x, 0.F, 1.F); }
float coeff(float hz, float rate) noexcept { return 1.F - std::exp(-2.F*kPi*std::clamp(hz,10.F,rate*.45F)/rate); }
float one_pole(float x, float& z, float g) noexcept { z += (x-z)*g; return z; }
float read_delay(const std::vector<float>& b, std::size_t w, float delay) noexcept {
  float p=static_cast<float>(w)-delay, n=static_cast<float>(b.size());
  while(p<0.F)p+=n; while(p>=n)p-=n;
  auto i0=static_cast<std::size_t>(p), i1=(i0+1)%b.size();
  float f=p-static_cast<float>(i0); return b[i0]+(b[i1]-b[i0])*f;
}
float shape(float x, float amount) noexcept {
  const float drive=1.F+amount*5.5F; return std::tanh(x*drive)/std::max(.72F,std::tanh(drive));
}
}

struct HaloParityProcessor::Impl {
  float rate;
  std::array<std::atomic<float>,7> target{};
  std::array<float,7> value{1.F,.36F,.22F,.42F,.14F,.58F,.14F};
  std::array<std::vector<float>,2> delay;
  std::array<float,2> hp_low{}, lp_low{}, diffusion{}, phase{}, scatter_state{};
  std::size_t write{};
  std::uint32_t rng{0x48414c4fU};

  explicit Impl(float r):rate(std::clamp(r,8000.F,384000.F)) {
    for(std::size_t i=0;i<value.size();++i) target[i].store(value[i]);
    const auto size=static_cast<std::size_t>(rate*6.6F)+32;
    delay[0].assign(size,0.F); delay[1].assign(size,0.F);
  }
  float noise() noexcept { rng^=rng<<13; rng^=rng>>17; rng^=rng<<5; return static_cast<float>(rng&0xffffU)/32767.5F-1.F; }
  void glide() noexcept {
    value[0]=target[0].load(std::memory_order_relaxed);
    const float g=1.F-std::exp(-1.F/(rate*.055F));
    for(std::size_t i=1;i<7;++i)value[i]+=(target[i].load(std::memory_order_relaxed)-value[i])*g;
  }

  void process(float* data,std::size_t frames) noexcept {
    for(std::size_t f=0;f<frames;++f){
      glide();
      const unsigned mode=std::min(11U,static_cast<unsigned>(std::round(value[0])));
      const auto& p=halo_parity_profile(mode);
      const float seconds=std::clamp(value[1],.03F,6.2F), feedback=std::clamp(value[2],0.F,.9F);
      const float color=clamp01(value[3]), character=clamp01(value[4]), width=clamp01(value[5]), mix=clamp01(value[6]);
      const float hp_g=coeff(p.highpass,rate);
      const float lp_hz=p.lowpass_range[0]+(p.lowpass_range[1]-p.lowpass_range[0])*color;
      const float lp_g=coeff(lp_hz,rate);
      float dry[2]{data[f*2],data[f*2+1]}, tap[2]{};
      for(unsigned ch=0;ch<2;++ch){
        phase[ch]+=2.F*kPi*p.flutter_rates[ch]/rate; if(phase[ch]>=2.F*kPi)phase[ch]-=2.F*kPi;
        float mod=std::sin(phase[ch])*p.flutter_depth*(.22F+character*.78F)*rate;
        float base=seconds*p.time_ratios[ch]*rate+mod;
        tap[ch]=read_delay(delay[ch],write,std::max(1.F,base));
        if(p.re201){
          tap[ch]=tap[ch]*.48F+read_delay(delay[ch],write,std::max(1.F,base*.49F))*.31F+read_delay(delay[ch],write,std::max(1.F,base*.73F))*.21F;
        }
        float high=tap[ch]-one_pole(tap[ch],hp_low[ch],hp_g);
        float wet=one_pole(high,lp_low[ch],lp_g);
        for(unsigned stage=0;stage<p.diffusion_stages;++stage){
          float a=.18F+.13F*static_cast<float>(stage)+character*.08F;
          float y=-a*wet+diffusion[ch]; diffusion[ch]=wet+a*y; wet=y;
        }
        if(p.quantization>0.F){
          const float levels=std::pow(2.F,16.F-p.quantization*9.F);
          wet=std::round(wet*levels)/levels;
        }
        wet=wet+(shape(wet,p.saturation)-wet)*(.16F+p.saturation*.42F);
        if(p.scatter>0.F){ scatter_state[ch]+=(noise()-scatter_state[ch])*.003F; wet+=scatter_state[ch]*p.scatter*character*.035F; }
        tap[ch]=wet;
      }
      for(unsigned ch=0;ch<2;++ch){
        const unsigned other=1U-ch;
        float same=tap[ch]*p.same_feedback, cross=tap[other]*p.cross_feedback;
        float fb=(same+cross)*feedback;
        if(p.pitch_scatter>0.F) fb += std::sin(phase[ch]*.37F)*tap[ch]*p.pitch_scatter*character*.035F;
        delay[ch][write]=std::clamp(dry[ch]*p.input_trim+fb,-1.25F,1.25F);
      }
      float wet_l=tap[0], wet_r=tap[1];
      if(p.orbit_depth>0.F){
        const float orbit=std::sin((phase[0]+phase[1])*.5F)*p.orbit_depth*width;
        const float l=wet_l*(1.F-orbit*.32F)+wet_r*std::max(0.F,-orbit)*.22F;
        const float r=wet_r*(1.F+orbit*.32F)+wet_l*std::max(0.F,orbit)*.22F; wet_l=l; wet_r=r;
      }
      const float direct=1.F-width*.24F, cross=width*.24F;
      const float out_l=(wet_l*direct+wet_r*cross)*p.output_trim;
      const float out_r=(wet_r*direct+wet_l*cross)*p.output_trim;
      const float dry_g=std::cos(mix*kPi*.5F), wet_g=std::sin(mix*kPi*.5F), norm=std::max(1.F,dry_g+wet_g);
      data[f*2]=std::clamp((dry[0]*dry_g+out_l*wet_g)/norm,-1.2F,1.2F);
      data[f*2+1]=std::clamp((dry[1]*dry_g+out_r*wet_g)/norm,-1.2F,1.2F);
      write=(write+1)%delay[0].size();
    }
  }
};

HaloParityProcessor::HaloParityProcessor(float r):impl_(std::make_unique<Impl>(r)){}
HaloParityProcessor::~HaloParityProcessor()=default;
void HaloParityProcessor::process(float* d,std::size_t f) noexcept { if(d&&f)impl_->process(d,f); }
bool HaloParityProcessor::set_parameter(std::string_view n,float v) noexcept {
  if(!std::isfinite(v))return false; std::size_t i=99;
  if(n=="algorithm")i=0;else if(n=="time")i=1;else if(n=="feedback")i=2;else if(n=="color")i=3;else if(n=="character")i=4;else if(n=="width")i=5;else if(n=="mix")i=6;
  if(i>=7)return false; impl_->target[i].store(v,std::memory_order_relaxed); return true;
}
void HaloParityProcessor::reset() noexcept {
  for(auto& b:impl_->delay)std::fill(b.begin(),b.end(),0.F); impl_->hp_low={};impl_->lp_low={};impl_->diffusion={};impl_->phase={};impl_->scatter_state={};impl_->write=0;
}

}  // namespace calcotone
