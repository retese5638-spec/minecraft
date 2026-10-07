'use strict';
/* ============================================================
   MINECLONE — a fully self-contained HTML5 Minecraft clone
   Voxel engine: chunked terrain, per-face meshing with baked
   ambient occlusion, day/night cycle, physics, mobs, TNT.
   ============================================================ */

// ================= CONFIG =================
const CHUNK = 16;          // chunk width (x,z)
const WORLD_H = 64;        // world height
const SEA = 20;            // water level
let   VIEW_DIST = 5;       // render distance in chunks
const GRAVITY = 30;
const JUMP_V  = 9.4;
const DAY_LEN = 600;       // seconds for a full day cycle

// ================= RNG / NOISE =================
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function hashStr(s){let h=1779033703^s.length;for(let i=0;i<s.length;i++){h=Math.imul(h^s.charCodeAt(i),3432918353);h=h<<13|h>>>19;}return h>>>0;}
// deterministic 2D/3D hash -> [0,1)
function hash2(x,z,s){let h=Math.imul(x,374761393)+Math.imul(z,668265263)+Math.imul(s,974634377);h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967296;}
function hash3(x,y,z,s){let h=Math.imul(x,374761393)+Math.imul(y,2246822519)+Math.imul(z,668265263)+Math.imul(s,974634377);h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967296;}

// Improved Perlin noise (3D; use z=0 for 2D)
class Perlin{
  constructor(seed){
    const rng=mulberry32(seed);
    const p=new Uint8Array(256);
    for(let i=0;i<256;i++)p[i]=i;
    for(let i=255;i>0;i--){const j=(rng()*(i+1))|0;const t=p[i];p[i]=p[j];p[j]=t;}
    this.p=new Uint8Array(512);
    for(let i=0;i<512;i++)this.p[i]=p[i&255];
  }
  static fade(t){return t*t*t*(t*(t*6-15)+10);}
  static lerp(t,a,b){return a+t*(b-a);}
  static grad(h,x,y,z){
    h&=15;const u=h<8?x:y,v=h<4?y:(h===12||h===14?x:z);
    return((h&1)===0?u:-u)+((h&2)===0?v:-v);
  }
  n3(x,y,z){
    const p=this.p;
    const X=Math.floor(x)&255,Y=Math.floor(y)&255,Z=Math.floor(z)&255;
    x-=Math.floor(x);y-=Math.floor(y);z-=Math.floor(z);
    const u=Perlin.fade(x),v=Perlin.fade(y),w=Perlin.fade(z);
    const A=p[X]+Y,AA=p[A]+Z,AB=p[A+1]+Z,B=p[X+1]+Y,BA=p[B]+Z,BB=p[B+1]+Z;
    return Perlin.lerp(w,
      Perlin.lerp(v,
        Perlin.lerp(u,Perlin.grad(p[AA],x,y,z),Perlin.grad(p[BA],x-1,y,z)),
        Perlin.lerp(u,Perlin.grad(p[AB],x,y-1,z),Perlin.grad(p[BB],x-1,y-1,z))),
      Perlin.lerp(v,
        Perlin.lerp(u,Perlin.grad(p[AA+1],x,y,z-1),Perlin.grad(p[BA+1],x-1,y,z-1)),
        Perlin.lerp(u,Perlin.grad(p[AB+1],x,y-1,z-1),Perlin.grad(p[BB+1],x-1,y-1,z-1))));
  }
  fbm2(x,y,oct){let a=0,amp=.5,f=1;for(let i=0;i<oct;i++){a+=amp*this.n3(x*f,y*f,0);amp*=.5;f*=2;}return a;}
  fbm3(x,y,z,oct){let a=0,amp=.5,f=1;for(let i=0;i<oct;i++){a+=amp*this.n3(x*f,y*f,z*f);amp*=.5;f*=2;}return a;}
}

// ================= BLOCKS =================
const B={AIR:0,GRASS:1,DIRT:2,STONE:3,SAND:4,LOG:5,LEAVES:6,WATER:7,GLASS:8,
BRICK:9,PLANKS:10,BEDROCK:11,COAL:12,IRON:13,GOLD:14,DIAMOND:15,COBBLE:16,
FLOWER_R:17,FLOWER_Y:18,TALLGRASS:19,TNT:20,LAVA:21,SNOW:22,CACTUS:23,
SANDSTONE:24,GRAVEL:25};

// tile indices in the atlas
const T={GRASS_T:0,GRASS_S:1,DIRT:2,STONE:3,SAND:4,LOG_S:5,LOG_T:6,LEAVES:7,
WATER:8,GLASS:9,BRICK:10,PLANKS:11,BEDROCK:12,COAL:13,IRON:14,GOLD:15,DIAMOND:16,
COBBLE:17,FLOWER_R:18,FLOWER_Y:19,TALLGRASS:20,TNT_S:21,TNT_T:22,LAVA:23,SNOW:24,
CACTUS_S:25,CACTUS_T:26,SANDSTONE:27,GRAVEL:28};

// def: name, tiles(all | {t,b,s}), solid, opaque, cross, liquid
const BLOCKS=[];
function defBlock(id,name,tiles,o){BLOCKS[id]=Object.assign({name,tiles,solid:true,opaque:true,cross:false,liquid:false,place:true},o);}
defBlock(B.AIR,'Air',0,{solid:false,opaque:false,place:false});
defBlock(B.GRASS,'Çim Bloğu',{t:T.GRASS_T,b:T.DIRT,s:T.GRASS_S});
defBlock(B.DIRT,'Toprak',T.DIRT);
defBlock(B.STONE,'Taş',T.STONE);
defBlock(B.SAND,'Kum',T.SAND);
defBlock(B.LOG,'Odun',{t:T.LOG_T,b:T.LOG_T,s:T.LOG_S});
defBlock(B.LEAVES,'Yaprak',T.LEAVES);
defBlock(B.WATER,'Su',T.WATER,{solid:false,opaque:false,liquid:true});
defBlock(B.GLASS,'Cam',T.GLASS,{opaque:false});
defBlock(B.BRICK,'Tuğla',T.BRICK);
defBlock(B.PLANKS,'Tahta',T.PLANKS);
defBlock(B.BEDROCK,'Bedrock',T.BEDROCK,{place:false});
defBlock(B.COAL,'Kömür Madeni',T.COAL);
defBlock(B.IRON,'Demir Madeni',T.IRON);
defBlock(B.GOLD,'Altın Madeni',T.GOLD);
defBlock(B.DIAMOND,'Elmas Madeni',T.DIAMOND);
defBlock(B.COBBLE,'Kırma Taş',T.COBBLE);
defBlock(B.FLOWER_R,'Kırmızı Çiçek',T.FLOWER_R,{solid:false,opaque:false,cross:true});
defBlock(B.FLOWER_Y,'Sarı Çiçek',T.FLOWER_Y,{solid:false,opaque:false,cross:true});
defBlock(B.TALLGRASS,'Uzun Ot',T.TALLGRASS,{solid:false,opaque:false,cross:true});
defBlock(B.TNT,'TNT',{t:T.TNT_T,b:T.TNT_T,s:T.TNT_S});
defBlock(B.LAVA,'Lav',T.LAVA,{solid:false,opaque:false,liquid:true});
defBlock(B.SNOW,'Kar',T.SNOW);
defBlock(B.CACTUS,'Kaktüs',{t:T.CACTUS_T,b:T.CACTUS_T,s:T.CACTUS_S});
defBlock(B.SANDSTONE,'Kumtaşı',T.SANDSTONE);
defBlock(B.GRAVEL,'Çakıl',T.GRAVEL);

const isOpaque=id=>BLOCKS[id]&&BLOCKS[id].opaque;
const isSolid =id=>BLOCKS[id]&&BLOCKS[id].solid;

// ================= TEXTURE ATLAS (procedural pixel art) =================
const TILE=16,ATLAS_C=8,ATLAS_R=4;
const tileCanvas=[];   // individual 16x16 canvases (for icons)
let atlasTex=null;

