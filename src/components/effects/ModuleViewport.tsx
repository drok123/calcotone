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

type EmberStyle = {
  accent:RGB;
  metal:RGB;
  stackScale:number;
  coreWidth:number;
  coreHeight:number;
  vesselScale:number;
  smoke:number;
  sparks:number;
  symmetry:number;
  damage:number;
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

  if (scene.module.id==='saturation') {
    const cameraX=Math.sin(scene.time*.22)*scene.audio.low*.24;
    const cameraY=-scene.audio.transient*.09;
    ctx.translate(cameraX,cameraY);
    drawEmber(scene);
    drawEmberFinish(scene);
    ctx.restore();
    return;
  }

  const cameraX=Math.sin(scene.time*.31+scene.variant)*scene.audio.low*.85;
  const cameraY=Math.cos(scene.time*.27+scene.variant*.4)*scene.audio.mid*.42-scene.audio.transient*.24;
  ctx.translate(cameraX,cameraY);
  drawSky(scene);
  drawDistantAtmosphere(scene);
  if (scene.module.id==='chorus') drawDrift(scene);
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

function parameterRawById(scene:Scene,id:string,fallback:number):number {
  const value=scene.module.parameters.find(parameter=>parameter.id===id)?.value;
  return typeof value==='number'?value:fallback;
}

function parameterById(scene:Scene,id:string,fallback:number):number {
  return clamp(parameterRawById(scene,id,fallback));
}

function emberStyle(mode:string,p:Palette):EmberStyle {
  const base:EmberStyle={accent:p.a,metal:[72,38,34],stackScale:1,coreWidth:1,coreHeight:1,vesselScale:1,smoke:1,sparks:1,symmetry:1,damage:0};
  if(mode==='velvet') return {...base,metal:[74,44,43],stackScale:.88,coreWidth:1.08,coreHeight:.92,vesselScale:1.08,smoke:.82,sparks:.52};
  if(mode==='tube') return {...base,accent:[255,153,92],metal:[76,47,41],stackScale:.95,coreWidth:.94,coreHeight:1.08,vesselScale:1.18,smoke:.9,sparks:.7};
  if(mode==='console') return {...base,accent:[255,133,66],metal:[65,45,38],stackScale:.82,coreWidth:1.2,coreHeight:.9,vesselScale:.86,smoke:.72,sparks:.5,symmetry:1.2};
  if(mode==='transformer') return {...base,accent:[255,174,82],metal:[64,39,35],stackScale:.92,coreWidth:1.08,coreHeight:1.02,vesselScale:1.02,smoke:.78,sparks:.82};
  if(mode==='furnace') return {...base,accent:[255,82,28],metal:[58,30,27],stackScale:1.25,coreWidth:1.12,coreHeight:1.18,vesselScale:1.04,smoke:1.35,sparks:1.02};
  if(mode==='exciter') return {...base,accent:[255,203,94],metal:[74,38,31],stackScale:1.02,coreWidth:.96,coreHeight:1.05,vesselScale:.92,smoke:.62,sparks:1.25};
  if(mode==='broken') return {...base,accent:[255,67,42],metal:[47,29,29],stackScale:1.04,coreWidth:1.03,coreHeight:.98,vesselScale:.98,smoke:1.18,sparks:1.1,symmetry:.38,damage:1};
  if(mode==='goldlion') return {...base,accent:[255,193,76],metal:[88,57,34],stackScale:1.02,coreWidth:1.05,coreHeight:1.04,vesselScale:1.05,smoke:.76,sparks:.78};
  if(mode==='mullard') return {...base,accent:[255,112,63],metal:[81,43,37],stackScale:1.03,coreWidth:1.1,coreHeight:1,vesselScale:1.14,smoke:1.08,sparks:.62};
  if(mode==='telefunken') return {...base,accent:[255,151,76],metal:[67,45,41],stackScale:.98,coreWidth:.95,coreHeight:1.08,vesselScale:.96,smoke:.68,sparks:.58,symmetry:1.25};
  if(mode==='bugleboy') return {...base,accent:[255,126,58],metal:[82,43,32],stackScale:1.07,coreWidth:1,coreHeight:1.02,vesselScale:1.09,smoke:.96,sparks:.94,symmetry:.62};
  if(mode==='rcablack') return {...base,accent:[204,69,54],metal:[31,25,27],stackScale:1.15,coreWidth:1.08,coreHeight:1.08,vesselScale:1.03,smoke:1.25,sparks:.45};
  return base;
}

function drawEmber(scene:Scene):void {
  const drive=parameterById(scene,'drive',.3);
  const heat=parameterById(scene,'heat',.35);
  const character=parameterById(scene,'character',.45);
  const dynamics=parameterById(scene,'dynamics',.38);
  const tone=clamp((parameterRawById(scene,'tone',9500)-200)/17800);
  const style=emberStyle(scene.mode,scene.p);

  drawEmberSky(scene,style,heat,tone);
  drawEmberDistantDistrict(scene,style,character);
  drawEmberStacks(scene,style,drive,heat);
  drawEmberPressureVessels(scene,style,character);
  drawEmberPipeNetwork(scene,style,character);
  drawEmberGantries(scene,style);
  drawEmberFoundation(scene,style,heat);
  drawEmberPowerBackplane(scene,style,drive,heat,tone,dynamics);
  drawEmberFurnaceCore(scene,style,drive,heat,dynamics,tone);
  drawEmberMoltenFloor(scene,style,drive,heat);
  drawEmberPowerFeed(scene,style,drive,heat,tone,dynamics);
  drawEmberAtmosphere(scene,style,heat);
}

function drawEmberSky({ctx,p,audio:a,time}:Scene,style:EmberStyle,heat:number,tone:number):void {
  const sky=ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'rgb(17,5,7)');
  sky.addColorStop(.5,'rgb(11,4,5)');
  sky.addColorStop(1,'rgb(4,2,3)');
  ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);

  const furnaceGlow=ctx.createRadialGradient(120,82,6,120,82,112);
  furnaceGlow.addColorStop(0,rgba(style.accent,.09+a.level*.075+heat*.03+tone*.012));
  furnaceGlow.addColorStop(.44,rgba(p.b,.018+heat*.013));
  furnaceGlow.addColorStop(1,'transparent');
  ctx.fillStyle=furnaceGlow;ctx.fillRect(0,0,W,H);

  for(let i=0;i<5;i+=1){
    const seed=900+i*41;
    const x=-12+random(seed)*264;
    const y=12+random(seed*2.7)*30;
    const rx=23+random(seed*4.1)*42;
    const ry=5+random(seed*5.9)*9;
    const drift=Math.sin(time*.03+i)*2.2;
    const g=ctx.createRadialGradient(x+drift,y,0,x+drift,y,rx);
    g.addColorStop(0,`rgba(70,42,39,${.014+heat*.012})`);
    g.addColorStop(1,'transparent');
    ctx.save();ctx.translate(x+drift,y);ctx.scale(1,ry/rx);ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,rx,0,TAU);ctx.fill();ctx.restore();
  }
}

