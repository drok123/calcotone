import { clampParameter } from '../Parameter';
import { BaseEffect } from './Effect';

export type EmberMode = 'velvet' | 'tube' | 'console' | 'transformer' | 'furnace' | 'exciter' | 'broken';
export const EMBER_MODE_ORDER: EmberMode[] = ['velvet','tube','console','transformer','furnace','exciter','broken'];
const MODE={id:'mode',label:'Mode',min:0,max:EMBER_MODE_ORDER.length-1,defaultValue:0,step:1};
const DRIVE={id:'drive',label:'Drive',min:0,max:1,defaultValue:.14,step:.01};
const TONE={id:'tone',label:'Tone',min:200,max:18000,defaultValue:9500,step:10,unit:'Hz'};
const HEAT={id:'heat',label:'Heat',min:0,max:1,defaultValue:.18,step:.01};
const CHARACTER={id:'character',label:'Character',min:0,max:1,defaultValue:.22,step:.01};
const DYNAMICS={id:'dynamics',label:'Dynamics',min:0,max:1,defaultValue:.38,step:.01};
const MIX={id:'mix',label:'Mix',min:0,max:1,defaultValue:.22,step:.01};

const curveCache=new Map<string,Float32Array<ArrayBuffer>>();
export class SaturationEffect extends BaseEffect {
 public readonly id='saturation'; public readonly name='Ember';
 private readonly preGain:GainNode; private readonly shaper:WaveShaperNode; private readonly hp:BiquadFilterNode; private readonly tone:BiquadFilterNode; private readonly presence:BiquadFilterNode; private readonly compressor:DynamicsCompressorNode; private readonly post:GainNode;
 private mode:EmberMode='velvet'; private drive=.14; private heat=.18; private character=.22; private dynamics=.38; private toneHz=9500;
 constructor(context:AudioContext){ super(context); this.preGain=context.createGain(); this.shaper=context.createWaveShaper(); this.hp=context.createBiquadFilter(); this.tone=context.createBiquadFilter(); this.presence=context.createBiquadFilter(); this.compressor=context.createDynamicsCompressor(); this.post=context.createGain();
  this.hp.type='highpass'; this.hp.frequency.value=22; this.hp.Q.value=.5; this.tone.type='lowpass'; this.presence.type='peaking'; this.presence.frequency.value=3200; this.presence.Q.value=.65; this.shaper.oversample='4x'; this.compressor.attack.value=.004; this.compressor.release.value=.09; this.compressor.knee.value=12;
  this.input.connect(this.preGain); this.preGain.connect(this.hp); this.hp.connect(this.shaper); this.shaper.connect(this.tone); this.tone.connect(this.presence); this.presence.connect(this.compressor); this.compressor.connect(this.post); this.post.connect(this.wetGain);
  this.initializeParameters([MODE,DRIVE,TONE,HEAT,CHARACTER,DYNAMICS,MIX]); for(const p of [MODE,DRIVE,TONE,HEAT,CHARACTER,DYNAMICS,MIX]) this.setParameter(p.id,p.defaultValue);
 }
 // Audio quality floor: the adaptive governor may request `none` in Live mode,
 // but Ember's non-linear stage is exactly where aliasing becomes most audible.
 // Keep a 2x minimum so visual/CPU pressure cannot make the signal suddenly
 // sound coarse. Balanced/Studio requests still retain their intended 2x/4x quality.
 public setOversampling(v:OverSampleType){this.shaper.oversample=v==='none'?'2x':v;}
 public setParameter(id:string,value:number){ const now=this.context.currentTime;
  if(id==='mode'){const v=clampParameter(value,MODE);this.parameterValues.set(id,v);this.mode=EMBER_MODE_ORDER[Math.round(v)]??'velvet';this.apply();return;}
  if(id==='drive')this.drive=clampParameter(value,DRIVE); else if(id==='tone')this.toneHz=clampParameter(value,TONE); else if(id==='heat')this.heat=clampParameter(value,HEAT); else if(id==='character')this.character=clampParameter(value,CHARACTER); else if(id==='dynamics')this.dynamics=clampParameter(value,DYNAMICS); else if(id==='mix'){const v=clampParameter(value,MIX);this.parameterValues.set(id,v);this.setWetDryMix(v);return;} else {console.warn(`Unknown parameter "${id}" for ${this.name}.`);return;}
  this.parameterValues.set(id,id==='drive'?this.drive:id==='tone'?this.toneHz:id==='heat'?this.heat:id==='character'?this.character:this.dynamics); this.apply(now);
 }
 private apply(now=this.context.currentTime){const modeIndex=EMBER_MODE_ORDER.indexOf(this.mode); const aggression=[.7,1,1.15,1.3,2.2,1.05,2.8][modeIndex]; const input=1+Math.pow(this.drive,1.35)*(4.2*aggression)+this.heat*1.4; this.preGain.gain.setTargetAtTime(input,now,.012); this.tone.frequency.setTargetAtTime(Math.max(1200,this.toneHz*(1-this.heat*.18)),now,.025); this.presence.gain.setTargetAtTime((this.mode==='exciter'?5:2.2)*(this.character-.35),now,.025); this.presence.frequency.setTargetAtTime(this.mode==='transformer'?1700:3200+this.character*2600,now,.025);
  this.compressor.threshold.setTargetAtTime(-4-this.dynamics*12,now,.03); this.compressor.ratio.setTargetAtTime(1.2+this.dynamics*3.8,now,.03); this.post.gain.setTargetAtTime(1/Math.pow(input,.72),now,.02); this.shaper.curve=getCurve(this.mode,this.drive,this.heat,this.character);
 }
 public override dispose(){for(const n of [this.preGain,this.shaper,this.hp,this.tone,this.presence,this.compressor,this.post])n.disconnect();super.dispose();}
}
function getCurve(mode:EmberMode,drive:number,heat:number,ch:number){const key=`${mode}:${Math.round(drive*64)}:${Math.round(heat*32)}:${Math.round(ch*32)}`;const hit=curveCache.get(key);if(hit)return hit;const n=8192,c=new Float32Array(n);const asym=mode==='tube'||mode==='transformer'?(.12+.2*ch):mode==='broken'?(.32*ch):.04*ch;const k=1.2+drive*7+heat*3+(mode==='furnace'?5:0);for(let i=0;i<n;i++){const x=i/(n-1)*2-1;let y=Math.tanh((x+Math.max(0,x)*asym)*k)/Math.tanh(k);if(mode==='console')y=.72*y+.28*Math.atan(x*k*1.3)/Math.atan(k*1.3);if(mode==='transformer')y+=Math.sin(x*Math.PI)*.035*heat;if(mode==='exciter')y=.82*y+.18*Math.tanh(x*k*2.4);if(mode==='broken')y=Math.tanh((y+Math.sin(x*17)*.06*ch)*1.15);c[i]=Math.max(-1,Math.min(1,y));}curveCache.set(key,c);if(curveCache.size>180)curveCache.delete(curveCache.keys().next().value!);return c;}