function buildAtlas(){
  const cv=document.createElement('canvas');
  cv.width=ATLAS_C*TILE;cv.height=ATLAS_R*TILE;
  const g=cv.getContext('2d');
  const R=mulberry32(1337);
  const px=(t,x,y,c)=>{g.fillStyle=c;g.fillRect((t%8)*16+x,((t/16)|0)*16*0+Math.floor(t/8)*16+y,1,1);};
  const speckle=(t,base,vars,dens=1)=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    if(R()<dens){const r=R();px(t,x,y,vars[(r*vars.length)|0]||base);}else px(t,x,y,base);}};
  const fill=(t,c)=>{g.fillStyle=c;g.fillRect((t%8)*16,Math.floor(t/8)*16,16,16);};

  // grass top
  speckle(T.GRASS_T,'#6aa84f',['#5d9c44','#79b95c','#5a9440','#82c765'],.5);
  // grass side: dirt + green fringe
  fill(T.GRASS_S,'#8a6239');
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.35)px(T.GRASS_S,x,y,['#7d5834','#966d42','#75522f'][(R()*3)|0]);}
  for(let x=0;x<16;x++){const d=2+(R()*3|0);for(let y=0;y<d;y++)px(T.GRASS_S,x,y,['#6aa84f','#5d9c44','#79b95c'][(R()*3)|0]);}
  // dirt
  fill(T.DIRT,'#8a6239');
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.4)px(T.DIRT,x,y,['#7d5834','#966d42','#6e4c2b','#a1784c'][(R()*4)|0]);}
  // stone
  fill(T.STONE,'#8a8a8a');
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.38)px(T.STONE,x,y,['#7d7d7d','#969696','#737373','#a1a1a1'][(R()*4)|0]);}
  // sand
  fill(T.SAND,'#e3d9a3');
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.35)px(T.SAND,x,y,['#d9cd94','#ece5b6','#cfc284'][(R()*3)|0]);}
  // log side
  fill(T.LOG_S,'#6b4f2a');
  for(let x=0;x<16;x++){const c=['#5d4324','#77582f','#54401f'][(R()*3)|0];for(let y=0;y<16;y++){px(T.LOG_S,x,y,R()<.15?'#4a351b':c);}}
  // log top: rings
  fill(T.LOG_T,'#a5854e');
  for(let r=0;r<8;r++){const c=r%2?'#8f7040':'#b5945c';for(let x=r;x<16-r;x++){px(T.LOG_T,x,r,c);px(T.LOG_T,x,15-r,c);}for(let y=r;y<16-r;y++){px(T.LOG_T,r,y,c);px(T.LOG_T,15-r,y,c);}}
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.1)px(T.LOG_T,x,y,'#7d6238');}
  // leaves
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){const r=R();px(T.LEAVES,x,y,r<.12?'rgba(0,0,0,0)':(r<.5?'#3e7a2e':(r<.8?'#35682a':'#4a8c36')));}
  // water
  fill(T.WATER,'#3a66d8');
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.3)px(T.WATER,x,y,['#3158c4','#4a78e8','#2b4fb0'][(R()*3)|0]);}
  for(let x=0;x<16;x+=4)for(let y=0;y<3;y++)px(T.WATER,x+((y*7)%4),y*5,'#5c8cf0');
  // glass: transparent + border + streak
  fill(T.GLASS,'rgba(0,0,0,0)');
  for(let i=0;i<16;i++){px(T.GLASS,i,0,'#cfe8f5');px(T.GLASS,i,15,'#cfe8f5');px(T.GLASS,0,i,'#cfe8f5');px(T.GLASS,15,i,'#cfe8f5');}
  px(T.GLASS,3,10,'#ffffff');px(T.GLASS,4,9,'#ffffff');px(T.GLASS,5,8,'#ffffff');px(T.GLASS,10,5,'#ffffff');px(T.GLASS,11,4,'#ffffff');
  // brick
  fill(T.BRICK,'#b3594a');
  for(let y=0;y<16;y+=4){for(let x=0;x<16;x++)px(T.BRICK,x,y,'#9c9c9c');}
  for(let r=0;r<4;r++){const off=(r%2)?4:0;for(let y=r*4;y<r*4+4;y++)for(let x=0;x<16;x++){if((x+off)%8===0)px(T.BRICK,x,y,'#9c9c9c');else if(R()<.2)px(T.BRICK,x,y,'#a04e40');}}
  // planks
  fill(T.PLANKS,'#a98a54');
  for(let y=0;y<16;y+=4){for(let x=0;x<16;x++)px(T.PLANKS,x,y,'#7d6238');}
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.25)px(T.PLANKS,x,y,['#9c7d4a','#b5945c','#8f7040'][(R()*3)|0]);}
  // bedrock
  fill(T.BEDROCK,'#565656');
  for(let y=0;y<16;y+=4)for(let x=0;x<16;x+=4){const c=['#3a3a3a','#6b6b6b','#2e2e2e','#7d7d7d'][(R()*4)|0];for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++)if(R()<.7)px(T.BEDROCK,x+dx,y+dy,c);}
  // ores on stone background
  const ore=(t,c1,c2)=>{fill(t,'#8a8a8a');for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.38)px(t,x,y,['#7d7d7d','#969696','#737373'][(R()*3)|0]);}
    for(let i=0;i<5;i++){const ox=2+(R()*12|0),oy=2+(R()*12|0);for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)px(t,Math.min(15,ox+dx),Math.min(15,oy+dy),(dx+dy)%2?c1:c2);}};
  ore(T.COAL,'#2b2b2b','#1a1a1a');ore(T.IRON,'#d8a888','#b8876a');
  ore(T.GOLD,'#f5d64a','#d9b42f');ore(T.DIAMOND,'#5ce8e0','#3ec4c4');
  // cobble
  fill(T.COBBLE,'#7a7a7a');
  for(let y=0;y<16;y+=5)for(let x=0;x<16;x+=5){const c=['#6b6b6b','#8d8d8d','#5f5f5f'][(R()*3)|0];for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++)px(T.COBBLE,x+dx+((y/5)%2?1:0),y+dy,c);}
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.12)px(T.COBBLE,x,y,'#4f4f4f');}
  // flowers / tallgrass (cross shapes, transparent bg)
  const stem=(t,pc)=>{fill(t,'rgba(0,0,0,0)');for(let y=6;y<16;y++){px(t,8,y,'#3e7a2e');px(t,7,y,y>10?'#35682a':'#3e7a2e');}
    px(t,6,12,'#3e7a2e');px(t,9,10,'#3e7a2e');
    for(let dy=0;dy<4;dy++)for(let dx=0;dx<5;dx++)px(t,5+dx,2+dy,pc);
    px(t,7,3,'#ffffff');px(t,6,4,'#ffffff');};
  stem(T.FLOWER_R,'#d83a2e');stem(T.FLOWER_Y,'#e8d83a');
  fill(T.TALLGRASS,'rgba(0,0,0,0)');
  for(let i=0;i<7;i++){const x=3+i*1.7,h=6+((i*5)%9);for(let y=16-h;y<16;y++)px(T.TALLGRASS,Math.floor(x),y,['#4a8c36','#3e7a2e','#5da045'][i%3]);}
  // tnt
  fill(T.TNT_S,'#d8341f');
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.2)px(T.TNT_S,x,y,'#b82a18');}
  for(let y=5;y<11;y++)for(let x=0;x<16;x++)px(T.TNT_S,x,y,'#e8e0d0');
  g.fillStyle='#1a1a1a';g.font='bold 7px monospace';
  g.fillText('TNT',(T.TNT_S%8)*16+2,Math.floor(T.TNT_S/8)*16+10);
  fill(T.TNT_T,'#d8341f');
  for(let y=4;y<12;y++)for(let x=4;x<12;x++)px(T.TNT_T,x,y,'#2b2b2b');
  // lava
  fill(T.LAVA,'#e25822');
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){const r=R();if(r<.3)px(T.LAVA,x,y,'#f5a623');else if(r<.5)px(T.LAVA,x,y,'#c43d0f');else if(r<.58)px(T.LAVA,x,y,'#fbe86b');}
  // snow
  fill(T.SNOW,'#f2f7f7');
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.2)px(T.SNOW,x,y,['#e3eeee','#ffffff','#d9e6e6'][(R()*3)|0]);}
  // cactus
  fill(T.CACTUS_S,'#4a8c36');
  for(let x=0;x<16;x++){if(x%4===0)for(let y=0;y<16;y++)px(T.CACTUS_S,x,y,'#35682a');}
  for(let i=0;i<10;i++)px(T.CACTUS_S,(R()*16)|0,(R()*16)|0,'#d8e8d0');
  fill(T.CACTUS_T,'#4a8c36');
  for(let i=0;i<16;i++){px(T.CACTUS_T,i,0,'#35682a');px(T.CACTUS_T,i,15,'#35682a');px(T.CACTUS_T,0,i,'#35682a');px(T.CACTUS_T,15,i,'#35682a');}
  // sandstone
  fill(T.SANDSTONE,'#ddd5a2');
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.3)px(T.SANDSTONE,x,y,['#d1c793','#e8e2b5','#c5b885'][(R()*3)|0]);}
  for(let x=0;x<16;x++){px(T.SANDSTONE,x,0,'#c5b885');px(T.SANDSTONE,x,15,'#c5b885');}
  // gravel
  fill(T.GRAVEL,'#8f8a83');
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){if(R()<.6)px(T.GRAVEL,x,y,['#7a756e','#a09a91','#6b655e','#b0a89e','#8a7f72'][(R()*5)|0]);}

  // split tiles into standalone canvases for HUD icons
  for(let i=0;i<ATLAS_C*ATLAS_R;i++){
    const t=document.createElement('canvas');t.width=t.height=16;
    t.getContext('2d').drawImage(cv,(i%8)*16,Math.floor(i/8)*16,16,16,0,0,16,16);
    tileCanvas[i]=t;
  }
  atlasTex=new THREE.CanvasTexture(cv);
  atlasTex.magFilter=THREE.NearestFilter;
  atlasTex.minFilter=THREE.NearestFilter;
  atlasTex.generateMipmaps=false;
}

