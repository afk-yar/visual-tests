(function () {
  "use strict";

  const canvas = document.getElementById("aquarium");
  const ctx = canvas.getContext("2d", { alpha: false });
  const fishCountEl = document.getElementById("fishCount");
  const fpsEl = document.getElementById("fps");
  const pauseBtn = document.getElementById("pauseBtn");
  const pauseLabel = document.getElementById("pauseLabel");
  const densityInput = document.getElementById("density");
  const cameraInput = document.getElementById("cameraMotion");

  const TAU = Math.PI * 2;
  const tank = { x: 8.2, y: 4.5, z: 6.2 };
  const fogColor = [18, 78, 91];
  const fish = [], bubbles = [], weeds = [], motes = [], rays = [];
  const camera = { pos: v3(), right: v3(), up: v3(), forward: v3(), focal: 800 };
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let width = 1, height = 1, dpr = 1, time = 0;
  let last = performance.now(), paused = false, fpsSmooth = 60;

  const species = [
    { body:"#e96d45", belly:"#ffd38e", fin:"#ef9b63", stripe:"#5a3140", size:.72, speed:.84 },
    { body:"#2ea5b0", belly:"#b9ede1", fin:"#63d4c3", stripe:"#173f68", size:.88, speed:.66 },
    { body:"#dda62c", belly:"#ffe8a1", fin:"#f5c352", stripe:"#6c5632", size:1.06, speed:.52 },
    { body:"#94aebb", belly:"#e5f2e9", fin:"#85c1c2", stripe:"#4e6f79", size:1.2, speed:.43 }
  ];

  function v3(x=0,y=0,z=0){ return {x,y,z}; }
  function add(a,b){ return v3(a.x+b.x,a.y+b.y,a.z+b.z); }
  function sub(a,b){ return v3(a.x-b.x,a.y-b.y,a.z-b.z); }
  function mul(a,n){ return v3(a.x*n,a.y*n,a.z*n); }
  function dot(a,b){ return a.x*b.x+a.y*b.y+a.z*b.z; }
  function cross(a,b){ return v3(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x); }
  function len(a){ return Math.hypot(a.x,a.y,a.z); }
  function norm(a){ const l=len(a)||1; return mul(a,1/l); }
  function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
  function lerp(a,b,n){ return a+(b-a)*n; }
  function rand(a,b){ return a+Math.random()*(b-a); }

  function hexRgb(hex){
    const n=parseInt(hex.slice(1),16);
    return [(n>>16)&255,(n>>8)&255,n&255];
  }
  function fogged(hex,fog){
    const c=hexRgb(hex), f=clamp(fog,0,1);
    return `rgb(${lerp(c[0],fogColor[0],f)|0},${lerp(c[1],fogColor[1],f)|0},${lerp(c[2],fogColor[2],f)|0})`;
  }
  function foggedHex(hex,fog){
    const c=hexRgb(hex),f=clamp(fog,0,1);
    return "#"+c.map((n,i)=>(lerp(n,fogColor[i],f)|0).toString(16).padStart(2,"0")).join("");
  }
  function rgba(hex,alpha){
    const c=hexRgb(hex);
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  }

  function resize(){
    width=innerWidth; height=innerHeight;
    dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr);
    canvas.style.width=width+"px"; canvas.style.height=height+"px";
    ctx.setTransform(dpr,0,0,dpr,0,0);
    camera.focal=Math.min(width,height)*1.12;
  }

  function updateCamera(t,dt){
    const motion=Number(cameraInput.value)/100;
    pointer.x+=(pointer.tx-pointer.x)*Math.min(1,dt*2.2);
    pointer.y+=(pointer.ty-pointer.y)*Math.min(1,dt*2.2);
    const yaw=Math.sin(t*.075)*.17*motion+pointer.x*.16;
    const pitch=-.055+Math.sin(t*.11)*.025*motion+pointer.y*.09;
    const distance=15.3;
    camera.pos=v3(Math.sin(yaw)*distance,.1+Math.sin(pitch)*distance,-Math.cos(yaw)*Math.cos(pitch)*distance);
    camera.forward=norm(sub(v3(0,-.1,.4),camera.pos));
    camera.right=norm(cross(camera.forward,v3(0,1,0)));
    camera.up=norm(cross(camera.right,camera.forward));
  }

  function project(p){
    const rel=sub(p,camera.pos),z=dot(rel,camera.forward);
    if(z<.2)return null;
    const scale=camera.focal/z;
    return {x:width*.5+dot(rel,camera.right)*scale,y:height*.49-dot(rel,camera.up)*scale,z,scale};
  }

  function path3(points,close=false){
    let started=false; ctx.beginPath();
    for(const p of points){
      const q=project(p); if(!q)continue;
      if(!started){ctx.moveTo(q.x,q.y);started=true;}else ctx.lineTo(q.x,q.y);
    }
    if(close)ctx.closePath();
    return started;
  }

  function fishBounds(size){
    const silhouetteRadius=size*2.2+.1;
    return v3(
      Math.max(.5,tank.x-silhouetteRadius),
      Math.max(.5,tank.y-silhouetteRadius),
      Math.max(.5,tank.z-silhouetteRadius)
    );
  }

  function randomFishTarget(size){
    const bounds=fishBounds(size);
    return v3(
      rand(-bounds.x*.9,bounds.x*.9),
      rand(-bounds.y*.88,bounds.y*.88),
      rand(-bounds.z*.9,bounds.z*.9)
    );
  }

  function createFish(index){
    const school=index<Math.max(5,Math.round(Number(densityInput.value)*.55));
    const sp=school?species[0]:species[1+(index%3)],heading=rand(0,TAU);
    const size=sp.size*rand(.82,1.18);
    const bounds=fishBounds(size);
    return {
      pos:v3(
        rand(-bounds.x*.88,bounds.x*.88),
        rand(-bounds.y*.82,bounds.y*.82),
        rand(-bounds.z*.86,bounds.z*.86)
      ),
      vel:v3(Math.cos(heading)*sp.speed,rand(-.14,.14),Math.sin(heading)*sp.speed),
      target:randomFishTarget(size),species:sp,size,
      phase:rand(0,TAU),seed:rand(0,100),school
    };
  }

  function syncFishCount(){
    const wanted=Number(densityInput.value);
    while(fish.length<wanted)fish.push(createFish(fish.length));
    while(fish.length>wanted)fish.pop();
    fishCountEl.textContent=fish.length;
  }

  function initWorld(){
    syncFishCount();
    for(let i=0;i<72;i++)bubbles.push({
      pos:v3(rand(-7.5,7.5),rand(-4.2,4.2),rand(-5.4,5.4)),
      r:rand(.025,.115),speed:rand(.18,.62),phase:rand(0,TAU)
    });
    for(let i=0;i<24;i++)weeds.push({
      root:v3(rand(-7.5,7.5),-4.15,rand(-5.5,5.5)),height:rand(1.2,3.7),
      phase:rand(0,TAU),width:rand(.07,.17),hue:Math.random()<.5?"#397f67":"#2d6c61"
    });
    for(let i=0;i<130;i++)motes.push({
      pos:v3(rand(-8,8),rand(-4,4),rand(-6,6)),phase:rand(0,TAU),r:rand(.006,.025)
    });
    for(let i=0;i<7;i++)rays.push({x:rand(-7,7),z:rand(-3.5,5.5),width:rand(.3,1.25),phase:rand(0,TAU)});
  }

  function updateFish(f,dt){
    const bounds=fishBounds(f.size);
    const toTarget=sub(f.target,f.pos);
    if(len(toTarget)<1.1||Math.random()<dt*.08)f.target=randomFishTarget(f.size);
    let steer=mul(norm(toTarget),.42);
    steer.y+=Math.sin(time*.7+f.seed)*.035;

    if(f.school){
      let center=v3(),avg=v3(),avoid=v3(),count=0;
      for(const other of fish){
        if(other===f||!other.school)continue;
        const delta=sub(other.pos,f.pos),d=len(delta);
        if(d<3.3){
          center=add(center,other.pos); avg=add(avg,other.vel);
          if(d<.72)avoid=add(avoid,mul(delta,-1/Math.max(.1,d*d)));
          count++;
        }
      }
      if(count){
        center=mul(center,1/count); avg=mul(avg,1/count);
        steer=add(steer,mul(norm(sub(center,f.pos)),.23));
        steer=add(steer,mul(norm(avg),.3));
        steer=add(steer,mul(avoid,.48));
      }
    }

    const axes=["x","y","z"];
    const lookAhead=1.1+f.size*1.4;
    const wallZone=.58+f.size*.5;
    const currentSpeed=len(f.vel)||1;
    for(const axis of axes){
      const future=f.pos[axis]+f.vel[axis]*lookAhead;
      const edge=Math.max(Math.abs(f.pos[axis]),Math.abs(future));
      const pressure=clamp(1-(bounds[axis]-edge)/wallZone,0,1);
      if(pressure>0){
        const wallSign=Math.sign(Math.abs(future)>Math.abs(f.pos[axis])?future:f.pos[axis])||1;
        const outward=clamp(wallSign*f.vel[axis]/currentSpeed,0,1);
        steer[axis]-=wallSign*(1.15+outward*2.5)*pressure*pressure;
        f.target[axis]=clamp(f.target[axis],-bounds[axis]*.72,bounds[axis]*.72);
      }
    }

    f.vel=add(f.vel,mul(steer,dt));
    const desired=f.species.speed*(.86+Math.sin(time*.31+f.seed)*.12);
    f.vel=mul(norm(f.vel),lerp(len(f.vel),desired,Math.min(1,dt*1.5)));
    f.pos=add(f.pos,mul(f.vel,dt));

    for(const axis of axes){
      if(f.pos[axis]>bounds[axis]){
        f.pos[axis]=bounds[axis];
        if(f.vel[axis]>0)f.vel[axis]*=-.35;
        f.target[axis]=Math.min(f.target[axis],bounds[axis]*.55);
      }else if(f.pos[axis]<-bounds[axis]){
        f.pos[axis]=-bounds[axis];
        if(f.vel[axis]<0)f.vel[axis]*=-.35;
        f.target[axis]=Math.max(f.target[axis],-bounds[axis]*.55);
      }
    }
    f.phase+=dt*(5.8+len(f.vel)*2.1);
  }

  function updateWorld(dt){
    for(const f of fish)updateFish(f,dt);
    for(const b of bubbles){
      b.pos.y+=b.speed*dt;
      b.pos.x+=Math.sin(time*1.3+b.phase)*dt*.045;
      if(b.pos.y>4.35){
        b.pos.y=-4.2; b.pos.x=rand(-7.5,7.5); b.pos.z=rand(-5.5,5.5);
      }
    }
  }

  function drawBackdrop(){
    const g=ctx.createLinearGradient(0,0,0,height);
    g.addColorStop(0,"#0f5c6d"); g.addColorStop(.34,"#0a4051");
    g.addColorStop(.73,"#07293a"); g.addColorStop(1,"#061925");
    ctx.fillStyle=g; ctx.fillRect(0,0,width,height);
    const glow=ctx.createRadialGradient(width*.48,-height*.1,0,width*.48,0,width*.78);
    glow.addColorStop(0,"rgba(175,255,239,.32)");
    glow.addColorStop(.27,"rgba(83,190,181,.11)");
    glow.addColorStop(1,"rgba(0,18,30,0)");
    ctx.fillStyle=glow; ctx.fillRect(0,0,width,height);
  }

  function drawDepthHaze(){
    const farWall=[
      v3(-tank.x,-tank.y,tank.z),v3(tank.x,-tank.y,tank.z),
      v3(tank.x,tank.y,tank.z),v3(-tank.x,tank.y,tank.z)
    ].map(project);
    if(farWall.some(p=>!p))return;
    const haze=ctx.createLinearGradient(0,farWall[3].y,0,farWall[0].y);
    haze.addColorStop(0,"rgba(107,177,168,.12)");
    haze.addColorStop(.48,"rgba(50,125,132,.19)");
    haze.addColorStop(1,"rgba(22,76,88,.31)");
    ctx.fillStyle=haze;
    ctx.beginPath();ctx.moveTo(farWall[0].x,farWall[0].y);
    for(let i=1;i<4;i++)ctx.lineTo(farWall[i].x,farWall[i].y);
    ctx.closePath();ctx.fill();

    const bloom=ctx.createRadialGradient(width*.5,height*.32,0,width*.5,height*.42,width*.46);
    bloom.addColorStop(0,"rgba(118,199,184,.075)");
    bloom.addColorStop(1,"rgba(35,103,113,0)");
    ctx.fillStyle=bloom;
    ctx.fillRect(0,0,width,height);
  }

  function drawRays(){
    ctx.save(); ctx.globalCompositeOperation="screen";
    for(const ray of rays){
      const sway=Math.sin(time*.16+ray.phase)*.5;
      const p=[
        v3(ray.x+sway,tank.y,ray.z),
        v3(ray.x+ray.width+sway,tank.y,ray.z+.15),
        v3(ray.x+ray.width*2.2,-tank.y,ray.z+1.6),
        v3(ray.x-ray.width*.9,-tank.y,ray.z+1.1)
      ].map(project);
      if(p.some(q=>!q))continue;
      const grad=ctx.createLinearGradient(p[0].x,p[0].y,p[3].x,p[3].y);
      grad.addColorStop(0,"rgba(194,255,236,.11)");
      grad.addColorStop(.55,"rgba(104,210,196,.035)");
      grad.addColorStop(1,"rgba(71,163,160,0)");
      ctx.fillStyle=grad; ctx.beginPath(); ctx.moveTo(p[0].x,p[0].y);
      for(let i=1;i<4;i++)ctx.lineTo(p[i].x,p[i].y);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function drawSand(){
    const corners=[
      v3(-tank.x,-tank.y,-tank.z),v3(tank.x,-tank.y,-tank.z),
      v3(tank.x,-tank.y,tank.z),v3(-tank.x,-tank.y,tank.z)
    ].map(project);
    if(corners.some(p=>!p))return;
    const grad=ctx.createLinearGradient(0,corners[0].y,0,corners[2].y);
    grad.addColorStop(0,"#334f4b"); grad.addColorStop(.48,"#596557");
    grad.addColorStop(1,"#81734e");
    ctx.fillStyle=grad; ctx.beginPath(); ctx.moveTo(corners[0].x,corners[0].y);
    for(let i=1;i<4;i++)ctx.lineTo(corners[i].x,corners[i].y);
    ctx.closePath(); ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation="screen";
    ctx.lineCap="round"; ctx.lineJoin="round";
    ctx.shadowColor="rgba(184,255,203,.26)"; ctx.shadowBlur=5;

    for(let zi=-5.6;zi<=5.6;zi+=.76){
      const pts=[];
      for(let xi=-8;xi<=8;xi+=.28){
        const drift=time*.68;
        const warp=Math.sin(xi*1.18+drift+zi*.86)*.16+
          Math.sin(xi*2.43-drift*.62-zi*.35)*.055;
        pts.push(v3(xi,-tank.y+.025,zi+warp));
      }
      const pulse=.105+Math.sin(zi*1.7-time*.8)*.025;
      ctx.strokeStyle=`rgba(191,248,190,${pulse})`;
      ctx.lineWidth=1.25; if(path3(pts))ctx.stroke();
    }

    for(let xi=-7.8;xi<=7.8;xi+=1.06){
      const pts=[];
      for(let zi=-5.8;zi<=5.8;zi+=.25){
        const drift=time*.54;
        const warp=Math.sin(zi*1.37-drift+xi*.72)*.13+
          Math.sin(zi*2.1+drift*.45)*.045;
        pts.push(v3(xi+warp,-tank.y+.028,zi));
      }
      ctx.strokeStyle="rgba(152,230,181,.072)";
      ctx.lineWidth=.9; if(path3(pts))ctx.stroke();
    }

    ctx.shadowBlur=9;
    for(let i=0;i<34;i++){
      const x=((i*4.83+time*.12)%15.6)-7.8;
      const z=((i*7.11+Math.sin(time*.31+i)*.25)%11.2)-5.6;
      const rx=.22+.12*Math.sin(i*2.4+time*.7);
      const rz=.12+.055*Math.cos(i*1.7-time*.5);
      const loop=[];
      for(let j=0;j<=8;j++){
        const a=j/8*TAU;
        const ripple=1+Math.sin(a*3+time+i)*.16;
        loop.push(v3(x+Math.cos(a)*rx*ripple,-tank.y+.032,z+Math.sin(a)*rz*ripple));
      }
      ctx.fillStyle="rgba(203,255,193,.045)";
      ctx.strokeStyle="rgba(213,255,202,.16)";
      ctx.lineWidth=1.1;
      if(path3(loop,true)){ctx.fill();ctx.stroke();}
    }
    ctx.restore();

    for(let i=0;i<80;i++){
      const x=((i*3.71)%16)-8,z=((i*7.17)%12)-6,p=project(v3(x,-tank.y+.038,z));
      if(!p)continue;
      ctx.fillStyle=`rgba(225,204,148,${clamp(.18-p.z*.005,.035,.14)})`;
      ctx.beginPath();
      ctx.ellipse(p.x,p.y,Math.max(.3,p.scale*.012),Math.max(.2,p.scale*.005),0,0,TAU);
      ctx.fill();
    }
  }

  function drawWeed(w,depthFog){
    const segments=9,left=[],right=[];
    for(let i=0;i<=segments;i++){
      const n=i/segments,bend=Math.sin(time*.75+w.phase+n*2.4)*n*n*.3;
      const center=add(w.root,v3(bend,w.height*n,Math.cos(time*.48+w.phase+n)*n*.09));
      const half=w.width*Math.sin(n*Math.PI)*(1-n*.35);
      left.push(add(center,mul(camera.right,half)));
      right.unshift(add(center,mul(camera.right,-half)));
    }
    if(!path3(left.concat(right),true))return;
    ctx.fillStyle=fogged(w.hue,depthFog*.95);
    ctx.globalAlpha=.42+(1-depthFog)*.34; ctx.fill(); ctx.globalAlpha=1;
  }

  function drawBubble(b,p,depthFog){
    const r=Math.max(.6,b.r*p.scale);
    ctx.save(); ctx.globalAlpha=clamp(.5-depthFog*.33,.12,.46);
    ctx.strokeStyle="#d9fffa"; ctx.lineWidth=Math.max(.45,r*.12);
    ctx.beginPath(); ctx.arc(p.x,p.y,r,0,TAU); ctx.stroke();
    ctx.fillStyle="rgba(227,255,251,.45)";
    ctx.beginPath(); ctx.arc(p.x-r*.28,p.y-r*.3,Math.max(.4,r*.15),0,TAU); ctx.fill();
    ctx.restore();
  }

  function drawMote(m,p,depthFog){
    const pulse=.45+Math.sin(time*.7+m.phase)*.25;
    ctx.fillStyle=`rgba(196,238,207,${pulse*(1-depthFog)*.28})`;
    ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(.25,m.r*p.scale),0,TAU); ctx.fill();
  }

  function drawFin(f,center,forward,side,up,visibleSize,depthFog,sign){
    const flap=Math.sin(f.phase*.63+sign)*.18;
    const rootA=add(center,mul(side,sign*.33*f.size));
    const rootB=add(add(center,mul(forward,-.42*f.size)),mul(side,sign*.23*f.size));
    const tip=add(add(center,mul(up,-.14*f.size)),mul(side,sign*(.78+flap)*f.size));
    const p=[rootA,tip,rootB].map(project);
    if(p.some(q=>!q))return;
    ctx.fillStyle=rgba(foggedHex(f.species.fin,depthFog),.48);
    ctx.beginPath(); ctx.moveTo(p[0].x,p[0].y);
    ctx.quadraticCurveTo(p[1].x,p[1].y,p[2].x,p[2].y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle=`rgba(230,255,240,${.1*(1-depthFog)})`;
    ctx.lineWidth=Math.max(.35,visibleSize*.009); ctx.stroke();
  }

  function drawFish(f,p,depthFog){
    const travelForward=norm(f.vel);
    const viewAlignment=Math.abs(dot(travelForward,camera.forward));
    const facingSign=dot(travelForward,camera.forward)>=0?1:-1;
    const forward=norm(add(travelForward,mul(camera.right,viewAlignment*.27*facingSign)));
    let side=cross(v3(0,1,0),forward);
    if(len(side)<.05)side=v3(1,0,0);
    side=norm(side);
    let up=norm(cross(forward,side));
    if(up.y<0)up=mul(up,-1);
    const size=f.size,segments=11,upper=[],lower=[],centers=[];
    const profile=[.05,.42,.69,.82,.88,.84,.71,.54,.34,.18,.06];

    for(let i=0;i<segments;i++){
      const n=i/(segments-1);
      const longitudinal=(1.05-n*2.35)*size;
      const wave=Math.sin(f.phase-n*5.2)*Math.pow(n,1.55)*.16*size;
      const center=add(f.pos,add(mul(forward,longitudinal),mul(side,wave)));
      const radius=profile[i]*size*.5;
      centers.push(center);
      upper.push(add(center,mul(up,radius)));
      lower.unshift(add(center,mul(up,-radius*.79)));
    }

    const body2d=upper.concat(lower).map(project);
    if(body2d.some(q=>!q))return;
    const head=project(centers[1]),tailBase=project(centers[9]);
    if(!head||!tailBase)return;
    const visibleSize=size*p.scale;
    if(visibleSize<1)return;

    ctx.save();
    ctx.globalAlpha=clamp(1-depthFog*.32,.58,1);
    ctx.shadowColor=`rgba(0,8,16,${.28*(1-depthFog)})`;
    ctx.shadowBlur=Math.min(16,visibleSize*.13);
    ctx.shadowOffsetY=Math.max(1,visibleSize*.035);

    const gradient=ctx.createLinearGradient(head.x,head.y-visibleSize*.35,head.x,head.y+visibleSize*.35);
    gradient.addColorStop(0,fogged(f.species.belly,clamp(depthFog*.8+viewAlignment*.28,0,.92)));
    gradient.addColorStop(.42,fogged(f.species.body,depthFog));
    gradient.addColorStop(1,fogged(f.species.stripe,depthFog*.85));
    ctx.fillStyle=gradient; ctx.beginPath(); ctx.moveTo(body2d[0].x,body2d[0].y);
    for(let i=1;i<body2d.length;i++){
      const a=body2d[i-1],b=body2d[i];
      ctx.quadraticCurveTo(a.x,a.y,(a.x+b.x)*.5,(a.y+b.y)*.5);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle=rgba(foggedHex(f.species.stripe,depthFog*.9),.34+viewAlignment*.2);
    ctx.lineWidth=Math.max(.65,visibleSize*(.018+viewAlignment*.012));ctx.stroke();
    ctx.shadowColor="transparent";

    const tailWave=Math.sin(f.phase-5.4)*.32*size;
    const tailTip=add(centers[10],add(mul(forward,-.72*size),mul(side,tailWave)));
    const tailP=[add(centers[9],mul(up,.48*size)),tailTip,add(centers[9],mul(up,-.48*size))].map(project);
    if(!tailP.some(q=>!q)){
      ctx.fillStyle=rgba(foggedHex(f.species.fin,depthFog),.73);
      ctx.beginPath(); ctx.moveTo(tailP[0].x,tailP[0].y);
      ctx.quadraticCurveTo(tailP[1].x,tailP[1].y-visibleSize*.08,tailP[2].x,tailP[2].y);
      ctx.quadraticCurveTo(tailBase.x,tailBase.y,tailP[0].x,tailP[0].y); ctx.fill();
      ctx.strokeStyle=rgba(foggedHex(f.species.stripe,depthFog),.3+viewAlignment*.2);
      ctx.lineWidth=Math.max(.55,visibleSize*.014);ctx.stroke();
    }

    drawFin(f,centers[4],forward,side,up,visibleSize,depthFog,1);
    drawFin(f,centers[5],forward,side,up,visibleSize,depthFog,-1);

    ctx.strokeStyle=rgba(f.species.stripe,clamp(.42-depthFog*.32,.06,.4));
    ctx.lineWidth=Math.max(.5,visibleSize*.035);
    for(const idx of [3,5,7]){
      const a=project(add(centers[idx],mul(up,profile[idx]*size*.36)));
      const b=project(add(centers[idx],mul(up,-profile[idx]*size*.28)));
      if(a&&b){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    }

    const toCamera=norm(sub(camera.pos,f.pos));
    const eyeSide=dot(side,toCamera)>=0?1:-1;
    const eye=project(add(centers[1],add(mul(up,.17*size),mul(side,eyeSide*.34*size))));
    const sideVisibility=Math.abs(dot(side,camera.forward));
    const eyeVisibility=.38+sideVisibility*.62;
    if(eye&&visibleSize>8){
      const er=clamp(visibleSize*.034,1,4.6)*eyeVisibility;
      ctx.fillStyle=`rgba(239,246,207,${.72+(1-depthFog)*.22})`;
      ctx.beginPath();ctx.arc(eye.x,eye.y,er*1.48,0,TAU);ctx.fill();
      ctx.fillStyle="#06131b";
      ctx.beginPath();ctx.arc(eye.x+eyeSide*er*.18,eye.y,er*.82,0,TAU);ctx.fill();
      ctx.fillStyle="rgba(255,255,239,.72)";
      ctx.beginPath();ctx.arc(eye.x-eyeSide*er*.18,eye.y-er*.2,Math.max(.3,er*.22),0,TAU);ctx.fill();
    }

    ctx.globalCompositeOperation="screen";
    ctx.strokeStyle=`rgba(237,255,231,${clamp(.28-depthFog*.22,.03,.25)})`;
    ctx.lineWidth=Math.max(.45,visibleSize*.018); ctx.beginPath();
    for(let i=1;i<7;i++){
      const q=project(add(centers[i],mul(up,profile[i]*size*.45)));
      if(!q)continue;
      if(i===1)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);
    }
    ctx.stroke(); ctx.restore();
  }

  function drawTankFrame(){
    const x=tank.x,y=tank.y,z=tank.z;
    const c=[
      v3(-x,-y,-z),v3(x,-y,-z),v3(x,y,-z),v3(-x,y,-z),
      v3(-x,-y,z),v3(x,-y,z),v3(x,y,z),v3(-x,y,z)
    ].map(project);
    if(c.some(p=>!p))return;
    const edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    ctx.save();
    for(let i=0;i<edges.length;i++){
      const a=c[edges[i][0]],b=c[edges[i][1]],near=Math.max(a.scale,b.scale);
      const luminous=i>=4&&i<=7;
      ctx.strokeStyle=luminous?"rgba(211,253,248,.34)":"rgba(166,231,231,.16)";
      ctx.lineWidth=clamp(near*(luminous?.016:.012),.55,2.1);
      ctx.shadowColor=luminous?"rgba(129,229,224,.28)":"rgba(106,203,207,.12)";
      ctx.shadowBlur=luminous?7:3;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    ctx.shadowBlur=0;

    const front=[c[4],c[5],c[6],c[7]];
    const glass=ctx.createLinearGradient(front[0].x,0,front[1].x,0);
    glass.addColorStop(0,"rgba(210,255,249,.105)");
    glass.addColorStop(.14,"rgba(255,255,255,.012)");
    glass.addColorStop(.78,"rgba(255,255,255,0)");
    glass.addColorStop(1,"rgba(191,246,244,.075)");
    ctx.fillStyle=glass;ctx.beginPath();ctx.moveTo(front[0].x,front[0].y);
    front.slice(1).forEach(q=>ctx.lineTo(q.x,q.y));ctx.closePath();ctx.fill();

    ctx.globalCompositeOperation="screen";
    ctx.save();
    ctx.filter="blur(4px)";
    ctx.strokeStyle="rgba(194,255,249,.13)";
    ctx.lineWidth=Math.max(5,width*.004);
    ctx.beginPath();ctx.moveTo(front[3].x,front[3].y);ctx.lineTo(front[0].x,front[0].y);
    ctx.moveTo(front[2].x,front[2].y);ctx.lineTo(front[1].x,front[1].y);ctx.stroke();
    ctx.restore();

    ctx.strokeStyle="rgba(238,255,254,.2)";
    ctx.lineWidth=Math.max(1.1,width*.00135);ctx.beginPath();
    ctx.moveTo(lerp(front[0].x,front[1].x,.09),lerp(front[0].y,front[1].y,.09));
    ctx.bezierCurveTo(width*.18,height*.24,width*.12,height*.62,
      lerp(front[3].x,front[2].x,.14),lerp(front[3].y,front[2].y,.14));
    ctx.stroke();

    ctx.strokeStyle="rgba(217,255,252,.095)";
    ctx.lineWidth=Math.max(2,width*.0025);ctx.beginPath();
    ctx.moveTo(lerp(front[3].x,front[2].x,.3),lerp(front[3].y,front[2].y,.3));
    ctx.bezierCurveTo(width*.42,height*.22,width*.58,height*.18,
      lerp(front[2].x,front[3].x,.25),lerp(front[2].y,front[3].y,.25));
    ctx.stroke();ctx.restore();
  }

  function drawVignette(){
    const g=ctx.createRadialGradient(width*.5,height*.46,Math.min(width,height)*.15,
      width*.5,height*.5,Math.max(width,height)*.72);
    g.addColorStop(0,"rgba(0,7,14,0)");
    g.addColorStop(.7,"rgba(0,7,14,.08)");
    g.addColorStop(1,"rgba(0,5,12,.64)");
    ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
    ctx.globalCompositeOperation="screen";
    const shimmer=ctx.createLinearGradient(0,0,width,height);
    shimmer.addColorStop(0,"rgba(209,255,244,.035)");
    shimmer.addColorStop(.24,"rgba(255,255,255,0)");
    shimmer.addColorStop(.74,"rgba(255,255,255,0)");
    shimmer.addColorStop(1,"rgba(150,228,230,.025)");
    ctx.fillStyle=shimmer;ctx.fillRect(0,0,width,height);
    ctx.globalCompositeOperation="source-over";
  }

  function render(){
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,width,height);
    drawBackdrop();drawDepthHaze();drawRays();drawSand();

    const queue=[];
    for(const w of weeds){
      const p=project(w.root);if(p)queue.push({z:p.z,type:0,data:w,p});
    }
    for(const m of motes){
      const pos=add(m.pos,v3(Math.sin(time*.18+m.phase)*.08,Math.sin(time*.11+m.phase)*.05,0));
      const p=project(pos);if(p)queue.push({z:p.z,type:1,data:m,p});
    }
    for(const b of bubbles){
      const p=project(b.pos);if(p)queue.push({z:p.z,type:2,data:b,p});
    }
    for(const f of fish){
      const p=project(f.pos);if(p)queue.push({z:p.z,type:3,data:f,p});
    }
    queue.sort((a,b)=>b.z-a.z);

    for(const item of queue){
      const depthFog=clamp((item.z-9.2)/11.8,0,.96);
      if(item.type===0)drawWeed(item.data,depthFog);
      else if(item.type===1)drawMote(item.data,item.p,depthFog);
      else if(item.type===2)drawBubble(item.data,item.p,depthFog);
      else drawFish(item.data,item.p,depthFog);
    }
    drawTankFrame();drawVignette();
  }

  function frame(now){
    let dt=Math.min(.05,Math.max(0,(now-last)/1000));
    last=now;if(paused)dt=0;
    time+=dt;updateCamera(time,dt||.016);
    if(dt)updateWorld(dt);
    render();
    if(dt>0)fpsSmooth=lerp(fpsSmooth,1/dt,.035);
    if((now|0)%20===0)fpsEl.textContent=String(Math.round(clamp(fpsSmooth,1,99)));
    requestAnimationFrame(frame);
  }

  function setPointer(clientX,clientY){
    pointer.tx=clamp(clientX/width*2-1,-1,1);
    pointer.ty=clamp(clientY/height*2-1,-1,1);
  }

  addEventListener("resize",resize,{passive:true});
  canvas.addEventListener("pointermove",e=>setPointer(e.clientX,e.clientY));
  canvas.addEventListener("pointerleave",()=>{pointer.tx=0;pointer.ty=0;});
  canvas.addEventListener("pointerdown",e=>{
    setPointer(e.clientX,e.clientY);
    for(const f of fish){
      const p=project(f.pos);if(!p)continue;
      const dx=p.x-e.clientX,dy=p.y-e.clientY;
      if(dx*dx+dy*dy<18000)f.target=add(f.pos,mul(norm(sub(f.pos,camera.pos)),4));
    }
  });
  pauseBtn.addEventListener("click",()=>{
    paused=!paused;
    pauseBtn.setAttribute("aria-pressed",String(paused));
    pauseLabel.textContent=paused?"Продолжить":"Пауза";
  });
  densityInput.addEventListener("input",syncFishCount);
  document.addEventListener("visibilitychange",()=>{last=performance.now();});

  resize();initWorld();updateCamera(0,.016);requestAnimationFrame(frame);
})();








