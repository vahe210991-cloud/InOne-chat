/* InOne screen runtime. Хост — Flutter (JavaScriptChannel "InOneBridge") или просмотрщик index.html. Нет сети, нет хранилища, секреты не логируются. */
(function(){
var d=document,r=d.documentElement,q=new URLSearchParams(location.search),B=window.InOneBridge,pv=!B,last=null;
var MSG={offline:'Нет связи с сервером',maintenance:'Сервис на техническом обслуживании',unavailable:'Сервис временно недоступен',rate:'Слишком много запросов. Подождите и попробуйте снова',error:'Текст ошибки по коду (каталог ERROR_TEXT)'};
var OFF={loading:1,waiting:1,offline:1,maintenance:1,unavailable:1,rate:1};
function emit(type,data){var m={type:type,screen:d.body.dataset.screen,data:data||{}};
 if(B)B.postMessage(JSON.stringify(m));else if(parent!==window)parent.postMessage({inone:m},'*');else console.log('[InOne]',type,data&&(data.call||data.screen))}
function setThemeMode(m){if(m==='light'||m==='dark')r.dataset.theme=m;else r.removeAttribute('data-theme')}
function setInsets(t,b){r.style.setProperty('--inset-top',t+'px');r.style.setProperty('--inset-bottom',b+'px')}
function setData(o){Object.keys(o).forEach(function(k){d.querySelectorAll('[data-bind="'+k+'"]').forEach(function(e){e.textContent=o[k]})})}
function setState(s,t){s=s||'default';d.body.dataset.state=s;var m=t||(s==='error'&&d.body.dataset.err)||MSG[s],bn=d.getElementById('bn');if(bn){bn.textContent=m||'';bn.hidden=!m}
 d.querySelectorAll('[data-only]').forEach(function(e){e.hidden=e.dataset.only.split(' ').indexOf(s)<0});
 d.querySelectorAll('[data-hide]').forEach(function(e){e.hidden=e.dataset.hide.split(' ').indexOf(s)>=0});
 d.querySelectorAll('.btn[data-api]').forEach(function(b){var l=b.querySelector('.l'),sp=b.querySelector('.sp');if(!b.dataset.t)b.dataset.t=l.textContent;
  var busy=(s==='loading'||s==='waiting')&&(b===last||(!last&&b.classList.contains('p')));
  b.disabled=!!OFF[s];l.textContent=(s==='loading'&&busy&&b.dataset.loading)||b.dataset.t;
  if(busy&&!sp)b.insertAdjacentHTML('afterbegin','<i class="sp"></i>');if(!busy&&sp)sp.remove()});d.querySelectorAll('.sw').forEach(function(w){w.setAttribute('aria-checked',s==='on');w.disabled=s==='test'||!!OFF[s]})}
function go(id,href){emit('navigate',{screen:id});if(pv&&parent===window){if(id==='back')history.back();else location.href=href+location.search}}
function run(btn){var f=btn.closest('form'),b={},bad=null;
 if(f)f.querySelectorAll('input').forEach(function(i){if(i.type==='radio'&&!i.checked)return;b[i.name]=i.value;var w=i.closest('.f');if(i.required&&!i.value.trim()){w.classList.add('bad');bad=bad||i}else w.classList.remove('bad')});
 if(bad){bad.focus();return}
 if(btn.dataset.body)Object.assign(b,JSON.parse(btn.dataset.body));
 last=btn;emit('api',{call:btn.dataset.api,body:b});setState(btn.dataset.busy||'loading');
 if(pv)setTimeout(function(){last=null;var a=btn.dataset.after,n=btn.dataset.next;if(a)setState(a);else if(n)go(n,n+'.html');else setState('default')},1100)}
function ask(a){var o=d.createElement('div');o.className='dlg';o.innerHTML='<div class="dc" role="alertdialog"><p></p><button class="btn p" type="button"><span class="l"></span></button><button class="btn o" type="button"><span class="l">Отмена</span></button></div>';
 o.querySelector('p').textContent=a.dataset.confirm;o.querySelector('.p .l').textContent=a.dataset.t||a.querySelector('.l').textContent;
 o.querySelector('.p').onclick=function(){o.remove();a.dataset.ok='1';a.click();delete a.dataset.ok};o.querySelector('.o').onclick=function(){o.remove()};d.body.appendChild(o)}
d.addEventListener('click',function(e){var a=e.target.closest('[data-confirm]');if(!a||a.dataset.ok||a.disabled)return;e.stopImmediatePropagation();e.preventDefault();ask(a)},true);
d.addEventListener('click',function(e){var w=e.target.closest('.sw');if(w&&!w.disabled){var on=w.getAttribute('aria-checked')!=='true',c=d.querySelector('input[name=provider]:checked');
 emit('api',{call:on?w.dataset.api:w.dataset.off,body:on?{provider:c&&c.value}:{}});setState(on?'on':'default')}
 var p=e.target.closest('[data-pick]');if(p){emit('pick',{what:p.dataset.pick});if(pv)setData({fileName:'registration.pdf'})}});
d.addEventListener('change',function(e){var c=e.target.closest('.chips[data-filter]');if(!c)return;var v=e.target.value;d.querySelectorAll('[data-status]').forEach(function(r){r.hidden=v!=='all'&&r.dataset.status!==v})});
d.addEventListener('submit',function(e){e.preventDefault();var b=e.target.querySelector('.btn[data-api]');if(b&&!b.disabled)run(b)});
d.addEventListener('click',function(e){var g=e.target.closest('[data-go]');if(g){go(g.dataset.go,g.dataset.href);return}
 var a=e.target.closest('.btn[data-api]');if(a&&a.type!=='submit'&&!a.disabled)run(a)});
d.addEventListener('input',function(e){var w=e.target.closest('.f');if(w)w.classList.remove('bad')});
d.addEventListener('focusin',function(e){if(e.target.tagName==='INPUT')setTimeout(function(){e.target.scrollIntoView({block:'center',behavior:'smooth'})},300)});
setThemeMode(q.get('theme')||'auto');
var p=q.get('platform');if(p)setInsets(p==='ios'?47:24,p==='ios'?34:16);
var ins=q.get('insets');if(ins){var a=ins.split(',');setInsets(+a[0]||0,+a[1]||0)}
setState(q.get('state')||'default');
window.InOne={setThemeMode:setThemeMode,setInsets:setInsets,setState:setState,setData:setData};
})();