function drawEmberDistantDistrict(scene:Scene,style:EmberStyle,character:number):void {
  const {ctx,audio:a}=scene;
  let x=-5;
  for(let i=0;i<18;i+=1){
    const seed=1200+i*37;
    const w=8+random(seed)*9;
    const h=12+random(seed*2.2)*25;
    const y=101-h;
    const shade=15+Math.floor(random(seed)*8);
    ctx.fillStyle=`rgba(${shade},8,9,.88)`;
    ctx.fillRect(x,y,w,h);
    if(i%5===0)ctx.fillRect(x+w*.43,y-7,Math.max(1,w*.14),7);
    if(random(seed*4.8)>.56){ctx.fillStyle=rgba(style.accent,.025+character*.025+a.mid*.018);ctx.fillRect(x+2,y+5,Math.max(1,w-4),1);}
    x+=w+2+random(seed*3.3)*3;
  }
  const haze=ctx.createLinearGradient(0,78,0,108);
  haze.addColorStop(0,'transparent');haze.addColorStop(1,rgba(style.accent,.018+a.level*.017));
  ctx.fillStyle=haze;ctx.fillRect(0,78,W,30);
}

function drawEmberStacks(scene:Scene,style:EmberStyle,drive:number,heat:number):void {
  const {ctx,audio:a,time}=scene;
  const stacks=[{x:28,h:50,w:9},{x:72,h:61,w:10},{x:168,h:61,w:10},{x:212,h:50,w:9}];
  stacks.forEach((stack,index)=>{
    const damage=style.damage*(index===0||index===2?1:0);
    const lean=(index<2?-1:1)*damage*.055;
    const h=stack.h*style.stackScale+drive*8+(index%2)*5;
    const top=108-h;
    ctx.save();ctx.translate(stack.x,108);ctx.transform(1,0,lean,1,0,0);
    const body=ctx.createLinearGradient(-stack.w/2,0,stack.w/2,0);
    body.addColorStop(0,'rgba(12,7,8,.98)');body.addColorStop(.55,rgba(style.metal,.62));body.addColorStop(1,'rgba(7,4,5,.98)');
    ctx.fillStyle=body;ctx.fillRect(-stack.w/2,-h,stack.w,h);
    ctx.fillStyle='rgba(5,3,4,.98)';ctx.fillRect(-stack.w*.68,-h-3,stack.w*1.36,3);
    ctx.fillStyle=rgba(style.accent,.045+heat*.05+a.mid*.025);ctx.fillRect(-stack.w*.35,-h+8,stack.w*.7,1.2);
    for(let band=0;band<3;band+=1){const by=-h+14+band*(h-18)/3;ctx.fillStyle='rgba(130,92,74,.075)';ctx.fillRect(-stack.w*.58,by,stack.w*1.16,1);}
    ctx.restore();
    smoke(ctx,stack.x,top-3,time+index*2.7,(7+heat*7)*style.smoke,[109,89,84],.03+heat*.028+a.mid*.016);
  });
}

