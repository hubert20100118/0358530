// 订餐小程序 - 远程数据层 (微信小程序端)
// 连接 Node 后端。读取走内存缓存(首屏用 Storage 缓存秒开)，写入走 wx.request REST API。
// 接口与旧版本地 store 保持一致。
//
// ⚠️ 部署说明：开发阶段用下方 127.0.0.1 即可(微信开发者工具需勾选"不校验合法域名/TLS")。
// 正式发布请把 API_BASE 改成你的 https 域名，并在小程序后台「开发管理-服务器域名-request合法域名」中加入它。
var API_BASE = 'http://127.0.0.1:8137/api';

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
var DEFAULT_SETTINGS = { shopName: '订餐小程序', slots: [], leadMinutes: 30 };

function lsGet(k, def) {
  try { var v = wx.getStorageSync(k); return (v === '' || v === undefined || v === null) ? def : v; } catch (e) { return def; }
}
function lsSet(k, v) { try { wx.setStorageSync(k, v); } catch (e) {} }
function loadCache() {
  cache.menu = lsGet(KEYS.menu, []);
  cache.settings = lsGet(KEYS.settings, null);
  cache.whitelist = lsGet(KEYS.whitelist, []);
  cache.users = lsGet(KEYS.users, []);
  cache.orders = lsGet(KEYS.orders, []);
}
function saveCache() {
  lsSet(KEYS.menu, cache.menu); lsSet(KEYS.settings, cache.settings);
  lsSet(KEYS.whitelist, cache.whitelist); lsSet(KEYS.users, cache.users); lsSet(KEYS.orders, cache.orders);
}
function token() { var s = lsGet(KEYS.session, null); return s && s.token; }
function adminToken() { var a = lsGet(KEYS.admin, null); return a && a.token; }

function req(method, path, body, useAdmin) {
  return new Promise(function (resolve) {
    var header = {};
    if (body) header['Content-Type'] = 'application/json';
    var t = useAdmin ? adminToken() : token();
    if (t) header['Authorization'] = 'Bearer ' + t;
    wx.request({
      url: API_BASE + path, method: method, data: body, header: header,
      success: function (res) { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, j: res.data || {} }); },
      fail: function () { resolve({ ok: false, status: 0, j: {} }); }
    });
  });
}

