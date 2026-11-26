/* 网页 App：注册离线支持，并提示用户把网站添加到手机主屏幕 */
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return; // 已经是从主屏幕打开的，不再提示
  var KEY = 'lz_a2hs_dismissed';
  try { if (Date.now() - Number(localStorage.getItem(KEY) || 0) < 14 * 86400000) return; } catch (e) {}
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|MicroMessenger|Instagram|FBAN|FBAV/.test(ua);
  var inWeChat = /MicroMessenger/.test(ua);
  var deferred = null;
  var en = function () { try { return localStorage.getItem('lz_lang') === 'en'; } catch (e) { return false; } };

  function banner(html, onAction) {
    if (document.getElementById('a2hs')) return;
    var el = document.createElement('div');
    el.id = 'a2hs';
    el.className = 'a2hs';
    el.innerHTML = '<img src="/icons/icon-192.png" alt=""><div class="a2hs-text">' + html + '</div>' +
      (onAction ? '<button type="button" class="a2hs-add">' + (en() ? 'Add' : '添加') + '</button>' : '') +
      '<button type="button" class="a2hs-close" aria-label="' + (en() ? 'Close' : '关闭') + '">×</button>';
    document.body.appendChild(el);
    el.querySelector('.a2hs-close').onclick = function () { el.remove(); try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} };
    if (onAction) el.querySelector('.a2hs-add').onclick = function () { onAction(el); };
  }

  // 安卓 Chrome 等：浏览器支持一键安装
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    setTimeout(function () {
      banner(en() ? '<strong>Get the Loading Zone app</strong><span>Add it to your home screen for shows and your member card.</span>'
                  : '<strong>把候场喜剧加到主屏幕</strong><span>像 App 一样一键打开演出和会员卡</span>',
        function (el) { el.remove(); deferred.prompt(); deferred.userChoice.finally(function () { deferred = null; }); });
    }, 6000);
  });

  // iPhone Safari：只能手动添加，给出步骤
  if (isSafari) {
    setTimeout(function () {
      banner(en() ? '<strong>Add Loading Zone to your home screen</strong><span>Tap <b>Share ⬆︎</b> below, then <b>Add to Home Screen</b>.</span>'
                  : '<strong>把候场喜剧加到主屏幕</strong><span>点下方 <b>分享 ⬆︎</b>，再选 <b>添加到主屏幕</b></span>');
    }, 8000);
  } else if (inWeChat && isIOS) {
    setTimeout(function () {
      banner(en() ? '<strong>Want the app version?</strong><span>Tap <b>···</b> → <b>Open in Safari</b>, then add to home screen.</span>'
                  : '<strong>想像 App 一样使用？</strong><span>点右上角 <b>···</b> → <b>在 Safari 中打开</b>，再添加到主屏幕</span>');
    }, 8000);
  }
})();
