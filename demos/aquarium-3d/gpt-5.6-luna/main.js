(() => {
'use strict';
const canvas = document.getElementById('aquarium'), ctx = canvas.getContext('2d', { alpha:false });
const TAU = Math.PI * 2, V = (x=0,y=0,z=0) => ({x,y,z});
const add=(a,b)=>V(a.x+b.x,a.y+b.y,a.z+b.z), sub=(a,b)=>V(a.x-b.x,a.y-b.y,a.z-b.z);
const mul=(a,n)=>V(a.x*n,a.y*n,a.z*n), dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>V(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
const norm=a=>{const l=Math.hypot(a.x,a.y,a.z)||1;return mul(a,1/l)}, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rand=(a,b)=>a+Math.random()*(b-a), rgba=(hex,a)=>{const n=parseInt(hex.slice(1),16);return 'rgba('+(n>>16)+','+(n>>8&255)+','+(n&255)+','+a+')'};
let W=0,H=0,dpr=1,time=0,last=performance.now(),paused=false,lightPower=1,speedPower=1,schooling=true;
const box={x:7.5,y:4.3,z:5.5}, fish=[],bubbles=[],plants=[],motes=[];
const cam={pos:V(),target:V(),right:V(),up:V(),forward:V(),focal:0};
const species={
 neon:{name:'neon',color:'#2ce3d8',accent:'#e8f8b1',dark:'#0c5264',size:.45,speed:2},
 koi:{name:'koi',color:'#f18f51',accent:'#fff0bd',dark:'#713c36',size:.82,speed:1.18},
 angel:{name:'angel',color:'#cfbaff',accent:'#8b74ca',dark:'#27275a',size:1.02,speed:.82}
};
function seed(){
 for(let i=0;i<48;i++){const type=i<29?species.neon:(i%3===0?species.angel:species.koi);
  fish.push({p:V(rand(-6.6,6.6),rand(-2.4,2.6),rand(-4.5,4.5)),v:V(rand(-1,1),rand(-.32,.32),rand(-1,1)),type,school:i<29,phase:rand(0,TAU),seed:rand(0,100),scale:rand(.82,1.16)});
 }
 for(let i=0;i<38;i++)bubbles.push({x:rand(-7,7),y:rand(-4,3),z:rand(-5,5),r:rand(.025,.11),speed:rand(.17,.5),phase:rand(0,TAU),alpha:rand(.22,.7)});
 for(let i=0;i<35;i++)motes.push({x:rand(-7.2,7.2),y:rand(-4.1,3.9),z:rand(-5.2,5.2),r:rand(.012,.05),drift:rand(.1,.35),phase:rand(0,TAU)});
 for(let i=0;i<25;i++)plants.push({x:rand(-7.1,7.1),z:rand(-5,5),h:rand(1,3.4),width:rand(.13,.3),phase:rand(0,TAU),leaves:Math.floor(rand(3,7)),hue:rand(145,185)});
}
function resize(){W=innerWidth;H=innerHeight;dpr=Math.min(2,devicePixelRatio||1);canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);cam.focal=Math.min(W,H)*.91}
function updateCam(t){const o=t*.045;cam.pos=V(Math.sin(o)*11.2,.65+Math.sin(t*.08)*.22,Math.cos(o)*11.2);cam.target=V(0,-.25+Math.sin(t*.11)*.1,0);cam.forward=norm(sub(cam.target,cam.pos));cam.right=norm(cross(cam.forward,V(0,1,0)));cam.up=norm(cross(cam.right,cam.forward))}
function project(p){const r=sub(p,cam.pos),depth=dot(r,cam.forward);if(depth<.25)return null;const s=cam.focal/depth;return{x:W/2+dot(r,cam.right)*s,y:H*.52-dot(r,cam.up)*s,s,depth}}
function fog(depth){return clamp(1-Math.max(0,depth-5)/14,.18,1)}
function poly(points,fill,stroke,width=1){const p=points.map(project);if(p.some(x=>!x))return;ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);for(let i=1;i<p.length;i++)ctx.lineTo(p[i].x,p[i].y);ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke()}}
function line(points,stroke,width=1){const p=points.map(project);if(p.some(x=>!x))return;ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);for(let i=1;i<p.length;i++)ctx.lineTo(p[i].x,p[i].y);ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.lineCap='round';ctx.stroke()}
function circle(p,r,fill,stroke){const q=project(p);if(!q)return;ctx.beginPath();ctx.arc(q.x,q.y,Math.max(.6,r*q.s),0,TAU);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.stroke()}}
function update(dt){
 const motion=dt*speedPower;
 for(const f of fish){const p=f.p,t=time+f.seed;let aim=V(Math.sin(t*.43+f.phase)*.62,Math.sin(t*.31+f.phase*1.8)*.28,Math.cos(t*.37+f.phase*.7)*.62);
  if(f.school&&schooling){const c=V(),fl=V();let n=0;for(const o of fish)if(o!==f&&o.school){const d=sub(o.p,p),dist=Math.hypot(d.x,d.y,d.z);if(dist<3.2){c.x+=o.p.x;c.y+=o.p.y;c.z+=o.p.z;fl.x+=o.v.x;fl.y+=o.v.y;fl.z+=o.v.z;n++}}if(n){aim=add(aim,mul(sub(mul(c,1/n),p),.24));aim=add(aim,mul(sub(mul(fl,1/n),f.v),.3))}}
  const m=.9;if(p.x>box.x-m)aim.x-=(p.x-box.x+m)*1.1;if(p.x<-box.x+m)aim.x+=(-box.x+m-p.x)*1.1;if(p.y>box.y-.8)aim.y-=(p.y-box.y+.8)*1.2;if(p.y<-box.y+.8)aim.y+=(-box.y+.8-p.y)*1.2;if(p.z>box.z-m)aim.z-=(p.z-box.z+m)*1.1;if(p.z<-box.z+m)aim.z+=(-box.z+m-p.z)*1.1;
  const target=norm(aim),max=f.type.speed*(f.school?1.04:1)*(schooling?1:.8);f.v=add(mul(f.v,Math.pow(.985,motion*60)),mul(target,.026*motion));f.v=mul(norm(f.v),max);f.p=add(f.p,mul(f.v,motion));
 }
 for(const b of bubbles){b.y+=b.speed*motion;b.x+=Math.sin(time*.7+b.phase)*.002*motion;if(b.y>box.y+.3){b.y=-box.y-.3;b.x=rand(-7,7)}}
}
function background(){
 const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#071c2a');g.addColorStop(.24,'#0a3142');g.addColorStop(.58,'#0a5360');g.addColorStop(1,'#031d2b');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
 const glow=ctx.createRadialGradient(W*.5,H*.05,0,W*.5,H*.2,Math.max(W,H)*.75);glow.addColorStop(0,'rgba(129,246,221,'+(.1*lightPower)+')');glow.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
 ctx.save();ctx.globalCompositeOperation='screen';for(let i=0;i<7;i++){const x=W*(.12+i*.14)+Math.sin(time*.08+i)*W*.025,w=W*(.06+(i%2)*.025),beam=ctx.createLinearGradient(x,0,x+W*.04,H*.72);beam.addColorStop(0,'rgba(190,255,229,'+(.045*lightPower)+')');beam.addColorStop(1,'rgba(100,235,208,0)');ctx.fillStyle=beam;ctx.beginPath();ctx.moveTo(x-w*.25,0);ctx.lineTo(x+w*.3,0);ctx.lineTo(x+w*2.2,H*.76);ctx.lineTo(x+w*1.15,H*.76);ctx.closePath();ctx.fill()}ctx.restore();
}
function backRocks(){for(const r of [V(-5.8,-3.45,2.5),V(-4.7,-3.55,-1.7),V(5.9,-3.55,1.2),V(4.9,-3.3,-3.8),V(-2.1,-3.7,-4.8),V(2.4,-3.5,-3.7)]){circle(add(r,V(0,.2,0)),.55,'rgba(17,78,78,.56)');circle(add(r,V(.15,.34,.12)),.22,'rgba(78,155,136,.24)')}}
function drawPlants(){for(const p of plants.slice().sort((a,b)=>b.z-a.z)){const base=V(p.x,-3.72,p.z),sway=Math.sin(time*.72+p.phase)*.25;line([base,V(p.x+sway*.35,-3.72+p.h*.5,p.z),V(p.x+sway,-3.72+p.h,p.z)],'rgba(50,145,150,.62)',p.width*10);for(let j=0;j<p.leaves;j++){const q=j/p.leaves,y=-3.68+p.h*q,x=p.x+sway*q,lean=Math.sin(time*.72+p.phase+j*.8)*.2;poly([V(x,y,p.z),V(x+lean+p.width,y+.16,p.z),V(x+lean,y+.38,p.z),V(x-p.width*.65,y+.14,p.z)],'rgba(42,145,145,.38)')}}}
function sand(){const y=-3.67;poly([V(-8,y,-6),V(8,y,-6),V(8,y,6),V(-8,y,6)],'rgba(157,131,76,.62)');for(let i=0;i<75;i++){const x=-7.8+i*1.771%15.6,z=-5.8+i*2.917%11.6,len=.06+i%4*.035;line([V(x,y+.01,z),V(x+len,y+.015,z+.012)],'rgba(244,208,123,'+(.13+i%5*.025)+')',.018)}ctx.save();ctx.globalCompositeOperation='screen';for(let i=0;i<12;i++){const x=W*(.04+i*.085)+Math.sin(time*.36+i*2.3)*W*.025,y=H*(.71+i%4*.035),c=ctx.createRadialGradient(x,y,0,x,y,W*.11);c.addColorStop(0,'rgba(255,233,150,'+(.055*lightPower)+')');c.addColorStop(.35,'rgba(220,205,130,0)');ctx.fillStyle=c;ctx.beginPath();ctx.ellipse(x,y,W*.15,H*.025,Math.sin(i)*.3,0,TAU);ctx.fill()}ctx.restore()}
function ambient(){for(const m of motes)circle(V(m.x,m.y,m.z),m.r,'rgba(189,255,227,.17)');for(const b of bubbles.slice().sort((a,c)=>c.z-a.z))circle(V(b.x+Math.sin(time+b.phase)*.05,b.y,b.z),b.r,'rgba(180,255,238,'+(b.alpha*fog(Math.abs(b.z)+7))+')','rgba(207,255,246,.38)')}
function fishBasis(f){const forward=norm(f.v),upWorld=V(0,1,0);let side=norm(cross(forward,upWorld));if(Math.hypot(side.x,side.y,side.z)<.1)side=V(1,0,0);return{forward,side,up:norm(cross(side,forward))}}
function fishPoint(f,b,ff,ss,uu){return add(f.p,add(mul(b.forward,ff*f.scale),add(mul(b.side,ss*f.scale),mul(b.up,uu*f.scale))))}
function drawFish(f){
 const b=fishBasis(f),s=f.type.size*f.scale,swim=Math.sin(time*(f.type.name==='neon'?7:3.8)+f.phase),wave=Math.sin(time*4.2+f.phase)*.1,op=fog(dot(sub(f.p,cam.pos),cam.forward)),C=f.type.color,A=f.type.accent,D=f.type.dark,P=(a,b2,c)=>fishPoint(f,b,a,b2,c);
 poly([P(-s*1.02,0,0),P(-s*1.76,-s*(.48+swim*.08),0),P(-s*1.54,0,0),P(-s*1.76,s*(.48+swim*.08),0)],rgba(D,.95*op));
 if(f.type.name==='angel'){poly([P(-.42*s,0,0),P(-.85*s,0,s*(1.5+swim*.08)),P(.18*s,0,s*.12)],rgba(A,.5*op));poly([P(-.38*s,0,0),P(-.9*s,0,-s*1.45),P(.2*s,0,-s*.1)],rgba(A,.48*op))}else poly([P(-.18*s,0,0),P(-.65*s,-s*(.62+swim*.1),0),P(.25*s,-s*.1,0)],rgba(A,.46*op));
 poly([P(-.95*s,0,0),P(-.68*s,-.52*s,wave),P(-.06*s,-.69*s,wave*.7),P(.65*s,-.42*s,0),P(.92*s,0,0),P(.65*s,.42*s,0),P(-.06*s,.69*s,wave*.7),P(-.68*s,.52*s,wave)],rgba(C,.94*op),rgba(A,.62*op),.7);
 poly([P(-.82*s,-.03*s,s*.03),P(-.42*s,-.46*s,s*.14),P(.5*s,-.34*s,s*.16),P(.77*s,0,s*.05),P(.25*s,.05*s,s*.18),P(-.45*s,.25*s,s*.1)],rgba(A,.18*op));
 if(f.type.name==='neon'){line([P(-.55*s,-.07*s,s*.12),P(.55*s,-.04*s,s*.12)],'rgba(255,248,173,'+(.8*op)+')',Math.max(1,s*.13*project(f.p).s));line([P(-.45*s,.12*s,s*.13),P(.55*s,.1*s,s*.13)],'rgba(39,244,224,'+(.86*op)+')',Math.max(1,s*.07*project(f.p).s))}
 circle(P(.62*s,-.3*s,s*.48),.095*s,'rgba(245,255,227,'+op+')');circle(P(.65*s,-.31*s,s*.54),.043*s,'rgba(5,24,31,'+op+')');
 line([P(.12*s,.52*s,0),P(.42*s,s*(.78+swim*.07),0),P(.64*s,.38*s,0)],rgba(A,.4*op),Math.max(.6,s*.035*project(f.p).s))
}
function fishLayer(){fish.slice().sort((a,b)=>dot(sub(b.p,cam.pos),cam.forward)-dot(sub(a.p,cam.pos),cam.forward)).forEach(drawFish)}
function glass(){
 const haze=ctx.createLinearGradient(0,0,W,0);haze.addColorStop(0,'rgba(69,238,211,.055)');haze.addColorStop(.5,'rgba(8,30,45,0)');haze.addColorStop(1,'rgba(104,249,224,.045)');ctx.fillStyle=haze;ctx.fillRect(0,0,W,H);
 ctx.save();ctx.globalCompositeOperation='screen';ctx.translate(W*.72+Math.sin(time*.14)*W*.08,H*.1);ctx.rotate(-.22);const sh=ctx.createLinearGradient(0,0,18,0);sh.addColorStop(0,'rgba(225,255,246,0)');sh.addColorStop(.5,'rgba(225,255,246,.18)');sh.addColorStop(1,'rgba(225,255,246,0)');ctx.fillStyle=sh;ctx.fillRect(0,0,12,H*.64);ctx.restore();
 const edge=ctx.createLinearGradient(0,0,0,H);edge.addColorStop(0,'rgba(190,255,240,.2)');edge.addColorStop(.38,'rgba(180,255,240,.04)');edge.addColorStop(1,'rgba(0,0,0,.2)');ctx.strokeStyle=edge;ctx.lineWidth=1;ctx.strokeRect(12,12,W-24,H-24);
 const v=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.25,W/2,H/2,Math.max(W,H)*.75);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,8,14,.42)');ctx.fillStyle=v;ctx.fillRect(0,0,W,H)
}
function render(){background();updateCam(time);backRocks();drawPlants();sand();ambient();fishLayer();glass()}
function frame(now){const dt=clamp((now-last)/1000,0,.045);last=now;if(!paused){time+=dt;update(dt)}render();requestAnimationFrame(frame)}
document.getElementById('pauseButton').addEventListener('click',()=>{paused=!paused;document.querySelector('.pause-icon').textContent=paused?'▶':'Ⅱ';document.querySelector('.button-label').textContent=paused?'Продолжить':'Пауза'});
document.getElementById('lightSlider').addEventListener('input',e=>{lightPower=+e.target.value;document.getElementById('lightValue').textContent=Math.round(lightPower*100)+'%'});
document.getElementById('speedSlider').addEventListener('input',e=>{speedPower=+e.target.value;document.getElementById('speedValue').textContent=speedPower.toFixed(1)+'×'});
document.getElementById('schoolButton').addEventListener('click',e=>{schooling=!schooling;e.currentTarget.classList.toggle('active',schooling);e.currentTarget.innerHTML='<span class="school-dot"></span> Стая: '+(schooling?'ON':'OFF')});
addEventListener('resize',resize,{passive:true});resize();seed();requestAnimationFrame(frame);
})();