function drawEmberPressureVessels(scene:Scene,style:EmberStyle,character:number):void {
  const {ctx,audio:a}=scene;
  for(const side of[-1,1]){
    const x=120+side*61;
    const y=84;
    const w=(16+character*4)*style.vesselScale;
    const h=(29+character*7)*style.vesselScale;
    const shell=ctx.createLinearGradient(x-w/2,0,x+w/2,0);
    shell.addColorStop(0,'rgba(7,4,5,.98)');shell.addColorStop(.48,rgba(style.metal,.45));shell.addColorStop(1,'rgba(8,4,5,.98)');
    ctx.fillStyle=shell;ctx.beginPath();ctx.roundRect(x-w/2,y-h/2,w,h,Math.min(7,w*.42));ctx.fill();
    stroke(ctx,[118,77,64],.12,.7);ctx.stroke();
    ctx.fillStyle=rgba(style.accent,.04+a.mid*.025);ctx.fillRect(x-w*.4,y-1,w*.8,1.5);
    ctx.fillStyle='rgba(7,4,5,.96)';ctx.fillRect(x-w*.16,y-h*.5-5,w*.32,5);
    ctx.beginPath();ctx.arc(x,y-h*.14,3,0,TAU);ctx.fillStyle='rgba(3,2,2,.96)';ctx.fill();stroke(ctx,[190,132,88],.14,.6);ctx.stroke();
    const needle=(a.mid*.7+a.transient*.2)*2.1;
    ctx.beginPath();ctx.moveTo(x,y-h*.14);ctx.lineTo(x+side*needle,y-h*.14-1.1);stroke(ctx,[255,190,111],.18,.55);ctx.stroke();
  }
}

function drawEmberPipeNetwork(scene:Scene,style:EmberStyle,character:number):void {
  const {ctx,audio:a,mode}=scene;
  const y=89-character*4;
  const broken=mode==='broken';
  const drawRun=(left:boolean)=>{
    const sx=left?58:182, mx=left?86:154, ex=left?103:137;
    ctx.beginPath();ctx.moveTo(sx,y+6);ctx.lineTo(mx,y+6);ctx.quadraticCurveTo(left?90:150,y+6,left?90:150,y+2);ctx.lineTo(left?90:150,74);ctx.lineTo(ex,74);ctx.stroke();
  };
  stroke(ctx,[116,72,58],.13+a.mid*.02,2.2);drawRun(true);if(!broken)drawRun(false);
  stroke(ctx,style.accent,.028+a.mid*.018,.8);drawRun(true);if(!broken)drawRun(false);
  for(const x of [58,86,154,182]){ctx.beginPath();ctx.arc(x,y+6,1.8,0,TAU);ctx.fillStyle='rgba(25,14,13,.98)';ctx.fill();stroke(ctx,[145,91,70],.1,.55);ctx.stroke();}
  if(character>.55){
    stroke(ctx,[98,61,52],.1,1.2);
    for(const x of [45,195]){ctx.beginPath();ctx.moveTo(x,108);ctx.lineTo(x,96);ctx.quadraticCurveTo(x,93,x+(x<120?5:-5),93);ctx.stroke();}
  }
}

function drawEmberGantries(scene:Scene,style:EmberStyle):void {
  const {ctx,audio:a,mode}=scene;
  const y=61;
  stroke(ctx,[108,76,66],.085+a.mid*.014,.75);
  for(const [x0,x1] of [[38,94],[146,202]] as const){
    ctx.beginPath();ctx.moveTo(x0,y);ctx.lineTo(x1,y);ctx.stroke();
    for(let x=x0+4;x<x1-8;x+=12){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+4,y+7);ctx.lineTo(x+8,y);ctx.stroke();}
  }
  for(const x of [42,198]){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,101);ctx.stroke();}
  if(mode==='telefunken'||mode==='console'){
    stroke(ctx,style.accent,.03+a.high*.018,.55);
    ctx.beginPath();ctx.moveTo(45,y-4);ctx.lineTo(91,y-4);ctx.moveTo(149,y-4);ctx.lineTo(195,y-4);ctx.stroke();
  }
}

