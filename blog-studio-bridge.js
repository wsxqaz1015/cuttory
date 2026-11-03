/* Cuttory blog -> local-first Studio. No AI requests. */
'use strict';
(() => {
const button=document.getElementById('studio-from-post'); if(!button)return;
let studioWindow=null;
button.addEventListener('click',async()=>{
 const api=window.CuttoryBlogBridge;if(!api?.getPost()){alert('먼저 글을 만들어 주세요.');return;} const S={post:api.getPost(),media:api.getMedia()}; const {photoBlob,toast}=api;
 const target=new URL('studio.html',location.href);
 let readyResolve; const ready=new Promise(resolve=>readyResolve=resolve);
 let handler=(event)=>{if(event.origin===location.origin&&event.source===studioWindow&&event.data?.type==='CUTTORY_STUDIO_READY')readyResolve(true);};
 window.addEventListener('message',handler);
 studioWindow=window.open(target.href,'cuttory_studio');
 if(!studioWindow){window.removeEventListener('message',handler);toast('팝업이 차단됐어요. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.');return;}
 const old=button.textContent; button.disabled=true;button.textContent='사진과 글 준비 중…';
 try{
   const attachments=[];for(const m of S.media){const blob=m.kind==='photo'?await photoBlob(m):m.file; attachments.push({blob,name:m.file?.name||m.id,kind:m.kind,start:m.start||0,len:m.len||6,muted:m.muted??true});}
   const p=S.post;const lines=[];if(p.intro)lines.push(p.intro,'');for(const section of p.sections||[]){if(section.heading)lines.push('## '+section.heading,'');for(const block of section.blocks||[]){if(block.text)lines.push(block.text,'');else if(block.ids)lines.push(...block.ids.map(id=>{const index=S.media.findIndex(x=>x.id===id);return index<0?'':'[첨부 '+(index+1)+']';}).filter(Boolean),'');}}if(p.tip)lines.push('## 작은 팁',p.tip,'');if(p.faq?.length){lines.push('## 자주 묻는 질문');for(const f of p.faq)lines.push('Q. '+f.q,'A. '+f.a,'');}if(p.recommend)lines.push('## 이런 분께 추천해요',p.recommend,'');if(p.outro)lines.push(p.outro);
   const payload={title:p.title||'블로그에서 가져온 글',text:lines.join('\n'),attachments};
   const available=await Promise.race([ready,new Promise(resolve=>setTimeout(()=>resolve(false),20000))]);
   if(!available){throw new Error('스튜디오 준비가 늦어졌어요. 창을 닫고 다시 보내 주세요.');}
   const ack=new Promise(resolve=>{const receive=event=>{if(event.source===studioWindow&&event.origin===location.origin&&event.data?.type==='CUTTORY_IMPORT_DONE'){window.removeEventListener('message',receive);resolve(true);}};window.addEventListener('message',receive);setTimeout(()=>{window.removeEventListener('message',receive);resolve(false);},30000);});
   studioWindow.postMessage({type:'CUTTORY_IMPORT',payload},location.origin);
   if(await ack)toast('글과 사진·영상을 스튜디오로 보냈어요.');else toast('스튜디오로 전송했어요. 새 창에서 가져오기 결과를 확인해 주세요.',5000);
 }catch(error){toast(error.message||'옮기지 못했어요.');}finally{button.disabled=false;button.textContent=old;window.removeEventListener('message',handler);}
});
})();
