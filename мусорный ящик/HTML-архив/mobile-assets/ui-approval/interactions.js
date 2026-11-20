// Общие взаимодействия. Мост Flutter: window.InOneBridge.postMessage(JSON) (webview_flutter JavaScriptChannel "InOneBridge").
(function(){var q=new URLSearchParams(location.search);var th=q.get('theme')||localStorage.getItem('inone-theme')||'light';
function setTheme(t){document.documentElement.dataset.theme=t;try{localStorage.setItem('inone-theme',t)}catch(e){}}setTheme(th);
var tl=document.createElement('div');tl.className='tools';tl.innerHTML='<button id=tl>Светлая</button><button id=td>Тёмная</button>';document.body.appendChild(tl);
tl.querySelector('#tl').onclick=function(){setTheme('light')};tl.querySelector('#td').onclick=function(){setTheme('dark')};
function emit(type,data){var m=JSON.stringify({type:type,data:data||{}});if(window.InOneBridge)InOneBridge.postMessage(m);else console.log('[bridge]',m)}
document.addEventListener('click',function(e){var g=e.target.closest('[data-go]');if(g){emit('navigate',{screen:g.dataset.go});if(!window.InOneBridge)location.href=g.dataset.href||'#'}
var a=e.target.closest('[data-api]');if(a){var f=a.closest('[data-form]'),b={},ok=true;
if(f)f.querySelectorAll('input').forEach(function(i){b[i.name]=i.value;if(i.required&&!i.value){ok=false;i.style.borderColor='var(--danger)'}});
var er=f&&f.querySelector('.err');if(!ok){if(er){er.textContent='Заполните обязательные поля';er.classList.add('on')}return}
if(er)er.classList.remove('on');emit('api',{call:a.dataset.api,body:b})}});
window.InOne={emit:emit,setTheme:setTheme};
// Flutter может вернуть ошибку: InOne.showError('Неверный пароль')
window.InOne.showError=function(t){var e=document.querySelector('.err');if(e){e.textContent=t;e.classList.add('on')}}})();
