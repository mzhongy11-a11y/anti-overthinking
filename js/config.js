/* 站点设置 + Supabase 客户端初始化
   密钥在 js/env.js；本文件只放业务开关和文案。 */
(function () {
  'use strict';

  window.APP_CONFIG = {
    // 每个密码的默认可测次数（后台生成时可单独指定，这里仅用于文案展示）
    defaultMaxUses: 3,
    // 同一设备已验证过的密码是否复用（false = 刷新页面需重新输入密码，会再消耗 1 次）
    rememberLicense: true,
    // 点击「再测一次」是否再次消耗次数
    consumeOnRetest: false,

    // 好评有礼弹窗文案
    gift: {
      title: '好评有礼 🎁',
      lines: [
        '感谢你的支持！完成以下两步即可领取 <b>1 元返现</b>：',
        '1. 在店铺对本商品给出<b>五星好评</b>（带图/带文字更好）',
        '2. 截图好评页面，<b>联系客服发送截图</b>',
      ],
      tail: '客服核对通过后，1 元返现会直接打到你下单的账户，通常 24 小时内到账。',
      tip: '小提示：截图里带上订单号会更快哦～',
    },
  };

  /* ---------- Supabase ---------- */
  var url = (window.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  var key = (window.SUPABASE_ANON_KEY || '').trim();
  window.SB = null;
  window.SB_ERROR = '';

  if (!window.supabase || !window.supabase.createClient) {
    window.SB_ERROR = 'Supabase 组件加载失败，请刷新页面重试';
  } else if (!url || !key || !/^https:\/\//i.test(url)) {
    window.SB_ERROR = '站点尚未配置 Supabase 连接信息';
  } else {
    try {
      /* 新版 publishable / secret key 不是 JWT。
         supabase-js 默认会把它同时塞进 Authorization: Bearer <key>，
         网关按 JWT 解析时可能报 "Invalid JWT"。
         这里把「值是 API key 本身」的 Bearer 头去掉，只保留 apikey 头；
         管理员登录后 Authorization 是用户 JWT，不受影响。 */
      var rawFetch = window.fetch ? window.fetch.bind(window) : null;
      var safeFetch = function (input, init) {
        if (!rawFetch) return Promise.reject(new Error('浏览器不支持 fetch'));
        init = init || {};
        try {
          var headers = new Headers(init.headers || {});
          var auth = headers.get('authorization') || '';
          if (/^Bearer\s+sb_(publishable|secret)_/i.test(auth)) {
            if (!headers.get('apikey')) headers.set('apikey', key);
            headers.delete('authorization');
            init = Object.assign({}, init, { headers: headers });
          }
        } catch (e) { /* 请求头构造成非标准对象时保持原样 */ }
        return rawFetch(input, init);
      };

      window.SB = window.supabase.createClient(url, key, {
        global: { fetch: safeFetch },
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      });
    } catch (e) {
      window.SB_ERROR = 'Supabase 初始化失败：' + (e && e.message ? e.message : String(e));
      console.error(e);
    }
  }

  /* 配置缺失时给出醒目提示，避免白屏无反馈 */
  if (window.SB_ERROR) {
    var show = function () {
      if (document.getElementById('__setup_tip')) return;
      var box = document.createElement('div');
      box.id = '__setup_tip';
      box.setAttribute('style', [
        'position:fixed', 'z-index:99999', 'left:12px', 'right:12px', 'top:12px',
        'padding:14px 16px', 'border-radius:12px', 'background:#fff4e5',
        'border:1px solid #f0c987', 'color:#8a5a00', 'font-size:13.5px',
        'line-height:1.7', 'box-shadow:0 8px 30px rgba(0,0,0,.12)', 'text-align:left',
      ].join(';'));
      box.innerHTML = '<b>⚠️ 还没连上数据库："' + window.SB_ERROR + '"</b><br>' +
        '如果你是站长：请打开项目里的 <b>部署指南.html</b>，按第 3～6 步创建 Supabase 项目并生成 <b>js/env.js</b> 覆盖一下即可。' +
        '<br>如果你是买家：请联系客服，站点尚未完成配置。';
      document.body.appendChild(box);
    };
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show);
  }
})();
