import { useEffect, useRef } from 'react';
import type { ModuleState } from '../../ui/types';
import type { VisualAudioState } from '../../visual/VisualEngine';
import { formatAlgorithmName } from '../../ui/formatting';
import { subscribeViewportAnimation, type ViewportRenderCallback } from './viewportScheduler';

export function ModuleViewport({
  module,
  visualState,
}: {
  module: ModuleState;
  visualState: VisualAudioState;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moduleRef = useRef(module);
  moduleRef.current = module;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;

    let cssWidth = 1;
    let cssHeight = 1;
    let pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);

    const resizeCanvas = (): void => {
      const rect = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, rect.width);
      cssHeight = Math.max(1, rect.height);
      pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
      const nextWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
      const nextHeight = Math.max(1, Math.round(cssHeight * pixelRatio));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);

    const render: ViewportRenderCallback = (time) => {
      const currentModule = moduleRef.current;
      if (!currentModule.enabled) return;

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const currentParams: Record<string, number> = {};
      for (const parameter of currentModule.parameters) {
        currentParams[parameter.id] = parameter.value;
      }

      drawModuleViewport(
        context,
        cssWidth,
        cssHeight,
        currentModule,
        visualState,
        currentParams,
        time / 1000
      );
    };

    const unsubscribe = subscribeViewportAnimation(render);
    return () => {
      unsubscribe();
      resizeObserver.disconnect();
    };
  }, [module.id, module.mediaMode]);

  return (
    <div className={`dsp-viewport viewport-${module.id} ${module.enabled ? 'active' : ''}`}>
      <div className="viewport-glass" aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="viewport-caption">{getViewportCaption(module)}</span>
    </div>
  );
}

function getViewportCaption(module: ModuleState): string {
  if (module.id === 'delay') return formatAlgorithmName(module.delayAlgorithm ?? 'tape');
  if (module.id === 'reverb') return (module.algorithm ?? 'hall').toUpperCase();
  if (module.id === 'media') return (module.mediaMode ?? 'cassette').toUpperCase();
  if (module.id === 'bitcrusher') return (module.grainMode ?? 'reconstruct').toUpperCase();
  if (module.id === 'chorus') return 'PHASE CURRENT';
  if (module.id === 'saturation') return 'THERMAL REACTOR';
  return 'THERMAL CORE';
}

