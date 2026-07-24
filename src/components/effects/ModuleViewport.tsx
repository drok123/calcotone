import { useEffect, useRef } from 'react';
import type { ModuleState } from '../../ui/types';
import { getLatestVisualAudioState, type VisualAudioState } from '../../visual/VisualEngine';
import { formatAlgorithmName } from '../../ui/formatting';
import { subscribeViewportAnimation, type ViewportRenderCallback } from './viewportScheduler';

const W = 240;
const H = 150;
const TAU = Math.PI * 2;

type RGB = readonly [number, number, number];
type Motion = { level:number; low:number; mid:number; high:number; transient:number };
type Spring = { value:number; velocity:number };
type Palette = { top:RGB; bottom:RGB; a:RGB; b:RGB; hot:RGB; pale:RGB; dark:RGB };
type Scene = {
  ctx:CanvasRenderingContext2D;
  module:ModuleState;
  mode:string;
  variant:number;
  params:number[];
  time:number;
  audio:Motion;
  p:Palette;
};

const clamp = (v:number, a=0, b=1) => Math.max(a, Math.min(b, v));
const lerp = (a:number, b:number, t:number) => a + (b-a)*t;
const fract = (v:number) => v - Math.floor(v);
const random = (seed:number) => fract(Math.sin(seed*127.1)*43758.5453123);
const rgba = (c:RGB, alpha:number) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(alpha)})`;

function hash(value:string):number {
  let out = 2166136261;
  for (let i=0;i<value.length;i+=1){ out ^= value.charCodeAt(i); out = Math.imul(out,16777619); }
  return out >>> 0;
}

function modeFor(module:ModuleState):string {
  if (module.id === 'saturation') return module.emberMode ?? 'velvet';
  if (module.id === 'chorus') return module.driftMode ?? 'chorus';
  if (module.id === 'delay') return module.delayAlgorithm ?? 'tape';
  if (module.id === 'reverb') return module.algorithm ?? 'hall';
  if (module.id === 'bitcrusher') return module.grainMode ?? 'reconstruct';
  return module.mediaMode ?? 'cassette';
}

function captionFor(module:ModuleState):string {
  if (module.id === 'saturation') return `EMBER · ${(module.emberMode ?? 'velvet').toUpperCase()}`;
  if (module.id === 'chorus') return `DRIFT · ${(module.driftMode ?? 'chorus').toUpperCase()}`;
  if (module.id === 'delay') return `HALO · ${formatAlgorithmName(module.delayAlgorithm ?? 'tape').toUpperCase()}`;
  if (module.id === 'reverb') return `ATMOS · ${(module.algorithm ?? 'hall').toUpperCase()}`;
  if (module.id === 'bitcrusher') return `GRAIN · ${(module.grainMode ?? 'reconstruct').toUpperCase()}`;
  const mode = module.mediaMode ?? 'cassette';
  return mode === 'Neve 1073' || mode === 'SSL 4000E' || mode === 'API 1608'
    ? 'ARTIFACT · SUMMING BUS'
    : `ARTIFACT · ${mode.toUpperCase()}`;
}

function paletteFor(id:string):Palette {
  if (id === 'saturation') return {top:[34,3,12],bottom:[7,2,7],a:[255,78,34],b:[255,46,136],hot:[255,215,112],pale:[255,243,222],dark:[13,2,7]};
  if (id === 'chorus') return {top:[2,19,42],bottom:[1,5,18],a:[42,225,255],b:[92,103,255],hot:[255,226,150],pale:[230,252,255],dark:[1,7,23]};
  if (id === 'delay') return {top:[8,4,40],bottom:[1,4,20],a:[76,130,255],b:[211,70,255],hot:[255,194,109],pale:[241,240,255],dark:[3,3,25]};
  if (id === 'reverb') return {top:[3,20,46],bottom:[1,7,24],a:[73,169,255],b:[160,95,255],hot:[207,237,255],pale:[239,250,255],dark:[2,8,29]};
  if (id === 'bitcrusher') return {top:[5,9,39],bottom:[2,4,20],a:[70,187,255],b:[188,82,255],hot:[105,255,209],pale:[238,248,255],dark:[3,5,24]};
  return {top:[33,14,5],bottom:[8,5,3],a:[255,185,64],b:[255,101,62],hot:[255,231,154],pale:[255,246,223],dark:[13,7,2]};
}

function spring(state:Spring, target:number, stiffness:number, damping:number, dt:number):number {
  state.velocity += (target-state.value)*stiffness*dt;
  state.velocity *= Math.exp(-damping*dt);
  state.value += state.velocity*dt;
  return clamp(state.value);
}

function physics(states:Record<keyof Motion,Spring>, audio:VisualAudioState, dt:number):Motion {
  return {
    level:spring(states.level,clamp(audio.level),34,8.5,dt),
    low:spring(states.low,clamp(audio.low),20,6,dt),
    mid:spring(states.mid,clamp(audio.mid),36,8,dt),
    high:spring(states.high,clamp(audio.high),52,10,dt),
    transient:spring(states.transient,clamp(audio.transient),82,11,dt),
  };
}

export function ModuleViewport({module}:{module:ModuleState; visualState:VisualAudioState}) {
  const canvasRef = useRef<HTMLCanvasElement|null>(null);
  const moduleRef = useRef(module);
  const lastRef = useRef(0);
  const springs = useRef<Record<keyof Motion,Spring>>({
    level:{value:0,velocity:0}, low:{value:0,velocity:0}, mid:{value:0,velocity:0},
    high:{value:0,velocity:0}, transient:{value:0,velocity:0},
  });
  moduleRef.current = module;

  useEffect(()=>{
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d',{alpha:false});
    if (!ctx) return;
    let cw=1, ch=1, dpr=Math.min(1.75,window.devicePixelRatio||1);
    const resize=()=>{
      const rect=canvas.getBoundingClientRect();
      cw=Math.max(1,rect.width); ch=Math.max(1,rect.height); dpr=Math.min(1.75,window.devicePixelRatio||1);
      const width=Math.round(cw*dpr), height=Math.round(ch*dpr);
      if (canvas.width!==width || canvas.height!==height){ canvas.width=width; canvas.height=height; }
    };
    resize();
    const observer=new ResizeObserver(resize);
    observer.observe(canvas);
    const render:ViewportRenderCallback=(stamp)=>{
      const time=stamp/1000;
      const dt=lastRef.current?clamp(time-lastRef.current,.001,.08):1/60;
      lastRef.current=time;
      const current=moduleRef.current;
      const mode=modeFor(current);
      const params=current.parameters.map(parameter=>clamp(parameter.value));
      ctx.setTransform(dpr,0,0,dpr,0,0);
      drawViewport(ctx,cw,ch,{ctx,module:current,mode,variant:hash(`${current.id}:${mode}`)%11,params,time,audio:physics(springs.current,getLatestVisualAudioState(),dt),p:paletteFor(current.id)});
    };
    const unsubscribe=subscribeViewportAnimation(render);
    return ()=>{ unsubscribe(); observer.disconnect(); };
  },[module.id]);

  return <div className={`dsp-viewport viewport-${module.id} ${module.enabled?'active':''}`}>
    <div className="viewport-glass" aria-hidden="true"/>
    <canvas ref={canvasRef} aria-hidden="true"/>
    <span className="viewport-caption">{captionFor(module)}</span>
  </div>;
}

function drawViewport(ctx:CanvasRenderingContext2D,cw:number,ch:number,scene:Scene):void {
  ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='#010205'; ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height); ctx.restore();
  if (!scene.module.enabled) return;
  const scale=Math.max(.01,Math.min((cw-4)/W,(ch-4)/H));
  ctx.save();
  ctx.translate((cw-W*scale)/2,(ch-H*scale)/2);
  ctx.scale(scale,scale);
  const cameraX=Math.sin(scene.time*.31+scene.variant)*scene.audio.low*.85;
  const cameraY=Math.cos(scene.time*.27+scene.variant*.4)*scene.audio.mid*.42-scene.audio.transient*.24;
  ctx.translate(cameraX,cameraY);
  drawSky(scene);
  drawDistantAtmosphere(scene);
  if (scene.module.id==='saturation') drawEmber(scene);
  else if (scene.module.id==='chorus') drawDrift(scene);
  else if (scene.module.id==='delay') drawHalo(scene);
  else if (scene.module.id==='reverb') drawAtmos(scene);
  else if (scene.module.id==='bitcrusher') drawGrain(scene);
  else drawArtifact(scene);
  drawFinish(scene);
  ctx.restore();
}

function drawSky({ctx,p,audio,time,variant}:Scene):void {
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,rgba(p.top,1)); g.addColorStop(.58,rgba(p.bottom,1)); g.addColorStop(1,rgba(p.dark,1));
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  const bloom=ctx.createRadialGradient(120,60,0,120,60,116);
  bloom.addColorStop(0,rgba(p.a,.05+audio.level*.065)); bloom.addColorStop(.48,rgba(p.b,.016+audio.mid*.022)); bloom.addColorStop(1,'transparent');
  ctx.fillStyle=bloom; ctx.fillRect(0,0,W,H);
  ctx.save(); ctx.globalCompositeOperation='screen';
  for(let i=0;i<25+variant;i+=1){
    const seed=variant*71+i*19;
    const x=random(seed*2.4)*W;
    const y=random(seed*5.1)*79+Math.sin(time*.22+i)*.35;
    dot(ctx,x,y,i%6===0?p.hot:p.pale,.18+random(seed*7.2)*.5,.025+random(seed)*.06+audio.high*.055,4);
  }
  ctx.restore();
}

function drawDistantAtmosphere({ctx,p,audio,time,variant}:Scene):void {
  ctx.save(); ctx.globalCompositeOperation='screen';
  for(let layer=0;layer<3;layer+=1){
    const y=62+layer*17;
    ctx.beginPath();
    for(let i=0;i<=36;i+=1){
      const q=i/36, x=q*W;
      const yy=y+Math.sin(q*TAU*(1.1+layer*.27)+time*(.05+layer*.015)+variant)*(1.4+layer*.5+audio.low*1.4);
      i?ctx.lineTo(x,yy):ctx.moveTo(x,yy);
    }
    stroke(ctx,layer%2?p.b:p.a,.012+audio.level*.013,.55);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEmber(scene:Scene):void {
  const {ctx,p,audio:a,time,variant,params}=scene;
  const drive=params[0]??.3, heat=params[1]??.35, character=params[2]??.45;
  const horizon=106;
  disc(ctx,48+(variant*27)%145,36+(variant%3)*5,13+drive*10+a.low*4,p.hot,.26+a.level*.15,p.a);
  skyline(scene,160+variant*41,97,16,7,17,18,56,[8,3,7],p.a,.15+character*.12,.45);
  ctx.save(); ctx.globalCompositeOperation='screen';
  for(let i=0;i<7;i+=1){
    const seed=700+variant*47+i*31, x=17+i*35+(random(seed)-.5)*8;
    const height=34+random(seed*1.7)*41+drive*13;
    const width=5+random(seed*2.8)*8;
    const sway=Math.sin(time*.67+i)*a.low*1.2;
    ctx.fillStyle='rgba(5,2,5,.91)'; ctx.fillRect(x+sway,horizon-height,width,height);
    ctx.fillStyle=rgba(p.a,.07+heat*.1+a.mid*.05); ctx.fillRect(x+1+sway,horizon-height+5,Math.max(1,width-2),2);
    if(i%2===variant%2){
      beam(ctx,x+width*.5+sway,horizon-height+2,x+width*.5,18,3+heat*5,p.a,.016+a.high*.03);
      smoke(ctx,x+width*.5+sway,horizon-height,time+i,8+heat*8,p.pale,.018+a.high*.025);
    }
  }
  for(let pipe=0;pipe<4;pipe+=1){
    const x=19+pipe*67+(variant%2)*7;
    stroke(ctx,pipe%2?p.b:p.hot,.045+a.mid*.035,.85);
    ctx.beginPath();ctx.moveTo(x,109);ctx.lineTo(x,88-pipe%2*7);ctx.lineTo(x+20,88-pipe%2*7);ctx.lineTo(x+20,78-pipe%3*5);ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle='rgba(1,2,5,.95)'; ctx.fillRect(0,108,W,H-108);
  ctx.save(); ctx.globalCompositeOperation='screen';
  for(let r=0;r<6;r+=1){
    ctx.beginPath();
    for(let i=0;i<=34;i+=1){const q=i/34,x=q*W,y=113+r*6.2+Math.sin(q*TAU*1.45+time*(.1+drive*.2)+r*1.25)*(1+heat*2.8+a.low*1.1);i?ctx.lineTo(x,y):ctx.moveTo(x,y)}
    stroke(ctx,r%2?p.b:p.hot,.05+drive*.055+a.level*.04,.65+heat*.55);ctx.stroke();
  }
  for(let i=0;i<17;i+=1){const seed=1100+variant*53+i*13,t=fract(random(seed)+time*(.014+a.high*.035));dot(ctx,random(seed*2.2)*W,112-t*67,i%3?p.a:p.hot,.3+t*.8,.045+a.high*.075,5)}
  ctx.restore();
}

function drawDrift(scene:Scene):void {
  const {ctx,p,audio:a,time,variant,params}=scene;
  const depth=params[0]??.4, rate=params[1]??.3, spread=params[2]??.5;
  disc(ctx,63+(variant%4)*39,35+(variant%2)*8,10+depth*8,p.a,.11+a.mid*.09,p.pale);
  ctx.fillStyle='rgba(2,8,20,.84)';
  ctx.beginPath();ctx.moveTo(0,100);for(let i=0;i<=18;i+=1)ctx.lineTo(i/18*W,82-random(i*9.2+variant*31)*23);ctx.lineTo(W,111);ctx.lineTo(0,111);ctx.fill();
  for(let i=0;i<9;i+=1){
    const seed=1450+variant*43+i*17,z=random(seed*2.3),x=14+random(seed)*212;
    const y=54+z*49+Math.sin(time*(.22+rate*.35)+seed)*(1.2+a.low*3)*(1-z*.45);
    const w=3+(1-z)*(4+spread*4), h=12+(1-z)*34;
    ctx.fillStyle=`rgba(2,9,24,${.52+(1-z)*.3})`;ctx.fillRect(x-w/2,y-h,w,h);
    stroke(ctx,i%2?p.b:p.a,.055+a.mid*.065,.65);ctx.strokeRect(x-w/2,y-h,w,h);
    if(i%3===0){ctx.beginPath();ctx.moveTo(x-w*.7,y-h*.55);ctx.lineTo(x+w*.8,y-h*.55);stroke(ctx,p.pale,.035+a.high*.045,.55);ctx.stroke()}
  }
  ctx.fillStyle='rgba(1,6,18,.95)';ctx.fillRect(0,91,W,H-91);
  ctx.save();ctx.globalCompositeOperation='screen';
  for(let r=0;r<13;r+=1){const q=r/12,y=94+r*4.65,amp=.5+q*(1.8+depth*2.5)+a.low*1.2;ctx.beginPath();for(let i=0;i<=42;i+=1){const t=i/42,x=t*W,yy=y+Math.sin(t*TAU*(1.2+spread*2.4)+time*(.18+rate*.8)+r*.68)*amp;i?ctx.lineTo(x,yy):ctx.moveTo(x,yy)}stroke(ctx,r%3===0?p.pale:r%2?p.a:p.b,.018+q*.045+a.high*.03,.5+q*.42);ctx.stroke()}
  for(let ribbon=0;ribbon<4;ribbon+=1){ctx.beginPath();for(let i=0;i<=44;i+=1){const q=i/44,x=q*W,y=49+ribbon*11+Math.sin(q*TAU*(1.05+ribbon*.19)+time*(.34+rate*.8)+ribbon)*(3.2+depth*7+a.mid*2.6);i?ctx.lineTo(x,y):ctx.moveTo(x,y)}stroke(ctx,ribbon%2?p.b:p.a,.025+a.level*.038,.9+spread*.8);ctx.stroke()}
  for(let i=0;i<8;i+=1){const seed=1900+variant*29+i*13,t=fract(random(seed)+time*(.006+rate*.02));const x=random(seed*3.1)*W,y=96+t*45;dot(ctx,x,y,i%2?p.b:p.a,.3+.4*t,.03+a.high*.04,4)}
  ctx.restore();
}

function drawHalo(scene:Scene):void {
  const {ctx,p,audio:a,time,variant,params,mode}=scene;
  const feedback=params[0]??.45, timing=params[1]??.4, tone=params[2]??.55, seed=hash(mode)%997;
  disc(ctx,42+(variant*37)%156,28+(variant%2)*9,8+tone*7,p.b,.11+a.level*.075,p.pale);
  skyline(scene,400+seed,83,22,5,13,15,41,[3,4,17],p.b,.27+feedback*.11,.25);
  skyline(scene,900+seed,112,17,8,19,26,75,[2,3,13],p.a,.22+tone*.14,.78);
  drawBillboards(scene,seed);
  ctx.fillStyle='rgba(1,2,8,.96)';ctx.beginPath();ctx.moveTo(89,94);ctx.lineTo(151,94);ctx.lineTo(207,H);ctx.lineTo(33,H);ctx.closePath();ctx.fill();
  ctx.save();ctx.globalCompositeOperation='screen';
  for(const side of[-1,1]){ctx.beginPath();ctx.moveTo(120+side*18,96);ctx.lineTo(120+side*81,H);stroke(ctx,side>0?p.b:p.a,.055+a.mid*.05,.8);ctx.stroke();ctx.beginPath();ctx.moveTo(120+side*7,96);ctx.lineTo(120+side*26,H);stroke(ctx,p.pale,.018+a.high*.025,.55);ctx.stroke()}
  const echoes=6+Math.round(feedback*8);
  for(let i=0;i<echoes;i+=1){const q=fract(time*(.11+timing*.5)+i/echoes+variant*.07),y=lerp(97,H+8,q*q),spread=lerp(4,58,q),alpha=(1-q)*(.07+feedback*.075)+a.level*.03;beam(ctx,120-spread,y,118,97,1.1+q*2.1,p.a,alpha);beam(ctx,120+spread,y,122,97,1.1+q*2.1,p.b,alpha)}
  for(let i=0;i<9;i+=1){const q=2200+seed+i*29,speed=.016+random(q)*.026+a.high*.03,t=fract(random(q*2.1)+time*speed+a.transient*.025),y=22+random(q*4.3)*64,dir=random(q*5.2)>.5?1:-1,x=dir>0?-14+t*268:254-t*268;ctx.beginPath();ctx.moveTo(x-dir*(6+a.high*8),y);ctx.lineTo(x,y);stroke(ctx,i%2?p.b:p.a,.04+a.high*.07,.75);ctx.stroke()}
  for(let rain=0;rain<18;rain+=1){const q=2600+variant*41+rain*17,t=fract(random(q)+time*(.035+.05*a.high)),x=random(q*2.8)*W,y=t*102;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-1.5-a.low,y+4+a.high*3);stroke(ctx,p.pale,.012+a.high*.027,.45);ctx.stroke()}
  ctx.restore();
}

function drawBillboards(scene:Scene,seed:number):void {
  const {ctx,p,audio:a,time}=scene;
  ctx.save();ctx.globalCompositeOperation='screen';
  for(let i=0;i<4;i+=1){const q=seed+i*67,side=i%2?1:-1,x=120+side*(47+random(q)*51),y=45+random(q*1.7)*45,w=14+random(q*2.4)*19,h=5+random(q*3.2)*9,c=i%2?p.b:p.a;ctx.fillStyle=rgba(c,.025+a.mid*.035);ctx.fillRect(x-w/2,y-h/2,w,h);stroke(ctx,c,.12+a.high*.09,.7);ctx.strokeRect(x-w/2,y-h/2,w,h);for(let line=0;line<3;line+=1){ctx.fillStyle=rgba(p.pale,.07+a.high*.07);ctx.fillRect(x-w*.34,y-2+line*2,w*(.25+random(q+line*13)*.5),.55)}if(i===0&&Math.sin(time*3+q)>.82){ctx.fillStyle=rgba(p.hot,.08+a.high*.08);ctx.fillRect(x-w/2,y-h/2,w,h)}}
  ctx.restore();
}

function drawAtmos(scene:Scene):void {
  const {ctx,p,audio:a,time,variant,params}=scene;
  const size=params[0]??.55, decay=params[1]??.5, shimmer=params[2]??.35;
  disc(ctx,120+Math.sin(time*.05+variant)*3,41,18+size*17,variant%2?p.b:p.a,.065+a.level*.065,p.pale);
  ctx.fillStyle='rgba(2,7,19,.79)';
  for(const side of[-1,1]){ctx.beginPath();ctx.moveTo(side<0?0:W,H);ctx.lineTo(120+side*42,99);ctx.lineTo(120+side*57,53-size*12);ctx.lineTo(120+side*82,64-size*7);ctx.lineTo(side<0?0:W,79);ctx.closePath();ctx.fill()}
  ctx.save();ctx.globalCompositeOperation='screen';
  for(let arch=0;arch<5+variant%3;arch+=1){const q=arch/(4+variant%3),w=lerp(110,24,q),h=lerp(95,28,q),y=lerp(131,74,q),sway=Math.sin(time*.08+arch)*a.low*(1-q);ctx.beginPath();ctx.moveTo(120-w/2+sway,y);ctx.lineTo(120-w/2+sway,y-h*.52);ctx.quadraticCurveTo(120+sway,y-h,120+w/2+sway,y-h*.52);ctx.lineTo(120+w/2+sway,y);stroke(ctx,arch%2?p.b:p.a,.025+(1-q)*.038+a.mid*.035,.65+(1-q)*.6);ctx.stroke()}
  for(let i=0;i<6+Math.round(shimmer*4);i+=1){const q=3000+variant*59+i*23,x=22+random(q)*196,w=5+random(q*2.1)*(10+size*10);beam(ctx,x,14,120+(x-120)*.17,134,w,i%2?p.b:p.pale,.009+decay*.014+a.mid*.023)}
  for(let i=0;i<11;i+=1){const q=3400+variant*47+i*31,z=random(q*1.8),x=10+random(q)*220,y=57+z*54+Math.sin(time*(.07+decay*.1)+q)*(.7+a.low*1.7),w=4+(1-z)*13;ctx.fillStyle=`rgba(5,11,27,${.35+(1-z)*.34})`;ctx.beginPath();ctx.ellipse(x,y,w,1.5+(1-z)*3.7,0,0,TAU);ctx.fill();dot(ctx,x+w*.3,y-1,i%2?p.b:p.a,.3+(1-z)*.5,.035+a.high*.05,5)}
  for(let isle=0;isle<4;isle+=1){const q=3900+variant*73+isle*37,x=30+random(q)*180,y=61+random(q*2.1)*42,w=7+random(q*3.2)*12;ctx.fillStyle='rgba(3,7,17,.72)';ctx.beginPath();ctx.moveTo(x-w,y);ctx.lineTo(x+w,y);ctx.lineTo(x+w*.3,y+6+random(q)*5);ctx.lineTo(x-w*.2,y+8+random(q*4.2)*5);ctx.closePath();ctx.fill();stroke(ctx,isle%2?p.b:p.a,.03+a.mid*.025,.55);ctx.stroke();}
  ctx.restore();
}

function drawGrain(scene:Scene):void {
  const {ctx,p,audio:a,time,variant,params}=scene;
  const crush=params[0]??.42, rate=params[1]??.48, mix=params[2]??.5;
  const sun=16+mix*10,sx=52+(variant*41)%136;
  for(let y=-3;y<=3;y+=1)for(let x=-3;x<=3;x+=1){if(x*x+y*y>11)continue;const cell=sun/6;ctx.fillStyle=rgba((x+y)%2?p.b:p.a,.025+a.mid*.04);ctx.fillRect(sx+x*cell,35+y*cell,cell-.45,cell-.45)}
  for(let i=0;i<18;i+=1){const seed=4300+variant*61+i*29,x=i*(W/18)-2,w=7+random(seed)*9,h=20+random(seed*1.9)*56,blocks=4+Math.round(h/8);for(let block=0;block<blocks;block+=1){const bh=h/blocks,detach=block>blocks-3?a.transient*(random(seed+block*19)-.5)*(6+crush*12):0,jitter=(random(seed*3.2+block*7)-.5)*crush*3,y=111-(block+1)*bh;ctx.fillStyle=`rgba(3,5,18,${.7+random(seed+block)*.22})`;ctx.fillRect(x+jitter+detach,y-Math.abs(detach)*.25,w,bh-.55);if(random(seed+block*5.4)>.46){ctx.fillStyle=rgba(block%2?p.b:p.a,.045+a.high*.085);ctx.fillRect(x+2+jitter+detach,y+2,Math.max(1,w-4),1)}}}
  ctx.fillStyle='rgba(1,2,10,.93)';ctx.fillRect(0,109,W,H-109);
  ctx.save();ctx.globalCompositeOperation='screen';
  for(let row=0;row<8;row+=1){const q=row/7,y=110+q*q*41;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);stroke(ctx,row%2?p.b:p.a,.018+q*.04+a.high*.03,.55);ctx.stroke()}
  for(let col=-7;col<=7;col+=1){ctx.beginPath();ctx.moveTo(120+col*3.5,108);ctx.lineTo(120+col*18,H);stroke(ctx,col%2?p.b:p.a,.013+a.mid*.023,.55);ctx.stroke()}
  for(let i=0;i<5+Math.round(crush*5);i+=1){const q=4800+variant*83+i*37,t=fract(random(q)+time*(.02+rate*.13)),y=17+t*119,w=24+random(q*2.1)*94,x=random(q*3.4)*(W-w);ctx.fillStyle=rgba(i%2?p.b:p.a,.01+a.high*.032+crush*.017);ctx.fillRect(x,y,w,1+random(q*4.6)*2.4)}
  for(let i=0;i<22;i+=1){const q=5200+variant*101+i*17,t=fract(random(q)+time*(.01+rate*.06)),x=random(q*2.8)*W+Math.sin(time+q)*a.transient*5,y=20+t*108,z=.55+random(q*4.2)*1.9+crush*.8;ctx.fillStyle=rgba(i%3?p.a:p.hot,.025+a.high*.075);ctx.fillRect(x,y,z,z)}
  ctx.restore();
}

function drawArtifact(scene:Scene):void {
  const {ctx,p,audio:a,time,variant,params,mode}=scene;
  const age=params[0]??.45,tone=params[1]??.5,motion=params[2]??.4;
  if(mode==='Neve 1073'||mode==='SSL 4000E'||mode==='API 1608'){drawConsoleCity(scene);return}
  disc(ctx,178-variant*7,38,10+tone*7,p.hot,.1+a.level*.065,p.pale);
  skyline(scene,5600+hash(mode)%601,112,15,7,17,18,49,[9,6,3],p.a,.12+tone*.12,.58);
  for(const side of[-1,1]){const x=120+side*(34+variant%3*4),y=63,r=15+age*5;ctx.fillStyle='rgba(3,3,3,.82)';ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();stroke(ctx,p.hot,.08+a.mid*.055,.9);ctx.stroke();for(let i=0;i<6;i+=1){const angle=time*(.11+motion*.8)*side+i/6*TAU;ctx.beginPath();ctx.moveTo(x+Math.cos(angle)*4,y+Math.sin(angle)*4);ctx.lineTo(x+Math.cos(angle)*(r-3),y+Math.sin(angle)*(r-3));stroke(ctx,p.a,.05+a.high*.045,.65);ctx.stroke()}dot(ctx,x,y,p.hot,1.1,.1+a.level*.075,7)}
  ctx.save();ctx.globalCompositeOperation='screen';
  ctx.beginPath();for(let i=0;i<=48;i+=1){const q=i/48,x=28+q*184,y=85+Math.sin(q*TAU*(1.4+variant*.06)+time*(.18+motion*.45))*(5+age*6+a.low*2.5);i?ctx.lineTo(x,y):ctx.moveTo(x,y)}stroke(ctx,p.hot,.06+a.mid*.05,1.05);ctx.stroke();
  for(let i=0;i<19;i+=1){const q=6100+variant*73+i*29,t=fract(random(q)+time*(.008+motion*.02));dot(ctx,random(q*2.3)*W,16+t*119,i%4?p.hot:p.a,.24+random(q)*.5,.018+age*.038+a.high*.032,4)}
  ctx.restore();
  ctx.fillStyle='rgba(3,3,3,.9)';ctx.fillRect(0,112,W,H-112);
  for(let i=0;i<10;i+=1){const x=12+i*24,meter=clamp(.14+a.level*.65+Math.sin(time*.9+i)*.07);ctx.fillStyle=rgba(i>7?p.b:p.a,.025+meter*.065);ctx.fillRect(x,125-meter*14,11,meter*14);stroke(ctx,p.hot,.04,.5);ctx.strokeRect(x,111,11,15)}
}

function drawConsoleCity({ctx,p,audio:a,time,variant,params,mode}:Scene):void {
  const drive=params[0]??.4,tone=params[1]??.5,width=params[2]??.5;
  const flavor=mode==='SSL 4000E'?1:mode==='API 1608'?2:0;
  ctx.fillStyle='rgba(2,3,4,.9)';ctx.beginPath();ctx.moveTo(76,40);ctx.lineTo(164,40);ctx.lineTo(224,H);ctx.lineTo(16,H);ctx.closePath();ctx.fill();
  ctx.save();ctx.globalCompositeOperation='screen';
  for(let i=0;i<12;i+=1){const q=i/11,xt=lerp(86,154,q),xb=lerp(28,212,q);ctx.beginPath();ctx.moveTo(xt,43);ctx.lineTo(xb,H);stroke(ctx,(i+flavor)%3===0?p.hot:p.a,.018+a.mid*.024,.6);ctx.stroke();const f=clamp(.18+a.level*.58+random(i+variant*17)*.18+Math.sin(time*.35+i)*.05),y=lerp(127,68,f),x=lerp(xb,xt,(H-y)/(H-43)),spread=1+width*1.7;ctx.fillStyle=rgba(i>8?p.b:p.hot,.1+a.high*.085);ctx.fillRect(x-2*spread,y-1,4*spread,2)}
  for(let i=0;i<18;i+=1){const x=58+i*7,e=clamp(a.low*.55+a.mid*.65+random(i*8.7+variant)*.18),h=4+e*(21+drive*12);ctx.fillStyle=rgba(i>14?p.b:p.a,.035+e*.075+tone*.02);ctx.fillRect(x,59-h,3.3,h)}
  for(let i=0;i<6;i+=1){const x=82+i*15;ctx.beginPath();ctx.arc(x,78+(i%2)*8,3.4+width*1.2,0,TAU);stroke(ctx,i%2?p.b:p.hot,.055+a.high*.05,.7);ctx.stroke();dot(ctx,x,78+(i%2)*8,i%2?p.b:p.hot,.5,.04+a.mid*.04,4)}
  ctx.restore();
}

function skyline(scene:Scene,seed:number,baseline:number,count:number,minW:number,maxW:number,minH:number,maxH:number,body:RGB,window:RGB,chance:number,depth:number):void {
  const {ctx,audio:a,time}=scene;
  let cursor=-8;
  for(let i=0;i<count;i+=1){
    const q=seed+i*31,w=lerp(minW,maxW,random(q*1.7)),h=lerp(minH,maxH,random(q*2.4)),gap=.8+random(q*3.9)*3.5;
    const x=cursor+Math.sin(time*(.18+depth*.13)+q)*a.low*depth*.8,y=baseline-h;
    const shade=Math.floor(6+depth*8+random(q)*5);
    ctx.fillStyle=`rgba(${shade},${shade+1},${shade+7},${.72+depth*.22})`;ctx.fillRect(x,y,w,h);
    ctx.fillStyle=rgba(body,.035+depth*.025);ctx.fillRect(x,y,1,h);
    const roof=Math.floor(random(q*5.3)*5);
    if(roof===1)ctx.fillRect(x+w*.42,y-7,Math.max(1,w*.16),7);
    else if(roof===2){ctx.beginPath();ctx.moveTo(x+w*.2,y);ctx.lineTo(x+w*.5,y-7);ctx.lineTo(x+w*.8,y);ctx.fill()}
    else if(roof===3){ctx.fillRect(x+w*.12,y-3,w*.76,2);ctx.fillRect(x+w*.47,y-8,1,5)}
    const rows=Math.max(1,Math.floor(h/7)),cols=Math.max(1,Math.floor(w/4.5));
    for(let row=0;row<rows;row+=1)for(let col=0;col<cols;col+=1){const z=q+row*17+col*47;if(random(z)>chance)continue;const flicker=random(z*2.2)>.86?.55+Math.sin(time*4+z)*.45:1;ctx.fillStyle=rgba(window,(.025+a.mid*.045+a.high*.023)*flicker*(.55+depth*.5));ctx.fillRect(x+2+col*4,y+4+row*6,1.15+depth*.65,1.35)}
    cursor+=w+gap;if(cursor>W+8)break;
  }
}

function smoke(ctx:CanvasRenderingContext2D,x:number,y:number,time:number,spread:number,c:RGB,alpha:number):void {
  for(let i=0;i<5;i+=1){const t=fract(time*.035+i*.19),dx=Math.sin(time*.3+i)*spread*t,dy=t*24,r=2+t*6;const g=ctx.createRadialGradient(x+dx,y-dy,0,x+dx,y-dy,r);g.addColorStop(0,rgba(c,alpha*(1-t)));g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(x+dx-r,y-dy-r,r*2,r*2)}
}

function drawFinish({ctx,p,audio:a,time,variant}:Scene):void {
  ctx.fillStyle='rgba(0,0,0,.28)';ctx.beginPath();ctx.moveTo(0,116);ctx.lineTo(22,125);ctx.lineTo(31,H);ctx.lineTo(0,H);ctx.fill();ctx.beginPath();ctx.moveTo(W,116);ctx.lineTo(W-22,125);ctx.lineTo(W-31,H);ctx.lineTo(W,H);ctx.fill();
  ctx.save();ctx.globalCompositeOperation='screen';
  for(let i=0;i<8+variant;i+=1){const q=7000+variant*71+i*43,speed=.016+random(q)*.025+a.high*.045,t=fract(random(q*2.4)+time*speed),x=random(q*3.1)*W,y=t*H,len=1+a.high*4+random(q*4.7)*2;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-a.low*1.2,y+len);stroke(ctx,i%3?p.pale:p.a,.012+a.high*.04,.45);ctx.stroke()}
  ctx.restore();
  ctx.fillStyle='rgba(255,255,255,.008)';for(let y=2;y<H;y+=5)ctx.fillRect(0,y,W,.35);
  const vignette=ctx.createRadialGradient(120,72,38,120,72,139);vignette.addColorStop(0,'transparent');vignette.addColorStop(.67,'rgba(0,0,0,.025)');vignette.addColorStop(1,'rgba(0,0,0,.74)');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
  stroke(ctx,p.pale,.022+a.transient*.09,.55+a.transient*.48);ctx.strokeRect(1.5,1.5,W-3,H-3);
}

function stroke(ctx:CanvasRenderingContext2D,c:RGB,alpha:number,width=.8):void { ctx.strokeStyle=rgba(c,alpha);ctx.lineWidth=width; }
function dot(ctx:CanvasRenderingContext2D,x:number,y:number,c:RGB,r:number,alpha:number,blur=8):void { ctx.save();ctx.globalCompositeOperation='screen';ctx.fillStyle=rgba(c,alpha);ctx.shadowColor=rgba(c,Math.min(.6,alpha*1.6));ctx.shadowBlur=blur;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.restore(); }
function disc(ctx:CanvasRenderingContext2D,x:number,y:number,r:number,c:RGB,alpha:number,core:RGB):void { ctx.save();ctx.globalCompositeOperation='screen';const g=ctx.createRadialGradient(x,y,0,x,y,r*2.6);g.addColorStop(0,rgba(core,alpha*1.25));g.addColorStop(.28,rgba(c,alpha));g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(x-r*2.7,y-r*2.7,r*5.4,r*5.4);ctx.restore(); }
function beam(ctx:CanvasRenderingContext2D,x0:number,y0:number,x1:number,y1:number,width:number,c:RGB,alpha:number):void { const dx=x1-x0,dy=y1-y0,length=Math.hypot(dx,dy)||1,nx=-dy/length*width,ny=dx/length*width,g=ctx.createLinearGradient(x0,y0,x1,y1);g.addColorStop(0,rgba(c,alpha));g.addColorStop(1,rgba(c,0));ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(x0+nx,y0+ny);ctx.lineTo(x0-nx,y0-ny);ctx.lineTo(x1-nx*.15,y1-ny*.15);ctx.lineTo(x1+nx*.15,y1+ny*.15);ctx.closePath();ctx.fill(); }
