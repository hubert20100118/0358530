/**
 * 订餐小程序 - 后端服务
 * 纯 Node 原生实现：http + node:sqlite（零第三方依赖）。
 * 同端口既托管 Web 静态资源（web/），又提供 REST API（/api）。
 * 数据真实落库（server/data.db），跨设备共享、后台看真实数据。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// 抑制 node:sqlite 的实验性警告
process.on('warning', function (w) { if (w && w.name === 'ExperimentalWarning') return; });

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');
// 数据库落盘路径：优先用环境变量 DB_PATH；否则若检测到持久盘挂载目录 /data（如 Render Disk）则自动用其，
// 避免部署在临时文件系统（免费实例）时每次重启清空数据。本地开发回退到 server/data.db。
function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  try {
    if (fs.existsSync('/data') && fs.statSync('/data').isDirectory()) return path.join('/data', 'data.db');
  } catch (e) { /* ignore */ }
  return path.join(__dirname, 'data.db');
}
const DB_PATH = resolveDbPath();
const PORT = process.env.PORT || 8137;

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`CREATE TABLE IF NOT EXISTS dishes (
  id TEXT PRIMARY KEY, name TEXT, category TEXT, price REAL,
  emoji TEXT, desc TEXT, available INTEGER DEFAULT 1, image TEXT, sort INTEGER DEFAULT 0
);`);
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT, phone TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user', createdAt TEXT
);`);
db.exec(`CREATE TABLE IF NOT EXISTS whitelist (
  id TEXT PRIMARY KEY, phone TEXT UNIQUE, name TEXT, used INTEGER DEFAULT 0
);`);
db.exec(`CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, userId TEXT, userName TEXT, items TEXT, totalPrice REAL,
  date TEXT, slot TEXT, note TEXT, status TEXT DEFAULT 'pending', createdAt TEXT
);`);
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`);
db.exec(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT, userId TEXT, createdAt TEXT);`);

// ---------- 工具 ----------
function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }
function nowISO() { return new Date().toISOString(); }
// 订单视图：把 DB 中 JSON 字符串的 items 解析回数组
function viewOrder(row) {
  if (!row) return row;
  var o = Object.assign({}, row);
  try { o.items = JSON.parse(row.items || '[]'); } catch (e) { o.items = []; }
  return o;
}
function jget(sql, params) { return db.prepare(sql).get(...(params || [])); }
function jall(sql, params) { return db.prepare(sql).all(...(params || [])); }
function jrun(sql, params) { return db.prepare(sql).run(...(params || [])); }

// 解析批量白名单文本：每行一个，支持「手机号」「手机号,姓名」「姓名 手机号」（顺序不限，姓名可选）
function parseWlText(text) {
  const valid = [], invalid = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    line = line.trim();
    if (!line) return;
    const parts = line.split(/[\s,，\t]+/).filter(Boolean);
    if (!parts.length) return;
    let phone = '', name = '';
    parts.forEach(function (p) {
      if (/^\d{6,15}$/.test(p) && !phone) phone = p;
      else if (!/^\d{6,15}$/.test(p)) name += (name ? ' ' : '') + p;
    });
    if (!phone && /^\d{6,15}$/.test(parts[0] || '')) phone = parts[0];
    if (phone) valid.push({ phone: phone, name: name });
    else invalid.push(line);
  });
  return { valid: valid, invalid: invalid };
}

function getSetting(k, def) {
  const r = jget('SELECT value FROM settings WHERE key=?', [k]);
  return r ? r.value : def;
}
function setSetting(k, v) { jrun('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, v]); }

function seedIfEmpty() {
  if (jget('SELECT COUNT(*) c FROM dishes').c === 0) {
    const seedDishes = [
      ['红烧牛肉面', '主食', 28, '🍜', '招牌手工面，牛腩软糯'],
      ['黄焖鸡米饭', '主食', 22, '🍚', '秘制酱汁，鸡腿肉'],
      ['扬州炒饭', '主食', 18, '🍛', '粒粒分明，配料丰富'],
      ['宫保鸡丁', '热菜', 26, '🍲', '酸甜微辣，下饭神器'],
      ['麻婆豆腐', '热菜', 20, '🌶️', '麻辣鲜香，嫩豆腐'],
      ['清炒时蔬', '素菜', 16, '🥬', '当季新鲜蔬菜'],
      ['番茄蛋汤', '汤品', 12, '🍅', '家常暖胃'],
      ['紫菜蛋花汤', '汤品', 10, '🥣', '清淡爽口'],
      ['可乐', '饮品', 6, '🥤', '冰镇 330ml'],
      ['鲜榨橙汁', '饮品', 14, '🍊', '无添加']
    ];
    seedDishes.forEach(function (d, i) {
      jrun('INSERT INTO dishes(id,name,category,price,emoji,desc,available,sort) VALUES(?,?,?,?,?,?,1,?)',
        [uid('d'), d[0], d[1], d[2], d[3], d[4], i]);
    });
  }
  if (jget('SELECT COUNT(*) c FROM settings').c === 0) {
    setSetting('adminPassword', sha('admin123'));
    setSetting('shopName', '阿布食堂');
    setSetting('slots', JSON.stringify(['11:00-11:30', '11:30-12:00', '12:00-12:30', '17:30-18:00', '18:00-18:30', '18:30-19:00']));
    setSetting('leadMinutes', '30');
  }
  if (jget('SELECT COUNT(*) c FROM whitelist').c === 0) {
    [['13800000001', '张三'], ['13800000002', '李四'], ['13800000003', '王五']].forEach(function (w) {
      jrun('INSERT INTO whitelist(id,phone,name,used) VALUES(?,?,?,0)', [uid('w'), w[0], w[1]]);
    });
  }
}
seedIfEmpty();

// ---------- 鉴权 ----------
function auth(req, role) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return null;
  const s = jget('SELECT * FROM sessions WHERE token=?', [m[1]]);
  if (!s) return null;
  if (role && s.role !== role) return null;
  return s;
}
function newSession(role, userId) {
  const token = crypto.randomUUID();
  jrun('INSERT INTO sessions(token,role,userId,createdAt) VALUES(?,?,?,?)', [token, role, userId || null, nowISO()]);
  return token;
}

function publicSettings() {
  return {
    shopName: getSetting('shopName', '订餐小程序'),
    slots: JSON.parse(getSetting('slots', '[]')),
    leadMinutes: Number(getSetting('leadMinutes', '30'))
  };
}

// ---------- HTTP 辅助 ----------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' });
  res.end(body);
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let data = '';
    req.on('data', function (c) { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', function () { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(WEB_DIR, rel));
  if (!filePath.startsWith(WEB_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, function (err, buf) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---------- 业务处理 ----------
async function handleApi(req, res, pathname, query) {
  const method = req.method;

  // 公开：菜单
  if (method === 'GET' && pathname === '/api/menu') {
    return sendJSON(res, 200, { ok: true, menu: jall('SELECT * FROM dishes ORDER BY sort, id') });
  }
  // 公开：店铺设置（不含后台密码）
  if (method === 'GET' && pathname === '/api/settings') {
    return sendJSON(res, 200, { ok: true, settings: publicSettings() });
  }

  // 注册
  if (method === 'POST' && pathname === '/api/register') {
    const b = await readBody(req);
    const phone = String(b.phone || '').trim();
    const name = String(b.name || '').trim();
    const password = String(b.password || '');
    if (!name || !/^\d{6,15}$/.test(phone) || !password) return sendJSON(res, 400, { ok: false, msg: '信息不完整' });
    const w = jget('SELECT * FROM whitelist WHERE phone=?', [phone]);
    if (!w) return sendJSON(res, 403, { ok: false, msg: '该手机号不在可注册名单中，请联系管理员' });
    if (w.used) return sendJSON(res, 403, { ok: false, msg: '该手机号已注册过' });
    if (jget('SELECT COUNT(*) c FROM users WHERE phone=?', [phone]).c) return sendJSON(res, 403, { ok: false, msg: '该手机号已存在' });
    const id = uid('u');
    jrun('INSERT INTO users(id,name,phone,password,role,createdAt) VALUES(?,?,?,?,?,?)', [id, name, phone, sha(password), 'user', nowISO()]);
    jrun('UPDATE whitelist SET used=1 WHERE phone=?', [phone]);
    const token = newSession('user', id);
    return sendJSON(res, 200, { ok: true, token: token, user: { id: id, name: name, phone: phone, role: 'user' } });
  }

  // 登录
  if (method === 'POST' && pathname === '/api/login') {
    const b = await readBody(req);
    const phone = String(b.phone || '').trim();
    const password = String(b.password || '');
    const u = jget('SELECT * FROM users WHERE phone=?', [phone]);
    if (!u) return sendJSON(res, 401, { ok: false, msg: '用户不存在' });
    if (u.password !== sha(password)) return sendJSON(res, 401, { ok: false, msg: '密码错误' });
    const token = newSession('user', u.id);
    return sendJSON(res, 200, { ok: true, token: token, user: { id: u.id, name: u.name, phone: u.phone, role: 'user' } });
  }

  // 以下需要用户或后台鉴权
  const userSess = auth(req, 'user');
  const adminSess = auth(req, 'admin');

  // 我的订单
  if (method === 'GET' && pathname === '/api/orders/mine') {
    if (!userSess) return sendJSON(res, 401, { ok: false, msg: '请先登录' });
    const rows = jall('SELECT * FROM orders WHERE userId=? ORDER BY createdAt DESC', [userSess.userId]).map(viewOrder);
    return sendJSON(res, 200, { ok: true, orders: rows });
  }

  // 取消自己的订单（仅需用户登录，只能取消本人订单）
  let cm = pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
  if (cm && method === 'PUT') {
    if (!userSess) return sendJSON(res, 401, { ok: false, msg: '请先登录' });
    const o = jget('SELECT * FROM orders WHERE id=?', [cm[1]]);
    if (!o) return sendJSON(res, 404, { ok: false, msg: '订单不存在' });
    if (o.userId !== userSess.userId) return sendJSON(res, 403, { ok: false, msg: '只能取消自己的订单' });
    jrun('UPDATE orders SET status=? WHERE id=? AND userId=?', ['cancelled', cm[1], userSess.userId]);
    return sendJSON(res, 200, { ok: true });
  }

  // 下单
  if (method === 'POST' && pathname === '/api/orders') {
    if (!userSess) return sendJSON(res, 401, { ok: false, msg: '请先登录' });
    const b = await readBody(req);
    const u = jget('SELECT * FROM users WHERE id=?', [userSess.userId]);
    const order = {
      id: uid('o'), userId: u.id, userName: u.name,
      items: JSON.stringify(b.items || []), totalPrice: Number(b.totalPrice) || 0,
      date: String(b.date || ''), slot: String(b.slot || ''), note: String(b.note || ''),
      status: 'pending', createdAt: nowISO()
    };
    jrun('INSERT INTO orders(id,userId,userName,items,totalPrice,date,slot,note,status,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [order.id, order.userId, order.userName, order.items, order.totalPrice, order.date, order.slot, order.note, order.status, order.createdAt]);
    return sendJSON(res, 200, { ok: true, order: Object.assign({}, order, { items: b.items || [] }) });
  }

  // ---------- 后台 ----------
  if (method === 'POST' && pathname === '/api/admin/login') {
    const b = await readBody(req);
    if (sha(String(b.password || '')) !== getSetting('adminPassword', '')) return sendJSON(res, 401, { ok: false, msg: '密码错误' });
    const token = newSession('admin', null);
    return sendJSON(res, 200, { ok: true, token: token });
  }
  if (pathname.startsWith('/api/admin/')) {
    if (!adminSess) return sendJSON(res, 401, { ok: false, msg: '需要管理员权限' });
    // 后台总览
    if (method === 'GET' && pathname === '/api/admin/state') {
      return sendJSON(res, 200, {
        ok: true,
        menu: jall('SELECT * FROM dishes ORDER BY sort, id'),
        settings: publicSettings(),
        whitelist: jall('SELECT * FROM whitelist'),
        users: jall('SELECT * FROM users'),
        orders: jall('SELECT * FROM orders ORDER BY createdAt DESC').map(viewOrder)
      });
    }
    // 菜单新增
    if (method === 'POST' && pathname === '/api/admin/menu') {
      const b = await readBody(req);
      const id = uid('d');
      const maxSort = jget('SELECT MAX(sort) m FROM dishes').m || 0;
      const dish = { id: id, name: String(b.name || ''), category: String(b.category || '其他'), price: Number(b.price) || 0, emoji: String(b.emoji || '🍽️'), desc: String(b.desc || ''), available: b.available !== false ? 1 : 0, image: b.image || '', sort: maxSort + 1 };
      jrun('INSERT INTO dishes(id,name,category,price,emoji,desc,available,image,sort) VALUES(?,?,?,?,?,?,?,?,?)',
        [dish.id, dish.name, dish.category, dish.price, dish.emoji, dish.desc, dish.available, dish.image, dish.sort]);
      return sendJSON(res, 200, { ok: true, dish: dish });
    }
    // 菜单更新
    let m = pathname.match(/^\/api\/admin\/menu\/([^/]+)$/);
    if (m && method === 'PUT') {
      const id = m[1]; const b = await readBody(req);
      const cur = jget('SELECT * FROM dishes WHERE id=?', [id]);
      if (!cur) return sendJSON(res, 404, { ok: false, msg: '菜品不存在' });
      const patch = {
        name: b.name != null ? String(b.name) : cur.name,
        category: b.category != null ? String(b.category) : cur.category,
        price: b.price != null ? Number(b.price) : cur.price,
        emoji: b.emoji != null ? String(b.emoji) : cur.emoji,
        desc: b.desc != null ? String(b.desc) : cur.desc,
        available: b.available != null ? (b.available ? 1 : 0) : cur.available,
        image: b.image !== undefined ? (b.image || '') : cur.image
      };
      jrun('UPDATE dishes SET name=?,category=?,price=?,emoji=?,desc=?,available=?,image=? WHERE id=?',
        [patch.name, patch.category, patch.price, patch.emoji, patch.desc, patch.available, patch.image, id]);
      return sendJSON(res, 200, { ok: true, dish: Object.assign({}, cur, patch) });
    }
    if (m && method === 'DELETE') {
      jrun('DELETE FROM dishes WHERE id=?', [m[1]]);
      return sendJSON(res, 200, { ok: true });
    }
    // 白名单新增
    if (method === 'POST' && pathname === '/api/admin/whitelist') {
      const b = await readBody(req);
      const phone = String(b.phone || '').trim();
      if (!/^\d{6,15}$/.test(phone)) return sendJSON(res, 400, { ok: false, msg: '手机号格式不正确' });
      if (jget('SELECT COUNT(*) c FROM whitelist WHERE phone=?', [phone]).c) return sendJSON(res, 400, { ok: false, msg: '已在白名单中' });
      const id = uid('w');
      jrun('INSERT INTO whitelist(id,phone,name,used) VALUES(?,?,?,0)', [id, phone, String(b.name || '')]);
      return sendJSON(res, 200, { ok: true, entry: { id: id, phone: phone, name: b.name || '', used: 0 } });
    }
    // 白名单批量导入
    if (method === 'POST' && pathname === '/api/admin/whitelist/batch') {
      const b = await readBody(req);
      const parsed = Array.isArray(b.entries)
        ? { valid: b.entries.map(function (e) { return { phone: String(e && e.phone || '').trim(), name: String(e && e.name || '').trim() }; }), invalid: [] }
        : parseWlText(b.text);
      const list = parsed.valid || [];
      const added = [], invalid = (parsed.invalid || []).slice(), skipped = [];
      list.forEach(function (item) {
        const phone = String(item.phone || '').trim();
        const name = String(item.name || '').trim();
        if (!/^\d{6,15}$/.test(phone)) { if (phone) invalid.push(phone); return; }
        if (jget('SELECT COUNT(*) c FROM whitelist WHERE phone=?', [phone]).c) { skipped.push(phone); return; }
        const id = uid('w');
        jrun('INSERT INTO whitelist(id,phone,name,used) VALUES(?,?,?,0)', [id, phone, name]);
        added.push({ id: id, phone: phone, name: name, used: 0 });
      });
      return sendJSON(res, 200, { ok: true, added: added.length, skipped: skipped.length, invalid: invalid.length, invalidList: invalid, entries: added });
    }
    let wm = pathname.match(/^\/api\/admin\/whitelist\/([^/]+)$/);
    if (wm && method === 'DELETE') {
      jrun('DELETE FROM whitelist WHERE phone=?', [decodeURIComponent(wm[1])]);
      return sendJSON(res, 200, { ok: true });
    }
    // 用户管理：某用户的全部订单
    let uo = pathname.match(/^\/api\/admin\/users\/([^/]+)\/orders$/);
    if (uo && method === 'GET') {
      const rows = jall('SELECT * FROM orders WHERE userId=? ORDER BY createdAt DESC', [decodeURIComponent(uo[1])]).map(viewOrder);
      return sendJSON(res, 200, { ok: true, orders: rows, count: rows.length });
    }
    // 用户管理：修改角色
    let ur = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
    if (ur && method === 'PUT') {
      const b = await readBody(req);
      const role = b.role === 'admin' ? 'admin' : 'user';
      jrun('UPDATE users SET role=? WHERE id=?', [role, decodeURIComponent(ur[1])]);
      return sendJSON(res, 200, { ok: true });
    }
    // 用户管理：重置密码
    let urp = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset$/);
    if (urp && method === 'POST') {
      const b = await readBody(req);
      const pwd = String(b.password || '').trim();
      if (!pwd) return sendJSON(res, 400, { ok: false, msg: '密码不能为空' });
      jrun('UPDATE users SET password=? WHERE id=?', [sha(pwd), decodeURIComponent(urp[1])]);
      return sendJSON(res, 200, { ok: true });
    }
    // 用户管理：删除用户（同时释放白名单、删除其订单）
    let ud = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (ud && method === 'DELETE') {
      const id = decodeURIComponent(ud[1]);
      const u = jget('SELECT * FROM users WHERE id=?', [id]);
      if (u) jrun('UPDATE whitelist SET used=0 WHERE phone=?', [u.phone]);
      jrun('DELETE FROM orders WHERE userId=?', [id]);
      jrun('DELETE FROM users WHERE id=?', [id]);
      return sendJSON(res, 200, { ok: true });
    }
    // 订单状态
    let om = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
    if (om && method === 'PUT') {
      const b = await readBody(req);
      jrun('UPDATE orders SET status=? WHERE id=?', [String(b.status || 'pending'), om[1]]);
      return sendJSON(res, 200, { ok: true });
    }
    let od = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (od && method === 'DELETE') {
      jrun('DELETE FROM orders WHERE id=?', [od[1]]);
      return sendJSON(res, 200, { ok: true });
    }
    // 设置
    if (method === 'PUT' && pathname === '/api/admin/settings') {
      const b = await readBody(req);
      if (b.shopName != null) setSetting('shopName', String(b.shopName));
      if (b.slots != null) setSetting('slots', JSON.stringify(b.slots));
      if (b.leadMinutes != null) setSetting('leadMinutes', String(b.leadMinutes));
      if (b.adminPassword) setSetting('adminPassword', sha(b.adminPassword));
      return sendJSON(res, 200, { ok: true, settings: publicSettings() });
    }
    // 重置
    if (method === 'POST' && pathname === '/api/admin/reset') {
      jrun('DELETE FROM dishes'); jrun('DELETE FROM users'); jrun('DELETE FROM whitelist'); jrun('DELETE FROM orders');
      jrun('DELETE FROM settings'); jrun('DELETE FROM sessions');
      seedIfEmpty();
      return sendJSON(res, 200, { ok: true, settings: publicSettings() });
    }
    return sendJSON(res, 404, { ok: false, msg: 'not found' });
  }

  return sendJSON(res, 404, { ok: false, msg: 'not found' });
}

// ---------- 服务器 ----------
const server = http.createServer(async function (req, res) {
  const u = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(u.pathname);
  if (pathname.startsWith('/api/')) {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }); return res.end(); }
    try { await handleApi(req, res, pathname, u.searchParams); }
    catch (e) { console.error('API ERROR', e); sendJSON(res, 500, { ok: false, msg: '服务器错误' }); }
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  res.writeHead(405); res.end('method not allowed');
});

server.listen(PORT, function () {
  console.log('订餐后端已启动: http://127.0.0.1:' + PORT + '  (数据库: ' + DB_PATH + ')');
});