function drawEmberFoundation({ctx,audio:a}:Scene,style:EmberStyle,heat:number):void {
  const shadow=ctx.createRadialGradient(120,108,1,120,108,54);
  shadow.addColorStop(0,'rgba(0,0,0,.58)');shadow.addColorStop(.62,'rgba(0,0,0,.28)');shadow.addColorStop(1,'transparent');
  ctx.save();ctx.translate(120,108);ctx.scale(1,.18);ctx.fillStyle=shadow;ctx.beginPath();ctx.arc(0,0,54,0,TAU);ctx.fill();ctx.restore();
  const glow=ctx.createLinearGradient(0,101,0,112);glow.addColorStop(0,'transparent');glow.addColorStop(1,rgba(style.accent,.035+heat*.03+a.low*.025));ctx.fillStyle=glow;ctx.fillRect(74,101,92,11);
}

function drawEmberPowerBackplane(scene:Scene,style:EmberStyle,drive:number,heat:number,tone:number,dynamics:number):void {
  const {ctx,p,audio:a,time,mode}=scene;
  const broken=mode==='broken';
  const transformer=mode==='transformer';
  const precision=clamp((style.symmetry-.45)/.8);
  const energy=clamp(.12+drive*.34+heat*.34+a.level*.26);
  const railY=100;
  const innerLeft=96,innerRight=144;
  const railWidth=(transformer?4.3:3.2)+heat*.6;
  const hotColor=tone>.56?p.hot:style.accent;

  const rail=(side:-1|1)=>{
    const from=side<0?innerLeft:innerRight;
    const to=side<0?3:237;
    const gapStart=side>0&&broken?184:null;
    const gapEnd=side>0&&broken?198:null;
    stroke(ctx,[58,36,32],.42,railWidth+2.2);
    ctx.beginPath();ctx.moveTo(from,railY);ctx.lineTo(gapStart??to,railY);ctx.stroke();
    if(gapStart!==null&&gapEnd!==null){ctx.beginPath();ctx.moveTo(gapEnd,railY);ctx.lineTo(to,railY);ctx.stroke();}
    stroke(ctx,[146,80,50],.18+heat*.12,railWidth);
    ctx.beginPath();ctx.moveTo(from,railY);ctx.lineTo(gapStart??to,railY);ctx.stroke();
    if(gapStart!==null&&gapEnd!==null){ctx.beginPath();ctx.moveTo(gapEnd,railY);ctx.lineTo(to,railY);ctx.stroke();}
    stroke(ctx,hotColor,.05+energy*.11+a.mid*.025,1.05+heat*.35);
    ctx.beginPath();ctx.moveTo(from,railY);ctx.lineTo(gapStart??to,railY);ctx.stroke();
    if(gapStart!==null&&gapEnd!==null){ctx.beginPath();ctx.moveTo(gapEnd,railY);ctx.lineTo(to,railY);ctx.stroke();}

    const standoffs=precision>.7?[24,48,72]:[20,48,76];
    for(let i=0;i<standoffs.length;i+=1){
      const offset=standoffs[i]+(1-precision)*(i%2?3:-2);
      const x=from+side*offset;
      if(side>0&&broken&&x>gapStart!&&x<gapEnd!)continue;
      ctx.fillStyle='rgba(9,7,7,.96)';ctx.fillRect(x-2,railY-5,4,10);
      stroke(ctx,[111,85,68],.15,.55);ctx.strokeRect(x-2,railY-5,4,10);
      ctx.fillStyle=rgba(style.accent,.025+heat*.03);ctx.fillRect(x-1.2,railY-1.2,2.4,2.4);
    }

    const speed=.06+drive*.18+(mode==='exciter'?.08:0)+a.low*.04;
    for(let pulse=0;pulse<2;pulse+=1){
      const t=fract(time*speed+pulse*.5+(side>0?.13:0));
      const available=broken&&side>0?(t<.56?lerp(innerRight,gapStart!,t/.56):lerp(gapEnd!,to,(t-.56)/.44)):lerp(from,to,t);
      const length=3.5+drive*4+a.transient*(5+dynamics*5);
      ctx.save();ctx.globalCompositeOperation='screen';
      const grad=ctx.createLinearGradient(available,railY,available-side*length,railY);
      grad.addColorStop(0,rgba(p.pale,.16+energy*.22+a.transient*.12));grad.addColorStop(1,'transparent');
      ctx.strokeStyle=grad;ctx.lineWidth=1.2+heat*.45;ctx.beginPath();ctx.moveTo(available,railY);ctx.lineTo(available-side*length,railY);ctx.stroke();ctx.restore();
    }
  };

  rail(-1);rail(1);

  for(const side of[-1,1] as const){
    const x=side<0?2:238;
    ctx.fillStyle='rgba(7,5,5,.98)';ctx.fillRect(x-(side<0?0:5),railY-6,5,12);
    stroke(ctx,[151,92,63],.18+energy*.08,.7);ctx.strokeRect(x-(side<0?0:5),railY-6,5,12);
    dot(ctx,side<0?3:237,railY,hotColor,.7,.045+energy*.075+a.transient*.04,4);
  }

  if(broken){
    const faultX=191;
    const fault=clamp(.25+a.high*.5+a.transient*.65);
    dot(ctx,faultX,railY,p.hot,.8+.7*fault,.08+.18*fault,7);
    stroke(ctx,p.hot,.05+.12*fault,.75);ctx.beginPath();ctx.moveTo(faultX-4,railY-1);ctx.lineTo(faultX-1,railY-6-fault*2);ctx.lineTo(faultX+2,railY+1);ctx.stroke();
  }
}