// ================= THREE SETUP =================
let renderer,scene,camera,sunLight,hemi;
let matOpaque,matCutout,matTrans,matLava;
let sunSpr,moonSpr,stars,cloudMesh;
const camDir=new THREE.Vector3();

function initThree(){
  renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(innerWidth,innerHeight);
  document.getElementById('game').appendChild(renderer.domElement);
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.08,600);
  scene.fog=new THREE.Fog(0x7eb6ff,40,160);
  scene.background=new THREE.Color(0x7eb6ff);

  hemi=new THREE.HemisphereLight(0xcfe8ff,0x8a6b45,.9);scene.add(hemi);
  sunLight=new THREE.DirectionalLight(0xffffff,1);scene.add(sunLight);scene.add(sunLight.target);

  matOpaque=new THREE.MeshLambertMaterial({map:atlasTex,vertexColors:true});
  matCutout=new THREE.MeshLambertMaterial({map:atlasTex,vertexColors:true,alphaTest:.5,side:THREE.DoubleSide});
  matTrans =new THREE.MeshLambertMaterial({map:atlasTex,vertexColors:true,transparent:true,opacity:.72,depthWrite:false});
  matLava  =new THREE.MeshLambertMaterial({map:atlasTex,vertexColors:true,emissive:0xff5500,emissiveIntensity:.55});

  buildSky();
  addEventListener('resize',()=>{
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight);
  });
}

function radialTex(inner,outer){
  const c=document.createElement('canvas');c.width=c.height=64;
  const g=c.getContext('2d');
  const gr=g.createRadialGradient(32,32,4,32,32,30);
  gr.addColorStop(0,inner);gr.addColorStop(1,outer);
  g.fillStyle=gr;g.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
}

function buildSky(){
  sunSpr=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex('#fffbe0','rgba(255,200,60,0)'),fog:false,depthWrite:false}));
  sunSpr.scale.set(60,60,1);scene.add(sunSpr);
  moonSpr=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex('#e8eef8','rgba(180,190,220,0)'),fog:false,depthWrite:false}));
  moonSpr.scale.set(32,32,1);scene.add(moonSpr);

  // stars
  const n=700,pos=new Float32Array(n*3),R=mulberry32(42);
  for(let i=0;i<n;i++){
    const t=R()*Math.PI*2,p=Math.acos(2*R()-1),r=380;
    pos[i*3]=r*Math.sin(p)*Math.cos(t);pos[i*3+1]=Math.abs(r*Math.cos(p));pos[i*3+2]=r*Math.sin(p)*Math.sin(t);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  stars=new THREE.Points(g,new THREE.PointsMaterial({color:0xffffff,size:1.6,sizeAttenuation:false,transparent:true,opacity:0,fog:false}));
  scene.add(stars);

  // clouds: blocky white rectangles on a scrolling plane (MC-style)
  const c=document.createElement('canvas');c.width=c.height=128;
  const g2=c.getContext('2d');const Rn=mulberry32(7);
  for(let i=0;i<30;i++){
    const w=6+((Rn()*14)|0),h=3+((Rn()*6)|0),x=(Rn()*128)|0,y=(Rn()*128)|0;
    g2.fillStyle='rgba(255,255,255,.9)';g2.fillRect(x,y,w,h);
    g2.fillStyle='rgba(235,240,250,.9)';g2.fillRect(x,y+h-1,w,1);
  }
  const ct=new THREE.CanvasTexture(c);ct.wrapS=ct.wrapT=THREE.RepeatWrapping;
  ct.magFilter=THREE.NearestFilter;ct.repeat.set(24,24);
  cloudMesh=new THREE.Mesh(new THREE.PlaneGeometry(1200,1200),
    new THREE.MeshLambertMaterial({map:ct,transparent:true,opacity:.75,depthWrite:false,side:THREE.DoubleSide}));
  cloudMesh.rotation.x=-Math.PI/2;cloudMesh.position.y=WORLD_H+16;
  scene.add(cloudMesh);
}

// ================= WORLD =================
const chunks=new Map();        // "cx,cz" -> {data:Uint8Array, meshes:[], dirty:bool}
const ckey=(cx,cz)=>cx+','+cz;
const edits=new Map();         // "x,y,z" -> block id  (for save file)
let seed=1234,perlin,perlinB;
let worldTime=0.32;            // 0..1 day fraction
let gameActive=false,invOpen=false,muted=false;

function idx(x,y,z){return(y<<8)|(z<<4)|x;}
function getBlock(x,y,z){
  if(y<0)return B.BEDROCK;
  if(y>=WORLD_H)return B.AIR;
  const c=chunks.get(ckey(Math.floor(x/16),Math.floor(z/16)));
  if(!c)return B.AIR;
  return c.data[idx(x&15,y,z&15)];
}
function setBlockRaw(x,y,z,id){
  const c=chunks.get(ckey(Math.floor(x/16),Math.floor(z/16)));
  if(!c)return;
  c.data[idx(x&15,y,z&15)]=id;
}
function setBlock(x,y,z,id,save=true){
  if(y<0||y>=WORLD_H)return;
  const cx=Math.floor(x/16),cz=Math.floor(z/16);
  const c=chunks.get(ckey(cx,cz));if(!c)return;
  c.data[idx(x&15,y,z&15)]=id;
  if(save)edits.set(x+','+y+','+z,id);
  c.dirty=true;
  if((x&15)===0){const n=chunks.get(ckey(cx-1,cz));if(n)n.dirty=true;}
  if((x&15)===15){const n=chunks.get(ckey(cx+1,cz));if(n)n.dirty=true;}
  if((z&15)===0){const n=chunks.get(ckey(cx,cz-1));if(n)n.dirty=true;}
  if((z&15)===15){const n=chunks.get(ckey(cx,cz+1));if(n)n.dirty=true;}
}

// ---- terrain gen ----
function terrainH(x,z){
  const e=perlin.fbm2(x*.006,z*.006,4);
  const m=perlin.fbm2(x*.018+300,z*.018+300,3);
  let h=23+e*14;
  if(m>0)h+=m*m*36;
  return Math.max(4,Math.min(WORLD_H-4,h))|0;
}
function biomeAt(x,z){
  const moist=perlinB.fbm2(x*.012+900,z*.012+900,2);
  const h=terrainH(x,z);
  if(h>44)return'snow';
  if(moist<-.22&&h<34)return'desert';
  return'plains';
}
function isCave(x,y,z){
  if(y<3||y>44)return false;
  return perlin.n3(x*.085,y*.13,z*.085)>.58;
}
function genChunk(cx,cz){
  const data=new Uint8Array(CHUNK*CHUNK*WORLD_H);
  const chunk={data,meshes:[],dirty:false};
  chunks.set(ckey(cx,cz),chunk);
  for(let lz=0;lz<16;lz++)for(let lx=0;lx<16;lx++){
    const wx=cx*16+lx,wz=cz*16+lz;
    const h=terrainH(wx,wz),biome=biomeAt(wx,wz);
    const beach=h<=SEA+1&&h>=SEA-4;
    for(let y=0;y<WORLD_H;y++){
      let id=B.AIR;
      if(y===0)id=B.BEDROCK;
      else if(y<=h){
        if(isCave(wx,y,wz))id=B.AIR;
        else if(y===h){
          if(beach||h<SEA)id=B.SAND;
          else if(biome==='desert')id=B.SAND;
          else if(biome==='snow')id=B.SNOW;
          else id=B.GRASS;
        }else if(y>h-4){
          id=(beach||biome==='desert')?B.SAND:B.DIRT;
        }else{
          id=B.STONE;
          const r=hash3(wx,y,wz,seed^0x5eed);
          if(r<.016&&y>4)id=B.COAL;
          else if(r<.024&&y<26&&y>4)id=B.IRON;
          else if(r<.028&&y<15)id=B.GOLD;
          else if(r<.031&&y<11)id=B.DIAMOND;
        }
      }else if(y<=SEA){
        id=B.WATER;
      }
      data[idx(lx,y,lz)]=id;
    }
    // underwater floor variety
    if(h<SEA-2){
      const r=hash2(wx,wz,seed^7);
      data[idx(lx,h,lz)]=r<.5?B.GRAVEL:B.SAND;
      if(h-1>0)data[idx(lx,h-1,lz)]=B.SAND;
    }
    // desert sandstone under sand
    if(biome==='desert'&&h>2)data[idx(lx,h-1,lz)]=B.SANDSTONE;
  }
  // decorations (kept ≥2 away from borders so nothing spills into neighbours)
  for(let lz=2;lz<14;lz++)for(let lx=2;lx<14;lx++){
    const wx=cx*16+lx,wz=cz*16+lz,h=terrainH(wx,wz),biome=biomeAt(wx,wz);
    if(h<=SEA+1||data[idx(lx,h,lz)]===B.AIR)continue;
    const top=data[idx(lx,h,lz)];
    const r=hash2(wx,wz,seed^0xbeef);
    if(top===B.GRASS){
      if(r<.009){ // tree
        const th=4+((r*1000)|0)%3;
        for(let y=1;y<=th;y++)if(h+y<WORLD_H)data[idx(lx,h+y,lz)]=B.LOG;
        for(let dy=th-2;dy<=th+1;dy++){
          const rad=dy<th?2:1;
          for(let dz=-rad;dz<=rad;dz++)for(let dx=-rad;dx<=rad;dx++){
            if(dx===0&&dz===0&&dy<th)continue;
            if(Math.abs(dx)===rad&&Math.abs(dz)===rad&&hash3(wx+dx,h+dy,wz+dz,5)<.5)continue;
            const yy=h+dy;if(yy<WORLD_H&&data[idx(lx+dx,yy,lz+dz)]===B.AIR)data[idx(lx+dx,yy,lz+dz)]=B.LEAVES;
          }
        }
      }else if(r<.045){
        if(h+1<WORLD_H)data[idx(lx,h+1,lz)]=r<.03?B.TALLGRASS:(r<.038?B.FLOWER_R:B.FLOWER_Y);
      }
    }else if(top===B.SAND&&biome==='desert'&&r<.006){
      const ch=2+((r*100)|0)%2;
      for(let y=1;y<=ch;y++)if(h+y<WORLD_H)data[idx(lx,h+y,lz)]=B.CACTUS;
    }
  }
  return chunk;
}

