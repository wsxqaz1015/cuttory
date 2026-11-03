/* Cuttory Studio canvas renderer. Original, dependency-free, local-first. */
(function () {
  'use strict';
  const imageCache = new Map(), videoCache = new Map(), measureCache = new Map();
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ko', {granularity:'grapheme'}) : null;
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const number = (n,f) => Number.isFinite(Number(n)) ? Number(n) : f;
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const chars = s => segmenter ? Array.from(segmenter.segment(s), x=>x.segment) : Array.from(s);
  const own = (o,k) => Object.prototype.hasOwnProperty.call(o || {},k);
  let audioContext;

  function color(value, fallback) {
    if (typeof value !== 'string' || /url\s*\(|var\s*\(/i.test(value)) return fallback;
    return window.CSS && CSS.supports('color',value) ? value : fallback;
  }
  function dimensions(doc) {
    const width = Math.round(number(doc.width,1080)), height = Math.round(number(doc.height,1350));
    if (width < 64 || height < 64 || width > 16384 || height > 16384 || width*height > 90000000) throw new Error('캔버스 크기는 64~16384px, 총 9천만 픽셀 이하여야 해요.');
    return {width,height};
  }
  function safeName(value) {
    let name = String(value || 'Cuttory').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g,'_').replace(/\s+/g,' ').replace(/^[. ]+|[. ]+$/g,'').slice(0,90).replace(/[. ]+$/g,'');
    if (!name) name='Cuttory';
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name='_'+name;
    return name;
  }
  function canvasOf(w,h) {
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    if (!c.getContext('2d')) throw new Error('Canvas2D를 사용할 수 없어요.');
    return c;
  }
  function roundRect(ctx,x,y,w,h,r) {
    r=clamp(number(r,0),0,Math.min(w,h)/2);
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }
  function waitEvent(el, event, timeout=25000) {
    return new Promise((resolve,reject)=>{
      const done=()=>{cleanup();resolve();}, fail=()=>{cleanup();reject(new Error('미디어를 읽지 못했어요.'));};
      const timer=setTimeout(()=>{cleanup();reject(new Error('미디어 로딩 시간이 초과됐어요.'));},timeout);
      function cleanup(){clearTimeout(timer);el.removeEventListener(event,done);el.removeEventListener('error',fail);}
      el.addEventListener(event,done,{once:true});el.addEventListener('error',fail,{once:true});
    });
  }
  function loadImage(src) {
    if (!src) return Promise.reject(new Error('이미지 주소가 없어요.'));
    if (!imageCache.has(src)) {
      const promise=(async()=>{const img=new Image(); if (/^https?:/i.test(src)) img.crossOrigin='anonymous'; const ready=waitEvent(img,'load');img.src=src; await ready; if (!img.naturalWidth) throw new Error('빈 이미지예요.');return img;})();
      imageCache.set(src,promise);promise.catch(()=>imageCache.delete(src));
    }
    return imageCache.get(src);
  }
  function loadVideo(src) {
    if (!src) return Promise.reject(new Error('동영상 주소가 없어요.'));
    if (!videoCache.has(src)) {
      const promise=(async()=>{const video=document.createElement('video');video.preload='auto';video.playsInline=true;video.muted=true; if (/^https?:/i.test(src)) video.crossOrigin='anonymous';const ready=waitEvent(video,'loadeddata');video.src=src;video.load();await ready;return {video,queue:Promise.resolve(),source:null};})();
      videoCache.set(src,promise);promise.catch(()=>videoCache.delete(src));
    }
    return videoCache.get(src);
  }
  function clipInfo(block,video) {
    const total=Number.isFinite(video.duration) ? video.duration : Infinity;
    const start=clamp(number(block.videoStart,0),0,Math.max(0,total-.02));
    const requested=clamp(number(block.videoDuration,6),.05,40);
    return {start,duration:Math.max(.05,Math.min(requested,total-start))};
  }
  async function seek(video, time) {
    const target=Number.isFinite(video.duration) ? clamp(time,0,Math.max(0,video.duration-.015)) : Math.max(0,time);
    if (Math.abs(video.currentTime-target)<.015 && video.readyState>=2) return;
    const ready=waitEvent(video,'seeked',15000);video.currentTime=target;await ready;
  }
  async function videoFrame(resource,time,fn) {
    const job=resource.queue.catch(()=>{}).then(async()=>{resource.video.pause();resource.video.muted=true;await seek(resource.video,time);fn(resource.video);});
    resource.queue=job; return job;
  }
  const defaults={
    category:{fontSize:27,fontWeight:700,color:'accent',marginBottom:18},
    title:{fontSize:64,fontWeight:800,lineHeight:1.28,marginBottom:30},
    subtitle:{fontSize:43,fontWeight:700,lineHeight:1.4,marginBottom:24},
    body:{fontSize:36,lineHeight:1.65,marginBottom:26},
    quote:{fontSize:39,lineHeight:1.55,color:'#4c6156',marginTop:16,marginBottom:30},
    caption:{fontSize:26,color:'#737b77',lineHeight:1.5,marginBottom:26},
    profile:{fontSize:28,fontWeight:600,marginTop:22,marginBottom:24},
    question:{fontSize:52,fontWeight:750,lineHeight:1.4,marginBottom:28},
    status:{fontSize:24,fontWeight:700,color:'accent',marginBottom:20},
    tags:{fontSize:26,color:'accent',lineHeight:1.55,marginBottom:18},
    metadata:{fontSize:24,color:'#77817b',lineHeight:1.5,marginBottom:20},
    questionFooter:{fontSize:25,color:'#77817b',marginTop:16,marginBottom:28},
    answerer:{fontSize:29,fontWeight:700,color:'accent',marginTop:26,marginBottom:22},
    reaction:{fontSize:25,color:'#68766d',marginTop:18,marginBottom:20},
    notice:{fontSize:25,color:'#737b77',lineHeight:1.55,marginTop:16,marginBottom:20},
    term:{fontSize:76,fontWeight:800,lineHeight:1.25,marginBottom:20},
    related:{fontSize:28,color:'accent',lineHeight:1.5,marginBottom:18},
    partOfSpeech:{fontSize:27,fontWeight:600,color:'#738078',marginBottom:22},
    definition:{fontSize:40,lineHeight:1.65,marginBottom:26},
    example:{fontSize:33,color:'#58695d',lineHeight:1.65,marginTop:8,marginBottom:24},
    more:{fontSize:28,color:'accent',marginTop:18,marginBottom:24},
    label:{fontSize:25,fontWeight:700,color:'accent',marginBottom:18},
    image:{height:420,marginBottom:26,fit:'cover',radius:0},
    divider:{height:2,marginTop:20,marginBottom:28,color:'#dce5df'}
  };
  function styleFor(doc,block) {
    const theme=doc.theme || {}, base={fontSize:36,fontFamily:theme.font || 'Pretendard',fontWeight:400,color:'#242c29',lineHeight:1.6,letterSpacing:0,paragraphSpacing:12,marginTop:0,marginBottom:24,align:'left'};
    const style=Object.assign(base,defaults[block.type] || defaults.body,block.style || {});
    if (style.color==='accent') style.color=theme.accent || '#197753';
    style.color=color(style.color,'#242c29');style.fontSize=clamp(number(style.fontSize,36),4,600);
    style.fontWeight=clamp(number(style.bold ? 700 : style.fontWeight,400),100,1000);
    style.lineHeight=Math.max(.5,number(style.lineHeight,1.6));style.letterSpacing=clamp(number(style.letterSpacing,0),-style.fontSize*.8,100);
    style.paragraphSpacing=Math.max(0,number(style.paragraphSpacing,12));
    style.marginTop=number(style.marginTop,0);style.marginBottom=number(style.marginBottom,24);
    return style;
  }
  function font(style,run={}) {
    const families=String(style.fontFamily || 'Pretendard').replace(/[\n\r;{}]/g,'').split(',').map(f=> '"'+f.trim().replace(/["\\]/g,'')+'"').join(',');
    return (run.italic || style.italic ? 'italic ' : '')+(run.bold ? Math.max(700,style.fontWeight) : style.fontWeight)+' '+style.fontSize+'px '+families+',"Noto Sans KR","Malgun Gothic",sans-serif';
  }
  function richRuns(block,style) {
    if (!block.html || typeof block.html!=='string') return [{text:String(block.text || '').replace(/\r\n?/g,'\n')}];
    const template=document.createElement('template');template.innerHTML=block.html;
    const runs=[];
    function append(text,flags){if(text)runs.push(Object.assign({text:text.replace(/\r\n?/g,'\n')},flags));}
    function walk(node,flags){
      if(node.nodeType===3){append(node.nodeValue,flags);return;}
      if(node.nodeType!==1)return;
      const tag=node.localName.toLowerCase();
      if(['script','style','iframe','object','embed','svg','math','template','noscript'].includes(tag))return;
      if(tag==='br'){append('\n',flags);return;}
      const next=Object.assign({},flags);
      if(tag==='b'||tag==='strong')next.bold=true;
      if(tag==='i'||tag==='em')next.italic=true;
      if(tag==='u')next.underline=true;
      if(tag==='s')next.strike=true;
      if(tag==='span')next.color=color(node.style.color,next.color || style.color);
      const paragraph=['p','div','li'].includes(tag);
      if(paragraph && runs.length && !runs[runs.length-1].text.endsWith('\n'))append('\n',flags);
      for(const child of node.childNodes)walk(child,next);
      if(paragraph)append('\n',flags);
    }
    for(const child of template.content.childNodes)walk(child,{});
    if(runs.length && /\n$/.test(runs[runs.length-1].text))runs[runs.length-1].text=runs[runs.length-1].text.replace(/\n$/,'');
    return runs.length ? runs : [{text:''}];
  }
  function glyphWidth(ctx,text,fontValue) {
    const key=fontValue+'\0'+text;
    if(measureCache.has(key))return measureCache.get(key);
    ctx.font=fontValue;const width=ctx.measureText(text).width;
    if(measureCache.size>40000)measureCache.clear();measureCache.set(key,width);return width;
  }
  function textLayout(ctx,block,style,width) {
    const lines=[];let line=[],lineWidth=0;
    const lineHeight=style.lineHeight<=5 ? style.fontSize*style.lineHeight : style.lineHeight;
    const actualLineHeight=Math.max(style.fontSize*1.05,lineHeight);
    let y=0, tooWide=false;
    function flush(paragraph=false){
      while(line.length && /^[ \t]$/.test(line[line.length-1].text)){lineWidth-=line.pop().advance;}
      const painted=Math.max(0,lineWidth-(line.length ? style.letterSpacing : 0));
      lines.push({glyphs:line,width:painted,y});y+=actualLineHeight+(paragraph?style.paragraphSpacing:0);line=[];lineWidth=0;
    }
    const tokens=[];
    for(const run of richRuns(block,style)){
      const f=font(style,run);
      for(const ch of chars(run.text))tokens.push({text:ch,run,font:f,advance:glyphWidth(ctx,ch==='\t'?'    ':ch,f)+style.letterSpacing});
    }
    for(let i=0;i<tokens.length;i++){
      const g=tokens[i];
      if(g.text==='\n'){flush(true);continue;}
      if(g.text==='\t')g.text='    ';
      // Keep ordinary Latin words intact where they fit, while Korean wraps by grapheme.
      if(/[A-Za-z0-9]/.test(g.text) && (i===0 || !/[A-Za-z0-9]/.test(tokens[i-1].text))){
        let word=0;for(let j=i;j<tokens.length && /^[A-Za-z0-9'_\-]$/.test(tokens[j].text);j++)word+=tokens[j].advance;
        if(line.length && word<=width && lineWidth+word-style.letterSpacing>width)flush();
      }
      if(line.length && lineWidth+g.advance-style.letterSpacing>width)flush();
      if(!line.length && /^[ \t]$/.test(g.text))continue;
      if(g.advance-style.letterSpacing>width)tooWide=true;
      line.push(g);lineWidth+=g.advance;
    }
    if(line.length || !lines.length || (tokens.length && tokens[tokens.length-1].text==='\n'))flush();
    return {lines,height:y,width:Math.max(0,...lines.map(l=>l.width)),lineHeight:actualLineHeight,tooWide};
  }
  function drawText(ctx,layout,style,x,y,width) {
    ctx.textAlign='left';ctx.textBaseline='alphabetic';
    for(let index=0;index<layout.lines.length;index++){
      const line=layout.lines[index];let px=x;
      if(style.align==='center')px+=(width-line.width)/2;
      if(style.align==='right'||style.align==='end')px+=width-line.width;
      const spaces=line.glyphs.filter(g=>g.text===' ').length;
      const extra=style.align==='justify' && index<layout.lines.length-1 && spaces ? Math.max(0,(width-line.width)/spaces) : 0;
      const baseline=y+line.y+(layout.lineHeight-style.fontSize)/2+style.fontSize*.81;
      for(const g of line.glyphs){
        ctx.font=g.font;ctx.fillStyle=g.run.color || style.color;ctx.fillText(g.text,px,baseline);
        const w=Math.max(0,g.advance-style.letterSpacing);
        ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=Math.max(1,style.fontSize/22);
        if(g.run.underline || style.underline){ctx.beginPath();ctx.moveTo(px,baseline+style.fontSize*.12);ctx.lineTo(px+w,baseline+style.fontSize*.12);ctx.stroke();}
        if(g.run.strike || style.strike){ctx.beginPath();ctx.moveTo(px,baseline-style.fontSize*.29);ctx.lineTo(px+w,baseline-style.fontSize*.29);ctx.stroke();}
        px+=g.advance+(g.text===' '?extra:0);
      }
    }
  }
  function paintMedia(ctx,media,item) {
    const {x,y,width,height,style}=item;const mw=media.videoWidth || media.naturalWidth || media.width,mh=media.videoHeight || media.naturalHeight || media.height;
    if(!mw || !mh)return;
    ctx.save();roundRect(ctx,x,y,width,height,style.radius);ctx.clip();
    const contain=style.fit==='contain';const ratio=contain?Math.min(width/mw,height/mh):Math.max(width/mw,height/mh);
    if(contain){ctx.fillStyle=color(style.background,'#f3f5f3');ctx.fillRect(x,y,width,height);}
    const anchorX=clamp(number(style.positionX,50),0,100)/100,anchorY=clamp(number(style.positionY,50),0,100)/100;
    ctx.drawImage(media,x+(width-mw*ratio)*anchorX,y+(height-mh*ratio)*anchorY,mw*ratio,mh*ratio);ctx.restore();
  }
  function paintMissing(ctx,item){ctx.save();roundRect(ctx,item.x,item.y,item.width,item.height,item.style.radius);ctx.fillStyle='#f0f3f1';ctx.fill();ctx.fillStyle='#69756d';ctx.font='24px sans-serif';ctx.textAlign='center';ctx.fillText('미디어를 불러올 수 없어요',item.x+item.width/2,item.y+item.height/2);ctx.restore();}
  async function prepare(doc,page,options={}) {
    const dim=dimensions(doc), theme=doc.theme || {}, measure=canvasOf(8,8).getContext('2d');
    if(document.fonts){
      const fonts=new Set();
      for(const block of page.blocks || []){const style=styleFor(doc,block);fonts.add(font(style));for(const run of richRuns(block,style))fonts.add(font(style,run));}
      fonts.add(font(Object.assign(styleFor(doc,{type:'caption'}),theme.headerStyle || {})));
      await Promise.all(Array.from(fonts,f=>Promise.race([document.fonts.load(f,'가나다 Aa'),sleep(1800)]).catch(()=>{})));
      measureCache.clear();
    }
    const warnings=[];const padding=clamp(number(theme.padding,Math.round(dim.width*.075)),12,dim.width*.3);
    const header=theme.headerVisible!==false && page.headerVisible!==false && !!theme.header;
    const profile=theme.profileVisible!==false && page.profileVisible!==false && !!theme.nickname;
    const hs=Object.assign(styleFor(doc,{type:'caption'}),{fontSize:25,color:color(theme.accent,'#197753')},theme.headerStyle || {});
    const ps=Object.assign(styleFor(doc,{type:'profile'}),{fontSize:24},theme.profileStyle || {});
    const hLayout=header?textLayout(measure,{text:theme.header},hs,dim.width-padding*2):null;
    const pLayout=profile?textLayout(measure,{text:theme.nickname},ps,dim.width-padding*2-48):null;
    const top=padding+(header?hLayout.height+number(hs.marginBottom,40):0), bottom=dim.height-padding-(profile?pLayout.height+34:0);
    const items=[];let cursor=0;
    for(const block of page.blocks || []){
      const style=styleFor(doc,block);const item={block,style,x:padding,y:0,width:dim.width-padding*2,height:0};
      cursor+=style.marginTop;item.y=cursor;
      if(block.type==='image'){
        const availableWidth=item.width;item.width=Math.max(1,availableWidth*clamp(number(style.widthPercent,100),1,100)/100);
        if(style.align==='center')item.x+=(availableWidth-item.width)/2;else if(style.align==='right'||style.align==='end')item.x+=availableWidth-item.width;
        const ratioMatch=/^(16:9|4:3|1:1|3:4)$/.exec(String(style.aspectRatio || 'free'));
        const ratio=ratioMatch?ratioMatch[1].split(':').map(Number):null;
        item.height=clamp(own(block.style,'height')?number(style.height,420):(ratio?item.width*ratio[1]/ratio[0]:number(style.height,420)),1,100000);
        try {item.resource=block.mediaKind==='video'?await loadVideo(block.src):await loadImage(block.src);
          const media=block.mediaKind==='video'?item.resource.video:item.resource;
          const sourceWidth=media.videoWidth || media.naturalWidth,sourceHeight=media.videoHeight || media.naturalHeight;
          if(sourceWidth<item.width*.65 || sourceHeight<item.height*.65)warnings.push('블록 '+block.id+': 원본 미디어 해상도가 낮아 확대하면 흐려질 수 있어요.');
          if(block.mediaKind==='video' && number(block.videoDuration,6)>40)warnings.push('블록 '+block.id+': 동영상 구간은 최대 40초로 제한돼요.');
        }catch(e){item.error=e;warnings.push('블록 '+block.id+': '+e.message);}
      } else if(block.type==='divider')item.height=clamp(number(style.height,2),1,100);
      else {
        item.inset=block.type==='quote'?28:((block.type==='notice'||block.type==='status'||block.type==='label'||block.type==='example')?18:0);
        item.verticalInset=['notice','status','label','example'].includes(block.type)?12:0;
        item.layout=textLayout(measure,block,style,Math.max(1,item.width-item.inset*2));
        item.height=item.layout.height+item.verticalInset*2;
      }
      cursor+=item.height+style.marginBottom;items.push(item);
    }
    const contentHeight=items.length?cursor:0;
    const offset=page.align==='center'?Math.max(0,(bottom-top-contentHeight)/2):page.align==='bottom'?Math.max(0,bottom-top-contentHeight):0;
    for(const item of items)item.y+=top+offset;
    const overflow=top>bottom || contentHeight>bottom-top+.5 || items.some(i=>i.y<0 || i.y+i.height>bottom+.5 || i.layout?.tooWide) || !!hLayout?.tooWide || !!pLayout?.tooWide;
    return {doc,page,dim,theme,padding,header,profile,hs,ps,hLayout,pLayout,items,warnings,overflow};
  }
  function paintBase(ctx,prepared) {
    const {dim,theme,padding,header,profile,hs,ps,hLayout,pLayout}=prepared;
    ctx.clearRect(0,0,dim.width,dim.height);ctx.fillStyle=color(theme.background,'#ffffff');ctx.fillRect(0,0,dim.width,dim.height);
    if(header){drawText(ctx,hLayout,hs,padding,padding,dim.width-padding*2);ctx.strokeStyle=color(theme.accent,'#197753');ctx.lineWidth=1;ctx.globalAlpha=.25;ctx.beginPath();ctx.moveTo(padding,padding+hLayout.height+19);ctx.lineTo(dim.width-padding,padding+hLayout.height+19);ctx.stroke();ctx.globalAlpha=1;}
    if(profile){
      const py=dim.height-padding-pLayout.height;
      ctx.fillStyle=color(theme.accent,'#197753');ctx.beginPath();ctx.arc(padding+13,py+pLayout.height/2,11,0,Math.PI*2);ctx.fill();
      drawText(ctx,pLayout,ps,padding+40,py,dim.width-padding*2-48);
    }
  }
  function paintNonMedia(ctx,item) {
    const {block,style,x,y,width,height,layout}=item;
    ctx.save();
    if(block.type==='divider'){ctx.fillStyle=style.color;ctx.fillRect(x,y,width,height);ctx.restore();return;}
    if(block.type==='quote'){ctx.fillStyle=color(style.borderColor,'#85aa96');ctx.fillRect(x,y+3,4,Math.max(1,height-6));}
    if(['notice','example','status','label'].includes(block.type)){
      let bx=x,bw=width;
      if(['status','label'].includes(block.type)){bw=Math.min(width,layout.width+item.inset*2);if(style.align==='center')bx+=(width-bw)/2;else if(style.align==='right')bx+=width-bw;}
      ctx.fillStyle=color(style.background,block.type==='example'?'#f5f6f2':'#eef5ef');roundRect(ctx,bx,y,bw,height,number(style.radius,8));ctx.fill();
    }
    drawText(ctx,layout,style,x+item.inset,y+item.verticalInset,width-item.inset*2);ctx.restore();
  }
  async function paintPrepared(ctx,prepared,time=0,live=false) {
    paintBase(ctx,prepared);
    for(const item of prepared.items){
      if(item.block.type!=='image'){paintNonMedia(ctx,item);continue;}
      if(!item.resource){paintMissing(ctx,item);continue;}
      if(item.block.mediaKind==='video'){
        if(live)paintMedia(ctx,item.liveVideo || item.resource.video,item);
        else {const clip=clipInfo(item.block,item.resource.video);await videoFrame(item.resource,clip.start+Math.min(Math.max(0,time),clip.duration-.025),video=>paintMedia(ctx,video,item));}
      } else paintMedia(ctx,item.resource,item);
    }
  }
  async function renderPage(doc,page,{scale=1,time=0}={}) {
    if(!doc || !page)throw new Error('문서와 페이지가 필요해요.');
    scale=number(scale,1);if(scale<=0 || scale>8)throw new Error('확대 비율은 0 초과, 8 이하여야 해요.');
    const prepared=await prepare(doc,page);if(prepared.items.some(i=>i.block.mediaKind==='video' && i.block.muted===false))prepared.warnings.push('동영상 미리보기는 무음이에요. 내보낼 때 브라우저가 허용하는 경우에만 오디오를 포함해요.');const w=Math.max(1,Math.round(prepared.dim.width*scale)),h=Math.max(1,Math.round(prepared.dim.height*scale));
    if(w*h>90000000 || w>32767 || h>32767)throw new Error('출력 캔버스가 너무 커요. 확대 비율을 줄여 주세요.');
    const canvas=canvasOf(w,h),ctx=canvas.getContext('2d');ctx.scale(scale,scale);await paintPrepared(ctx,prepared,number(time,0));
    return {canvas,hitboxes:prepared.items.map(i=>({id:i.block.id,x:i.x,y:i.y,width:i.width,height:i.height})),overflow:prepared.overflow,warnings:prepared.warnings.slice()};
  }
  function toBlob(canvas,type='image/png') {return new Promise((resolve,reject)=>{try{canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('이미지 파일 생성에 실패했어요.')),type);}catch(e){reject(new Error('이미지를 내보낼 수 없어요. 외부 미디어는 CORS 허용이 필요해요. '+e.message));}});}
  function progress(callback,value,detail={}) {if(typeof callback==='function')try{callback(clamp(value,0,1),detail);}catch(e){console.warn('진행률 콜백 오류',e);}}
  function warn(message,callback,value=0) {console.warn('[CuttoryRenderer] '+message);progress(callback,value,{warning:message});}
  function assertExport(prepared,allowOverflow=false) {
    if(prepared.overflow && !allowOverflow)throw new Error('페이지에 캔버스를 넘는 콘텐츠가 있어요. 잘린 파일을 만들지 않도록 내보내기를 멈췄어요. 글자 크기·여백을 줄이거나 페이지를 나눠 주세요.');
    if(prepared.items.some(item=>item.error))throw new Error('미디어를 불러오지 못해 내보내기를 멈췄어요. '+prepared.warnings.join(' '));
  }
  async function makeLiveVideo(item) {
    // Dedicated playback elements prevent preview seeks and duplicate-src blocks from interfering.
    const source=item.resource.video, video=document.createElement('video');video.preload='auto';video.playsInline=true;video.muted=true;video.crossOrigin=source.crossOrigin;
    const ready=waitEvent(video,'loadeddata');video.src=source.currentSrc || source.src;video.load();await ready;
    const clip=clipInfo(item.block,video);await seek(video,clip.start);item.liveVideo=video;item.clip=clip;return video;
  }
  async function recordPage(prepared,onProgress) {
    if(document.hidden)warn('현재 탭이 백그라운드에 있어 영상 프레임이 느려질 수 있어요. 녹화가 끝날 때까지 이 탭을 활성 상태로 유지해 주세요.',onProgress);
    if(typeof MediaRecorder==='undefined' || !HTMLCanvasElement.prototype.captureStream)throw new Error('이 브라우저는 실제 동영상 녹화를 지원하지 않아요. 최신 Chrome을 사용해 주세요.');
    const types=['video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    const mime=types.find(t=>MediaRecorder.isTypeSupported(t));if(!mime)throw new Error('지원되는 동영상 저장 형식이 없어요.');
    const canvas=canvasOf(prepared.dim.width,prepared.dim.height),ctx=canvas.getContext('2d');
    const videos=prepared.items.filter(i=>i.block.type==='image' && i.block.mediaKind==='video');
    const stream=canvas.captureStream(30);let recorder, destination, audioNodes=[],stopTimer,stoppedPromise,started=0;
    let playbackWarnings=[];
    try {
      await Promise.all(videos.map(makeLiveVideo));
      const audible=videos.filter(i=>i.block.muted===false);
      if(audible.length){
        try {
          const AC=window.AudioContext || window.webkitAudioContext;if(!AC)throw new Error('Web Audio 미지원');
          audioContext=audioContext || new AC();
          await Promise.race([audioContext.resume(),sleep(1500)]);
          if(audioContext.state!=='running')throw new Error('브라우저 오디오 권한 필요');
          destination=audioContext.createMediaStreamDestination();
          for(const item of audible){const node=audioContext.createMediaElementSource(item.liveVideo);node.connect(destination);audioNodes.push(node);item.liveVideo.muted=false;}
          destination.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
          if(!stream.getAudioTracks().length)throw new Error('오디오 트랙 생성 실패');
        }catch(e){
          audioNodes.forEach(n=>n.disconnect());audioNodes=[];videos.forEach(i=>i.liveVideo.muted=true);
          stream.getAudioTracks().forEach(t=>{stream.removeTrack(t);t.stop();});
          const message='동영상 오디오를 포함하지 못했어요. 이번 파일은 무음이에요. ('+e.message+')';playbackWarnings.push(message);warn(message,onProgress);
        }
      }
      await paintPrepared(ctx,prepared,0,true);
      recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8000000});const chunks=[];
      stoppedPromise=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=resolve;recorder.onerror=e=>reject(e.error || new Error('동영상 녹화에 실패했어요.'));});
      recorder.start(250);started=performance.now();
      for(const item of videos){try{await item.liveVideo.play();}catch(e){throw new Error('동영상 재생이 차단됐어요. 페이지에서 내보내기를 다시 눌러 주세요. '+e.message);}}
      const duration=Math.max(.1,...videos.map(i=>i.clip.duration),videos.length?0:6);
      await new Promise((resolve,reject)=>{
        let lastProgress=-1,finished=false,frameTimer;
        let visibilityWarned=document.hidden;
        const visibility=()=>{if(document.hidden&&!visibilityWarned){visibilityWarned=true;warn('녹화 중 탭이 비활성화됐어요. 브라우저 절전으로 프레임이 줄어들 수 있어요.',onProgress);}};
        document.addEventListener('visibilitychange',visibility);
        const finish=()=>{if(finished)return;finished=true;clearTimeout(stopTimer);clearTimeout(frameTimer);document.removeEventListener('visibilitychange',visibility);resolve();};
        const frame=async()=>{
          if(finished)return;
          try{
            const elapsed=(performance.now()-started)/1000;
            for(const item of videos)if(elapsed>=item.clip.duration && !item.liveVideo.paused)item.liveVideo.pause();
            await paintPrepared(ctx,prepared,elapsed,true);
            const tick=Math.floor(elapsed*5);if(tick!==lastProgress){lastProgress=tick;progress(onProgress,elapsed/duration,{elapsed,duration});}
            if(elapsed>=duration)finish();else frameTimer=setTimeout(frame,1000/30);
          }catch(e){finished=true;clearTimeout(stopTimer);clearTimeout(frameTimer);document.removeEventListener('visibilitychange',visibility);reject(e);}
        };
        // Timer keeps real-time recording finite even if background tabs throttle animation frames.
        stopTimer=setTimeout(finish,duration*1000+60);frame();
      });
      if(recorder.state!=='inactive')recorder.stop();await stoppedPromise;
      if(!chunks.length)throw new Error('녹화된 동영상 데이터가 없어요.');
      const actual=recorder.mimeType || chunks[0].type || mime;
      const extension=/mp4/i.test(actual)?'mp4':/webm/i.test(actual)?'webm':null;
      if(!extension)throw new Error('녹화 형식을 판별할 수 없어요: '+actual);
      const blob=new Blob(chunks,{type:actual});progress(onProgress,1,{warnings:playbackWarnings});return {blob,extension,warnings:playbackWarnings};
    } finally {
      clearTimeout(stopTimer);
      if(recorder && recorder.state!=='inactive'){try{recorder.stop();}catch(e){}}
      if(stoppedPromise)stoppedPromise.catch(()=>{});
      stream.getTracks().forEach(t=>t.stop());audioNodes.forEach(n=>{try{n.disconnect();}catch(e){}});
      if(destination)destination.stream.getTracks().forEach(t=>t.stop());
      for(const item of videos)if(item.liveVideo){item.liveVideo.pause();item.liveVideo.removeAttribute('src');item.liveVideo.load();delete item.liveVideo;}
    }
  }
  const crcTable=new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
  function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
  async function storeZip(files) {
    const parts=[],central=[];let offset=0,centralSize=0;const encoder=new TextEncoder();
    if(files.length>65535)throw new Error('ZIP에 넣을 파일이 너무 많아요.');
    for(const file of files){
      const name=encoder.encode(file.name),bytes=new Uint8Array(await file.blob.arrayBuffer());
      if(bytes.length>0xffffffff || offset+bytes.length+name.length+30>0xffffffff)throw new Error('4GB 이상 ZIP은 지원하지 않아요. 페이지를 나눠 저장해 주세요.');
      const crc=crc32(bytes),local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
      lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint16(8,0,true);lv.setUint16(12,33,true);lv.setUint32(14,crc,true);lv.setUint32(18,bytes.length,true);lv.setUint32(22,bytes.length,true);lv.setUint16(26,name.length,true);local.set(name,30);
      parts.push(local,bytes);
      const cd=new Uint8Array(46+name.length),cv=new DataView(cd.buffer);
      cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(10,0,true);cv.setUint16(14,33,true);cv.setUint32(16,crc,true);cv.setUint32(20,bytes.length,true);cv.setUint32(24,bytes.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);cd.set(name,46);
      central.push(cd);centralSize+=cd.length;offset+=local.length+bytes.length;
    }
    if(offset+centralSize>0xffffffff)throw new Error('ZIP64 형식은 지원하지 않아요.');
    const end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,centralSize,true);ev.setUint32(16,offset,true);
    return new Blob([...parts,...central,end],{type:'application/zip'});
  }
  // Serialize exports: a single real-time recorder can own playback resources at a time.
  let exportQueue=Promise.resolve();
  async function exportInternal(doc,{pageIndexes,mode='all',format='png',onProgress,allowOverflow=false}={}) {
    if(!doc || !Array.isArray(doc.pages) || !doc.pages.length)throw new Error('내보낼 페이지가 없어요.');
    if(!['png','zip','video'].includes(format))throw new Error('지원하지 않는 내보내기 형식이에요.');
    let indexes;
    if(mode==='all')indexes=doc.pages.map((_,i)=>i);
    else if(mode==='current')indexes=[Array.isArray(pageIndexes)&&pageIndexes.length?pageIndexes[0]:0];
    else if(mode==='selected')indexes=Array.from(new Set(pageIndexes || [])).sort((a,b)=>a-b);
    else throw new Error('지원하지 않는 페이지 선택 모드예요.');
    if(!indexes.length || indexes.some(i=>!Number.isInteger(i)||i<0||i>=doc.pages.length))throw new Error('올바른 페이지를 선택해 주세요.');
    const outputs=[],base=safeName(doc.name),digits=Math.max(2,String(doc.pages.length).length);
    const selected=indexes.filter(i=>format!=='png'||!(doc.pages[i].blocks || []).some(b=>b.type==='image'&&b.mediaKind==='video'));
    if(selected.length!==indexes.length)warn('PNG 내보내기에서 동영상 페이지를 제외했어요. 동영상 포함 페이지는 ZIP 또는 동영상 형식으로 저장해 주세요.',onProgress);
    if(!selected.length)throw new Error('정지 이미지 페이지가 없어요. ZIP 또는 동영상 형식을 선택해 주세요.');
    progress(onProgress,0,{total:selected.length});
    // Preflight every page before expensive recording, avoiding partial silent failures.
    const preparedPages=[];for(const index of selected){const prepared=await prepare(doc,doc.pages[index]);assertExport(prepared,allowOverflow);for(const message of prepared.warnings)warn(message,onProgress);if(prepared.overflow)warn('페이지 '+(index+1)+'의 넘치는 콘텐츠가 잘린 채로 내보내져요. allowOverflow가 활성화되어 있어요.',onProgress);preparedPages.push({index,prepared});}
    for(let n=0;n<preparedPages.length;n++){
      const {index,prepared}=preparedPages[n],hasVideo=prepared.items.some(i=>i.block.type==='image'&&i.block.mediaKind==='video');
      const name=base+'_'+String(index+1).padStart(digits,'0');
      if(format==='video'||(format==='zip'&&hasVideo)){
        const result=await recordPage(prepared,(value,detail)=>progress(onProgress,(n+value)/selected.length,Object.assign({pageIndex:index},detail)));
        outputs.push({name:name+'.'+result.extension,blob:result.blob});
      }else{
        const canvas=canvasOf(prepared.dim.width,prepared.dim.height);await paintPrepared(canvas.getContext('2d'),prepared);
        outputs.push({name:name+'.png',blob:await toBlob(canvas)});
      }
      progress(onProgress,(n+1)/selected.length,{pageIndex:index});
    }
    if(format==='zip'){const blob=await storeZip(outputs);progress(onProgress,1,{complete:true});return [{name:base+'.zip',blob}];}
    progress(onProgress,1,{complete:true});return outputs;
  }
  function exportDocument(doc,options={}) {
    // Snapshot input so edits made during a long real-time recording do not alter the export.
    let copy;try{copy=typeof structuredClone==='function'?structuredClone(doc):JSON.parse(JSON.stringify(doc));}catch(e){return Promise.reject(new Error('문서 데이터를 복사하지 못했어요.'));}
    const job=exportQueue.catch(()=>{}).then(()=>exportInternal(copy,options));exportQueue=job;return job;
  }
  function serializeText(doc) {
    return (doc.pages || []).map(page=>(page.blocks || []).map(block=>{
      if(block.type==='image'||block.type==='divider')return '';
      if(block.html){const style=styleFor(doc,block);return richRuns(block,style).map(r=>r.text).join('');}
      return String(block.text || '');
    }).filter(Boolean).join('\n\n')).join('\n\n---\n\n');
  }
  window.CuttoryRenderer=Object.freeze({renderPage,exportDocument,serializeText});
})();