function drawEmberFurnaceCore(scene:Scene,style:EmberStyle,drive:number,heat:number,dynamics:number,tone:number):void {
  const {ctx,p,audio:a}=scene;
  const cx=120, base=111, w=58*style.coreWidth, h=52*style.coreHeight;
  const pulse=1+a.low*.024+dynamics*a.transient*.012;

  ctx.save();ctx.translate(cx,base);ctx.scale(pulse,pulse);ctx.translate(-cx,-base);
  ctx.fillStyle='rgba(7,4,5,.96)';
  ctx.beginPath();ctx.moveTo(cx-w*.52,base-2);ctx.lineTo(cx-w*.5,base-h*.62);ctx.lineTo(cx-w*.31,base-h);ctx.lineTo(cx-w*.24,base-h-4);ctx.lineTo(cx-w*.3,base);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.moveTo(cx+w*.52,base-2);ctx.lineTo(cx+w*.5,base-h*.62);ctx.lineTo(cx+w*.31,base-h);ctx.lineTo(cx+w*.24,base-h-4);ctx.lineTo(cx+w*.3,base);ctx.closePath();ctx.fill();

  const body=ctx.createLinearGradient(cx-w/2,0,cx+w/2,0);
  body.addColorStop(0,'rgba(12,7,8,.99)');body.addColorStop(.24,rgba(style.metal,.72));body.addColorStop(.54,rgba([83,42,34],.76));body.addColorStop(1,'rgba(9,5,6,.99)');
  ctx.fillStyle=body;
  ctx.beginPath();ctx.moveTo(cx-w*.46,base);ctx.lineTo(cx-w*.5,base-h*.62);ctx.lineTo(cx-w*.31,base-h);ctx.lineTo(cx+w*.31,base-h);ctx.lineTo(cx+w*.5,base-h*.62);ctx.lineTo(cx+w*.46,base);ctx.closePath();ctx.fill();

  ctx.fillStyle='rgba(13,8,8,.99)';ctx.fillRect(cx-w*.34,base-h-5,w*.68,7);
  stroke(ctx,[145,91,71],.13,.75);ctx.strokeRect(cx-w*.34,base-h-5,w*.68,7);
  ctx.fillStyle=rgba(style.accent,.035+tone*.025+a.mid*.018);ctx.fillRect(cx-w*.3,base-h-3,w*.6,1.2);

  const frontY=base-h*.59;
  ctx.fillStyle='rgba(8,4,5,.55)';ctx.fillRect(cx-w*.38,frontY,w*.76,h*.45);
  stroke(ctx,[128,78,64],.095,.65);ctx.strokeRect(cx-w*.38,frontY,w*.76,h*.45);
  for(const sx of[-1,1])for(const sy of[0,1])dot(ctx,cx+sx*w*.335,frontY+4+sy*(h*.45-8),[160,99,74],.55,.1,2);

  const mouthW=w*(.39+drive*.11), mouthH=11+heat*7, mouthY=base-24;
  const glow=ctx.createRadialGradient(cx,mouthY,1,cx,mouthY,mouthW*.9);
  glow.addColorStop(0,rgba(p.pale,.42+a.level*.2+a.transient*.15+tone*.05));glow.addColorStop(.24,rgba(style.accent,.36+drive*.18));glow.addColorStop(.64,rgba(p.a,.09+heat*.1));glow.addColorStop(1,'transparent');
  ctx.fillStyle=glow;ctx.fillRect(cx-mouthW,mouthY-mouthH*1.8,mouthW*2,mouthH*3.6);
  ctx.fillStyle='rgba(2,1,2,.96)';ctx.fillRect(cx-mouthW*.52,mouthY-mouthH*.45,mouthW*1.04,mouthH*.9);
  const core=ctx.createLinearGradient(0,mouthY-mouthH*.4,0,mouthY+mouthH*.4);
  core.addColorStop(0,rgba(p.hot,.3+heat*.2));core.addColorStop(.5,rgba(style.accent,.44+drive*.2+a.level*.14));core.addColorStop(1,rgba([255,53,20],.14));
  ctx.fillStyle=core;ctx.fillRect(cx-mouthW*.44,mouthY-mouthH*.33,mouthW*.88,mouthH*.66);
  ctx.fillStyle='rgba(7,3,3,.92)';ctx.fillRect(cx-mouthW*.58,mouthY-mouthH*.56,mouthW*1.16,2);

  for(const side of[-1,1]){
    stroke(ctx,[119,77,64],.1,.65);ctx.beginPath();ctx.moveTo(cx+side*w*.4,base-7);ctx.lineTo(cx+side*w*.4,base-h*.5);ctx.stroke();
    for(let rung=0;rung<4;rung+=1){const yy=base-13-rung*7;ctx.beginPath();ctx.moveTo(cx+side*w*.43,yy);ctx.lineTo(cx+side*w*.36,yy);ctx.stroke();}
  }
  ctx.restore();
  drawEmberCoreModeDetail(scene,style,cx,base,w,h,heat);
}

