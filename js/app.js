/* 反内耗指数测试 · 主流程 */
(function () {
  'use strict';

  const D = window.QUIZ_DATA;
  const C = window.APP_CONFIG;
  const LS_KEY = 'ao_license_v1';

  /* ---------- 数据服务（Supabase，由 js/config.js 初始化） ---------- */
  const SB = window.SB;
  const SB_ERROR = window.SB_ERROR || '';

  const state = {
    answers: {},      // { QID: 1..5 }
    idx: 0,
    code: null,
    remaining: null,
    result: null,
    shareId: null,
    saving: false,
  };

  /* ---------- 小工具 ---------- */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function show(screen) {
    ['#screen-gate', '#screen-quiz', '#screen-result'].forEach((s) => $(s).classList.add('hidden'));
    $(screen).classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  function openModal(id) { $(id).classList.remove('hidden'); }
  function closeModal(id) { $(id).classList.add('hidden'); }

  $$('[data-close]').forEach((el) => el.addEventListener('click', (e) => {
    const m = e.target.closest('.modal');
    if (m) m.classList.add('hidden');
  }));

  function randId(n) {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  /* ---------- 1. 密码验证 ---------- */
  async function verifyCode(code, isRetest) {
    if (!SB) { $('#gate-err').textContent = SB_ERROR || '数据服务未就绪，请刷新页面重试'; return false; }
    const { data, error } = await SB.rpc('consume_license', { p_code: code });
    if (error) {
      toast('验证失败：' + (error.message || '网络异常，请稍后重试'));
      return false;
    }
    const r = data || {};
    if (!r.ok) {
      $('#gate-err').textContent = r.message || '密码无效';
      return false;
    }
    state.code = code.toUpperCase();
    state.remaining = r.remaining;
    if (!isRetest && C.rememberLicense) {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ code: state.code, remaining: r.remaining })); } catch (e) {}
    }
    return true;
  }

  $('#btn-verify').addEventListener('click', async () => {
    const code = ($('#inp-code').value || '').trim();
    if (!code) { $('#gate-err').textContent = '请输入密码'; return; }
    const btn = $('#btn-verify');
    btn.disabled = true; btn.textContent = '验证中…';
    $('#gate-err').textContent = '';
    const ok = await verifyCode(code, false);
    btn.disabled = false; btn.textContent = '验证并开始测试';
    if (!ok) return;
    toast('验证通过，本密码剩余 ' + state.remaining + ' 次');
    startQuiz();
  });
  $('#inp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-verify').click(); });

  /* ---------- 2. 答题 ---------- */
  function startQuiz() {
    state.answers = {};
    state.idx = 0;
    state.result = null;
    state.shareId = null;
    renderQuestion();
    show('#screen-quiz');
  }

  function renderQuestion() {
    if (state.idx < 0) state.idx = 0;
    if (state.idx > D.ORDER.length - 1) state.idx = D.ORDER.length - 1;
    const qid = D.ORDER[state.idx];
    const q = D.QUESTIONS[qid];
    if (!q) return;
    const dim = D.DIMS.filter((d) => d.key === q.dim)[0];
    $('#q-idx').textContent = state.idx + 1;
    $('#q-bar').style.width = Math.max(3, Math.round(((state.idx + 1) / D.ORDER.length) * 100)) + '%';
    $('#q-dimtag').textContent = '第 ' + (state.idx + 1) + ' 题';
    $('#q-text').textContent = q.text;
    $('#q-hint').textContent = state.answers[qid] ? '已选，可修改' : '请选择最符合你的一项';

    const box = $('#q-opts');
    box.innerHTML = '';
    D.OPTIONS.slice().reverse().forEach((o) => {
      const b = document.createElement('button');
      b.className = 'opt' + (state.answers[qid] === o.v ? ' on' : '');
      b.innerHTML = '<span class="dot"></span><span>' + o.label + '</span>';
      b.addEventListener('click', () => {
        state.answers[qid] = o.v;
        renderQuestion();
        const atIdx = state.idx;
        if (atIdx < D.ORDER.length - 1) {
          // 手动点「下一题」与自动跳题存在竞态：只有仍停留在同一题时才自动前进
          setTimeout(() => {
            if (state.idx === atIdx && atIdx < D.ORDER.length - 1) { state.idx++; renderQuestion(); }
          }, 180);
        }
      });
      box.appendChild(b);
    });

    $('#btn-prev').disabled = state.idx === 0;
    $('#btn-next').textContent = state.idx === D.ORDER.length - 1 ? '查看结果' : '下一题';
    $('#btn-next').disabled = !state.answers[qid];
  }

  $('#btn-prev').addEventListener('click', () => {
    if (state.idx > 0) { state.idx--; renderQuestion(); }
  });
  $('#btn-next').addEventListener('click', () => {
    const qid = D.ORDER[state.idx];
    if (!state.answers[qid]) { toast('请选择一项后再继续'); return; }
    if (state.idx < D.ORDER.length - 1) { state.idx++; renderQuestion(); return; }
    finish();
  });

  /* ---------- 3. 计分 ---------- */
  function score() {
    const raw = { r: 0, p: 0, o: 0, d: 0, m: 0, s: 0 };
    D.ORDER.forEach((qid) => {
      const q = D.QUESTIONS[qid];
      const v = state.answers[qid];
      raw[q.dim] += q.reverse ? (6 - v) : v;
    });
    const cost = {};   // 内耗指向分，5–25，越高越耗
    let total = 0;
    D.DIMS.forEach((d) => {
      cost[d.key] = d.positive ? raw[d.key] : (30 - raw[d.key]);
      total += cost[d.key];
    });
    const indexScore = Math.round(((150 - total) / 120) * 100);

    const level = D.LEVELS.filter((l) => total >= l.min && total <= l.max)[0] || D.LEVELS[2];

    // 主导类型
    const keys = ['r', 'p', 'o', 'd', 'm', 's'];
    const sorted = keys.slice().sort((a, b) => cost[b] - cost[a]);
    const top2 = sorted.slice(0, 2).sort().join('');
    let typeKey;
    if (total <= 54 && keys.every((k) => cost[k] < 18)) {
      typeKey = 'calm';
    } else if (cost.o >= 18 && cost.s >= 18 && Math.abs(cost.o - cost.s) <= 3 && top2 === 'os') {
      typeKey = 'hurt';
    } else if (cost.r >= 18 && cost.d >= 18 && Math.abs(cost.r - cost.d) <= 3 && top2 === 'dr') {
      typeKey = 'loop';
    } else {
      const prio = ['o', 's', 'r', 'd', 'p', 'm'];
      const maxv = Math.max.apply(null, keys.map((k) => cost[k]));
      const tied = prio.filter((k) => cost[k] === maxv);
      const pick = tied.length ? tied[0] : sorted[0];
      typeKey = { r: 'replay', p: 'perfect', o: 'radar', d: 'maze', m: 'director', s: 'judge' }[pick];
    }

    return { raw: raw, cost: cost, total: total, indexScore: indexScore, level: level, typeKey: typeKey };
  }

  /* ---------- 4. 雷达图 ---------- */
  function radarSVG(cost) {
    const N = 6, CX = 150, CY = 150, R = 98, MAX = 25;
    const labels = ['反刍重播', '完美苛责', '他人目光', '决策纠结', '当下锚定*', '自我友善*'];
    const keys = ['r', 'p', 'o', 'd', 'm', 's'];
    const pt = (i, ratio) => {
      const a = (-90 + i * (360 / N)) * Math.PI / 180;
      return [CX + Math.cos(a) * R * ratio, CY + Math.sin(a) * R * ratio];
    };
    let g = '';
    [0.25, 0.5, 0.75, 1].forEach((r) => {
      const p = [];
      for (let i = 0; i < N; i++) p.push(pt(i, r).map((n) => n.toFixed(1)).join(','));
      g += '<polygon points="' + p.join(' ') + '" fill="none" stroke="#e2e7f0" stroke-width="1"/>';
    });
    for (let i = 0; i < N; i++) {
      const e = pt(i, 1);
      g += '<line x1="' + CX + '" y1="' + CY + '" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '" stroke="#e2e7f0" stroke-width="1"/>';
    }
    const pts = keys.map((k, i) => pt(i, Math.max(cost[k], 0) / MAX));
    const poly = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    g += '<polygon points="' + poly + '" fill="rgba(74,108,247,.18)" stroke="#4a6cf7" stroke-width="2" stroke-linejoin="round"/>';
    pts.forEach((p) => {
      g += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" fill="#4a6cf7"/>';
    });
    for (let i = 0; i < N; i++) {
      const lp = pt(i, 1.24);
      const anchor = Math.abs(lp[0] - CX) < 6 ? 'middle' : (lp[0] > CX ? 'start' : 'end');
      g += '<text x="' + lp[0].toFixed(1) + '" y="' + (lp[1] + 4).toFixed(1) + '" font-size="11" fill="#7b8496" text-anchor="' + anchor + '">' + labels[i] + '</text>';
    }
    return '<svg width="300" height="300" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">' + g + '</svg>';
  }

  /* ---------- 5. 结果渲染 ---------- */
  function renderResult(res, isShare) {
    const t = D.TYPES[res.typeKey];
    const lv = res.level;

    $('#r-index').textContent = res.indexScore;
    $('#r-level').innerHTML = lv.emoji + ' ' + lv.badge + ' 级 · ' + lv.name;
    $('#r-emoji').textContent = t.emoji;
    $('#r-type').textContent = t.name;
    $('#r-tagline').textContent = t.tagline;
    $('#r-quote').textContent = '「' + t.quote + '」';

    $('#radar').innerHTML = radarSVG(res.cost);

    const list = $('#dim-list');
    list.innerHTML = '';
    D.DIMS.forEach((d) => {
      const v = res.cost[d.key];
      const talk = D.DIM_TALK[d.key];
      const isHigh = v >= 18, isLow = v <= 12;
      const line = isHigh ? talk.high : (isLow ? talk.low : '处于中间地带，平时还行，压力一大就会被触发。');
      const cls = isHigh ? 'hi' : (isLow ? 'lo' : '');
      const div = document.createElement('div');
      div.className = 'dim-item';
      div.innerHTML =
        '<div class="h"><span>' + d.name + (d.positive ? '' : '　<small style="color:#7b8496;font-weight:400">（越低越耗）</small>') + '</span>' +
        '<span class="sc ' + cls + '">' + v + ' / 25</span></div>' +
        '<div class="t">' + line + '</div>' +
        '<div class="f">→ ' + talk.fix + '</div>';
      list.appendChild(div);
    });
    list.insertAdjacentHTML('beforeend',
      '<div style="font-size:11.5px;color:#7b8496;margin-top:8px;line-height:1.6">* 六轴显示的是「内耗指向分」，分数越高代表这一项越耗电。「当下锚定」「自我友善」两轴为反向维度，因而显示的是其<b>缺失程度</b>。</div>');

    $('#r-theory').innerHTML = t.theory.map((p) => '<p>' + p + '</p>').join('') +
      '<p style="border-left:3px solid #4a6cf7;padding-left:12px;color:#1b1f27"><b>' + t.why + '</b></p>';
    $('#r-steps').innerHTML = t.steps.map((s) => '<li>' + s + '</li>').join('');
    $('#r-spell').textContent = t.spell;

    $('#share-banner').classList.toggle('hidden', !isShare);
    show('#screen-result');

    if (!isShare) saveResult(res);   // 后台静默保存，供复制链接使用
  }

  async function finish() {
    const res = score();
    state.result = res;
    renderResult(res, false);
  }

  /* ---------- 6. 保存结果到云端（供分享链接） ---------- */
  async function saveResult(res) {
    if (!SB || state.saving) return;
    state.saving = true;
    const shareId = randId(10);
    try {
      // 只写不读：results 表对游客只开放 INSERT，读取必须走 get_result(分享码)
      const { error } = await SB.from('results').insert({
        share_id: shareId,
        answers: state.answers,
        total_score: res.total,
        index_score: res.indexScore,
        level_key: res.level.key,
        type_key: res.typeKey,
        dims: res.cost,
      });
      if (error) { console.error(error); state.saving = false; return; }
      state.shareId = shareId;
    } catch (e) {
      console.error(e);
    }
    state.saving = false;
  }

  async function ensureSaved() {
    if (state.shareId) return state.shareId;
    if (!state.result) return null;
    await saveResult(state.result);
    return state.shareId;
  }

  function shareUrl(id) {
    const base = location.origin + location.pathname;
    return base + '?r=' + encodeURIComponent(id);
  }

  $('#btn-copy').addEventListener('click', async () => {
    if (!state.result) return;
    const btn = $('#btn-copy');
    btn.disabled = true; btn.textContent = '生成中…';
    const id = await ensureSaved();
    btn.disabled = false; btn.textContent = '🔗 复制结果链接';
    if (!id) { toast('分享链接生成失败，请检查网络后重试'); return; }
    const url = shareUrl(id);
    const text = '我的反内耗指数是 ' + state.result.indexScore + ' 分，内耗人格是「' + D.TYPES[state.result.typeKey].name + '」。你也来测测：' + url;
    copyText(text).then(() => toast('结果链接已复制，去分享给朋友吧'))
      .catch(() => { toast('复制失败，请长按地址栏手动复制'); });
  });

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  /* ---------- 7. 保存长图 ---------- */
  let lastDataUrl = null;
  const isMobile = /iPhone|iPad|iPod|Android|HarmonyOS/i.test(navigator.userAgent);

  $('#btn-save').addEventListener('click', async () => {
    const btn = $('#btn-save');
    btn.disabled = true; btn.textContent = '正在生成长图…';
    try {
      const node = $('#capture');
      const canvas = await html2canvas(node, {
        scale: Math.min(2, window.devicePixelRatio * 1.5),
        backgroundColor: '#f4f6fa',
        useCORS: true,
        logging: false,
        windowWidth: node.scrollWidth,
      });
      lastDataUrl = canvas.toDataURL('image/png');
      $('#save-box').innerHTML = '<img src="' + lastDataUrl + '" alt="测评结果">';
      $('#save-hint').innerHTML = isMobile
        ? '<b>长按上方图片</b> → 选择「保存图片」即可存入相册'
        : '点击下方按钮，把结果长图保存到本机';
      openModal('#modal-save');
      if (!isMobile) setTimeout(() => $('#btn-download').click(), 300);
    } catch (e) {
      console.error(e);
      toast('生成图片失败，可改用「复制结果链接」分享');
    }
    btn.disabled = false; btn.textContent = '💾 保存结果长图';
  });

  $('#btn-download').addEventListener('click', () => {
    if (!lastDataUrl) return;
    const a = document.createElement('a');
    a.href = lastDataUrl;
    a.download = '反内耗指数测试_我的结果.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('已保存到本机');
  });

  /* ---------- 8. 再测一次 / 好评有礼 ---------- */
  $('#btn-retest').addEventListener('click', async () => {
    if (C.consumeOnRetest && state.code) {
      const ok = await verifyCode(state.code, true);
      if (!ok) { show('#screen-gate'); return; }
    }
    startQuiz();
    toast('已重置，请重新作答');
  });

  $('#btn-gift').addEventListener('click', () => {
    const g = C.gift;
    $('#gift-title').textContent = g.title;
    $('#gift-lines').innerHTML = g.lines.map((l) => '<p>' + l + '</p>').join('');
    $('#gift-tail').innerHTML = g.tail + '<br><span style="color:#c47a12">' + g.tip + '</span>';
    openModal('#modal-gift');
  });

  /* ---------- 9. 分享链接打开 ---------- */
  async function loadShared(id) {
    if (!SB) { toast(SB_ERROR || '数据服务未就绪'); return false; }
    const { data, error } = await SB.rpc('get_result', { p_share_id: id });
    if (error || !data) { toast('未找到该结果，链接可能已失效'); return false; }
    state.answers = data.answers || {};
    const res = {
      raw: {}, cost: data.dims,
      total: data.total_score, indexScore: data.index_score,
      level: D.LEVELS.filter((l) => l.key === data.level_key)[0] || D.LEVELS[2],
      typeKey: data.type_key,
    };
    state.result = res;
    renderResult(res, true);
    return true;
  }

  /* ---------- 启动 ---------- */
  (async function boot() {
    const m = /[?&]r=([^&]+)/.exec(location.search);
    if (m) { await loadShared(decodeURIComponent(m[1])); return; }

    if (C.rememberLicense) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}
      if (saved && saved.code) {
        state.code = saved.code;
        state.remaining = saved.remaining;
        toast('本设备已验证密码' + (saved.remaining != null ? '，剩余 ' + saved.remaining + ' 次' : ''));
        startQuiz();
        return;
      }
    }
    show('#screen-gate');
  })();
})();
