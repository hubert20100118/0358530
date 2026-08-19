/**
 * 订餐小程序 - Web 端数据层（双模自适应）
 *
 * 两种运行模式：
 *  1) 远程模式(remote)：页面由 Node 后端(server/server.js)同源托管，/api 可达。
 *     读取走内存缓存(首屏 localStorage 缓存秒开)，写入走 REST API 并乐观更新本地缓存；
 *     login/register/adminLogin 需服务端校验，为异步。订单真实入库、跨设备共享。
 *  2) 本地模式(local)：纯静态托管（如 CloudStudio 分享链接），/api 不可达时自动降级。
 *     数据全部存浏览器 localStorage，单机演示用，无需后端。
 *
 * init() 会探测 /api/settings：成功->remote，失败/异常->local(灌入演示种子)。
 * 所有读方法在两种模式下都从内存 cache 读取，方法签名与旧版保持一致。
 */
(function (global) {
  'use strict';

  var BASE = '/api';
  var KEYS = {
    menu: 'mr_cache_menu',
    settings: 'mr_cache_settings',
    whitelist: 'mr_cache_whitelist',
    users: 'mr_cache_users',
    orders: 'mr_cache_orders',
    session: 'mr_session',
    admin: 'mr_admin'
  };

  var cache = { menu: [], settings: null, whitelist: [], users: [], orders: [] };
  var remote = null; // null=未定, true=remote, false=local

  // ---------- 本地存储 ----------
  function lsGet(k, def) {
    try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : def; } catch (e) { return def; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function loadCache() {
    cache.menu = lsGet(KEYS.menu, []);
    cache.settings = lsGet(KEYS.settings, null);
    cache.whitelist = lsGet(KEYS.whitelist, []);
    cache.users = lsGet(KEYS.users, []);
    cache.orders = lsGet(KEYS.orders, []);
  }
  function saveCache() {
    lsSet(KEYS.menu, cache.menu);
    lsSet(KEYS.settings, cache.settings);
    lsSet(KEYS.whitelist, cache.whitelist);
    lsSet(KEYS.users, cache.users);
    lsSet(KEYS.orders, cache.orders);
  }

  function token() { var s = lsGet(KEYS.session, null); return s && s.token; }
  function adminToken() { var a = lsGet(KEYS.admin, null); return a && a.token; }

  // 本地模式使用的简易哈希（与旧版一致），用于后台密码校验
  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
    return 'h' + (h >>> 0).toString(16);
  }

  // ---------- 演示种子（与后端 server.js 保持一致）----------
  var SEED = {
    shopName: '阿布食堂',
    slots: ['11:00-11:30', '11:30-12:00', '12:00-12:30', '17:30-18:00', '18:00-18:30', '18:30-19:00'],
    adminPassword: hash('admin123'),
    whitelist: [
      { phone: '13800000001', name: '张三' },
      { phone: '13800000002', name: '李四' },
      { phone: '13800000003', name: '王五' }
    ],
    menu: [
      ['d_seed_1', '红烧牛肉面', '主食', 28, '🍜', '招牌手工面，牛腩软糯'],
      ['d_seed_2', '黄焖鸡米饭', '主食', 22, '🍚', '秘制酱汁，鸡腿肉'],
      ['d_seed_3', '扬州炒饭', '主食', 18, '🍛', '粒粒分明，配料丰富'],
      ['d_seed_4', '宫保鸡丁', '热菜', 26, '🍲', '酸甜微辣，下饭神器'],
      ['d_seed_5', '麻婆豆腐', '热菜', 20, '🌶️', '麻辣鲜香，嫩豆腐'],
      ['d_seed_6', '清炒时蔬', '素菜', 16, '🥬', '当季新鲜蔬菜'],
      ['d_seed_7', '番茄蛋汤', '汤品', 12, '🍅', '家常暖胃'],
      ['d_seed_8', '紫菜蛋花汤', '汤品', 10, '🥣', '清淡爽口'],
      ['d_seed_9', '可乐', '饮品', 6, '🥤', '冰镇 330ml'],
      ['d_seed_10', '鲜榨橙汁', '饮品', 14, '🍊', '无添加']
    ].map(function (d) {
      return { id: d[0], name: d[1], category: d[2], price: d[3], emoji: d[4], desc: d[5], available: true, image: '' };
    })
  };

  function seedLocal() {
    cache.settings = { shopName: SEED.shopName, slots: SEED.slots.slice(), leadMinutes: 30, adminPassword: SEED.adminPassword };
    cache.menu = SEED.menu.map(function (d) { return Object.assign({}, d); });
    cache.whitelist = SEED.whitelist.map(function (w) { return { phone: w.phone, name: w.name, used: false }; });
    cache.users = [];
    cache.orders = [];
    saveCache();
  }

  // ---------- 远程请求封装（仅 remote 模式使用）----------
  function apiReq(method, path, body, useAdmin) {
    var opt = { method: method, headers: {} };
    if (body) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    var t = useAdmin ? adminToken() : token();
    if (t) opt.headers['Authorization'] = 'Bearer ' + t;
    return fetch(BASE + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    });
  }

  function remoteBoot(j) {
    cache.settings = j.settings; lsSet(KEYS.settings, cache.settings);
    var tasks = [
      apiReq('GET', '/menu').then(function (r) { if (r.j && r.j.menu) { cache.menu = r.j.menu; lsSet(KEYS.menu, cache.menu); } })
    ];
    if (token()) {
      tasks.push(apiReq('GET', '/orders/mine').then(function (r) { if (r.j && r.j.orders) { cache.orders = r.j.orders; lsSet(KEYS.orders, cache.orders); } }));
    }
    return Promise.all(tasks);
  }
  function localBoot() {
    remote = false;
    if (!cache.settings || !cache.settings.shopName) seedLocal();
    return Promise.resolve();
  }

  function findWhitelistLocal(phone) {
    for (var i = 0; i < cache.whitelist.length; i++) if (cache.whitelist[i].phone === phone) return cache.whitelist[i];
    return null;
  }
  function getUserLocal(phone) {
    for (var i = 0; i < cache.users.length; i++) if (cache.users[i].phone === phone) return cache.users[i];
    return null;
  }

  // ---------- Store API ----------
  var Store = {
    KEYS: KEYS,
    isRemote: function () { return remote === true; },

    init: function () {
      loadCache();
      return fetch(BASE + '/settings').then(function (r) {
        return r.json().catch(function () { return null; });
      }).then(function (j) {
        if (j && j.ok && j.settings) { remote = true; return remoteBoot(j); }
        return localBoot();
      }).catch(function () { return localBoot(); });
    },

    refreshMine: function () {
      if (remote !== true || !token()) return Promise.resolve();
      return apiReq('GET', '/orders/mine').then(function (r) { if (r.j && r.j.orders) { cache.orders = r.j.orders; lsSet(KEYS.orders, cache.orders); } });
    },
    refreshAdmin: function () {
      // 不依赖 remote 标志：只要后台接口可达就拉取真实数据。
      // 避免 Store.init() 探测 /api/settings 瞬时抖动降级成 local 后，remote 永久为 false，
      // 导致后台（用户/订单/白名单）永远读不到云端数据、显示空白。
      if (!adminToken()) return Promise.resolve();
      return apiReq('GET', '/admin/state', null, true).then(function (r) {
        if (r.j && r.j.ok) {
          remote = true; // 后台数据可达即视为云端模式
          cache.menu = r.j.menu || []; cache.settings = r.j.settings || null;
          cache.whitelist = r.j.whitelist || []; cache.users = r.j.users || []; cache.orders = r.j.orders || [];
          saveCache();
        }
      }).catch(function () { /* 本地演示模式：拉不到后台数据，保持原样 */ });
    },

    getSettings: function () { return cache.settings || { shopName: '订餐小程序', slots: [], leadMinutes: 30 }; },
    updateSettings: function (patch) {
      cache.settings = Object.assign({}, cache.settings || { shopName: '订餐小程序', slots: [], leadMinutes: 30 }, patch);
      if (cache.settings.adminPassword && remote !== true) cache.settings.adminPassword = hash(cache.settings.adminPassword);
      lsSet(KEYS.settings, cache.settings);
      if (remote === true) apiReq('PUT', '/admin/settings', patch, true);
      return cache.settings;
    },

    getMenu: function () { return cache.menu; },
    getCategories: function () {
      var cats = [];
      this.getMenu().forEach(function (d) { if (cats.indexOf(d.category) < 0) cats.push(d.category); });
      return cats;
    },
    addDish: function (dish) {
      var d = Object.assign({}, dish);
      d.id = d.id || ('d_local_' + Date.now());
      d.price = Number(d.price) || 0;
      d.available = d.available !== false;
      cache.menu.push(d); lsSet(KEYS.menu, cache.menu);
      if (remote === true) apiReq('POST', '/admin/menu', d, true).then(function (r) {
        if (r.j && r.j.dish) { var i = cache.menu.findIndex(function (x) { return x.id === d.id; }); if (i >= 0) { cache.menu[i] = r.j.dish; lsSet(KEYS.menu, cache.menu); } }
      });
      return d;
    },
    updateDish: function (id, patch) {
      cache.menu = cache.menu.map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; });
      lsSet(KEYS.menu, cache.menu);
      if (remote === true) apiReq('PUT', '/admin/menu/' + encodeURIComponent(id), patch, true);
    },
    removeDish: function (id) {
      cache.menu = cache.menu.filter(function (x) { return x.id !== id; });
      lsSet(KEYS.menu, cache.menu);
      if (remote === true) apiReq('DELETE', '/admin/menu/' + encodeURIComponent(id), null, true);
    },

    getWhitelist: function () { return cache.whitelist; },
    addWhitelist: function (entry) {
      if (this.findWhitelist(entry.phone)) return;
      var e = { phone: String(entry.phone), name: entry.name || '', used: false };
      cache.whitelist.push(e); lsSet(KEYS.whitelist, cache.whitelist);
      if (remote === true) apiReq('POST', '/admin/whitelist', e, true).then(function (r) {
        if (r.j && r.j.entry) { var i = cache.whitelist.findIndex(function (x) { return x.phone === e.phone; }); if (i >= 0) { cache.whitelist[i] = r.j.entry; lsSet(KEYS.whitelist, cache.whitelist); } }
      });
    },
    removeWhitelist: function (phone) {
      cache.whitelist = cache.whitelist.filter(function (w) { return w.phone !== phone; });
      lsSet(KEYS.whitelist, cache.whitelist);
      if (remote === true) apiReq('DELETE', '/admin/whitelist/' + encodeURIComponent(phone), null, true);
    },
    findWhitelist: function (phone) {
      return this.getWhitelist().filter(function (w) { return w.phone === phone; })[0] || null;
    },

    batchWhitelist: function (text) {
      if (remote === true) {
        return apiReq('POST', '/admin/whitelist/batch', { text: String(text || '') }, true).then(function (r) {
          return Store.refreshAdmin().then(function () { return r.j || { ok: false }; });
        });
      }
      // local 模式：前端直接解析导入
      var lines = String(text || '').split(/\r?\n/);
      var added = 0, invalid = 0, skipped = 0;
      lines.forEach(function (line) {
        line = line.trim(); if (!line) return;
        var parts = line.split(/[\s,，\t]+/).filter(Boolean);
        var phone = '', name = '';
        parts.forEach(function (p) {
          if (/^\d{6,15}$/.test(p) && !phone) phone = p;
          else if (!/^\d{6,15}$/.test(p)) name += (name ? ' ' : '') + p;
        });
        if (!phone && /^\d{6,15}$/.test(parts[0] || '')) phone = parts[0];
        if (!phone) { invalid++; return; }
        if (Store.findWhitelist(phone)) { skipped++; return; }
        Store.addWhitelist({ phone: phone, name: name });
        added++;
      });
      return Promise.resolve({ ok: true, added: added, skipped: skipped, invalid: invalid });
    },

    getUsers: function () { return cache.users; },
    getUserById: function (id) { return this.getUsers().filter(function (u) { return u.id === id; })[0] || null; },
    getUserOrders: function (userId) {
      return this.getOrders().filter(function (o) { return o.userId === userId; });
    },
    setUserRole: function (id, role) {
      if (remote === true) return apiReq('PUT', '/admin/users/' + encodeURIComponent(id) + '/role', { role: role }, true).then(function () { return Store.refreshAdmin(); });
      var u = Store.getUserById(id); if (u) { u.role = role; lsSet(KEYS.users, cache.users); }
      return Promise.resolve();
    },
    resetUserPassword: function (id, pwd) {
      if (remote === true) return apiReq('POST', '/admin/users/' + encodeURIComponent(id) + '/reset', { password: pwd }, true);
      return Promise.resolve();
    },
    deleteUser: function (id) {
      if (remote === true) return apiReq('DELETE', '/admin/users/' + encodeURIComponent(id), null, true).then(function () { return Store.refreshAdmin(); });
      cache.users = cache.users.filter(function (u) { return u.id !== id; }); lsSet(KEYS.users, cache.users);
      return Promise.resolve();
    },
    register: function (name, phone, password) {
      // 优先走云端：即使 init 曾误判为 local，只要服务端可达就入库，保证后台可见
      return apiReq('POST', '/register', { name: name, phone: phone, password: password }).then(function (r) {
        if (r.ok && r.j && r.j.ok) {
          remote = true;
          var sess = { id: r.j.user.id, name: r.j.user.name, phone: r.j.user.phone, role: r.j.user.role, token: r.j.token };
          lsSet(KEYS.session, sess);
          return { ok: true, user: sess };
        }
        if (r.status === 401 || r.status === 403 || (r.j && r.j.msg)) {
          // 云端明确拒绝（不在白名单 / 已注册 / 信息不全）：直接报错，不本地兜底
          return { ok: false, msg: (r.j && r.j.msg) || '注册失败' };
        }
        return localRegister(name, phone, password);
      }).catch(function () { return localRegister(name, phone, password); });
    },
    localRegister: function (name, phone, password) {
      return new Promise(function (resolve) {
        var w = findWhitelistLocal(phone);
        if (!w) return resolve({ ok: false, msg: '该手机号不在可注册名单中，请联系管理员' });
        if (w.used) return resolve({ ok: false, msg: '该手机号已注册过' });
        if (getUserLocal(phone)) return resolve({ ok: false, msg: '该手机号已存在' });
        var id = 'u_local_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        cache.users.push({ id: id, name: name, phone: phone, password: hash(password), role: 'user', createdAt: new Date().toISOString() });
        lsSet(KEYS.users, cache.users);
        w.used = true; lsSet(KEYS.whitelist, cache.whitelist);
        var sess = { id: id, name: name, phone: phone, role: 'user', token: 't_' + id };
        lsSet(KEYS.session, sess);
        resolve({ ok: true, user: sess });
      });
    },
    login: function (phone, password) {
      return apiReq('POST', '/login', { phone: phone, password: password }).then(function (r) {
        if (r.ok && r.j && r.j.ok) {
          remote = true;
          var sess = { id: r.j.user.id, name: r.j.user.name, phone: r.j.user.phone, role: r.j.user.role, token: r.j.token };
          lsSet(KEYS.session, sess);
          return { ok: true, user: sess };
        }
        if (r.status === 401 || r.status === 403 || (r.j && r.j.msg)) {
          return { ok: false, msg: (r.j && r.j.msg) || '登录失败' };
        }
        return localLogin(phone, password);
      }).catch(function () { return localLogin(phone, password); });
    },
    localLogin: function (phone, password) {
      return new Promise(function (resolve) {
        var u = getUserLocal(phone);
        if (!u) return resolve({ ok: false, msg: '用户不存在' });
        if (u.password !== hash(password)) return resolve({ ok: false, msg: '密码错误' });
        var sess = { id: u.id, name: u.name, phone: u.phone, role: 'user', token: 't_' + u.id };
        lsSet(KEYS.session, sess);
        resolve({ ok: true, user: sess });
      });
    },
    setSession: function (sess) { lsSet(KEYS.session, sess); },
    getSession: function () { return lsGet(KEYS.session, null); },
    logout: function () { try { localStorage.removeItem(KEYS.session); } catch (e) {} },

    adminLogin: function (password) {
      // 优先走云端：即使 init 误判 local，只要服务端可达就拿到真实 admin token，后台才能拉到数据
      return apiReq('POST', '/admin/login', { password: password }).then(function (r) {
        if (r.ok && r.j && r.j.ok) { lsSet(KEYS.admin, { token: r.j.token }); remote = true; return { ok: true }; }
        if (r.status === 401 || (r.j && r.j.msg)) return { ok: false, msg: (r.j && r.j.msg) || '密码错误' };
        return localAdminLogin(password);
      }).catch(function () { return localAdminLogin(password); });
    },
    localAdminLogin: function (password) {
      return new Promise(function (resolve) {
        if (cache.settings && cache.settings.adminPassword === hash(password)) {
          lsSet(KEYS.admin, { token: 'admin_local' });
          resolve({ ok: true });
        } else resolve({ ok: false, msg: '密码错误' });
      });
    },

    getOrders: function () { return cache.orders; },
    getOrdersByUser: function (userId) {
      return this.getOrders().filter(function (o) { return o.userId === userId; });
    },
    addOrder: function (order) {
      var o = Object.assign({}, order);
      o.id = o.id || ('o_local_' + Date.now());
      o.createdAt = new Date().toISOString();
      o.status = 'pending';
      cache.orders.push(o); lsSet(KEYS.orders, cache.orders);
      // 始终尝试云端（local 模式 fetch 失败被忽略），服务端可达时订单入库、后台可见
      apiReq('POST', '/orders', o).then(function (r) {
        if (r.ok && r.j && r.j.ok && r.j.order) {
          remote = true;
          var i = cache.orders.findIndex(function (x) { return x.id === o.id; });
          if (i >= 0) { cache.orders[i] = r.j.order; lsSet(KEYS.orders, cache.orders); }
        }
      }).catch(function () {});
      return o;
    },
    updateOrderStatus: function (id, status) {
      cache.orders = cache.orders.map(function (o) { return o.id === id ? Object.assign({}, o, { status: status }) : o; });
      lsSet(KEYS.orders, cache.orders);
      apiReq('PUT', '/admin/orders/' + encodeURIComponent(id) + '/status', { status: status }, true).catch(function () {});
    },
    // 普通用户取消自己的订单：走 /api/orders/:id/cancel（仅需用户登录），避免误用需管理员权限的 admin 接口导致取消失败
    cancelMyOrder: function (id) {
      cache.orders = cache.orders.map(function (o) { return o.id === id ? Object.assign({}, o, { status: 'cancelled' }) : o; });
      lsSet(KEYS.orders, cache.orders);
      apiReq('PUT', '/orders/' + encodeURIComponent(id) + '/cancel', {}, false).then(function (r) { if (r.ok) remote = true; }).catch(function () {});
    },
    removeOrder: function (id) {
      cache.orders = cache.orders.filter(function (o) { return o.id !== id; });
      lsSet(KEYS.orders, cache.orders);
      if (remote === true) apiReq('DELETE', '/admin/orders/' + encodeURIComponent(id), null, true);
    },

    stats: function () {
      var orders = this.getOrders();
      var menu = this.getMenu();
      var nameMap = {}; menu.forEach(function (d) { nameMap[d.id] = d.name; });
      var byDish = {}, bySlot = {}, byDate = {}, revenue = 0, count = 0;
      orders.forEach(function (o) {
        if (o.status === 'cancelled') return;
        count++; revenue += o.totalPrice || 0;
        byDate[o.date] = (byDate[o.date] || 0) + 1;
        bySlot[o.slot] = (bySlot[o.slot] || 0) + 1;
        (o.items || []).forEach(function (it) {
          var k = it.dishId || it.name;
          if (!byDish[k]) byDish[k] = { name: it.name, qty: 0, amount: 0 };
          byDish[k].qty += it.qty; byDish[k].amount += it.qty * it.price;
        });
      });
      var dishRank = Object.keys(byDish).map(function (k) { return byDish[k]; }).sort(function (a, b) { return b.qty - a.qty; });
      return {
        totalOrders: count, revenue: revenue, byDish: dishRank, bySlot: bySlot, byDate: byDate,
        pending: orders.filter(function (o) { return o.status === 'pending'; }).length
      };
    },

    resetAll: function () {
      if (remote === true) {
        return apiReq('POST', '/admin/reset', {}, true).then(function () {
          cache = { menu: [], settings: null, whitelist: [], users: [], orders: [] };
          try { Object.keys(KEYS).forEach(function (k) { if (k !== 'session' && k !== 'admin') localStorage.removeItem(KEYS[k]); }); } catch (e) {}
          try { localStorage.removeItem(KEYS.admin); } catch (e) {}
          return Store.init();
        });
      }
      return new Promise(function (resolve) {
        cache = { menu: [], settings: null, whitelist: [], users: [], orders: [] };
        Object.keys(KEYS).forEach(function (k) { try { localStorage.removeItem(KEYS[k]); } catch (e) {} });
        seedLocal();
        resolve();
      });
    }
  };

  global.Store = Store;
})(window);