function drawEmberCoreModeDetail(scene:Scene,style:EmberStyle,cx:number,base:number,w:number,h:number,heat:number):void {
  const {ctx,mode,audio:a,time,p}=scene;
  ctx.save();ctx.globalCompositeOperation='screen';
  if(mode==='tube'||mode==='goldlion'||mode==='mullard'||mode==='telefunken'||mode==='bugleboy'||mode==='rcablack'){
    const count=mode==='bugleboy'?3:2;
    for(let i=0;i<count;i+=1){
      const spread=mode==='telefunken'?16:15;
      const x=cx+(i-(count-1)/2)*spread;
      const y=base-h-10-(i%2)*(mode==='bugleboy'?4:0);
      const rw=(mode==='mullard'?6.2:5.4)*style.vesselScale,rh=(mode==='telefunken'?11:9.5)*style.vesselScale;
      const glass=ctx.createLinearGradient(x-rw,0,x+rw,0);glass.addColorStop(0,'rgba(5,4,4,.94)');glass.addColorStop(.5,mode==='rcablack'?'rgba(18,13,14,.96)':'rgba(26,15,13,.78)');glass.addColorStop(1,'rgba(5,4,4,.94)');
      ctx.fillStyle=glass;ctx.beginPath();ctx.roundRect(x-rw,y-rh,rw*2,rh*2,3);ctx.fill();
      stroke(ctx,style.accent,.1+heat*.07+a.mid*.035,.7);ctx.stroke();
      dot(ctx,x,y+2,mode==='goldlion'?[255,210,104]:p.hot,1.7+a.low*1.1,.13+heat*.1+a.level*.06,7);
    }
  } else if(mode==='transformer'){
    for(const side of[-1,1])for(let ring=0;ring<3;ring+=1){ctx.beginPath();ctx.ellipse(cx+side*w*.25,base-h*.48,5+ring*3.2,8+ring*2.1,0,0,TAU);stroke(ctx,ring%2?style.accent:p.hot,.045+a.mid*.035,.75);ctx.stroke();}
  } else if(mode==='console'){
    ctx.fillStyle='rgba(3,2,2,.62)';ctx.fillRect(cx-w*.31,base-h*.72,w*.62,17);
    for(let strip=0;strip<7;strip+=1){const x=cx-w*.26+strip*(w*.52/6);const meter=clamp(.2+a.level*.58+Math.sin(time*.7+strip)*.06);ctx.fillStyle=rgba(strip>4?p.b:style.accent,.045+meter*.09);ctx.fillRect(x-1.5,base-h*.68+12*(1-meter),3,12*meter);}
  } else if(mode==='exciter'){
    for(let rod=0;rod<5;rod+=1){const x=cx-18+rod*9;ctx.beginPath();ctx.moveTo(x,base-h);ctx.lineTo(x+(rod-2)*1.6,base-h-11);stroke(ctx,p.hot,.06+a.high*.08,.65);ctx.stroke();dot(ctx,x+(rod-2)*1.6,base-h-11,p.hot,.5,.07+a.high*.12,5);}
  } else if(mode==='furnace'){
    ctx.fillStyle=rgba(style.accent,.045+a.level*.035);ctx.fillRect(cx-w*.28,base-h+9,w*.56,3);
    stroke(ctx,p.hot,.08+heat*.05,.75);ctx.beginPath();ctx.moveTo(cx-w*.3,base-h+14);ctx.lineTo(cx+w*.3,base-h+14);ctx.stroke();
  } else if(mode==='velvet'){
    ctx.beginPath();ctx.ellipse(cx,base-h*.62,w*.24,h*.16,0,Math.PI,TAU);stroke(ctx,style.accent,.04+a.mid*.025,.65);ctx.stroke();
  } else if(mode==='broken'){
    ctx.fillStyle='rgba(0,0,0,.58)';ctx.beginPath();ctx.moveTo(cx-6,base-h-5);ctx.lineTo(cx+3,base-h*.62);ctx.lineTo(cx-1,base-h*.35);ctx.lineTo(cx+9,base-5);ctx.lineTo(cx+2,base-4);ctx.lineTo(cx-8,base-h*.39);ctx.closePath();ctx.fill();
    for(let i=0;i<4;i+=1){const q=8100+i*23,t=fract(time*(.11+a.high*.14)+random(q));const x=cx+(random(q*2.1)-.5)*28,y=base-h*.65+t*23;dot(ctx,x,y,p.hot,.3+t*.45,.05+a.high*.1,4);}
  }
  ctx.restore();
}