// ---- mesher (with baked ambient occlusion) ----
const FACES=[
  {dir:[-1,0,0],shade:.62,tile:'s',corners:[[0,1,0,0,1],[0,0,0,0,0],[0,1,1,1,1],[0,0,1,1,0]]},
  {dir:[ 1,0,0],shade:.62,tile:'s',corners:[[1,1,1,0,1],[1,0,1,0,0],[1,1,0,1,1],[1,0,0,1,0]]},
  {dir:[0,-1,0],shade:.5 ,tile:'b',corners:[[1,0,1,1,0],[0,0,1,0,0],[1,0,0,1,1],[0,0,0,0,1]]},
  {dir:[0, 1,0],shade:1. ,tile:'t',corners:[[0,1,1,1,1],[1,1,1,0,1],[0,1,0,1,0],[1,1,0,0,0]]},
  {dir:[0,0,-1],shade:.78,tile:'s',corners:[[1,0,0,0,0],[0,0,0,1,0],[1,1,0,0,1],[0,1,0,1,1]]},
  {dir:[0,0, 1],shade:.78,tile:'s',corners:[[0,0,1,0,0],[1,0,1,1,0],[0,1,1,0,1],[1,1,1,1,1]]},
];
const AO_LUT=[.42,.58,.78,1];

function tileOf(id,side){
  const t=BLOCKS[id].tiles;
  return(typeof t==='number')?t:t[side];
}
function uvFor(tile,u,v){
  return[((tile%8)+u)/8,1-(Math.floor(tile/8)+1-v)/4];
}
function drawFace(id,nb){
  const d=BLOCKS[id],n=BLOCKS[nb];
  if(!n||nb===B.AIR)return true;
  if(d.opaque)return!n.opaque;
  if(id===B.WATER)return nb!==B.WATER&&nb!==B.LAVA&&!n.opaque||nb===B.GLASS;
  if(id===B.LAVA )return nb!==B.LAVA&&nb!==B.WATER&&(!n.opaque||nb===B.GLASS);
  if(id===B.GLASS)return nb!==B.GLASS&&!n.opaque&&nb!==B.WATER&&nb!==B.LAVA;
  return!n.opaque&&nb!==id;
}
// AO helper: is the sample cell occluding?
const occ=(x,y,z)=>isOpaque(getBlock(x,y,z));

function buildChunkMesh(cx,cz){
  const chunk=chunks.get(ckey(cx,cz));if(!chunk)return;
  // dispose old
  for(const m of chunk.meshes){scene.remove(m);m.geometry.dispose();}
  chunk.meshes=[];chunk.dirty=false;
  const data=chunk.data;
  const bx=cx*16,bz=cz*16;
  const grp={op:{p:[],n:[],u:[],c:[],i:[]},cu:{p:[],n:[],u:[],c:[],i:[]},
             tr:{p:[],n:[],u:[],c:[],i:[]},lv:{p:[],n:[],u:[],c:[],i:[]}};

  for(let y=0;y<WORLD_H;y++)for(let z=0;z<16;z++)for(let x=0;x<16;x++){
    const id=data[idx(x,y,z)];if(!id)continue;
    const d=BLOCKS[id],wx=bx+x,wz=bz+z;

    if(d.cross){
      const g=grp.cu,t=d.tiles;
      const corners=[[0,0,0,0,0],[1,0,1,1,0],[1,1,1,1,1],[0,1,0,0,1],
                     [0,0,1,0,0],[1,0,0,1,0],[1,1,0,1,1],[0,1,1,0,1]];
      const base=g.p.length/3;
      for(const[cx0,cy0,cz0,uu,vv]of corners){
        g.p.push(x+cx0,y+cy0,z+cz0);g.n.push(0,1,0);
        const uv=uvFor(t,uu,vv);g.u.push(uv[0],uv[1]);g.c.push(1,1,1);
      }
      for(let k=0;k<8;k+=4){const b=base+k;g.i.push(b,b+1,b+2,b,b+2,b+3);}
      continue;
    }
    const g=d.liquid?(id===B.LAVA?grp.lv:grp.tr):(d.opaque?grp.op:grp.tr);
    const waterTop=id===B.WATER&&getBlock(wx,y+1,wz)!==B.WATER;
    for(let f=0;f<6;f++){
      const F=FACES[f];
      const nx=wx+F.dir[0],ny=y+F.dir[1],nz=wz+F.dir[2];
      const nb=getBlock(nx,ny,nz);
      if(!drawFace(id,nb))continue;
      const tile=tileOf(id,F.tile);
      const base=g.p.length/3;
      const ao=new Array(4);
      const doAO=d.opaque;
      for(let vi=0;vi<4;vi++){
        const[cx0,cy0,cz0,uu,vv]=F.corners[vi];
        let vy=cy0;
        if(waterTop&&cy0===1)vy=.875;
        g.p.push(x+cx0,y+vy,z+cz0);g.n.push(F.dir[0],F.dir[1],F.dir[2]);
        const uv=uvFor(tile,uu,vv);g.u.push(uv[0],uv[1]);
        let light=1;
        if(doAO){
          // tangent axes of this face
          const a0=F.dir[0]!==0?1:0,a1=F.dir[2]!==0?1:2;
          const c0=[x,y,z];c0[a0]=cx0?1:-1;const o1=[0,0,0];o1[a0]=c0[a0]===1?1:-1;
          const o2=[0,0,0];o2[a1]=(a1===1?cy0:cz0)?1:-1;
          const s1=occ(nx+o1[0],ny+o1[1],nz+o1[2])?1:0;
          const s2=occ(nx+o2[0],ny+o2[1],nz+o2[2])?1:0;
          const cr=occ(nx+o1[0]+o2[0],ny+o1[1]+o2[1],nz+o1[2]+o2[2])?1:0;
          ao[vi]=(s1&&s2)?0:3-(s1+s2+cr);
          light=F.shade*AO_LUT[ao[vi]];
          if(id===B.LEAVES)light*=.9;
        }
        if(id===B.LAVA)light=1.4;
        g.c.push(light,light,light);
      }
      // default triangulation shares diagonal 1-2; flip to diagonal 0-3
      // when those vertices are brighter (both keep outward winding)
      if(doAO&&ao[0]+ao[3]>ao[1]+ao[2]){
        g.i.push(base,base+1,base+3,base,base+3,base+2);
      }else{
        g.i.push(base,base+1,base+2,base+2,base+1,base+3);
      }
    }
  }
  const mk=(g,mat)=>{
    if(!g.i.length)return;
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(g.p,3));
    geo.setAttribute('normal',new THREE.Float32BufferAttribute(g.n,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(g.u,2));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(g.c,3));
    geo.setIndex(g.i);
    const m=new THREE.Mesh(geo,mat);
    m.position.set(bx,0,bz);
    scene.add(m);chunk.meshes.push(m);
  };
  mk(grp.op,matOpaque);mk(grp.cu,matCutout);mk(grp.tr,matTrans);mk(grp.lv,matLava);
}