var Store = {
  KEYS: KEYS,
  API_BASE: API_BASE,

  init: function () {
    loadCache();
    var tasks = [
      req('GET', '/menu').then(function (r) { if (r.j && r.j.menu) { cache.menu = r.j.menu; lsSet(KEYS.menu, cache.menu); } }),
      req('GET', '/settings').then(function (r) { if (r.j && r.j.settings) { cache.settings = r.j.settings; lsSet(KEYS.settings, cache.settings); } })
    ];
    if (token()) tasks.push(req('GET', '/orders/mine').then(function (r) { if (r.j && r.j.orders) { cache.orders = r.j.orders; lsSet(KEYS.orders, cache.orders); } }));
    if (adminToken()) tasks.push(req('GET', '/admin/state').then(function (r) { if (r.j && r.j.ok) { cache.menu = r.j.menu || []; cache.settings = r.j.settings || null; cache.whitelist = r.j.whitelist || []; cache.users = r.j.users || []; cache.orders = r.j.orders || []; saveCache(); } }));
    return Promise.all(tasks);
  },

  // 进入页面时统一刷新（跨设备共享 + 真实数据）
  refresh: function () { return this.init(); },
  refreshMine: function () {
    if (!token()) return Promise.resolve();
    return req('GET', '/orders/mine').then(function (r) { if (r.j && r.j.orders) { cache.orders = r.j.orders; lsSet(KEYS.orders, cache.orders); } });
  },
  refreshAdmin: function () {
    if (!adminToken()) return Promise.resolve();
    return req('GET', '/admin/state').then(function (r) {
      if (r.j && r.j.ok) { cache.menu = r.j.menu || []; cache.settings = r.j.settings || null; cache.whitelist = r.j.whitelist || []; cache.users = r.j.users || []; cache.orders = r.j.orders || []; saveCache(); }
    });
  },

  getSettings: function () { return cache.settings || DEFAULT_SETTINGS; },
  updateSettings: function (patch) {
    cache.settings = Object.assign({}, cache.settings || DEFAULT_SETTINGS, patch);
    lsSet(KEYS.settings, cache.settings);
    req('PUT', '/admin/settings', patch, true);
    return cache.settings;
  },

  getMenu: function () { return cache.menu; },
  getCategories: function () {
    var cats = [], m = this.getMenu();
    m.forEach(function (d) { if (cats.indexOf(d.category) < 0) cats.push(d.category); });
    return cats;
  },
  addDish: function (dish) {
    var d = Object.assign({}, dish); d.id = d.id || ('d_local_' + Date.now()); d.price = Number(d.price) || 0; d.available = d.available !== false;
    cache.menu.push(d); lsSet(KEYS.menu, cache.menu);
    req('POST', '/admin/menu', d, true).then(function (r) { if (r.j && r.j.dish) { var i = cache.menu.findIndex(function (x) { return x.id === d.id; }); if (i >= 0) { cache.menu[i] = r.j.dish; lsSet(KEYS.menu, cache.menu); } } });
    return d;
  },
  updateDish: function (id, patch) {
    cache.menu = cache.menu.map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; });
    lsSet(KEYS.menu, cache.menu);
    req('PUT', '/admin/menu/' + encodeURIComponent(id), patch, true);
  },
  removeDish: function (id) {
    cache.menu = cache.menu.filter(function (x) { return x.id !== id; });
    lsSet(KEYS.menu, cache.menu);
    req('DELETE', '/admin/menu/' + encodeURIComponent(id), null, true);
  },

  getWhitelist: function () { return cache.whitelist; },
  addWhitelist: function (entry) {
    if (this.findWhitelist(entry.phone)) return;
    var e = { phone: String(entry.phone), name: entry.name || '', used: false };
    cache.whitelist.push(e); lsSet(KEYS.whitelist, cache.whitelist);
    req('POST', '/admin/whitelist', e, true).then(function (r) { if (r.j && r.j.entry) { var i = cache.whitelist.findIndex(function (x) { return x.phone === e.phone; }); if (i >= 0) { cache.whitelist[i] = r.j.entry; lsSet(KEYS.whitelist, cache.whitelist); } } });
  },
  removeWhitelist: function (phone) {
    cache.whitelist = cache.whitelist.filter(function (w) { return w.phone !== phone; });
    lsSet(KEYS.whitelist, cache.whitelist);
    req('DELETE', '/admin/whitelist/' + encodeURIComponent(phone), null, true);
  },
  findWhitelist: function (phone) {
    var r = this.getWhitelist().filter(function (w) { return w.phone === phone; }); return r[0] || null;
  },

  getUsers: function () { return cache.users; },
  register: function (name, phone, password) {
    return req('POST', '/register', { name: name, phone: phone, password: password }).then(function (r) {
      if (r.ok && r.j && r.j.ok) {
        var sess = { id: r.j.user.id, name: r.j.user.name, phone: r.j.user.phone, role: r.j.user.role, token: r.j.token };
        lsSet(KEYS.session, sess);
        return { ok: true, user: sess };
      }
      return { ok: false, msg: (r.j && r.j.msg) || '注册失败' };
    });
  },
  login: function (phone, password) {
    return req('POST', '/login', { phone: phone, password: password }).then(function (r) {
      if (r.ok && r.j && r.j.ok) {
        var sess = { id: r.j.user.id, name: r.j.user.name, phone: r.j.user.phone, role: r.j.user.role, token: r.j.token };
        lsSet(KEYS.session, sess);
        return { ok: true, user: sess };
      }
      return { ok: false, msg: (r.j && r.j.msg) || '登录失败' };
    });
  },
  setSession: function (sess) { lsSet(KEYS.session, sess); },
  getSession: function () { return lsGet(KEYS.session, null); },
  logout: function () { try { wx.removeStorageSync(KEYS.session); } catch (e) {} },

  adminLogin: function (password) {
    return req('POST', '/admin/login', { password: password }).then(function (r) {
      if (r.ok && r.j && r.j.ok) { lsSet(KEYS.admin, { token: r.j.token }); return { ok: true }; }
      return { ok: false, msg: (r.j && r.j.msg) || '密码错误' };
    });
  },

  getOrders: function () { return cache.orders; },
  getOrdersByUser: function (userId) { return this.getOrders().filter(function (o) { return o.userId === userId; }); },
  addOrder: function (order) {
    var o = Object.assign({}, order);
    o.id = o.id || ('o_local_' + Date.now());
    o.createdAt = new Date().toISOString();
    o.status = 'pending';
    cache.orders.push(o); lsSet(KEYS.orders, cache.orders);
    req('POST', '/orders', o).then(function (r) { if (r.j && r.j.ok && r.j.order) { var i = cache.orders.findIndex(function (x) { return x.id === o.id; }); if (i >= 0) { cache.orders[i] = r.j.order; lsSet(KEYS.orders, cache.orders); } } });
    return o;
  },
  updateOrderStatus: function (id, status) {
    cache.orders = cache.orders.map(function (o) { return o.id === id ? Object.assign({}, o, { status: status }) : o; });
    lsSet(KEYS.orders, cache.orders);
    req('PUT', '/admin/orders/' + encodeURIComponent(id) + '/status', { status: status }, true);
  },
  removeOrder: function (id) {
    cache.orders = cache.orders.filter(function (o) { return o.id !== id; });
    lsSet(KEYS.orders, cache.orders);
    req('DELETE', '/admin/orders/' + encodeURIComponent(id), null, true);
  },

  stats: function () {
    var orders = this.getOrders(), menu = this.getMenu(), nameMap = {};
    menu.forEach(function (d) { nameMap[d.id] = d.name; });
    var byDish = {}, bySlot = {}, byDate = {}, revenue = 0, count = 0;
    orders.forEach(function (o) {
      if (o.status === 'cancelled') return;
      count++; revenue += o.totalPrice || 0;
      byDate[o.date] = (byDate[o.date] || 0) + 1;
      bySlot[o.slot] = (bySlot[o.slot] || 0) + 1;
      (o.items || []).forEach(function (it) {
        var k = it.dishId || it.name; if (!byDish[k]) byDish[k] = { name: it.name, qty: 0, amount: 0 };
        byDish[k].qty += it.qty; byDish[k].amount += it.qty * it.price;
      });
    });
    var dishRank = Object.keys(byDish).map(function (k) { return byDish[k]; }).sort(function (a, b) { return b.qty - a.qty; });
    return { totalOrders: count, revenue: revenue, byDish: dishRank, bySlot: bySlot, byDate: byDate, pending: orders.filter(function (o) { return o.status === 'pending'; }).length };
  },

  resetAll: function () {
    var that = this;
    return req('POST', '/admin/reset', {}, true).then(function () {
      cache = { menu: [], settings: null, whitelist: [], users: [], orders: [] };
      try { Object.keys(KEYS).forEach(function (k) { if (k !== 'session' && k !== 'admin') wx.removeStorageSync(KEYS[k]); }); } catch (e) {}
      try { wx.removeStorageSync(KEYS.admin); } catch (e) {}
      return that.init();
    });
  }
};

module.exports = Store;
