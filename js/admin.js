/* 密码管理后台 · Supabase 版
   登录 = Supabase Auth 邮箱密码；数据 = RLS 行级权限（只有管理员账号能读写） */
(function () {
  'use strict';
  const C = window.APP_CONFIG;
  const SB = window.SB;
  const SB_ERROR = window.SB_ERROR || '';

  const state = { page: 0, size: 20, filter: 'all', search: '', total: 0, lastCodes: [], email: '' };
  const $ = (s) => document.querySelector(s);

  let tt = null;
  function toast(m) {
    const t = $('#toast'); t.textContent = m; t.classList.add('show');
    clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2200);
  }
  const fmt = (s) => !s ? '-' : String(s).replace('T', ' ').slice(0, 16);
  function showLogin(msg) {
    $('#admin-login').classList.remove('hidden');
    $('#admin-panel').classList.add('hidden');
    if (msg) $('#admin-err').textContent = msg;
  }
  function enterPanel(email) {
    state.email = email || '';
    const who = $('#admin-who');
    if (who) who.textContent = state.email;
    $('#admin-login').classList.add('hidden');
    $('#admin-panel').classList.remove('hidden');
    refresh();
  }

  /* ---------- 登录 ---------- */
  async function login(email, password, quiet) {
    if (!SB) throw new Error(SB_ERROR || '数据服务未就绪');
    const { data, error } = await SB.auth.signInWithPassword({ email: email, password: password });
    if (error || !data || !data.session) {
      throw new Error('登录失败：' + ((error && error.message) || '邮箱或密码不正确'));
    }
    // 服务端二次确认：这个账号是否被登记为管理员
    const chk = await SB.rpc('is_admin', {});
    if (chk.error || chk.data !== true) {
      await SB.auth.signOut();
      throw new Error('该账号不是本站点管理员');
    }
    enterPanel(email);
  }

  $('#btn-admin-login').addEventListener('click', () => {
    const e = $('#inp-admin-email').value.trim();
    const p = $('#inp-admin-pass').value;
    if (!e || !p) { $('#admin-err').textContent = '请填写邮箱和密码'; return; }
    $('#admin-err').textContent = '';
    const b = $('#btn-admin-login'); b.disabled = true; b.textContent = '登录中…';
    login(e, p, false).catch((err) => {
      showLogin(err.message);
    }).finally(() => { b.disabled = false; b.textContent = '登录'; });
  });
  ['#inp-admin-email', '#inp-admin-pass'].forEach((s) => {
    $(s).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('#btn-admin-login').click(); });
  });

  /* ---------- 统计 ---------- */
  function beijingTodayStart() {
    // 服务端 created_at 是 UTC；用北京时间当天的 00:00 换算成 UTC 再去比
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    const ymd = d.toISOString().slice(0, 10);
    return new Date(ymd + 'T00:00:00+08:00').toISOString();
  }
  const lc = (fn) => {
    let q = SB.from('licenses').select('*', { count: 'exact', head: true });
    return fn ? fn(q) : q;
  };

  async function loadStats() {
    const rs = await Promise.all([
      lc(),
      lc((q) => q.eq('used_count', 0).eq('status', 'active')),
      lc((q) => q.eq('is_exhausted', true)),
      SB.from('results').select('*', { count: 'exact', head: true }),
      SB.from('results').select('*', { count: 'exact', head: true }).gte('created_at', beijingTodayStart()),
    ]);
    const bad = rs.filter((r) => r.error);
    if (bad.length) throw new Error(bad[0].error.message || '统计加载失败');
    const n = rs.map((r) => r.count || 0);
    $('#stats').innerHTML =
      stat(n[0], '密码总数') + stat(n[1], '未使用') + stat(n[2], '已用完') +
      stat(n[3], '完成测评') + stat(n[4], '今日测评');
  }
  const stat = (n, label) => '<div class="stat"><b>' + (n || 0) + '</b><span>' + label + '</span></div>';

  async function refresh() {
    try { await loadStats(); } catch (e) { toast('统计加载失败：' + e.message); }
    await loadCodes();
  }

  /* ---------- 密码列表 ---------- */
  async function loadCodes() {
    try {
      let q = SB.from('licenses').select('*', { count: 'exact' });
      const f = state.search.trim() ? 'search' : state.filter;
      if (f === 'unused') q = q.eq('used_count', 0);
      else if (f === 'used') q = q.gt('used_count', 0);
      else if (f === 'exhausted') q = q.eq('is_exhausted', true);
      else if (f === 'disabled') q = q.eq('status', 'disabled');
      else if (f === 'search') {
        const t = state.search.trim().replace(/["(),\\%]/g, '');
        if (t) q = q.or('code.ilike."%' + t + '%",note.ilike."%' + t + '%"');
      }
      q = q.order('created_at', { ascending: false }).order('id', { ascending: false })
           .range(state.page * state.size, (state.page + 1) * state.size - 1);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message || '列表加载失败');
      state.total = count || 0;
      const rows = data || [];
      $('#code-rows').innerHTML = rows.length ? rows.map((c) =>
        '<tr>' +
        '<td class="code">' + c.code + '</td>' +
        '<td>' + c.used_count + ' / ' + c.max_uses + '</td>' +
        '<td>' + pill(c) + '</td>' +
        '<td style="white-space:normal;color:#7b8496">' + (c.note || '-') + '</td>' +
        '<td style="color:#7b8496">' + fmt(c.last_used_at) + '</td>' +
        '<td>' +
          '<button class="mini" data-act="reset" data-code="' + c.code + '">重置</button>' +
          '<button class="mini" data-act="toggle" data-code="' + c.code + '" data-status="' + c.status + '">' +
            (c.status === 'disabled' ? '启用' : '停用') + '</button>' +
        '</td></tr>').join('')
        : '<tr><td colspan="6" style="text-align:center;color:#7b8496;padding:22px">暂无数据</td></tr>';
      const maxPage = Math.max(0, Math.ceil(state.total / state.size) - 1);
      $('#p-info').textContent = '第 ' + (state.page + 1) + ' / ' + (maxPage + 1) + ' 页 · 共 ' + state.total + ' 条';
      $('#p-prev').disabled = state.page === 0;
      $('#p-next').disabled = state.page >= maxPage;
    } catch (e) { toast('列表加载失败：' + e.message); }
  }

  function pill(c) {
    if (c.status === 'disabled') return '<span class="pill disabled">已停用</span>';
    if (c.is_exhausted || c.used_count >= c.max_uses) return '<span class="pill full">已用完</span>';
    return '<span class="pill active">可用</span>';
  }

  $('#code-rows').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const code = b.getAttribute('data-code');
    try {
      let r;
      if (b.getAttribute('data-act') === 'reset') {
        r = await SB.from('licenses').update({ used_count: 0, last_used_at: null })
          .eq('code', code).select('code');
        if (!r.error && r.data && r.data.length) toast('已重置 ' + code + ' 的使用次数');
      } else {
        const next = b.getAttribute('data-status') === 'disabled' ? 'active' : 'disabled';
        r = await SB.from('licenses').update({ status: next }).eq('code', code).select('code');
        if (!r.error && r.data && r.data.length) toast(next === 'active' ? '已启用 ' + code : '已停用 ' + code);
      }
      if (r.error || !r.data || !r.data.length) { toast('操作失败：无权限或密码不存在'); return; }
      refresh();
    } catch (err) { toast('操作失败：' + err.message); }
  });

  $('#btn-search').addEventListener('click', () => { state.search = $('#f-search').value; state.page = 0; loadCodes(); });
  $('#f-filter').addEventListener('change', () => {
    state.filter = $('#f-filter').value; state.search = ''; $('#f-search').value = '';
    state.page = 0; loadCodes();
  });
  $('#p-prev').addEventListener('click', () => { if (state.page > 0) { state.page--; loadCodes(); } });
  $('#p-next').addEventListener('click', () => { state.page++; loadCodes(); });

  /* ---------- 生成密码 ---------- */
  function randCode(n) {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    if (window.crypto && window.crypto.getRandomValues) {
      const buf = new Uint32Array(n);
      window.crypto.getRandomValues(buf);
      for (let i = 0; i < n; i++) out += a[buf[i] % a.length];
    } else {
      for (let i = 0; i < n; i++) out += a[Math.floor(Math.random() * a.length)];
    }
    return out;
  }

  $('#btn-gen').addEventListener('click', async () => {
    const n = Math.min(500, Math.max(1, parseInt($('#gen-count').value, 10) || 10));
    const u = Math.min(20, Math.max(1, parseInt($('#gen-uses').value, 10) || 3));
    const note = $('#gen-note').value.trim();
    const btn = $('#btn-gen');
    btn.disabled = true; btn.textContent = '生成中…';
    try {
      let codes = null, lastErr = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const rows = [];
        for (let i = 0; i < n; i++) rows.push({ code: randCode(8), max_uses: u, note: note || null });
        const r = await SB.from('licenses').insert(rows).select('code');
        if (!r.error && r.data) { codes = r.data.map((x) => x.code); break; }
        lastErr = r.error;
        if (!r.error || r.error.code !== '23505') break;   // 只有编码撞车才重试
      }
      if (!codes) throw new Error((lastErr && lastErr.message) || '生成失败，请确认已登录且 RLS 配置正确');
      state.lastCodes = codes;
      $('#gen-out').textContent = codes.join('\n');
      $('#gen-out').classList.remove('hidden');
      $('#gen-acts').classList.remove('hidden');
      toast('已生成 ' + codes.length + ' 个密码');
      refresh();
    } catch (e) { toast('生成失败：' + e.message); }
    btn.disabled = false; btn.textContent = '生成';
  });

  function copy(text, okMsg) {
    const done = () => toast(okMsg);
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? done() : toast('复制失败'); } catch (e) { toast('复制失败'); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
  }

  $('#btn-copy-codes').addEventListener('click', () => copy(state.lastCodes.join('\n'), '已复制全部密码'));
  $('#btn-copy-lines').addEventListener('click', () => {
    const base = location.origin + location.pathname.replace(/admin\.html$/, '') + 'index.html';
    copy(state.lastCodes.map((c) => c + '　（测评入口：' + base + '）').join('\n'), '已复制（含入口链接）');
  });
  $('#btn-download-codes').addEventListener('click', () => {
    const blob = new Blob([state.lastCodes.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '测试密码_' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });

  /* ---------- 改登录密码 / 退出 ---------- */
  $('#btn-set-key').addEventListener('click', async () => {
    const nk = $('#new-key').value.trim();
    if (nk.length < 8) { toast('新密码至少 8 位，建议含大小写字母和数字'); return; }
    const btn = $('#btn-set-key'); btn.disabled = true;
    const { error } = await SB.auth.updateUser({ password: nk });
    btn.disabled = false;
    if (error) { toast('修改失败：' + error.message); return; }
    $('#new-key').value = '';
    toast('登录密码已更新，下次请用新密码登录');
  });
  $('#btn-logout').addEventListener('click', async () => {
    try { await SB.auth.signOut(); } catch (e) {}
    $('#admin-panel').classList.add('hidden');
    showLogin('');
  });

  /* ---------- 启动：恢复已有会话 ---------- */
  (async function boot() {
    if (!SB) { showLogin(SB_ERROR || '数据服务未就绪'); return; }
    try {
      const { data } = await SB.auth.getSession();
      if (data && data.session) {
        const chk = await SB.rpc('is_admin', {});
        if (chk.data === true) { enterPanel(data.session.user.email || ''); return; }
        await SB.auth.signOut();
      }
    } catch (e) { console.warn(e); }
    showLogin('');
  })();
})();