// ---- streaming ----
let genQueue=[],meshQueue=[],queuedGen=new Set(),queuedMesh=new Set();
let lastPC=null;
function ensureChunks(px,pz){
  const pcx=Math.floor(px/16),pcz=Math.floor(pz/16);
  if(lastPC&&lastPC[0]===pcx&&lastPC[1]===pcz&&genQueue.length===0&&meshQueue.length===0)return;
  lastPC=[pcx,pcz];
  for(let dz=-VIEW_DIST;dz<=VIEW_DIST;dz++)for(let dx=-VIEW_DIST;dx<=VIEW_DIST;dx++){
    const cx=pcx+dx,cz=pcz+dz,k=ckey(cx,cz);
    if(!chunks.has(k)&&!queuedGen.has(k)){genQueue.push([cx,cz,dx*dx+dz*dz]);queuedGen.add(k);}
  }
  genQueue.sort((a,b)=>a[2]-b[2]);
  for(const[k,ch]of chunks){
    const[cx,cz]=k.split(',').map(Number);
    const d=Math.max(Math.abs(cx-pcx),Math.abs(cz-pcz));
    if(d<=VIEW_DIST&&!ch.meshes.length&&!queuedMesh.has(k)){meshQueue.push([cx,cz,d]);queuedMesh.add(k);}
    else if(d>VIEW_DIST+1&&ch.meshes.length){
      for(const m of ch.meshes){scene.remove(m);m.geometry.dispose();}
      ch.meshes=[];
    }
  }
  meshQueue.sort((a,b)=>a[2]-b[2]);
}
function pumpQueues(budget){
  let n=0;
  while(n<budget&&genQueue.length){
    const[cx,cz]=genQueue.shift();queuedGen.delete(ckey(cx,cz));
    genChunk(cx,cz);
    // neighbours' border faces may need a rebuild now that we exist
    for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){
      const nc=chunks.get(ckey(cx+dx,cz+dz));if(nc&&nc.meshes.length)nc.dirty=true;
    }
    n++;
  }
  while(n<budget&&meshQueue.length){
    const[cx,cz]=meshQueue.shift();queuedMesh.delete(ckey(cx,cz));
    buildChunkMesh(cx,cz);n++;
  }
  // rebuild dirty chunks (block edits)
  for(const[k,ch]of chunks){
    if(ch.dirty&&ch.meshes.length){
      const[cx,cz]=k.split(',').map(Number);buildChunkMesh(cx,cz);
    }
  }
}

// ================= PLAYER / PHYSICS =================
const player={pos:new THREE.Vector3(.5,50,.5),vel:new THREE.Vector3(),w:.6,h:1.8,eye:1.62,
  yaw:0,pitch:0,onGround:false,fly:false,inWater:false,headWater:false};
const keys={};
let selected=0;
const hotbar=[B.GRASS,B.DIRT,B.STONE,B.COBBLE,B.PLANKS,B.LOG,B.GLASS,B.BRICK,B.TNT];

function collideAxis(e,axis,amt){
  const p=e.pos;
  if(axis===0)p.x+=amt;else if(axis===1)p.y+=amt;else p.z+=amt;
  const hw=e.w/2;
  const x0=Math.floor(p.x-hw),x1=Math.floor(p.x+hw);
  const y0=Math.floor(p.y),y1=Math.floor(p.y+e.h-1e-6);
  const z0=Math.floor(p.z-hw),z1=Math.floor(p.z+hw);
  for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
    if(!isSolid(getBlock(x,y,z)))continue;
    if(axis===1){
      if(amt<0){p.y=y+1;e.vel.y=0;e.onGround=true;}
      else{p.y=y-e.h-1e-4;e.vel.y=0;}
    }else if(axis===0){
      p.x=amt>0?x-hw-1e-4:x+1+hw+1e-4;e.vel.x=0;
    }else{
      p.z=amt>0?z-hw-1e-4:z+1+hw+1e-4;e.vel.z=0;
    }
  }
}
function pointFree(x,y,z){return!isSolid(getBlock(Math.floor(x),Math.floor(y),Math.floor(z)));}

function stepPlayer(dt){
  const p=player;
  const feetB=getBlock(Math.floor(p.pos.x),Math.floor(p.pos.y+.4),Math.floor(p.pos.z));
  p.inWater=feetB===B.WATER;
  p.headWater=getBlock(Math.floor(p.pos.x),Math.floor(p.pos.y+p.eye),Math.floor(p.pos.z))===B.WATER;

  const sprint=keys['shiftleft']&&!p.fly;
  let speed=p.fly?11:(sprint?6.2:4.3);
  if(p.inWater)speed*=0.55;

  const sy=Math.sin(p.yaw),cy=Math.cos(p.yaw);
  let mx=0,mz=0;
  if(keys['keyw']){mx-=sy;mz-=cy;}
  if(keys['keys']){mx+=sy;mz+=cy;}
  if(keys['keya']){mx-=cy;mz+=sy;}
  if(keys['keyd']){mx+=cy;mz-=sy;}
  const ml=Math.hypot(mx,mz)||1;
  p.vel.x=mx/ml*speed;p.vel.z=mz/ml*speed;

  if(p.fly){
    p.vel.y=(keys['space']?speed:0)-(keys['shiftleft']?speed:0);
  }else{
    p.vel.y-=GRAVITY*dt*(p.inWater?.25:1);
    if(p.inWater){p.vel.y*=.92;if(keys['space'])p.vel.y=Math.min(p.vel.y+60*dt,4.5);}
    if(keys['space']&&p.onGround){p.vel.y=JUMP_V;p.onGround=false;}
  }
  p.vel.y=Math.max(p.vel.y,-55);

  p.onGround=false;
  collideAxis(p,0,p.vel.x*dt);
  collideAxis(p,2,p.vel.z*dt);
  collideAxis(p,1,p.vel.y*dt);
  if(p.pos.y<-30){p.pos.set(.5,60,.5);p.vel.set(0,0,0);} // fell out of world

  camera.position.set(p.pos.x,p.pos.y+p.eye,p.pos.z);
  camera.rotation.order='YXZ';
  camera.rotation.y=p.yaw;camera.rotation.x=p.pitch;
}

// ================= RAYCAST / INTERACT =================
function raycastVoxel(){
  const o=camera.position;
  camera.getWorldDirection(camDir);
  const d=camDir;
  let x=Math.floor(o.x),y=Math.floor(o.y),z=Math.floor(o.z);
  const sx=d.x>0?1:-1,sy=d.y>0?1:-1,sz=d.z>0?1:-1;
  const tdx=Math.abs(1/(d.x||1e-9)),tdy=Math.abs(1/(d.y||1e-9)),tdz=Math.abs(1/(d.z||1e-9));
  let tmx=(sx>0?(x+1-o.x):(o.x-x))*tdx;
  let tmy=(sy>0?(y+1-o.y):(o.y-y))*tdy;
  let tmz=(sz>0?(z+1-o.z):(o.z-z))*tdz;
  let nx=0,ny=0,nz=0;
  for(let i=0;i<64;i++){
    const id=getBlock(x,y,z);
    if(id!==B.AIR&&id!==B.WATER&&id!==B.LAVA)return{x,y,z,nx,ny,nz,id};
    if(tmx<tmy&&tmx<tmz){x+=sx;nx=-sx;ny=0;nz=0;if(tmx>6)return null;tmx+=tdx;}
    else if(tmy<tmz){y+=sy;nx=0;ny=-sy;nz=0;if(tmy>6)return null;tmy+=tdy;}
    else{z+=sz;nx=0;ny=0;nz=-sz;if(tmz>6)return null;tmz+=tdz;}
  }
  return null;
}

let hlBox=null;
function initHL(){
  const g=new THREE.BoxGeometry(1.002,1.002,1.002);
  const e=new THREE.EdgesGeometry(g);
  hlBox=new THREE.LineSegments(e,new THREE.LineBasicMaterial({color:0x000000,transparent:true,opacity:.5}));
  scene.add(hlBox);
}

