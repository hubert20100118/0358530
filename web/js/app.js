/* 订餐小程序 Web 端主逻辑 */
(function () {
  'use strict';
  // Store.init() 在底部启动处统一调用（异步拉取服务端数据）

  // ---------- 全局状态 ----------
  var cart = {};            // { dishId: qty }
  var activeCat = '全部';
  var adminVerified = false;
  var editingDishId = null;
  var editingImage = '';

  // ---------- 工具 ----------
  function $(s) { return document.querySelector(s); }
  function $all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '¥' + (Number(n) || 0).toFixed(2).replace(/\.00$/, ''); }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  function fmtDate(iso) {
    var d = new Date(iso); var p = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function todayStr() {
    var d = new Date(); var p = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function futureDates(n) {
    var arr = [], d = new Date();
    for (var i = 0; i < n; i++) {
      var x = new Date(d.getTime() + i * 86400000);
      var p = function (m) { return m < 10 ? '0' + m : m; };
      arr.push({ value: x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()),
        label: (i === 0 ? '今天' : i === 1 ? '明天' : ['周日','周一','周二','周三','周四','周五','周六'][x.getDay()]) });
    }
    return arr;
  }
  function statusText(s) { return { pending: '待处理', done: '已完成', cancelled: '已取消' }[s] || s; }

  // ---------- 顶部栏 ----------
  function refreshTop() {
    var s = Store.getSettings();
    $('#shopName').textContent = s.shopName || '订餐小程序';
    document.title = (s.shopName || '订餐小程序') + ' · 订餐';
    var u = Store.getSession();
    if (u) {
      $('#userLine').textContent = '你好，' + u.name + '（' + u.phone + '）';
      $('#loginBtn').style.display = 'none';
      $('#logoutBtn').style.display = '';
    } else {
      $('#userLine').textContent = '未登录 · 仅白名单可注册';
      $('#loginBtn').style.display = '';
      $('#logoutBtn').style.display = 'none';
    }
  }

  // ---------- 导航 ----------
  function switchView(name) {
    $all('.view').forEach(function (v) { v.classList.remove('active'); });
    $('#view-' + name).classList.add('active');
    $all('.tabbar button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    if (name === 'my') { Store.refreshMine().then(renderMy); }
    if (name === 'admin') { Store.refreshAdmin().then(renderAdminIfReady); }
  }

  // ---------- 菜单/点餐 ----------
  function renderCats() {
    var cats = ['全部'].concat(Store.getCategories());
    if (cats.indexOf(activeCat) < 0) activeCat = '全部';
    $('#catBar').innerHTML = cats.map(function (c) {
      return '<button class="cat-chip ' + (c === activeCat ? 'active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
  }
  function renderDishes() {
    var menu = Store.getMenu();
    var list = activeCat === '全部' ? menu : menu.filter(function (d) { return d.category === activeCat; });
    if (!list.length) { $('#dishList').innerHTML = '<div class="empty">该分类暂无菜品</div>'; return; }
    $('#dishList').innerHTML = list.map(function (d) {
      var q = cart[d.id] || 0;
      return '<div class="dish ' + (d.available ? '' : 'off') + '">' +
        '<div class="media">' + (d.image ? '<img src="' + esc(d.image) + '">' : esc(d.emoji || '🍽️')) + '</div>' +
        '<div class="info"><div class="name">' + esc(d.name) + (d.available ? '' : ' <span class="pill">售罄</span>') + '</div>' +
        '<div class="desc">' + esc(d.desc || '') + '</div>' +
        '<div class="price">' + money(d.price) + '</div></div>' +
        '<div class="step">' +
          '<button data-act="dec" data-id="' + d.id + '">−</button>' +
          '<span class="qty">' + q + '</span>' +
          '<button data-act="inc" data-id="' + d.id + '" ' + (d.available ? '' : 'disabled style="opacity:.4"') + '>+</button>' +
        '</div></div>';
    }).join('');
  }
  function refreshCart() {
    var total = 0, count = 0;
    Object.keys(cart).forEach(function (id) {
      var d = Store.getMenu().filter(function (x) { return x.id === id; })[0];
      if (d) { total += d.price * cart[id]; count += cart[id]; }
    });
    $('#cartTotal').textContent = money(total);
    $('#cartCount').textContent = count + ' 件';
    $('#cartbar').classList.toggle('show', count > 0);
  }

  // ---------- 结算 ----------
  var selDate = '', selSlot = '';
  function openOrder() {
    var u = Store.getSession();
    if (!u) { openAuth('login'); toast('请先登录'); return; }
    if (!Object.keys(cart).length) { toast('请先选择菜品'); return; }
    var s = Store.getSettings();
    selDate = todayStr(); selSlot = s.slots[0] || '';
    var dates = futureDates(7);
    $('#orderDate').value = selDate;
    $('#orderDate').min = todayStr();
    $('#orderDate').max = dates[dates.length - 1].value;
    $('#orderSlots').innerHTML = s.slots.map(function (sl) {
      return '<button class="slot ' + (sl === selSlot ? 'active' : '') + '" data-slot="' + esc(sl) + '">' + esc(sl) + '</button>';
    }).join('');
    // 汇总
    var rows = '', total = 0;
    Object.keys(cart).forEach(function (id) {
      var d = Store.getMenu().filter(function (x) { return x.id === id; })[0];
      if (!d) return;
      rows += '<div class="bar-row"><span class="name">' + esc(d.name) + '</span><span class="val">x' + cart[id] + '</span><span class="val">' + money(d.price * cart[id]) + '</span></div>';
      total += d.price * cart[id];
    });
    $('#orderSummary').innerHTML = rows + '<div class="row" style="margin-top:6px;font-weight:700"><span>合计</span><span class="amt" style="color:var(--primary)">' + money(total) + '</span></div>';
    $('#orderNote').value = '';
    $('#orderMask').classList.add('show');
  }
  function submitOrder() {
    if (!selDate || !selSlot) { toast('请选择取餐日期和时段'); return; }
    var u = Store.getSession();
    var items = [], total = 0;
    Object.keys(cart).forEach(function (id) {
      var d = Store.getMenu().filter(function (x) { return x.id === id; })[0];
      if (!d) return;
      items.push({ dishId: d.id, name: d.name, price: d.price, qty: cart[id] });
      total += d.price * cart[id];
    });
    if (!items.length) { toast('购物车为空'); return; }
    Store.addOrder({ userId: u.id, userName: u.name, items: items, totalPrice: total, date: selDate, slot: selSlot, note: $('#orderNote').value.trim() });
    cart = {}; refreshCart(); renderDishes();
    $('#orderMask').classList.remove('show');
    toast('下单成功！可在「我的」查看');
    switchView('my');
  }

  // ---------- 我的 ----------
  function renderMy() {
    var u = Store.getSession();
    if (!u) {
      $('#myProfile').innerHTML = '<div class="empty">未登录<br><span class="lk" id="goLogin">去登录 / 注册</span></div>';
      $('#myOrders').innerHTML = '';
      var gl = $('#goLogin'); if (gl) gl.onclick = function () { openAuth('login'); };
      return;
    }
    $('#myProfile').innerHTML = '<div class="row" style="align-items:center"><div style="flex:1"><div style="font-weight:700;font-size:17px">' + esc(u.name) + '</div><div class="muted">' + esc(u.phone) + '</div></div><span class="pill">已登录</span></div>';
    var orders = Store.getOrdersByUser(u.id).slice().reverse();
    if (!orders.length) { $('#myOrders').innerHTML = '<div class="empty">还没有订单，去点餐吧 🍜</div>'; return; }
    $('#myOrders').innerHTML = orders.map(orderCard).join('');
  }
  function orderCard(o) {
    var items = (o.items || []).map(function (i) { return esc(i.name) + ' x' + i.qty; }).join('、');
    return '<div class="order"><div class="hd"><span class="date">' + esc(o.date) + ' ' + esc(o.slot) + '</span>' +
      '<span class="tag ' + o.status + '">' + statusText(o.status) + '</span></div>' +
      '<div class="items">' + items + '</div>' +
      (o.note ? '<div class="muted">备注：' + esc(o.note) + '</div>' : '') +
      '<div class="ft"><span class="amt">' + money(o.totalPrice) + '</span>' +
      (o.status === 'pending' ? '<button class="btn sm ghost" data-cancel="' + o.id + '">取消订单</button>' : '') +
      '</div></div>';
  }

  // ---------- 认证 ----------
  function openAuth(tab) {
    $('#authMask').classList.add('show');
    setAuthTab(tab || 'login');
  }
  function setAuthTab(tab) {
    var isLogin = tab === 'login';
    $('#tabLogin').style.background = isLogin ? 'var(--primary)' : '';
    $('#tabLogin').style.color = isLogin ? '#fff' : '';
    $('#tabReg').style.background = isLogin ? '' : 'var(--primary)';
    $('#tabReg').style.color = isLogin ? '' : '#fff';
    $('#loginForm').style.display = isLogin ? '' : 'none';
    $('#regForm').style.display = isLogin ? 'none' : '';
  }
  function doLogin() {
    Store.login($('#lPhone').value.trim(), $('#lPwd').value).then(function (r) {
      if (!r.ok) { toast(r.msg); return; }
      refreshTop(); $('#authMask').classList.remove('show'); renderMy(); toast('登录成功');
    });
  }
  function doReg() {
    Store.register($('#rName').value.trim(), $('#rPhone').value.trim(), $('#rPwd').value).then(function (r) {
      if (!r.ok) { toast(r.msg); return; }
      refreshTop(); $('#authMask').classList.remove('show'); renderMy(); toast('注册成功，已登录');
    });
  }

  // ---------- 后台 ----------
  function renderAdminIfReady() {
    if (!adminVerified) {
      document.body.classList.remove('is-admin');
      $('#adminLogin').style.display = ''; $('#adminPanel').style.display = 'none'; return;
    }
    document.body.classList.add('is-admin');
    $('#adminLogin').style.display = 'none'; $('#adminPanel').style.display = '';
    renderAdmin();
  }
  function renderAdmin() {
    var st = Store.stats();
    $('#stOrders').textContent = st.totalOrders;
    $('#stRevenue').textContent = money(st.revenue);
    $('#stPending').textContent = st.pending;
    $('#stUsers').textContent = Store.getUsers().length;

    // 菜品销量
    if (!st.byDish.length) { $('#dishRank').innerHTML = '<div class="muted">暂无订单数据</div>'; }
    else {
      var max = st.byDish[0].qty;
      $('#dishRank').innerHTML = st.byDish.map(function (d) {
        return '<div class="bar-row"><span class="name">' + esc(d.name) + '</span>' +
          '<span class="bar-track"><span class="bar-fill" style="width:' + (d.qty / max * 100) + '%"></span></span>' +
          '<span class="val">' + d.qty + '</span></div>';
      }).join('');
    }
    // 时段分布
    var slots = Store.getSettings().slots;
    var maxS = Math.max.apply(null, slots.map(function (s) { return st.bySlot[s] || 0; }).concat([1]));
    $('#slotRank').innerHTML = slots.map(function (s) {
      var v = st.bySlot[s] || 0;
      return '<div class="bar-row"><span class="name">' + esc(s) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + (v / maxS * 100) + '%"></span></span>' +
        '<span class="val">' + v + '</span></div>';
    }).join('');

    renderDishManage();
    renderWhitelist();
    renderUsers();
    renderAllOrders();
  }
  function renderDishManage() {
    var menu = Store.getMenu();
    $('#dishManage').innerHTML = menu.map(function (d) {
      return '<div class="list-item"><div style="display:flex;align-items:center"><div class="thumb">' + (d.image ? '<img src="' + esc(d.image) + '">' : esc(d.emoji || '🍽️')) + '</div><div><b>' + esc(d.name) + '</b> <span class="muted">' + esc(d.category) + ' · ' + money(d.price) + (d.available ? '' : ' · 售罄') + '</span></div></div>' +
        '<div style="display:flex;gap:6px"><button class="btn sm ghost" data-editd="' + d.id + '">编辑</button><button class="btn sm ghost danger" data-deld="' + d.id + '">删</button></div></div>';
    }).join('') || '<div class="muted">暂无菜品</div>';
  }
  function renderWhitelist() {
    var wl = Store.getWhitelist();
    $('#wlList').innerHTML = wl.map(function (w) {
      return '<div class="list-item"><div><b>' + esc(w.phone) + '</b> <span class="muted">' + esc(w.name || '') + '</span> ' +
        (w.used ? '<span class="pill used">已注册</span>' : '<span class="pill">待注册</span>') + '</div>' +
        '<button class="btn sm ghost danger" data-delwl="' + esc(w.phone) + '">删</button></div>';
    }).join('') || '<div class="muted">暂无白名单</div>';
  }
  function renderUsers() {
    var us = Store.getUsers();
    $('#userList').innerHTML = us.map(function (u) {
      return '<div class="list-item"><div><b>' + esc(u.name) + '</b> <span class="muted">' + esc(u.phone) + '</span></div><span class="pill">' + esc(u.role) + '</span></div>';
    }).join('') || '<div class="muted">暂无注册用户</div>';
  }
  function renderAllOrders() {
    var os = Store.getOrders().slice().reverse();
    if (!os.length) { $('#allOrders').innerHTML = '<div class="muted">暂无订单</div>'; return; }
    $('#allOrders').innerHTML = os.map(function (o) {
      var items = (o.items || []).map(function (i) { return esc(i.name) + 'x' + i.qty; }).join('、');
      var acts = '';
      if (o.status === 'pending') acts = '<button class="btn sm" data-done="' + o.id + '" style="margin-right:6px">完成</button><button class="btn sm ghost danger" data-cancelall="' + o.id + '">取消</button>';
      else if (o.status === 'done') acts = '<button class="btn sm ghost danger" data-del="' + o.id + '">删除</button>';
      else acts = '<button class="btn sm ghost danger" data-del="' + o.id + '">删除</button>';
      return '<div class="order"><div class="hd"><span class="date">' + esc(o.userName) + ' · ' + esc(o.date) + ' ' + esc(o.slot) + '</span>' +
        '<span class="tag ' + o.status + '">' + statusText(o.status) + '</span></div>' +
        '<div class="items">' + items + '</div>' +
        '<div class="ft"><span class="amt">' + money(o.totalPrice) + '</span><span>' + acts + '</span></div></div>';
    }).join('');
  }

  // ---------- 编辑/新增 弹层 ----------
  // 将图片文件压缩为 base64（最大边 240px，JPEG 0.7），避免撑爆 localStorage
  function compressImageFile(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 240, w = img.width, h = img.height;
        if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
        else if (h > max) { w = Math.round(w * max / h); h = max; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        try { cb(canvas.toDataURL('image/jpeg', 0.7)); }
        catch (e) { toast('图片处理失败'); }
      };
      img.onerror = function () { toast('图片读取失败'); };
      img.src = reader.result;
    };
    reader.onerror = function () { toast('图片读取失败'); };
    reader.readAsDataURL(file);
  }
  function clearEditingImage() {
    editingImage = '';
    var p = $('#edImgPreview'); if (p) p.innerHTML = '<span class="muted">未设置图片</span>';
  }
  function bindEditImgDel() {
    var del = $('#edImgDel'); if (del) del.onclick = clearEditingImage;
  }
  function openDishEdit(id) {
    editingDishId = id || null;
    editingImage = '';
    var d = id ? Store.getMenu().filter(function (x) { return x.id === id; })[0] : null;
    if (d) editingImage = d.image || '';
    var cats = Store.getCategories();
    var catOpts = cats.map(function (c) { return '<option ' + (d && d.category === c ? 'selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '<option value="__new__">+ 新分类</option>';
    var imgHtml = '<div class="field"><label>菜品图片（可选，自动压缩）</label>' +
      '<div id="edImgPreview" class="img-preview">' + (editingImage ? '<img src="' + editingImage + '">' : '<span class="muted">未设置图片</span>') + '</div>' +
      '<input type="file" id="edImgFile" accept="image/*" style="margin-top:8px">' +
      (editingImage ? '<button class="btn sm ghost" id="edImgDel" style="margin-top:8px">移除图片</button>' : '') + '</div>';
    $('#editBody').innerHTML = '<h3>' + (id ? '编辑菜品' : '新增菜品') + '</h3>' +
      '<div class="field"><label>名称</label><input id="edName" value="' + (d ? esc(d.name) : '') + '"></div>' +
      '<div class="field"><label>分类</label><select id="edCat">' + catOpts + '</select></div>' +
      '<div class="field" id="edNewCatWrap" style="display:none"><label>新分类名</label><input id="edNewCat"></div>' +
      '<div class="field"><label>价格(元)</label><input id="edPrice" type="number" step="0.5" value="' + (d ? d.price : '') + '"></div>' +
      '<div class="field"><label>Emoji 图标</label><input id="edEmoji" value="' + (d ? esc(d.emoji || '') : '🍽️') + '"></div>' +
      imgHtml +
      '<div class="field"><label>描述</label><input id="edDesc" value="' + (d ? esc(d.desc || '') : '') + '"></div>' +
      '<div class="field"><label><input type="checkbox" id="edAvail" ' + (d ? (d.available !== false ? 'checked' : '') : 'checked') + '> 在售</label></div>' +
      '<button class="btn" id="edSave">保存</button><button class="btn ghost" id="edCancel" style="margin-top:10px">取消</button>';
    $('#editMask').classList.add('show');
    $('#edCat').onchange = function () { $('#edNewCatWrap').style.display = this.value === '__new__' ? '' : 'none'; };
    var fileInput = $('#edImgFile');
    if (fileInput) fileInput.onchange = function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      compressImageFile(f, function (dataUrl) {
        editingImage = dataUrl;
        $('#edImgPreview').innerHTML = '<img src="' + dataUrl + '"><br><button class="btn sm ghost" id="edImgDel" style="margin-top:8px">移除图片</button>';
        bindEditImgDel();
      });
    };
    bindEditImgDel();
    $('#edSave').onclick = function () {
      var cat = $('#edCat').value === '__new__' ? $('#edNewCat').value.trim() || '其他' : $('#edCat').value;
      var data = { name: $('#edName').value.trim(), category: cat, price: $('#edPrice').value, emoji: $('#edEmoji').value.trim() || '🍽️', desc: $('#edDesc').value.trim(), available: $('#edAvail').checked, image: editingImage };
      if (!data.name) { toast('请填写名称'); return; }
      if (editingDishId) Store.updateDish(editingDishId, data); else Store.addDish(data);
      $('#editMask').classList.remove('show'); renderDishManage(); renderCats(); renderDishes(); toast('已保存');
    };
    $('#edCancel').onclick = function () { $('#editMask').classList.remove('show'); };
  }
  function openWlAdd() {
    $('#editBody').innerHTML = '<h3>添加白名单</h3>' +
      '<div class="field"><label>姓名</label><input id="wlName" placeholder="可选"></div>' +
      '<div class="field"><label>手机号（注册时须一致）</label><input id="wlPhone" placeholder="如 13800000004"></div>' +
      '<button class="btn" id="wlSave">添加</button><button class="btn ghost" id="wlCancel" style="margin-top:10px">取消</button>';
    $('#editMask').classList.add('show');
    $('#wlSave').onclick = function () {
      var phone = $('#wlPhone').value.trim();
      if (!/^\d{6,15}$/.test(phone)) { toast('手机号格式不正确'); return; }
      if (Store.findWhitelist(phone)) { toast('已在白名单中'); return; }
      Store.addWhitelist({ phone: phone, name: $('#wlName').value.trim() });
      $('#editMask').classList.remove('show'); renderWhitelist(); toast('已添加');
    };
    $('#wlCancel').onclick = function () { $('#editMask').classList.remove('show'); };
  }

  // ---------- 导出 CSV ----------
  function exportCSV() {
    var os = Store.getOrders();
    var head = ['订单号', '用户', '日期', '时段', '菜品', '金额', '状态', '备注', '下单时间'];
    var rows = os.map(function (o) {
      return [o.id, o.userName, o.date, o.slot, (o.items || []).map(function (i) { return i.name + 'x' + i.qty; }).join('/'), o.totalPrice, statusText(o.status), o.note || '', o.createdAt];
    });
    var csv = '﻿' + head.join(',') + '\n' + rows.map(function (r) {
      return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'orders.csv'; a.click();
    URL.revokeObjectURL(url); toast('已导出 orders.csv');
  }

  // ---------- 事件绑定 ----------
  function bind() {
    // 顶部
    $('#loginBtn').onclick = function () { openAuth('login'); };
    $('#logoutBtn').onclick = function () { Store.logout(); refreshTop(); renderMy(); toast('已退出'); };

    // 导航
    $all('.tabbar button').forEach(function (b) { b.onclick = function () { switchView(b.dataset.view); }; });

    // 分类
    $('#catBar').onclick = function (e) {
      var c = e.target.closest('[data-cat]'); if (!c) return;
      activeCat = c.dataset.cat; renderCats(); renderDishes();
    };
    // 菜品加减
    $('#dishList').onclick = function (e) {
      var btn = e.target.closest('button[data-act]'); if (!btn) return;
      var id = btn.dataset.id, act = btn.dataset.act;
      cart[id] = cart[id] || 0;
      if (act === 'inc') cart[id]++;
      if (act === 'dec') { cart[id]--; if (cart[id] <= 0) delete cart[id]; }
      renderDishes(); refreshCart();
    };

    // 购物车结算
    $('#goOrder').onclick = openOrder;
    $('#cancelOrder').onclick = function () { $('#orderMask').classList.remove('show'); };
    $('#submitOrder').onclick = submitOrder;
    $('#orderDate').onchange = function () { selDate = this.value; };
    $('#orderSlots').onclick = function (e) {
      var s = e.target.closest('[data-slot]'); if (!s) return;
      selSlot = s.dataset.slot;
      $all('#orderSlots .slot').forEach(function (x) { x.classList.toggle('active', x === s); });
    };

    // 认证
    $('#tabLogin').onclick = function () { setAuthTab('login'); };
    $('#tabReg').onclick = function () { setAuthTab('reg'); };
    $('#doLogin').onclick = doLogin;
    $('#doReg').onclick = doReg;

    // 我的订单取消
    $('#myOrders').onclick = function (e) {
      var b = e.target.closest('[data-cancel]'); if (!b) return;
      Store.updateOrderStatus(b.dataset.cancel, 'cancelled'); renderMy(); toast('已取消');
    };

    // 后台登录
    $('#adminLoginBtn').onclick = function () {
      Store.adminLogin($('#adminPwd').value).then(function (r) {
        if (r.ok) {
          adminVerified = true;
          // 拉取最新后台数据（remote 模式必需；local 模式为 no-op），再渲染
          Store.refreshAdmin().then(renderAdminIfReady);
          toast('欢迎，管理员');
        } else { toast(r.msg || '密码错误'); }
      });
    };

    // 后台操作
    $('#addDishBtn').onclick = function () { openDishEdit(null); };
    $('#addWlBtn').onclick = openWlAdd;
    $('#exportBtn').onclick = exportCSV;

    $('#dishManage').onclick = function (e) {
      var ed = e.target.closest('[data-editd]'); var dl = e.target.closest('[data-deld]');
      if (ed) openDishEdit(ed.dataset.editd);
      if (dl) { if (confirm('确定删除该菜品？')) { Store.removeDish(dl.dataset.deld); renderDishManage(); renderCats(); renderDishes(); } }
    };
    $('#wlList').onclick = function (e) {
      var b = e.target.closest('[data-delwl]'); if (!b) return;
      if (confirm('从白名单删除该手机号？')) { Store.removeWhitelist(b.dataset.delwl); renderWhitelist(); }
    };
    $('#allOrders').onclick = function (e) {
      var done = e.target.closest('[data-done]');
      var canc = e.target.closest('[data-cancelall]');
      var del = e.target.closest('[data-del]');
      if (done) { Store.updateOrderStatus(done.dataset.done, 'done'); renderAllOrders(); renderAdmin(); }
      if (canc) { Store.updateOrderStatus(canc.dataset.cancelall, 'cancelled'); renderAllOrders(); renderAdmin(); }
      if (del) { Store.removeOrder(del.dataset.del); renderAllOrders(); renderAdmin(); }
    };

    // 设置
    $('#saveSettings').onclick = function () {
      var patch = { shopName: $('#setShop').value.trim() || '订餐小程序' };
      var pwd = $('#setPwd').value;
      if (pwd) patch.adminPassword = pwd; // 明文交给后端哈希存储
      var slots = $('#setSlots').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (slots.length) patch.slots = slots;
      Store.updateSettings(patch); refreshTop(); renderAdmin(); toast('设置已保存');
    };
    $('#resetBtn').onclick = function () {
      if (confirm('将清空所有菜单/用户/订单/白名单，恢复初始演示数据，确定？')) {
        Store.resetAll().then(function () {
          adminVerified = false; cart = {}; refreshTop(); renderCats(); renderDishes(); refreshCart(); renderAdminIfReady(); toast('已重置');
        });
      }
    };

    // 关闭弹层（点遮罩）
    $all('.modal-mask').forEach(function (m) {
      m.onclick = function (e) { if (e.target === m) m.classList.remove('show'); };
    });

    // 预填设置
    var s = Store.getSettings();
    $('#setShop').value = s.shopName;
    $('#setSlots').value = s.slots.join(',');
  }

  // ---------- 启动 ----------
  bind();
  // 首屏先用本地缓存秒开
  refreshTop(); renderCats(); renderDishes(); refreshCart();
  // 再从后端(或本地种子)拉取真实数据并刷新
  Store.init().then(function () {
    refreshTop(); renderCats(); renderDishes(); refreshCart(); renderAdminIfReady();
    // local 模式下此时才有种子设置，预填设置表单
    var s = Store.getSettings();
    $('#setShop').value = s.shopName;
    $('#setSlots').value = (s.slots || []).join(',');
  });
})();
