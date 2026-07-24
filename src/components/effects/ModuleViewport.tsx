import { useEffect, useRef } from 'react';
import type { ModuleState } from '../../ui/types';
import { getLatestVisualAudioState, type VisualAudioState } from '../../visual/VisualEngine';
import { formatAlgorithmName } from '../../ui/formatting';
import { subscribeViewportAnimation, type ViewportRenderCallback } from './viewportScheduler';
import {
  drawViewportRoomBack,
  drawViewportRoomFront,
  getViewportSculptureTransform,
  type ViewportSculptureTransform,
} from './viewportRoom';
import { drawViewportStageLight } from './viewportStageLight';
import {
  drawViewportSculptureFieldBack,
  drawViewportSculptureFieldFront,
} from './viewportSculptureField';

const W = 240, H = 150, TAU = Math.PI * 2;
type RGB = readonly [number, number, number];
type Params = Record<string, number>;
type Physics = { level:number; low:number; mid:number; high:number; transient:number };
type Spring = { value:number; velocity:number };
type Palette = { a:RGB; b:RGB; warm:RGB; pale:RGB };
type Kit = { ctx:CanvasRenderingContext2D; module:ModuleState; params:Params; time:number; motion:Physics; p:Palette };

const clamp = (v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const c01 = (v:number)=>clamp(v,0,1);
const fract = (v:number)=>v-Math.floor(v);
const hash = (v:number)=>fract(Math.sin(v*127.1)*43758.5453123);
const rgba = (c:RGB,a:number)=>`rgba(${c[0]},${c[1]},${c[2]},${c01(a)})`;
const val = (p:Params,id:string,f=0)=>p[id]??f;
const is = (m:string,...v:string[])=>v.includes(m);

function palette(id:string):Palette {
  if(id==='saturation') return {a:[243,132,62],b:[204,69,127],warm:[255,194,100],pale:[247,230,207]};
  if(id==='chorus') return {a:[75,198,225],b:[102,116,235],warm:[225,202,128],pale:[220,242,246]};
  if(id==='delay') return {a:[153,117,246],b:[210,88,170],warm:[245,178,95],pale:[232,227,248]};
  if(id==='reverb') return {a:[82,142,238],b:[161,111,235],warm:[231,190,127],pale:[225,237,246]};
  if(id==='media') return {a:[215,148,80],b:[178,82,111],warm:[247,188,101],pale:[238,226,203]};
  return {a:[216,92,193],b:[89,190,152],warm:[239,172,91],pale:[234,230,242]};
}

function mode(m:ModuleState){
  if(m.id==='saturation') return m.emberMode??'velvet';
  if(m.id==='chorus') return m.driftMode??'chorus';
  if(m.id==='delay') return m.delayAlgorithm??'tape';
  if(m.id==='reverb') return m.algorithm??'hall';
  if(m.id==='media') return m.mediaMode??'cassette';
  return m.grainMode??'reconstruct';
}

function caption(m:ModuleState){
  if(m.id==='saturation') return ({goldlion:'B759 · GOLD LION FIELD',mullard:'ECC83 · MULLARD HEAT',telefunken:'ECC83 · TELEFUNKEN GRID',bugleboy:'12AX7 · BUGLE BOY AIR',rcablack:'12AX7 · RCA BLACK PLATE'} as Record<string,string>)[m.emberMode??'']??'THERMAL REACTOR';
  if(m.id==='chorus') return m.driftMode==='ce1'?'CE-1 · BBD CHORUS':m.driftMode==='dimensiond'?'DIMENSION D · PHASE MATRIX':'PHASE CURRENT';
  if(m.id==='delay') return m.delayAlgorithm==='re201'?'RE-201 · TAPE ECHO':formatAlgorithmName(m.delayAlgorithm??'tape');
  if(m.id==='reverb') return m.algorithm==='emt140'?'EMT 140 · PLATE FIELD':m.algorithm==='lexicon224'?'224 · DIGITAL SPACE':(m.algorithm??'hall').toUpperCase();
  if(m.id==='bitcrusher') return m.grainMode==='sp1200'?'SP-1200 · 26.04 KHZ':m.grainMode==='mpc60'?'MPC60 · 40 KHZ':m.grainMode==='mirage'?'MIRAGE · 8 BIT':(m.grainMode??'reconstruct').toUpperCase();
  if(m.id==='media') return m.mediaMode==='tascam424'?'PORTASTUDIO 424 · 4 TRACK':(m.mediaMode??'cassette').toUpperCase();
  return 'SIGNAL WORLD';
}

function spring(s:Spring,target:number,k:number,d:number,dt:number){s.velocity+=(target-s.value)*k*dt;s.velocity*=Math.exp(-d*dt);s.value+=s.velocity*dt;return c01(s.value)}
function physics(s:Record<keyof Physics,Spring>,a:VisualAudioState,dt:number):Physics{return{level:spring(s.level,c01(a.level),42,10,dt),low:spring(s.low,c01(a.low),28,7,dt),mid:spring(s.mid,c01(a.mid),43,9,dt),high:spring(s.high,c01(a.high),58,11,dt),transient:spring(s.transient,c01(a.transient),86,12,dt)}}

export function ModuleViewport({module}:{module:ModuleState;visualState:VisualAudioState}){
  const canvasRef=useRef<HTMLCanvasElement|null>(null), moduleRef=useRef(module), last=useRef(0);
  const springs=useRef<Record<keyof Physics,Spring>>({level:{value:0,velocity:0},low:{value:0,velocity:0},mid:{value:0,velocity:0},high:{value:0,velocity:0},transient:{value:0,velocity:0}});
  moduleRef.current=module;
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return;
    let cw=1,ch=1,dpr=Math.min(1.5,window.devicePixelRatio||1);
    const resize=()=>{const r=canvas.getBoundingClientRect();cw=Math.max(1,r.width);ch=Math.max(1,r.height);dpr=Math.min(1.5,window.devicePixelRatio||1);const w=Math.round(cw*dpr),h=Math.round(ch*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}};
    resize();const ro=new ResizeObserver(resize);ro.observe(canvas);
    const render:ViewportRenderCallback=(stamp)=>{const t=stamp/1000,dt=last.current?clamp(t-last.current,.001,.08):1/60;last.current=t;const m=moduleRef.current,p:Params={};for(const x of m.parameters)p[x.id]=x.value;ctx.setTransform(dpr,0,0,dpr,0,0);draw(ctx,cw,ch,{ctx,module:m,params:p,time:t,motion:physics(springs.current,getLatestVisualAudioState(),dt),p:palette(m.id)})};
    const off=subscribeViewportAnimation(render);return()=>{off();ro.disconnect()};
  },[module.id]);
  return <div className={`dsp-viewport viewport-${module.id} ${module.enabled?'active':''}`}><div className="viewport-glass" aria-hidden="true"/><canvas ref={canvasRef} aria-hidden="true"/><span className="viewport-caption">{caption(module)}</span></div>;
}