// ---- particles ----
const PMAX=400;
let pGeo,pPts,pData;
function initParticles(){
  pData=[];
  for(let i=0;i<PMAX;i++)pData.push({life:0,x:0,y:0,z:0,vx:0,vy:0,vz:0,r:1,g:1,b:1});
  pGeo=new THREE.BufferGeometry();
  pGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(PMAX*3),3));
  pGeo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(PMAX*3),3));
  const c=document.createElement('canvas');c.width=c.height=8;
  const cg=c.getContext('2d');cg.fillStyle='#fff';cg.fillRect(0,0,8,8);
  pPts=new THREE.Points(pGeo,new THREE.PointsMaterial({size:.16,vertexColors:true,map:new THREE.CanvasTexture(c)}));
  pPts.frustumCulled=false;
  scene.add(pPts);
}
function burst(x,y,z,r,g,b,n=18,spd=3){
  let placed=0;
  for(const p of pData){
    if(p.life>0)continue;
    p.life=.4+Math.random()*.5;
    p.x=x+Math.random();p.y=y+Math.random();p.z=z+Math.random();
    p.vx=(Math.random()-.5)*spd;p.vy=Math.random()*spd;p.vz=(Math.random()-.5)*spd;
    p.r=r*(0.85+Math.random()*.3);p.g=g*(0.85+Math.random()*.3);p.b=b*(0.85+Math.random()*.3);
    if(++placed>=n)break;
  }
}
function updateParticles(dt){
  const pos=pGeo.attributes.position.array,col=pGeo.attributes.color.array;
  for(let i=0;i<PMAX;i++){
    const p=pData[i];
    if(p.life>0){
      p.life-=dt;p.vy-=18*dt;
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;
      pos[i*3]=p.x;pos[i*3+1]=p.y;pos[i*3+2]=p.z;
      col[i*3]=p.r;col[i*3+1]=p.g;col[i*3+2]=p.b;
    }else{pos[i*3+1]=-999;}
  }
  pGeo.attributes.position.needsUpdate=true;
  pGeo.attributes.color.needsUpdate=true;
}
const blockColor=id=>{
  const m={[B.GRASS]:[0.42,0.66,0.31],[B.DIRT]:[0.54,0.38,0.22],[B.STONE]:[0.54,0.54,0.54],
  [B.SAND]:[0.89,0.85,0.64],[B.LOG]:[0.42,0.31,0.16],[B.LEAVES]:[0.24,0.48,0.18],
  [B.GLASS]:[0.8,0.9,0.95],[B.BRICK]:[0.7,0.35,0.29],[B.PLANKS]:[0.66,0.54,0.33],
  [B.COBBLE]:[0.48,0.48,0.48],[B.TNT]:[0.85,0.2,0.12],[B.LAVA]:[0.9,0.35,0.1],
  [B.SNOW]:[0.95,0.97,0.97],[B.CACTUS]:[0.29,0.55,0.21],[B.SANDSTONE]:[0.87,0.84,0.64],
  [B.GRAVEL]:[0.56,0.54,0.51],[B.COAL]:[0.3,0.3,0.3],[B.IRON]:[0.75,0.6,0.5],
  [B.GOLD]:[0.9,0.8,0.3],[B.DIAMOND]:[0.35,0.85,0.85]};
  return m[id]||[0.5,0.5,0.5];
};

// ---- TNT ----
const tnts=[];
function igniteTNT(x,y,z){
  setBlock(x,y,z,B.AIR);
  const m=new THREE.Mesh(new THREE.BoxGeometry(.98,.98,.98),
    new THREE.MeshBasicMaterial({color:0xd8341f}));
  m.position.set(x+.5,y+.5,z+.5);scene.add(m);
  tnts.push({x:x+.5,y:y+.5,z:z+.5,mesh:m,t:1.6});
  snd('ignite');
}
function updateTNT(dt){
  for(let i=tnts.length-1;i>=0;i--){
    const t=tnts[i];t.t-=dt;
    const flash=Math.sin(t.t*25)>0;
    t.mesh.material.color.setHex(flash?0xffffff:0xd8341f);
    t.mesh.scale.setScalar(1+Math.sin(t.t*15)*.08);
    if(t.t<=0){
      scene.remove(t.mesh);explode(t.x,t.y,t.z);tnts.splice(i,1);
    }
  }
}
function explode(x,y,z){
  snd('explode');
  burst(x,y,z,.9,.5,.2,60,8);
  burst(x,y,z,.3,.3,.3,40,5);
  const R=3.4;
  for(let dy=-4;dy<=4;dy++)for(let dz=-4;dz<=4;dz++)for(let dx=-4;dx<=4;dx++){
    const bx=Math.floor(x+dx),by=Math.floor(y+dy),bz=Math.floor(z+dz);
    const d2=dx*dx+dy*dy+dz*dz;
    if(d2>R*R)continue;
    const id=getBlock(bx,by,bz);
    if(id===B.BEDROCK||id===B.AIR)continue;
    if(id===B.TNT){if(hash3(bx,by,bz,9)<.9)igniteTNT(bx,by,bz);continue;}
    if(hash3(bx,by,bz,Date.now()%997)<.95)setBlock(bx,by,bz,B.AIR);
  }
  // knock the player around a bit
  const d=player.pos.distanceTo(new THREE.Vector3(x,y,z));
  if(d<7){
    const f=(7-d)*2.2;
    player.vel.add(player.pos.clone().sub(new THREE.Vector3(x,y,z)).normalize().multiplyScalar(f));
    player.vel.y+=f*.6;
    flashHurt();
  }
}
let hurtT=0;
function flashHurt(){
  const v=document.getElementById('vignette-hurt');
  v.style.boxShadow='inset 0 0 120px rgba(180,0,0,.85)';
  hurtT=.5;
}

// ---- block actions ----
let lDown=false,rDown=false,actT=0;
function breakBlock(h){
  if(!h)return;
  const id=getBlock(h.x,h.y,h.z);
  if(id===B.AIR||id===B.BEDROCK)return;
  if(id===B.TNT){igniteTNT(h.x,h.y,h.z);return;}
  const c=blockColor(id);
  burst(h.x,h.y,h.z,c[0],c[1],c[2],22,3.5);
  setBlock(h.x,h.y,h.z,B.AIR);
  snd('break');
}
function placeBlock(h){
  if(!h)return;
  const x=h.x+h.nx,y=h.y+h.ny,z=h.z+h.nz;
  if(getBlock(x,y,z)!==B.AIR&&getBlock(x,y,z)!==B.WATER&&getBlock(x,y,z)!==B.LAVA)return;
  const id=hotbar[selected],d=BLOCKS[id];
  if(d.solid){
    // don't place inside the player
    const hw=player.w/2;
    if(x+1>player.pos.x-hw&&x<player.pos.x+hw&&
       z+1>player.pos.z-hw&&z<player.pos.z+hw&&
       y+1>player.pos.y&&y<player.pos.y+player.h)return;
  }
  setBlock(x,y,z,id);
  snd('place');
}
function pickBlock(h){
  if(!h)return;
  const id=getBlock(h.x,h.y,h.z);
  if(!BLOCKS[id]||!BLOCKS[id].place)return;
  const slot=hotbar.indexOf(id);
  if(slot>=0)selected=slot;else hotbar[selected]=id;
  renderHotbar();snd('click');
}

// ================= MOBS (pigs) =================
const pigs=[];
class Pig{
  constructor(x,y,z){
    this.pos=new THREE.Vector3(x,y,z);this.vel=new THREE.Vector3();
    this.w=.8;this.h=.9;this.yaw=0;this.state=0;this.timer=0;this.onGround=false;
    const pink=0xf2a0a0,dark=0xd98f8f;
    const m=new THREE.MeshLambertMaterial({color:pink});
    const md=new THREE.MeshLambertMaterial({color:dark});
    const mb=new THREE.MeshLambertMaterial({color:0x1a1a1a});
    const g=this.g=new THREE.Group();
    const body=new THREE.Mesh(new THREE.BoxGeometry(.62,.5,1),m);body.position.y=.62;g.add(body);
    const head=new THREE.Mesh(new THREE.BoxGeometry(.44,.4,.4),m);head.position.set(0,.78,.62);g.add(head);
    const snout=new THREE.Mesh(new THREE.BoxGeometry(.22,.18,.06),md);snout.position.set(0,.72,.83);g.add(snout);
    for(const s of[-1,1]){
      const eye=new THREE.Mesh(new THREE.BoxGeometry(.07,.09,.02),mb);eye.position.set(.13*s,.86,.83);g.add(eye);
      const ear=new THREE.Mesh(new THREE.BoxGeometry(.1,.14,.06),md);ear.position.set(.12*s,1,.58);g.add(ear);
    }
    this.legs=[];
    for(const[lx,lz]of[[-.2,.35],[.2,.35],[-.2,-.35],[.2,-.35]]){
      const leg=new THREE.Mesh(new THREE.BoxGeometry(.16,.38,.16),md);
      leg.position.set(lx,.19,lz);g.add(leg);this.legs.push(leg);
    }
    scene.add(g);
  }
  step(dt){
    this.timer-=dt;
    if(this.timer<=0){this.state=Math.random()<.55?1:0;this.yaw=Math.random()*Math.PI*2;this.timer=1+Math.random()*3;}
    if(this.state===1){
      const s=1.3;
      this.vel.x=-Math.sin(this.yaw)*s;this.vel.z=-Math.cos(this.yaw)*s;
    }else{this.vel.x=0;this.vel.z=0;}
    this.vel.y-=GRAVITY*dt;this.vel.y=Math.max(this.vel.y,-30);
    const ox=this.pos.x,oz=this.pos.z;
    this.onGround=false;
    collideAxis(this,0,this.vel.x*dt);
    collideAxis(this,2,this.vel.z*dt);
    collideAxis(this,1,this.vel.y*dt);
    // walked into a wall -> hop
    if(this.state===1&&this.onGround&&(Math.abs(this.pos.x-ox)<Math.abs(this.vel.x*dt)*.3||Math.abs(this.pos.z-oz)<Math.abs(this.vel.z*dt)*.3))
      this.vel.y=7;
    const t=performance.now()*.006;
    const sw=this.state===1?Math.sin(t*6)*.5:0;
    this.legs[0].rotation.x=sw;this.legs[3].rotation.x=sw;
    this.legs[1].rotation.x=-sw;this.legs[2].rotation.x=-sw;
    this.g.position.copy(this.pos);this.g.rotation.y=this.yaw;
  }
}
function spawnPigs(px,pz,n){
  for(let i=0;i<n;i++){
    const x=px+(Math.random()-.5)*40,z=pz+(Math.random()-.5)*40;
    const h=terrainH(Math.floor(x),Math.floor(z));
    if(h>SEA+1&&h<WORLD_H-8&&biomeAt(x,z)!=='desert')pigs.push(new Pig(x+.5,h+1.5,z+.5));
  }
}