function drawEmberMoltenFloor(scene:Scene,style:EmberStyle,drive:number,heat:number):void {
  const {ctx,p,audio:a,time}=scene;
  ctx.fillStyle='rgb(5,3,3)';ctx.fillRect(0,108,W,H-108);
  for(let plate=0;plate<6;plate+=1){const x=plate*42-4;ctx.fillStyle=plate%2?'rgba(17,11,11,.95)':'rgba(13,9,9,.97)';ctx.fillRect(x,108,36,H-108);stroke(ctx,[76,52,47],.06,.5);ctx.strokeRect(x,108,36,H-108);}

  ctx.save();ctx.globalCompositeOperation='screen';
  const drawChannel=(topLeft:number,topRight:number,bottomLeft:number,bottomRight:number,alpha:number,phase:number)=>{
    ctx.beginPath();ctx.moveTo(topLeft,112);ctx.lineTo(topRight,112);ctx.lineTo(bottomRight,139);ctx.lineTo(bottomLeft,139);ctx.closePath();
    const lava=ctx.createLinearGradient(0,112,0,139);lava.addColorStop(0,rgba(style.accent,.07+drive*.06));lava.addColorStop(.55,rgba(style.accent,alpha+a.level*.055));lava.addColorStop(1,rgba(p.hot,.05+heat*.04));ctx.fillStyle=lava;ctx.fill();
    ctx.beginPath();for(let i=0;i<=22;i+=1){const q=i/22;const left=lerp(topLeft,bottomLeft,q),right=lerp(topRight,bottomRight,q),x=lerp(left,right,.5),y=112+q*27+Math.sin(q*TAU*1.2+time*(.16+drive*.18)+phase)*(.35+heat*.75+a.low*.55);i?ctx.lineTo(x,y):ctx.moveTo(x,y);}stroke(ctx,p.hot,.055+drive*.03+a.level*.025,.55);ctx.stroke();
  };
  drawChannel(108,132,91,149,.16,0);
  drawChannel(46,53,25,64,.075,1.7);
  drawChannel(187,194,176,215,.075,3.1);
  ctx.restore();

  const lip=ctx.createLinearGradient(0,137,0,H);lip.addColorStop(0,'rgba(26,17,16,.99)');lip.addColorStop(1,'rgba(5,3,4,1)');ctx.fillStyle=lip;ctx.fillRect(0,139,W,11);
  stroke(ctx,[101,65,54],.1,.7);ctx.beginPath();ctx.moveTo(0,139);ctx.lineTo(W,139);ctx.stroke();
}