function applySculptureTransform(ctx:CanvasRenderingContext2D, sculpture:ViewportSculptureTransform){
  ctx.translate(W/2+sculpture.x,H/2+sculpture.y);
  ctx.rotate(sculpture.rotation);
  ctx.transform(1,sculpture.shearY,sculpture.shearX,1,0,0);
  ctx.scale(sculpture.scale,sculpture.scale);
  ctx.translate(-W/2,-H/2);
}

function drawSculptureReflection(k:Kit,sculpture:ViewportSculptureTransform){
  const {ctx,motion}=k;
  const floorY=119;
  ctx.save();
  ctx.beginPath();
  ctx.rect(23,103,194,36);
  ctx.clip();
  ctx.globalCompositeOperation='screen';
  ctx.globalAlpha=.035+motion.level*.018;
  ctx.translate(0,floorY*1.35);
  ctx.scale(1,-.35);
  applySculptureTransform(ctx,sculpture);
  art(k);
  ctx.restore();

  const shadow=ctx.createRadialGradient(W/2,floorY,0,W/2,floorY,53);
  shadow.addColorStop(0,'rgba(0,0,0,.34)');
  shadow.addColorStop(.5,'rgba(0,0,0,.16)');
  shadow.addColorStop(1,'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(W/2,floorY);
  ctx.scale(1,.16);
  ctx.fillStyle=shadow;
  ctx.beginPath();ctx.arc(0,0,53,0,TAU);ctx.fill();
  ctx.restore();
}

function draw(ctx:CanvasRenderingContext2D,cw:number,ch:number,k:Kit){
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#010203';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.restore();if(!k.module.enabled)return;
  const s=Math.max(.01,Math.min((cw-8)/W,(ch-8)/H));
  ctx.save();ctx.translate((cw-W*s)/2,(ch-H*s)/2);ctx.scale(s,s);
  background(k);
  drawViewportRoomBack(ctx,W,H,k.module.id,k.time,k.motion,k.p);
  drawViewportStageLight(ctx,W,H,k.module.id,k.time,k.motion,k.p);
  drawViewportSculptureFieldBack(ctx,W,H,k.module.id,k.time,k.motion,k.p);
  const sculpture=getViewportSculptureTransform(k.module.id,k.time,k.motion);
  drawSculptureReflection(k,sculpture);
  ctx.save();
  applySculptureTransform(ctx,sculpture);
  art(k);
  ctx.restore();
  drawViewportSculptureFieldFront(ctx,W,H,k.module.id,k.time,k.motion,k.p);
  drawViewportRoomFront(ctx,W,H,k.time,k.motion,k.p);
  finish(k);
  ctx.restore();
}
function grad(ctx:CanvasRenderingContext2D,top:RGB,bottom:RGB){const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,rgba(top,1));g.addColorStop(1,rgba(bottom,1));ctx.fillStyle=g;ctx.fillRect(0,0,W,H)}
function stroke(ctx:CanvasRenderingContext2D,c:RGB,a:number,w=1){ctx.strokeStyle=rgba(c,a);ctx.lineWidth=w}
function glow(ctx:CanvasRenderingContext2D,x:number,y:number,c:RGB,r:number,a:number){ctx.save();ctx.fillStyle=rgba(c,a);ctx.shadowColor=rgba(c,Math.min(.5,a));ctx.shadowBlur=3+r*2;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.restore()}