// ================= AUDIO =================
let AC=null;
function audio(){if(!AC)AC=new(window.AudioContext||window.webkitAudioContext)();return AC;}
function snd(type){
  if(muted)return;
  try{
    const c=audio(),t=c.currentTime;
    const g=c.createGain();g.connect(c.destination);
    if(type==='break'||type==='step'){
      const len=type==='step'?.05:.14;
      const buf=c.createBuffer(1,c.sampleRate*len,c.sampleRate);
      const d=buf.getChannelData(0);
      for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);
      const s=c.createBufferSource();s.buffer=buf;
      const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=type==='step'?400:900;
      s.connect(f);f.connect(g);
      g.gain.setValueAtTime(type==='step'?.06:.28,t);
      g.gain.exponentialRampToValueAtTime(.001,t+len);
      s.start(t);
    }else if(type==='place'||type==='click'){
      const o=c.createOscillator();o.type='square';
      o.frequency.setValueAtTime(type==='click'?500:170,t);
      o.frequency.exponentialRampToValueAtTime(90,t+.08);
      o.connect(g);g.gain.setValueAtTime(.14,t);
      g.gain.exponentialRampToValueAtTime(.001,t+.09);o.start(t);o.stop(t+.1);
    }else if(type==='ignite'){
      const o=c.createOscillator();o.type='sawtooth';
      o.frequency.setValueAtTime(300,t);o.frequency.linearRampToValueAtTime(900,t+.5);
      o.connect(g);g.gain.setValueAtTime(.07,t);
      g.gain.exponentialRampToValueAtTime(.001,t+.6);o.start(t);o.stop(t+.6);
    }else if(type==='explode'){
      const buf=c.createBuffer(1,c.sampleRate*.7,c.sampleRate);
      const d=buf.getChannelData(0);
      for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);
      const s=c.createBufferSource();s.buffer=buf;
      const f=c.createBiquadFilter();f.type='lowpass';f.frequency.setValueAtTime(1200,t);f.frequency.exponentialRampToValueAtTime(80,t+.7);
      s.connect(f);f.connect(g);g.gain.setValueAtTime(.7,t);
      s.start(t);
      const o=c.createOscillator();o.frequency.setValueAtTime(90,t);o.frequency.exponentialRampToValueAtTime(30,t+.6);
      o.connect(g);o.start(t);o.stop(t+.7);
    }
  }catch(e){}
}

// ================= UI =================
const $=id=>document.getElementById(id);
function drawIcon(cv,id){
  const c=cv.getContext('2d');c.imageSmoothingEnabled=false;
  c.clearRect(0,0,cv.width,cv.height);
  const d=BLOCKS[id];
  if(d.cross){
    c.drawImage(tileCanvas[d.tiles],0,0,16,16,6,6,32,32);return;
  }
  const tt=tileCanvas[tileOf(id,'t')],st=tileCanvas[tileOf(id,'s')],k=1.375;
  // top diamond
  c.setTransform(k,.5*k,-k,.5*k,22,1);c.drawImage(tt,0,0);
  // left face
  c.setTransform(k,.5*k,0,k,0,12);c.drawImage(st,0,0);
  c.fillStyle='rgba(0,0,0,.18)';c.fillRect(0,0,16,16);
  // right face
  c.setTransform(k,-.5*k,0,k,22,23);c.drawImage(st,0,0);
  c.fillStyle='rgba(0,0,0,.32)';c.fillRect(0,0,16,16);
  c.setTransform(1,0,0,1,0,0);
}
function renderHotbar(){
  const bar=$('hotbar');bar.innerHTML='';
  hotbar.forEach((id,i)=>{
    const s=document.createElement('div');s.className='slot'+(i===selected?' sel':'');
    s.innerHTML=`<span class="num">${i+1}</span>`;
    const cv=document.createElement('canvas');cv.width=cv.height=44;
    drawIcon(cv,id);s.appendChild(cv);
    const cnt=document.createElement('span');cnt.className='cnt';cnt.textContent='∞';
    s.appendChild(cnt);
    s.onclick=()=>{if(invOpen){selected=i;renderHotbar();}};
    bar.appendChild(s);
  });
  const nameEl=$('block-name');
  nameEl.textContent=BLOCKS[hotbar[selected]].name;
  nameEl.style.opacity=1;
  clearTimeout(nameEl._t);nameEl._t=setTimeout(()=>nameEl.style.opacity=0,1400);
}
function buildInventory(){
  const grid=$('inv-grid');grid.innerHTML='';
  for(const d of BLOCKS){
    if(!d||!d.place||d===BLOCKS[B.AIR])continue;
    const it=document.createElement('div');it.className='inv-item';
    const cv=document.createElement('canvas');cv.width=cv.height=40;
    drawIcon(cv,BLOCKS.indexOf(d));it.appendChild(cv);
    const tip=document.createElement('span');tip.className='tip';tip.textContent=d.name;
    it.appendChild(tip);
    it.onclick=()=>{hotbar[selected]=BLOCKS.indexOf(d);renderHotbar();snd('click');};
    grid.appendChild(it);
  }
}
function toast(msg){
  const t=$('toast');t.textContent=msg;t.style.opacity=1;
  clearTimeout(t._t);t._t=setTimeout(()=>t.style.opacity=0,2200);
}

// ---- save / load ----
const SAVE_KEY='mineclone_save_v1';
function saveWorld(){
  try{
    localStorage.setItem(SAVE_KEY,JSON.stringify({
      seed,time:worldTime,
      pos:[player.pos.x,player.pos.y,player.pos.z,player.yaw,player.pitch],
      edits:Object.fromEntries(edits),
    }));
    toast('Dünya kaydedildi ✔');
  }catch(e){toast('Kayıt başarısız: '+e.message);}
}
function loadSaveData(){
  try{return JSON.parse(localStorage.getItem(SAVE_KEY));}catch(e){return null;}
}

// ---- world bootstrap ----
async function generateWorld(seedVal,saveData){
  seed=seedVal;perlin=new Perlin(seed);perlinB=new Perlin(seed^0xABCD);
  // reset
  for(const[k,ch]of chunks)for(const m of ch.meshes){scene.remove(m);m.geometry.dispose();}
  chunks.clear();edits.clear();genQueue=[];meshQueue=[];queuedGen.clear();queuedMesh.clear();lastPC=null;
  for(const p of pigs)scene.remove(p.g);pigs.length=0;
  for(const t of tnts)scene.remove(t.mesh);tnts.length=0;

  const list=[];
  for(let dz=-VIEW_DIST;dz<=VIEW_DIST;dz++)for(let dx=-VIEW_DIST;dx<=VIEW_DIST;dx++)list.push([dx,dz]);
  list.sort((a,b)=>(a[0]*a[0]+a[1]*a[1])-(b[0]*b[0]+b[1]*b[1]));
  const bar=$('loading-fill');
  for(let i=0;i<list.length;i++){
    genChunk(list[i][0],list[i][1]);
    if(i%10===0){bar.style.width=(i/list.length*50)+'%';await new Promise(r=>setTimeout(r,0));}
  }
  // apply saved edits
  if(saveData&&saveData.edits){
    for(const[k,id]of Object.entries(saveData.edits)){
      const[x,y,z]=k.split(',').map(Number);setBlockRaw(x,y,z,id);
      edits.set(k,id);
    }
  }
  for(let i=0;i<list.length;i++){
    buildChunkMesh(list[i][0],list[i][1]);
    if(i%8===0){bar.style.width=(50+i/list.length*50)+'%';await new Promise(r=>setTimeout(r,0));}
  }
  // player
  if(saveData&&saveData.pos){
    player.pos.set(saveData.pos[0],saveData.pos[1],saveData.pos[2]);
    player.yaw=saveData.pos[3];player.pitch=saveData.pos[4];
    worldTime=saveData.time??0.32;
  }else{
    // find the highest solid block at origin so we never drop into a cave mouth
    let sy=WORLD_H-1;
    while(sy>0&&!isSolid(chunks.get(ckey(0,0)).data[idx(0,sy,0)]))sy--;
    player.pos.set(.5,sy+1.5,.5);player.yaw=0;player.pitch=-.15;
    worldTime=.32;
  }
  player.vel.set(0,0,0);
  spawnPigs(0,0,9);
}