function drawEmberPowerFeed(scene:Scene,style:EmberStyle,drive:number,heat:number,tone:number,dynamics:number):void {
  const {ctx,p,audio:a,time,mode}=scene;
  const precision=clamp((style.symmetry-.45)/.8);
  const asym=(1-precision)*(mode==='broken'?4:mode==='bugleboy'?2.2:1.2);
  const energy=clamp(.1+drive*.38+heat*.32+a.level*.24);
  const hotColor=tone>.58?p.hot:style.accent;
  const circuitAlpha=.04+heat*.055+drive*.035+a.mid*.018;

  ctx.save();
  const traces=[
    {side:-1 as const,y:117,branch:44},
    {side:-1 as const,y:129,branch:73},
    {side:1 as const,y:117,branch:196},
    {side:1 as const,y:129,branch:167},
  ];
  for(let i=0;i<traces.length;i+=1){
    const t=traces[i];
    const side=t.side;
    const startX=120+side*(28+(i%2)*4);
    const bendX=120+side*(48+(i%2)*12)+side*asym*(i%2?1:-.5);
    const endX=t.branch+side*asym*(i%2?.5:-.25);
    const y=t.y+(i%2?asym*.25:-asym*.18);

    stroke(ctx,[87,53,44],.22,2.05);
    ctx.beginPath();ctx.moveTo(startX,109);ctx.lineTo(startX,y-5);ctx.quadraticCurveTo(startX,y,bendX,y);ctx.lineTo(endX,y);ctx.stroke();
    stroke(ctx,[180,95,52],.11+heat*.08,1.05);
    ctx.beginPath();ctx.moveTo(startX,109);ctx.lineTo(startX,y-5);ctx.quadraticCurveTo(startX,y,bendX,y);ctx.lineTo(endX,y);ctx.stroke();
    stroke(ctx,hotColor,circuitAlpha,.45+heat*.22);
    ctx.beginPath();ctx.moveTo(startX,109);ctx.lineTo(startX,y-5);ctx.quadraticCurveTo(startX,y,bendX,y);ctx.lineTo(endX,y);ctx.stroke();

    for(const q of [.28,.62,.92]){
      const nx=lerp(startX,endX,q);
      ctx.fillStyle='rgba(8,5,5,.98)';ctx.beginPath();ctx.arc(nx,y,1.8,0,TAU);ctx.fill();stroke(ctx,[142,89,65],.13,.5);ctx.stroke();
    }

    const speed=.07+drive*.22+(mode==='exciter'?.07:0);
    const pulse=fract(time*speed+i*.23);
    const px=lerp(startX,endX,pulse);
    const pulseAlpha=.06+energy*.15+a.transient*(.08+dynamics*.08);
    dot(ctx,px,y,hotColor,.55+a.transient*.65,pulseAlpha,5);
  }

  const centerFeed=ctx.createLinearGradient(0,108,0,139);
  centerFeed.addColorStop(0,rgba(hotColor,.10+energy*.11));centerFeed.addColorStop(.55,rgba(style.accent,.035+heat*.055));centerFeed.addColorStop(1,'transparent');
  ctx.fillStyle=centerFeed;ctx.fillRect(116,108,8,31);

  if(mode==='transformer'){
    stroke(ctx,p.hot,.045+a.mid*.04,1.1);
    for(const x of [82,158])for(let ring=0;ring<3;ring+=1){ctx.beginPath();ctx.arc(x,123,3+ring*2.2,0,TAU);ctx.stroke();}
  }
  if(mode==='console'||mode==='telefunken'){
    stroke(ctx,style.accent,.035+a.high*.02,.55);
    for(const y of [116,123,130]){ctx.beginPath();ctx.moveTo(30,y);ctx.lineTo(88,y);ctx.moveTo(152,y);ctx.lineTo(210,y);ctx.stroke();}
  }
  ctx.restore();
}

function drawEmberAtmosphere(scene:Scene,style:EmberStyle,heat:number):void {
  const {ctx,p,audio:a,time}=scene;
  ctx.save();ctx.globalCompositeOperation='screen';
  for(let column=0;column<3;column+=1){
    const cx=112+column*8;
    ctx.beginPath();
    for(let i=0;i<=18;i+=1){const q=i/18,y=104-q*42,x=cx+Math.sin(q*TAU*1.25+time*.72+column)*(.2+heat*.65+a.mid*.35)*q;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}
    stroke(ctx,column===1?p.hot:style.accent,.012+heat*.012+a.mid*.008,.5);ctx.stroke();
  }

  const sparkCount=Math.round((4+heat*5+a.high*6)*style.sparks);
  for(let i=0;i<sparkCount;i+=1){
    const seed=8600+i*29+hash(scene.mode)%113,t=fract(random(seed)+time*(.04+a.high*.065));
    const originX=i%3===0?120:(i%2?80:160);
    const x=originX+(random(seed*2.1)-.5)*(8+16*t)+Math.sin(time+seed)*a.transient;
    const y=106-t*(25+random(seed*3.4)*22);
    dot(ctx,x,y,i%4?p.hot:p.pale,.22+t*.34,.035+a.high*.07+a.transient*.03,3.5);
  }

  if(a.mid>.18||a.transient>.1){const ventAlpha=.014+a.mid*.025+a.transient*.028;smoke(ctx,60,91,time*1.6,4,[186,163,149],ventAlpha);smoke(ctx,180,91,time*1.6+3.1,4,[186,163,149],ventAlpha);}
  ctx.restore();
}

function drawEmberFinish({ctx,p,audio:a}:Scene):void {
  const vignette=ctx.createRadialGradient(120,78,48,120,78,142);
  vignette.addColorStop(0,'transparent');vignette.addColorStop(.7,'rgba(0,0,0,.035)');vignette.addColorStop(1,'rgba(0,0,0,.72)');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
  const soot=ctx.createLinearGradient(0,0,0,H);soot.addColorStop(0,'rgba(0,0,0,.1)');soot.addColorStop(.18,'transparent');soot.addColorStop(.84,'transparent');soot.addColorStop(1,'rgba(0,0,0,.2)');ctx.fillStyle=soot;ctx.fillRect(0,0,W,H);
  stroke(ctx,p.hot,.014+a.transient*.035,.5+a.transient*.18);ctx.strokeRect(1.5,1.5,W-3,H-3);
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