function background({ctx,module,time,motion,p}:Kit){
  if(module.id==='saturation'){grad(ctx,[21,7,11],[6,3,5]);const g=ctx.createLinearGradient(0,0,W,0);g.addColorStop(0,rgba(p.b,.05));g.addColorStop(.5,rgba(p.a,.12+motion.low*.05));g.addColorStop(1,rgba(p.b,.04));ctx.fillStyle=g;ctx.fillRect(0,0,W,H);return}
  if(module.id==='chorus'){grad(ctx,[4,10,28],[3,6,16]);const g=ctx.createLinearGradient(0,0,W,0);g.addColorStop(0,rgba(p.a,.07));g.addColorStop(.47,'transparent');g.addColorStop(.53,'transparent');g.addColorStop(1,rgba(p.b,.07));ctx.fillStyle=g;ctx.fillRect(0,0,W,H);return}
  if(module.id==='delay'){grad(ctx,[10,7,29],[3,4,11]);for(let i=0;i<7;i++){const q=i/6,y=18+q*116;stroke(ctx,i%2?p.b:p.a,.022+(1-q)*.02,.6);ctx.beginPath();ctx.moveTo(14+q*12,y);ctx.lineTo(226-q*12,y-q*7);ctx.stroke()}return}
  if(module.id==='reverb'){grad(ctx,[5,12,27],[4,7,18]);ctx.save();ctx.globalCompositeOperation='screen';for(let i=0;i<5;i++){const x=-20+i*64+Math.sin(time*.035+i)*8,g=ctx.createLinearGradient(x,0,x+70,H);g.addColorStop(0,'transparent');g.addColorStop(.45,rgba(i%2?p.b:p.a,.02+motion.mid*.03));g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(x,0,90,H)}ctx.restore();return}
  if(module.id==='bitcrusher'){grad(ctx,[13,5,18],[4,4,10]);stroke(ctx,p.b,.023,.55);for(let x=12;x<W;x+=12){ctx.beginPath();ctx.moveTo(x,12);ctx.lineTo(x,138);ctx.stroke()}for(let y=18;y<H;y+=12){ctx.beginPath();ctx.moveTo(10,y);ctx.lineTo(230,y);ctx.stroke()}return}
  grad(ctx,[16,10,7],[5,5,7]);for(let y=9;y<H;y+=9){stroke(ctx,y%18?p.a:p.b,.024,.5);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
}
function art(k:Kit){if(k.module.id==='saturation')ember(k);else if(k.module.id==='chorus')drift(k);else if(k.module.id==='delay')halo(k);else if(k.module.id==='reverb')atmos(k);else if(k.module.id==='bitcrusher')grain(k);else artifact(k)}

function ember({ctx,module,params,time,motion,p}:Kit){const m=mode(module),drive=c01(val(params,'drive',.2)),heat=c01(val(params,'heat',.2)),cx=120,cy=72-motion.low*2;const g=ctx.createRadialGradient(cx-4,cy-6,2,cx,cy,40+drive*12);g.addColorStop(0,rgba(p.warm,.45+heat*.2+motion.transient*.08));g.addColorStop(.3,rgba(p.a,.24+drive*.12));g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(cx,cy,44+drive*8,27+heat*7,Math.sin(time*.07)*.04,0,TAU);ctx.fill();if(is(m,'goldlion','mullard','telefunken','bugleboy','rcablack')){for(let i=-1;i<=1;i++){const x=cx+i*46;stroke(ctx,i?p.a:p.warm,.25+drive*.1,1.1);ctx.beginPath();ctx.roundRect(x-14,cy-35,28,62,10);ctx.stroke();for(let r=-2;r<=2;r++){const y=cy+r*10;stroke(ctx,p.b,.13+heat*.07,.7);ctx.beginPath();ctx.moveTo(x-9,y);ctx.lineTo(x+9,y+Math.sin(time*.2+r+i)*1.5);ctx.stroke()}glow(ctx,x,cy+20-((time*(.4+heat*.2)+i*.18)%1)*48,p.warm,1.4+drive,.4)}}else{for(let r=0;r<(m==='broken'?11:8);r++){const y=38+r*(74/(m==='broken'?10:7)),bend=Math.sin(time*(m==='furnace'?.34:.18)+r)*(2+heat*5+motion.low*2);stroke(ctx,r%2?p.b:p.a,.12+drive*.08,.9);ctx.beginPath();ctx.moveTo(18,y);ctx.bezierCurveTo(70,y,94,y+bend,120,y+bend);ctx.bezierCurveTo(148,y+bend,172,y,222,y);ctx.stroke()}}glow(ctx,cx,cy,p.warm,1.7+motion.transient*1.4,.35)}
function drift({ctx,module,params,time,motion,p}:Kit){const m=mode(module),depth=c01(val(params,'depth',.3)*110),rate=.18+c01(val(params,'rate',.2)/2.5)*.85,spread=c01(val(params,'spread',.5)),mv=c01(val(params,'motion',.3));for(let r=0;r<5;r++){const ph=time*rate*(.55+r*.04)+r*1.27+motion.mid*.5;ctx.beginPath();for(let s=0;s<=72;s++){const q=s/72,x=8+q*224;let y=42+r*17+Math.sin(q*Math.PI*2.4+ph)*(5+depth*10);if(m==='liquid')y+=Math.sin(q*Math.PI*6-time*.24+r)*6*mv;if(is(m,'dimension','dimensiond'))y+=(q-.5)*(r-2)*11*spread;if(m==='vibrato')y+=Math.sin(q*Math.PI*8+time*rate*2)*(3+depth*5);s?ctx.lineTo(x,y):ctx.moveTo(x,y)}stroke(ctx,r%2?p.b:p.a,.14+r*.024+motion.high*.03,1.05);ctx.stroke()}}
function halo({ctx,module,params,time,motion,p}:Kit){const m=mode(module),fb=c01(val(params,'feedback',.3)),ch=c01(val(params,'character',.2)),wide=c01(val(params,'width',.5)),depth=7+Math.round(fb*6);ctx.save();ctx.translate(Math.sin(time*.08)*(1+ch*5)+motion.mid*2,Math.cos(time*.06)*(0.5+ch*2)-motion.low*2);for(let i=depth-1;i>=0;i--){const k=i/Math.max(1,depth-1),sc=.28+(1-k)*.92,w=172*sc*(.9+wide*.14),h=96*sc,x=120+(i-depth/2)*ch*1.2,y=74+(k-.5)*8;stroke(ctx,i%2?p.b:p.a,.055+(1-k)*.2+motion.transient*(1-k)*.04,.9+(1-k)*.25);ctx.beginPath();is(m,'diffuse','constellation')?ctx.ellipse(x,y,w/2,h/2,0,0,TAU):ctx.roundRect(x-w/2,y-h/2,w,h,4+sc*6);ctx.stroke()}ctx.restore();if(m==='pingpong'){let x=28,y=27;for(let i=0;i<11;i++){const nx=i%2?66+i*4:176-i*4,ny=28+i*9;stroke(ctx,i%2?p.b:p.a,.3-i*.018,1);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(nx,ny);ctx.stroke();glow(ctx,nx,ny,i%2?p.b:p.a,.9,.24);x=nx;y=ny}}glow(ctx,120,74,p.warm,1.4+motion.transient*1.5,.36)}
function atmos({ctx,module,params,time,motion,p}:Kit){const m=mode(module),size=.62+c01(val(params,'size',.5))*.38,diff=c01(val(params,'diffusion',.5)),mv=c01(val(params,'motion',.2)),sheets=m==='room'?4:m==='hall'?6:m==='cinema'?8:7;ctx.save();ctx.globalCompositeOperation='screen';for(let i=0;i<sheets;i++){const seed=hash(i*9.17+2),base=18+i*(112/Math.max(1,sheets-1)),amp=(3+diff*9)*(.5+seed*.7),speed=.035+mv*.07+seed*.015;ctx.beginPath();for(let s=0;s<=42;s++){const q=s/42,x=-8+q*256,y=base+Math.sin(q*Math.PI*(1.2+seed)+time*speed+i)*amp+Math.sin(q*7+time*.018)*1.5-motion.mid*(i%2?3:1.5);s?ctx.lineTo(x,y):ctx.moveTo(x,y)}stroke(ctx,i%3===0?p.b:p.a,.045+diff*.045+motion.high*.02,1+size*.5);ctx.stroke()}if(is(m,'cloud','nebula','celestial','aurora','freeze','abyss')){const n=m==='nebula'?34:m==='cloud'?24:16;for(let i=0;i<n;i++){const seed=hash(i*17.3),x=8+hash(i*4.1+time*.003)*224,y=12+hash(i*6.7+time*.002)*118;glow(ctx,x+Math.sin(time*(.015+seed*.02)+i)*4,y-motion.mid*3,i%4?p.a:p.b,.6+(i%4)*.35,.07+motion.high*.04)}}ctx.restore();if(is(m,'plate','emt140')){stroke(ctx,p.pale,.18,1);ctx.strokeRect(22,24,196,96);for(let r=0;r<10;r++){const y=30+r*9;ctx.beginPath();for(let s=0;s<=52;s++){const q=s/52,x=24+q*192,yy=y+Math.sin(q*Math.PI*5+time*.21+r)*(1.3+diff*4.5);s?ctx.lineTo(x,yy):ctx.moveTo(x,yy)}stroke(ctx,r%2?p.b:p.a,.075+r*.006,.75);ctx.stroke()}}}
function grain({ctx,module,params,time,motion,p}:Kit){const m=mode(module),density=c01(val(params,'density',.4)),chaos=c01(val(params,'chaos',.2)),bloom=c01(val(params,'bloom',.3));if(m==='mpc60'){const size=24,gap=6,sx=57,sy=20,active=Math.floor(time*(2.2+density*1.5)+motion.transient*4)%16;for(let r=0;r<4;r++)for(let c=0;c<4;c++){const i=r*4+c,x=sx+c*(size+gap),y=sy+r*(size+gap);stroke(ctx,i===active?p.pale:i%2?p.b:p.a,i===active?.42:.16,i===active?1.3:.9);ctx.strokeRect(x,y,size,size);if(i===active){ctx.fillStyle=rgba(p.warm,.07+bloom*.07);ctx.fillRect(x+2,y+2,size-4,size-4)}}return}const n=18+Math.round(density*30),st=m==='stutter'?Math.floor(time*(4+chaos*8))/(4+chaos*8):time;for(let i=0;i<n;i++){const seed=i*12.9898,q=m==='mirage'?6:m==='reconstruct'?3:1;let x=18+hash(seed*1.7+st*.09)*204,y=20+hash(seed*.9+st*.11)*106;if(q>1){x=Math.round(x/q)*q;y=Math.round(y/q)*q}if(m==='smear')x+=Math.sin(time*.25+i)*(8+chaos*12);const z=1.5+(i%4)*1.1+bloom*2+motion.transient*1.4;ctx.save();ctx.translate(x,y);ctx.fillStyle=rgba(m==='prism'&&i%3===0?p.pale:i%2?p.b:p.a,.13+bloom*.06+motion.high*.04);if(is(m,'shatter','prism','ruin')){ctx.rotate(seed+time*.04*(i%2?-1:1));ctx.beginPath();ctx.moveTo(0,-z*2);ctx.lineTo(z*1.5,0);ctx.lineTo(0,z*1.7);ctx.lineTo(-z*1.4,0);ctx.closePath();ctx.fill()}else ctx.fillRect(-z,-z,z*2,z*(1+hash(i)*2));ctx.restore()}}
function artifact({ctx,module,params,time,motion,p}:Kit){const m=mode(module),wear=c01(val(params,'wear',.25)),wow=c01(val(params,'wow',.16)),noise=c01(val(params,'noise',.1)),transport=Math.sin(time*(.22+wow*.45))*(1+wow*4);if(is(m,'cassette','reel','tascam424','Ampex ATR-102')){const reel=is(m,'reel','Ampex ATR-102'),sw=reel?188:194,sh=reel?92:98,l=reel?72:74,r=reel?168:166,rad=reel?31:21,spin=time*(.7+wear*.65);stroke(ctx,p.a,.28,1.1);ctx.strokeRect(120-sw/2+transport*.2,72-sh/2,sw,sh);for(const x of [l,r]){stroke(ctx,p.b,.24,1);ctx.beginPath();ctx.arc(x+transport*.15,67,rad,0,TAU);ctx.stroke();for(let s=0;s<6;s++){const a=spin+s*TAU/6;ctx.beginPath();ctx.moveTo(x,67);ctx.lineTo(x+Math.cos(a)*(rad-4),67+Math.sin(a)*(rad-4));ctx.stroke()}}}else if(is(m,'vinyl','wax')){const rad=m==='wax'?58:50,cx=102+transport*.15,cy=72;stroke(ctx,p.a,.28,1.05);for(let r=0;r<8;r++){ctx.beginPath();ctx.arc(cx,cy,rad-r*5,0,TAU);ctx.stroke()}const needle=time*(.08+wow*.04),x=cx+Math.cos(needle)*37,y=cy+Math.sin(needle)*37;stroke(ctx,p.warm,.34,1.1);ctx.beginPath();ctx.moveTo(202,26);ctx.lineTo(x,y);ctx.stroke();glow(ctx,x,y,p.warm,1.3,.42)}else if(is(m,'Neve 1073','SSL 4000E','API 1608')){const n=m==='API 1608'?8:6;for(let i=0;i<n;i++){const x=28+i*(184/Math.max(1,n-1)),meter=c01(.2+motion.level*.7+Math.sin(time*(.6+i*.03)+i)*.12);stroke(ctx,i%2?p.b:p.a,.18,.9);ctx.beginPath();ctx.moveTo(x,32);ctx.lineTo(x,116);ctx.stroke();ctx.fillStyle=rgba(m==='Neve 1073'?p.warm:p.a,.08+meter*.22);ctx.fillRect(x-2,108-meter*55,4,meter*55)}}else if(m==='vhs'){for(let r=0;r<15;r++){const y=16+r*8,shift=Math.sin(time*(.45+wow)+r*1.5)*(2+wear*8)+(r%4===0?motion.transient*6:0);stroke(ctx,r%3?p.a:p.b,.07+noise*.08,r%4===0?1.2:.7);ctx.beginPath();ctx.moveTo(12+shift,y);ctx.lineTo(228-shift*.45,y);ctx.stroke()}for(let i=0;i<9;i++){const x=22+i*24+transport,h=18+hash(i*4.2)*54;ctx.fillStyle=rgba(i%2?p.b:p.a,.045+motion.high*.035);ctx.fillRect(x,122-h,12,h)}}else{const bands=m==='radio'?10:16;for(let r=0;r<bands;r++){const y=20+r*(104/Math.max(1,bands-1)),shift=Math.sin(time*(.4+wow)+r*1.7)*(2+wear*9);stroke(ctx,r%2?p.b:p.a,.07+noise*.08,.9);ctx.beginPath();ctx.moveTo(12+shift,y);ctx.lineTo(228-shift*.4,y);ctx.stroke()}}}
function finish({ctx,module,time,motion,p}:Kit){if(module.id==='media'){ctx.fillStyle=rgba(p.a,.025+motion.high*.015);ctx.fillRect(0,((time*7)%(H+8))-4,W,1)}const g=ctx.createLinearGradient(0,0,W,0);g.addColorStop(0,'rgba(0,0,0,.25)');g.addColorStop(.08,'transparent');g.addColorStop(.92,'transparent');g.addColorStop(1,'rgba(0,0,0,.25)');ctx.fillStyle=g;ctx.fillRect(0,0,W,H)}