// ================= INPUT =================
function initInput(){
  const cv=renderer.domElement;
  document.addEventListener('keydown',e=>{
    keys[e.code.toLowerCase()]=true;
    if(e.code==='Space')e.preventDefault();
    if(!gameActive)return;
    if(e.code.startsWith('Digit')){const n=+e.code[5];if(n>=1&&n<=9){selected=n-1;renderHotbar();}}
    if(e.code==='KeyF'){player.fly=!player.fly;toast(player.fly?'Uçuş: AÇIK':'Uçuş: KAPALI');}
    if(e.code==='KeyM'){muted=!muted;toast(muted?'Ses: KAPALI':'Ses: AÇIK');}
    if(e.code==='F3'||e.code==='F4'){e.preventDefault();$('debug').classList.toggle('hidden');}
    if(e.code==='KeyE'){toggleInv();}
    if(e.code==='Minus'){VIEW_DIST=Math.max(2,VIEW_DIST-1);lastPC=null;toast('Görüş: '+VIEW_DIST);}
    if(e.code==='Equal'||e.code==='NumpadAdd'){VIEW_DIST=Math.min(8,VIEW_DIST+1);lastPC=null;toast('Görüş: '+VIEW_DIST);}
  });
  document.addEventListener('keyup',e=>{keys[e.code.toLowerCase()]=false;});
  cv.addEventListener('click',()=>{
    if(gameActive&&!invOpen&&document.pointerLockElement!==cv)
      lockPointer();
  });
  cv.addEventListener('mousedown',e=>{
    if(document.pointerLockElement!==cv)return;
    if(e.button===0)lDown=true;
    if(e.button===1){e.preventDefault();pickBlock(raycastVoxel());}
    if(e.button===2)rDown=true;
  });
  addEventListener('mouseup',e=>{if(e.button===0)lDown=false;if(e.button===2)rDown=false;});
  addEventListener('contextmenu',e=>e.preventDefault());
  addEventListener('wheel',e=>{
    if(!gameActive||invOpen)return;
    selected=(selected+(e.deltaY>0?1:8))%9;renderHotbar();
  },{passive:true});
  document.addEventListener('mousemove',e=>{
    if(document.pointerLockElement!==cv||!gameActive)return;
    player.yaw-=e.movementX*.0023;
    player.pitch-=e.movementY*.0023;
    player.pitch=Math.max(-1.55,Math.min(1.55,player.pitch));
  });
  document.addEventListener('pointerlockchange',()=>{
    if(document.pointerLockElement!==cv&&gameActive&&!invOpen){
      $('pause-screen').classList.remove('hidden');
    }
  });
}
function lockPointer(){
  try{const r=renderer.domElement.requestPointerLock();if(r&&r.catch)r.catch(()=>{});}catch(e){}
}
function toggleInv(){
  invOpen=!invOpen;
  $('inventory').classList.toggle('hidden',!invOpen);
  if(invOpen)document.exitPointerLock();
  else{$('pause-screen').classList.add('hidden');lockPointer();}
}

function wireMenus(){
  $('btn-help').onclick=$('btn-help2').onclick=()=>{$('help-screen').classList.remove('hidden');};
  $('btn-help-back').onclick=()=>$('help-screen').classList.add('hidden');
  $('btn-resume').onclick=()=>{$('pause-screen').classList.add('hidden');lockPointer();};
  $('btn-save').onclick=saveWorld;
  $('btn-quit').onclick=()=>{saveWorld();location.reload();};
  $('btn-play').onclick=()=>start(false);
  $('btn-continue').onclick=()=>start(true);
  if(!loadSaveData())$('btn-continue').style.display='none';
}
async function start(load){
  const sv=load?loadSaveData():null;
  let s=sv?sv.seed:null;
  if(s==null){
    const inp=$('seed-input').value.trim();
    s=inp?hashStr(inp):((Math.random()*2**31)|0);
  }
  $('btn-play').style.display='none';$('btn-continue').style.display='none';
  $('seed-row').style.display='none';
  $('loading-bar').classList.remove('hidden');
  await generateWorld(s,sv);
  $('title-screen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  gameActive=true;
  renderHotbar();
  lockPointer();
  toast('Seed: '+seed);
}

// ================= SKY / TIME =================
function lerp3(c1,c2,t){return[c1[0]+(c2[0]-c1[0])*t,c1[1]+(c2[1]-c1[1])*t,c1[2]+(c2[2]-c1[2])*t];}
const SKY_DAY=[.49,.71,1],SKY_NIGHT=[.02,.03,.09],SKY_SET=[.98,.6,.3];
function updateSky(dt){
  worldTime=(worldTime+dt/DAY_LEN)%1;
  const a=worldTime*Math.PI*2-Math.PI/2;   // sunrise at t=0
  const elev=Math.sin(a);
  const day=Math.max(0,Math.min(1,elev*2.4+.25));
  let sky=lerp3(SKY_NIGHT,SKY_DAY,day);
  const dusk=Math.max(0,1-Math.abs(elev)*5)*day;
  sky=lerp3(sky,SKY_SET,dusk*.55);
  const fogN=player.headWater?4:(16+VIEW_DIST*14);
  const fogF=player.headWater?22:(30+VIEW_DIST*16);
  scene.fog.near=fogN;scene.fog.far=fogF;
  if(player.headWater){sky=[.05,.2,.5];}
  scene.fog.color.setRGB(...sky);
  scene.background.setRGB(...sky);
  hemi.intensity=.25+day*.75;
  sunLight.intensity=.15+day*.95;
  // sun/moon orbit around camera
  const sd=new THREE.Vector3(Math.cos(a),Math.sin(a),.25).normalize();
  sunSpr.position.copy(camera.position).addScaledVector(sd,300);
  moonSpr.position.copy(camera.position).addScaledVector(sd,-300);
  sunSpr.material.opacity=Math.min(1,elev*8+1);
  moonSpr.material.opacity=Math.min(1,-elev*8+1);
  sunLight.position.copy(camera.position).addScaledVector(elev>0?sd:sd.clone().negate(),80);
  sunLight.target.position.copy(camera.position);
  stars.material.opacity=Math.max(0,1-day*1.4)*(0.85+0.15*Math.sin(performance.now()*.003));
  stars.position.copy(camera.position);stars.rotation.y+=dt*.004;
  cloudMesh.position.x=camera.position.x;
  cloudMesh.position.z=camera.position.z;
  cloudMesh.material.map.offset.x+=dt*.004;
}

// ================= DEBUG =================
let fps=0,fAcc=0,fN=0;
function updateDebug(){
  const d=$('debug');if(d.classList.contains('hidden'))return;
  const p=player.pos;
  d.textContent=
`MineClone  seed:${seed}
FPS: ${fps|0}  chunks: ${chunks.size}  VD:${VIEW_DIST}
XYZ: ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}
Chunk: ${Math.floor(p.x/16)},${Math.floor(p.z/16)}  Time: ${(worldTime).toFixed(2)}
Fly:${player.fly}  Water:${player.inWater}  Pigs:${pigs.length}`;
}

// ================= MAIN LOOP =================
let lastT=0,saveT=0,stepSndT=0;
function loop(t){
  requestAnimationFrame(loop);
  const dt=Math.min(.05,(t-lastT)/1000||0);lastT=t;
  fAcc+=dt;fN++;if(fAcc>.5){fps=fN/fAcc;fAcc=0;fN=0;}
  if(gameActive&&!invOpen){
    // fixed-step physics
    stepPlayer(Math.min(dt,.033));
    // block actions (hold-to-repeat)
    actT-=dt;
    if(lDown||rDown){
      if(actT<=0){
        const h=raycastVoxel();
        if(lDown)breakBlock(h);else placeBlock(h);
        actT=lDown?.16:.22;
      }
    }else actT=0;
    const h=raycastVoxel();
    if(h){hlBox.visible=true;hlBox.position.set(h.x+.5,h.y+.5,h.z+.5);}
    else hlBox.visible=false;
    // step sounds
    if(player.onGround&&(Math.abs(player.vel.x)+Math.abs(player.vel.z))>1){
      stepSndT-=dt;if(stepSndT<=0){snd('step');stepSndT=.34;}
    }
    for(const pig of pigs)pig.step(Math.min(dt,.033));
  }
  ensureChunks(player.pos.x,player.pos.z);
  pumpQueues(2);
  updateTNT(dt);
  updateParticles(dt);
  updateSky(dt);
  updateDebug();
  if(hurtT>0){hurtT-=dt;if(hurtT<=0)$('vignette-hurt').style.boxShadow='inset 0 0 120px rgba(180,0,0,0)';}
  saveT+=dt;if(saveT>20&&gameActive){saveT=0;if(edits.size)saveWorld();}
  renderer.render(scene,camera);
}

// ================= BOOT =================
buildAtlas();
initThree();
initHL();
initParticles();
initInput();
wireMenus();
buildInventory();
requestAnimationFrame(loop);