function drawModuleViewport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  module: ModuleState,
  _audio: VisualAudioState,
  params: Record<string, number>,
  time: number
) {
  ctx.clearRect(0, 0, width, height);
  if (!module.enabled) {
    ctx.fillStyle = 'rgb(0,0,0)';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  // Visual Worlds are deliberately non-reactive: audio level/transients never alter brightness,
  // opacity, color, bloom or animation speed. Motion is driven only by time and module parameters.
  const activity = .42;
  const transient = 0;
  const cx = width / 2;
  const cy = height / 2;
  const mode = module.id === 'saturation' ? (module.emberMode ?? 'velvet')
    : module.id === 'chorus' ? (module.driftMode ?? 'chorus')
    : module.id === 'delay' ? (module.delayAlgorithm ?? 'tape')
    : module.id === 'reverb' ? (module.algorithm ?? 'hall')
    : module.id === 'media' ? (module.mediaMode ?? 'cassette')
    : 'grain';

  const accent = module.id === 'saturation' ? [241, 153, 66]
    : module.id === 'chorus' ? [88, 205, 220]
    : module.id === 'delay' ? [161, 126, 255]
    : module.id === 'reverb' ? [86, 145, 255]
    : module.id === 'media' ? [202, 145, 91]
    : [223, 105, 197];
  const moduleMix = Math.max(0, Math.min(1, params.mix ?? 0.5));
  const lineWhiten = 0.10 + moduleMix * 0.70;
  const rgba = (alpha: number, whiten = false) => {
    const blend = whiten ? lineWhiten : 0;
    const red = Math.round(accent[0] + (255 - accent[0]) * blend);
    const green = Math.round(accent[1] + (255 - accent[1]) * blend);
    const blue = Math.round(accent[2] + (255 - accent[2]) * blend);
    return `rgba(${red},${green},${blue},${Math.max(0, Math.min(1, alpha))})`;
  };

  const bg = ctx.createRadialGradient(cx, cy, 4, cx, cy, width * .7);
  bg.addColorStop(0, rgba(.045 + activity * .12));
  bg.addColorStop(.58, 'rgba(4,7,11,.985)');
  bg.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const project = (x: number, y: number, z: number) => {
    const depth = 1 + z * .32;
    return [cx + x * depth, cy + y * depth - z * 8] as const;
  };
  const line = (a=.35, w=1.25) => { ctx.strokeStyle=rgba(a, true); ctx.lineWidth=w; };
  const cube = (scale = 1, alpha=.28) => {
    const points = [
      [-55,-35,-1],[55,-35,-1],[55,35,-1],[-55,35,-1],
      [-55,-35,1],[55,-35,1],[55,35,1],[-55,35,1],
    ].map(([x,y,z]) => project(x * scale, y * scale, z));
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    line(alpha + activity*.18, 1.25);
    edges.forEach(([a,b]) => { ctx.beginPath(); ctx.moveTo(...points[a]); ctx.lineTo(...points[b]); ctx.stroke(); });
  };
  const dot=(x:number,y:number,r=1.6,a=.6)=>{
    ctx.save();
    ctx.fillStyle=rgba(a);
    ctx.shadowColor=rgba(Math.min(.8,a));
    ctx.shadowBlur=3+r*1.8;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    ctx.restore();
  };
  const wave=(y:number,amp:number,freq:number,phase:number,a=.45)=>{
    line(a,1.35);ctx.beginPath();
    for(let x=-58;x<=58;x+=2){const p=project(x,y+Math.sin(x*freq+phase)*amp,Math.sin(x*.025+phase)*.35);x===-58?ctx.moveTo(...p):ctx.lineTo(...p);}
    ctx.stroke();
  };

  // EMBER — mode-specific circuitry: every algorithm gets its own electronic topology.
  if (module.id === 'saturation') {
    const heat=params.heat??.25, drive=params.drive??.2, char=params.character??.3;
    cube(1,.24);

    const node=(x:number,y:number,a=.55,r=1.25)=>dot(x,y,r,a);
    const trace=(points:[number,number][],a=.34,w=1.05)=>{
      line(a,w);ctx.beginPath();
      points.forEach(([x,y],i)=>i===0?ctx.moveTo(x,y):ctx.lineTo(x,y));
      ctx.stroke();
    };
    const resistor=(x:number,y:number,len=18,a=.42)=>{
      line(a,1.05);ctx.beginPath();ctx.moveTo(x-len/2,y);
      for(let i=0;i<=6;i++){const xx=x-len/2+(i/6)*len, yy=y+(i===0||i===6?0:(i%2?3:-3));ctx.lineTo(xx,yy);}
      ctx.stroke();
    };
    const coil=(x:number,y:number,turns=5,a=.4)=>{
      line(a,1.05);ctx.beginPath();
      for(let i=0;i<=turns*8;i++){const p=i/(turns*8),xx=x-18+p*36,yy=y+Math.sin(p*Math.PI*2*turns)*3.2;i===0?ctx.moveTo(xx,yy):ctx.lineTo(xx,yy);}
      ctx.stroke();
    };

    if(mode==='tube'){
      // Three valve stages with heater rails and animated plate current.
      for(let i=-1;i<=1;i++){
        const x=cx+i*32;
        line(.42,1.15);ctx.strokeRect(x-8,cy-22,16,44);
        line(.30,1);ctx.beginPath();ctx.moveTo(x-5,cy-11);ctx.lineTo(x+5,cy-11);ctx.moveTo(x-5,cy);ctx.lineTo(x+5,cy);ctx.moveTo(x-5,cy+11);ctx.lineTo(x+5,cy+11);ctx.stroke();
        const pulse=(Math.sin(time*.7+i)+1)*.5;
        node(x,cy-17+pulse*34,.40+heat*.28,1.15+drive*.7);
      }
      trace([[cx-48,cy+27],[cx+48,cy+27]],.25,1);
      trace([[cx-48,cy-27],[cx+48,cy-27]],.25,1);
    } else if(mode==='transformer'){
      // Coupled windings and a moving magnetic flux bridge.
      coil(cx-25,cy-8,6,.44);coil(cx+25,cy-8,6,.44);
      coil(cx-25,cy+9,6,.32);coil(cx+25,cy+9,6,.32);
      const flux=Math.sin(time*.42)*(3+heat*4);
      trace([[cx-4,cy-24+flux],[cx+4,cy-24-flux],[cx+4,cy+24+flux],[cx-4,cy+24-flux],[cx-4,cy-24+flux]],.25+drive*.22,1.1);
      node(cx-49,cy-8,.45);node(cx+49,cy-8,.45);
    } else if(mode==='console'){
      // Console bus: parallel channel strips feeding a summing backbone.
      for(let row=-3;row<=3;row++){
        const y=cy+row*8;
        trace([[cx-49,y],[cx-30,y],[cx-24,y+(row%2?3:-3)],[cx-10,y+(row%2?3:-3)]],.24+Math.abs(row)*.025);
        resistor(cx,y+(row%2?3:-3),18,.34+drive*.18);
        trace([[cx+10,y+(row%2?3:-3)],[cx+22,y],[cx+37,y],[cx+37,cy]],.27);
        node(cx-30,y,.35,1);node(cx+22,y,.35,1);
      }
      trace([[cx+37,cy-30],[cx+37,cy+30],[cx+49,cy+30]],.48,1.3);
    } else if(mode==='exciter'){
      // Harmonic multiplier lattice: signal branches into progressively finer paths.
      trace([[cx-50,cy],[cx-34,cy]],.48,1.3);
      for(let branch=-3;branch<=3;branch++){
        const y=cy+branch*8;
        const phase=Math.sin(time*.65+branch)*char*3;
        trace([[cx-34,cy],[cx-22,y],[cx+8,y+phase],[cx+22,cy]],.25+Math.abs(branch)*.035,1);
        node(cx-22,y,.34+heat*.18,1.05);
      }
      resistor(cx+31,cy,17,.48);trace([[cx+39,cy],[cx+50,cy]],.48,1.3);
    } else if(mode==='broken'){
      // Damaged board: interrupted traces, floating nodes and intermittent bridges.
      for(let i=0;i<12;i++){
        const row=(i%6)-2.5, y=cy+row*10;
        const x0=cx-48+(i%2)*7, gap=8+((i*7)%13);
        trace([[x0,y],[cx-gap,y]],.22+(i%4)*.055);
        trace([[cx+gap,y+(i%2?4:-4)],[cx+46,y+(i%2?4:-4)]],.22+(i%3)*.06);
        node(cx-gap,y,.25+(i%4)*.06,1);
        if(Math.sin(time*.5+i*2.7)>.45) trace([[cx-gap,y],[cx+gap,y+(i%2?4:-4)]],.16+char*.22,.8);
      }
    } else if(mode==='furnace'){
      // High-current power stage: rectifier-like diamonds and hot bus rails.
      trace([[cx-50,cy-25],[cx+50,cy-25]],.34,1.2);
      trace([[cx-50,cy+25],[cx+50,cy+25]],.34,1.2);
      for(let i=-3;i<=3;i++){
        const x=cx+i*14, wobble=Math.sin(time*.45+i)*heat*3;
        trace([[x,cy-25],[x-6,cy-10+wobble],[x,cy],[x+6,cy+10-wobble],[x,cy+25]],.30+drive*.22,1.15);
        node(x,cy,.38+heat*.30,1.1+heat*.6);
      }
    } else {
      // Velvet: a soft discrete ladder with gently breathing bias paths.
      for(let row=-2;row<=2;row++){
        const y=cy+row*11;
        const breathe=Math.sin(time*.28+row)*heat*2.5;
        trace([[cx-48,y],[cx-30,y],[cx-24,y+breathe]],.25);
        resistor(cx-14,y+breathe,18,.32+drive*.15);
        trace([[cx-5,y+breathe],[cx+13,y+breathe],[cx+20,y],[cx+45,y]],.27);
        node(cx-30,y,.30);node(cx+20,y,.30);
      }
      trace([[cx-40,cy-28],[cx-40,cy+28]],.18);
      trace([[cx+34,cy-28],[cx+34,cy+28]],.18);
    }
  }

  // DRIFT — a phase-current instrument: streamlines, stereo orbits and directional flow.
  else if (module.id === 'chorus') {
    const depth=params.depth??.3, rate=.35+(params.rate??.2)*1.7, spread=params.spread??.5, motion=params.motion??.3;
    cube(1,.24);
    // Drift remains fluid, but its flow now occupies the same visual volume as every other module.
    const fieldLeft=cx-50, fieldWidth=100;
    for(let i=0;i<8;i++){
      ctx.beginPath();
      for(let localX=0;localX<=fieldWidth;localX+=4){
        const x=fieldLeft+localX;
        const p=localX/fieldWidth;
        const base=cy+(i-3.5)*8;
        let y=base+Math.sin(p*Math.PI*2.4+time*rate+i*.62)*(3+depth*8);
        if(mode==='liquid') y+=Math.sin(p*Math.PI*5-time*.23+i)*5*motion;
        if(mode==='dimension') y+=(p-.5)*(i-3.5)*4*spread;
        localX===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      line(.19+i*.035,1.15);ctx.stroke();
    }
    if(mode==='rotary'||mode==='orbit'){
      const rings=mode==='orbit'?5:3;
      for(let i=0;i<rings;i++){const a=time*rate*(i%2?-.10:.12);line(.28+i*.045,1.2);ctx.beginPath();ctx.ellipse(cx,cy,18+i*8,9+i*4,a,0,Math.PI*2);ctx.stroke();const pa=time*rate+i*1.2;dot(cx+Math.cos(pa)*(18+i*8),cy+Math.sin(pa)*(9+i*4),1.4,.55);}
    } else if(mode==='doppler'){
      const sourceX=cx+Math.sin(time*rate*.7)*35;dot(sourceX,cy,2.4,.72);for(let i=0;i<6;i++){const rr=10+i*10+(time*rate*9)%10;line(.38-i*.04,1.1);ctx.beginPath();ctx.arc(sourceX,cy,rr,Math.PI*.72,Math.PI*1.28);ctx.stroke();}
    } else if(mode==='vibrato'){
      line(.62,1.4);ctx.beginPath();for(let x=0;x<=width;x+=3){const y=cy+Math.sin(x*.07+time*rate*1.7)*(5+depth*12);x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();
    } else if(mode==='ensemble'){
      for(let i=0;i<5;i++){const pa=time*(.14+i*.011)+i*1.25;dot(cx+Math.cos(pa)*(22+i*5),cy+Math.sin(pa*.93)*(10+i*2),1.3,.42+i*.05);}
    }
  }

  // HALO — an echo/reflection tunnel: repeated fronts, nested depth planes and bounce paths.
  else if (module.id === 'delay') {
    const fb=params.feedback??.3, character=params.character??.2;
    cube(1,.24);
    // Halo's echo tunnel is contained inside the same chassis instead of becoming its own outer box.
    for(let i=0;i<5;i++){
      const k=i/4;
      const w=84*(1-k*.66),h=48*(1-k*.66);
      const ox=Math.sin(time*.035+i*.7)*1.5*character;
      line(.16+(1-k)*.20,1.05);ctx.strokeRect(cx-w/2+ox,cy-h/2,w,h);
    }
    if(mode==='pingpong'){
      let x=cx-43,y=cy-22;for(let i=0;i<8;i++){const nx=i%2?cx-35+i*3:cx+35-i*3;const ny=cy-22+i*6.2;line(.52-i*.04,1.25);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(nx,ny);ctx.stroke();dot(nx,ny,1.3,.55-i*.035);x=nx;y=ny;}
    } else if(mode==='diffuse'||mode==='constellation'){
      const count=mode==='constellation'?18:13;for(let i=0;i<count;i++){const a=i*2.399+time*.055,r=10+(i%6)*7;const x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r*.5;dot(x,y,1.2+(i%3)*.25,.32+(i%5)*.05);if(mode==='constellation'&&i>1&&i%2===0){line(.20,1);ctx.beginPath();ctx.moveTo(cx+Math.cos((i-2)*2.399+time*.055)*(10+((i-2)%6)*7),cy+Math.sin((i-2)*2.399+time*.055)*(10+((i-2)%6)*7)*.5);ctx.lineTo(x,y);ctx.stroke();}}
    } else if(mode==='scatter'){
      for(let i=0;i<16;i++){const a=i*4.13+time*.10;line(.20+(i%4)*.055,1);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.sin(a*1.7)*48,cy+Math.cos(a*.83)*25);ctx.stroke();}
    } else {
      // Clean/Tape/BBD: visible repeated echo fronts travelling down the tunnel.
      const count=5+Math.round(fb*5);
      for(let i=0;i<count;i++){const phase=(time*.10+i/count)%1;const w=12+phase*85,h=7+phase*49;line((1-phase)*.50,1.15);ctx.beginPath();ctx.ellipse(cx,cy,w/2,h/2,0,0,Math.PI*2);ctx.stroke();}
      if(mode==='bbd'){line(.18,1);for(let x=cx-42;x<=cx+42;x+=12){ctx.beginPath();ctx.moveTo(x,cy-25);ctx.lineTo(x,cy+25);ctx.stroke();}}
    }
  }

  // ATMOS — algorithms become different abstract architectural spaces.
  else if (module.id === 'reverb') {
    const size=.55+(params.size??.5)*.45, motion=params.motion??.2;
    if(mode==='room'||mode==='hall'||mode==='cinema'){
      // Keep the outer Atmos chassis-space identical to Ember/Drift.
      // Algorithm/Size differences live inside the frame instead of deforming the cube itself.
      cube(1,.24);
      const interiorScale = mode==='room' ? .68*size : mode==='hall' ? .82*size : .92*size;
      const columns=mode==='cinema'?7:mode==='hall'?5:3;
      line(.25,1.15);
      for(let i=0;i<columns;i++){
        const x=(-45+i*(90/Math.max(1,columns-1)))*interiorScale;
        const a=project(x,-30*interiorScale,-.72),b=project(x,30*interiorScale,.72);
        ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();
      }
    } else if(mode==='plate'){
      line(.55,1.4);ctx.strokeRect(cx-48*size,cy-27*size,96*size,54*size);for(let i=0;i<7;i++)wave((i-3)*6,2+motion*5,.09,time*.3+i,.26+i*.04);
    } else if(mode==='cloud'||mode==='nebula'){
      const n=mode==='nebula'?30:20;for(let i=0;i<n;i++){const a=i*2.399+time*(.03+motion*.05),r=8+(i%8)*7*size;dot(cx+Math.cos(a)*r,cy+Math.sin(a*1.13)*r*.48,1+(i%3)*.35,.22+(i%6)*.055);}
    } else if(mode==='freeze'){
      cube(1,.24);for(let i=0;i<9;i++){line(.22+i*.035,1.1);ctx.beginPath();ctx.ellipse(cx,cy,8+i*6,4+i*3,Math.sin(i)*.15,0,Math.PI*2);ctx.stroke();}
    } else if(mode==='celestial'){
      cube(1,.24);for(let i=-3;i<=3;i++){const yy=cy+i*9+Math.sin(time*.15+i)*3;line(.28+Math.abs(i)*.025,1.2);ctx.beginPath();ctx.moveTo(cx-50,yy);ctx.lineTo(cx+50,yy-10*Math.sin(i));ctx.stroke();}dot(cx,cy-4,3,.8);
    } else if(mode==='aurora'){
      cube(1,.24);for(let i=0;i<9;i++){ctx.beginPath();for(let x=-55;x<=55;x+=3){const y=(i-4)*7+Math.sin(x*.045+time*.28+i*.5)*(5+motion*8);x===-55?ctx.moveTo(cx+x,cy+y):ctx.lineTo(cx+x,cy+y);}line(.2+i*.035,1.25);ctx.stroke();}
    } else {
      // Abyss: descending perspective planes.
      for(let i=0;i<8;i++){const k=i/7, y=cy-28+k*58, half=52*(1-k*.72);line(.45-k*.32,1.2);ctx.beginPath();ctx.moveTo(cx-half,y);ctx.lineTo(cx+half,y);ctx.stroke();if(i<7){ctx.beginPath();ctx.moveTo(cx-half,y);ctx.lineTo(cx-52*(1-(k+1/7)*.72),cy-28+(k+1/7)*58);ctx.stroke();}}
    }
    // A restrained live wave makes the space breathe with actual signal.
    for(let i=0;i<4;i++){const phase=(time*(.12+motion*.18)+i*.21)%1;line((1-phase)*(.28+activity*.3),1.1);ctx.beginPath();ctx.ellipse(cx,cy,phase*58*size,phase*30*size,0,0,Math.PI*2);ctx.stroke();}
  }

  // ARTIFACT — cassette/vinyl stay literal; other media modes use subtle linework.
  else if (module.id === 'media') {
    cube(.94,.2);
    const wear=params.wear??.25;
    if(mode==='cassette'){
      // Minimal cassette blueprint: module accent washes the glass, bright linework carries the form.
      const shellW=104, shellH=58, left=cx-shellW/2, top=cy-shellH/2;
      ctx.fillStyle=rgba(.075 + activity*.055);
      ctx.fillRect(left,top,shellW,shellH);
      line(.64,1.45);
      ctx.strokeRect(left+.5,top+.5,shellW-1,shellH-1);
      line(.30,1.05);
      ctx.strokeRect(cx-38,cy-17,76,27);
      const spin=time*(1.2+wear*1.8);
      for(const rx of [-24,24]){
        line(.58,1.35);
        ctx.beginPath();ctx.arc(cx+rx,cy-4,11,0,Math.PI*2);ctx.stroke();
        ctx.beginPath();ctx.arc(cx+rx,cy-4,4,0,Math.PI*2);ctx.stroke();
        for(let i=0;i<6;i++){
          const a=spin+i*Math.PI/3;
          ctx.beginPath();
          ctx.moveTo(cx+rx+Math.cos(a)*5,cy-4+Math.sin(a)*5);
          ctx.lineTo(cx+rx+Math.cos(a)*9,cy-4+Math.sin(a)*9);
          ctx.stroke();
        }
      }
      line(.42,1.2);
      ctx.beginPath();
      ctx.moveTo(cx-13,cy-4);ctx.lineTo(cx+13,cy-4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx-38,cy+18);ctx.lineTo(cx-27,cy+28);ctx.lineTo(cx+27,cy+28);ctx.lineTo(cx+38,cy+18);
      ctx.stroke();
      for(let i=-1;i<=1;i++) dot(cx+i*13,cy+23,1.35,.55);
      line(.24+wear*.22,1);
      for(let i=0;i<4;i++){
        const y=top+8+i*5;
        ctx.beginPath();ctx.moveTo(left+8,y);ctx.lineTo(left+30,y);ctx.stroke();
      }
    } else if(mode==='vinyl'){
      // Stylized turntable world: record/platter live inside the same perspective chamber.
      cube(1,.24);
      const spin=time*(.72+wear*.42);
      const platterY=cy+5;
      ctx.save();
      ctx.translate(cx-7,platterY);
      ctx.scale(1,.48);
      for(let r=11;r<=44;r+=5){
        line(.18+r/150, r===44?1.45:1);
        ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();
      }
      // Rotating label geometry gives motion without flashing or audio reaction.
      line(.58,1.35);
      ctx.beginPath();ctx.arc(0,0,11,0,Math.PI*2);ctx.stroke();
      for(let i=0;i<4;i++){
        const a=spin+i*Math.PI/2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*4,Math.sin(a)*4);
        ctx.lineTo(Math.cos(a)*10,Math.sin(a)*10);
        ctx.stroke();
      }
      ctx.restore();

      // Spindle.
      dot(cx-7,platterY,1.7,.7);

      // Tonearm, pivot and cartridge.
      const armPhase=.04*Math.sin(time*.16);
      const pivotX=cx+43,pivotY=cy-23;
      line(.52,1.4);
      ctx.beginPath();ctx.arc(pivotX,pivotY,6,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pivotX-2,pivotY+4);
      ctx.lineTo(cx+18+armPhase*22,cy+4);
      ctx.lineTo(cx+11+armPhase*18,cy+10);
      ctx.stroke();
      ctx.save();
      ctx.translate(cx+12+armPhase*18,cy+9);
      ctx.rotate(-.35);
      line(.66,1.35);
      ctx.strokeRect(-5,-2,10,4);
      ctx.restore();

      // Sparse perspective deck rails inside the cube.
      line(.24,1);
      const deckA=project(-48,25,-.72),deckB=project(48,25,-.72);
      const deckC=project(48,32,.58),deckD=project(-48,32,.58);
      ctx.beginPath();ctx.moveTo(...deckA);ctx.lineTo(...deckB);ctx.lineTo(...deckC);ctx.lineTo(...deckD);ctx.closePath();ctx.stroke();
    } else if(mode==='reel'){
      for(const x of [-28,28]){line(.52,1.4);ctx.beginPath();ctx.arc(cx+x,cy-4,18,0,Math.PI*2);ctx.stroke();for(let i=0;i<3;i++){const a=time*(.5+wear)+i*Math.PI*2/3;ctx.beginPath();ctx.moveTo(cx+x,cy-4);ctx.lineTo(cx+x+Math.cos(a)*14,cy-4+Math.sin(a)*14);ctx.stroke();}}
      line(.4,1.3);ctx.beginPath();ctx.moveTo(cx-28,cy+14);ctx.quadraticCurveTo(cx,cy+28,cx+28,cy+14);ctx.stroke();
    } else if(mode==='vhs'){
      for(let y=-28;y<=28;y+=8){line(.22+((y+28)/56)*.2,1);ctx.beginPath();ctx.moveTo(cx-52,cy+y+Math.sin(time*3+y)*wear*3);ctx.lineTo(cx+52,cy+y);ctx.stroke();}
      const scan=((time*.35)%1)*56-28;line(.72,1.5);ctx.beginPath();ctx.moveTo(cx-50,cy+scan);ctx.lineTo(cx+50,cy+scan);ctx.stroke();
    } else if(mode==='radio'){
      line(.5,1.3);ctx.beginPath();ctx.moveTo(cx-50,cy+12);ctx.lineTo(cx+50,cy+12);ctx.stroke();for(let i=0;i<13;i++){const x=cx-48+i*8;const h=5+(i%4)*4;line(.25+(i%3)*.08,1);ctx.beginPath();ctx.moveTo(x,cy+12);ctx.lineTo(x,cy+12-h);ctx.stroke();}const needle=cx-45+((Math.sin(time*.18)+1)/2)*90;line(.75,1.5);ctx.beginPath();ctx.moveTo(needle,cy-20);ctx.lineTo(needle,cy+18);ctx.stroke();
    } else if(mode==='wax'){
      for(let r=8;r<=48;r+=5){line(.18+r/180,1);ctx.beginPath();ctx.ellipse(cx,cy,r,r*.55,Math.sin(r)*.02,0,Math.PI*2);ctx.stroke();}
      for(let i=0;i<6;i++)dot(cx+Math.sin(i*8.3+time*.04)*44,cy+Math.cos(i*4.7)*23,1,.35+wear*.25);
    } else if(mode==='broken'){
      let px=cx-52,py=cy;for(let i=1;i<=15;i++){const x=cx-52+i*(104/15),y=cy+Math.sin(i*9.13+time*.8)*24*wear+((i%4)-2)*5;line(.3+(i%3)*.09,1.3);ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();px=x;py=y;}if(transient>.08)dot(px,py,2.5,.9);
    } else {
      // Archive: sparse aging waveform + vertical dropout scars.
      wave(0,7,.055,time*.08,.48);for(let i=0;i<8;i++){const x=cx-48+i*14+Math.sin(i*3.7)*3;line(.18+wear*.25,1);ctx.beginPath();ctx.moveTo(x,cy-28);ctx.lineTo(x,cy+28);ctx.stroke();}
    }
  }

  // GRAIN keeps its particle identity; no algorithm dropdown to distinguish.
  else {
    cube(1,.22);
    const density=params.density??.4, count=18+Math.round(density*46);
    for(let i=0;i<count;i++){const seed=i*12.9898,orbit=time*(.18+(params.chaos??.2)*.55)+seed,x=Math.sin(seed*1.7+orbit)*(20+(i%7)*6),y=Math.cos(seed*.9+orbit*1.2)*(12+(i%5)*6),z=Math.sin(seed+orbit*.7),p=project(x,y,z),sz=1+((i%4)/3)*(1+(params.bloom??.3)*2);ctx.fillStyle=rgba(.14+activity*.5+(z+1)*.08);ctx.fillRect(p[0]-sz/2,p[1]-sz/2,sz,sz);}
  }

  ctx.strokeStyle = 'rgba(255,255,255,.028)';
  ctx.lineWidth = 1;
  for (let y = 6; y < height; y += 6) { ctx.beginPath(); ctx.moveTo(0,y+.5); ctx.lineTo(width,y+.5); ctx.stroke(); }
}
