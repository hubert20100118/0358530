// pages/admin/admin.js
var Store = require('../../utils/store.js');
var STATUS = { pending: '待处理', done: '已完成', cancelled: '已取消' };

function hash(str) { var h = 0; str = String(str || ''); for (var i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return 'h' + (h >>> 0).toString(16); }

Page({
  data: {
    authed: false,
    pwd: '',
    st: { totalOrders: 0, revenue: 0, pending: 0, users: 0 },
    dishRank: [], slotRank: [],
    menu: [],
    showDish: false, editId: null,
    fName: '', fCat: '', fPrice: '', fEmoji: '', fDesc: '', fAvail: true, fImg: '',
    wlForm: { show: false, name: '', phone: '' },
    whitelist: [], users: [], orders: [],
    setShop: '', setSlots: ''
  },

  onShow: function () {
    var that = this;
    if (this.data.authed) Store.refreshAdmin().then(function () { that.renderAll(); });
  },

  doAuth: function () {
    var that = this;
    Store.adminLogin(this.data.pwd).then(function (r) {
      if (r.ok) {
        that.setData({ authed: true });
        Store.refreshAdmin().then(function () { that.renderAll(); });
        wx.showToast({ title: '欢迎，管理员', icon: 'success' });
      } else { wx.showToast({ title: r.msg || '密码错误', icon: 'none' }); }
    });
  },
  onPwd: function (e) { this.setData({ pwd: e.detail.value }); },

  renderAll: function () {
    var st = Store.stats();
    var maxD = st.byDish.length ? st.byDish[0].qty : 1;
    var dishRank = st.byDish.map(function (d) { return { name: d.name, qty: d.qty, pct: Math.round(d.qty / maxD * 100) }; });
    var slots = Store.getSettings().slots;
    var maxS = Math.max.apply(null, slots.map(function (s) { return st.bySlot[s] || 0; }).concat([1]));
    var slotRank = slots.map(function (s) { return { slot: s, v: st.bySlot[s] || 0, pct: Math.round((st.bySlot[s] || 0) / maxS * 100) }; });
    var s = Store.getSettings();
    this.setData({
      st: { totalOrders: st.totalOrders, revenue: st.revenue, pending: st.pending, users: Store.getUsers().length },
      dishRank: dishRank, slotRank: slotRank,
      menu: Store.getMenu(),
      whitelist: Store.getWhitelist(),
      users: Store.getUsers(),
      orders: Store.getOrders().slice().reverse().map(function (o) {
        o.statusText = STATUS[o.status] || o.status;
        o.itemsText = (o.items || []).map(function (i) { return i.name + 'x' + i.qty; }).join('/');
        return o;
      }),
      setShop: s.shopName, setSlots: s.slots.join(',')
    });
  },

  // 菜品编辑
  openAddDish: function () { this.setData({ showDish: true, editId: null, fName: '', fCat: '', fPrice: '', fEmoji: '🍽️', fDesc: '', fAvail: true, fImg: '' }); },
  openEditDish: function (e) {
    var d = Store.getMenu().filter(function (x) { return x.id === e.currentTarget.dataset.id; })[0];
    if (!d) return;
    this.setData({ showDish: true, editId: d.id, fName: d.name, fCat: d.category, fPrice: String(d.price), fEmoji: d.emoji || '🍽️', fDesc: d.desc || '', fAvail: d.available !== false, fImg: d.image || '' });
  },
  chooseDishImage: function () {
    var that = this;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'], success: function (res) {
      var fp = res.tempFiles[0].tempFilePath;
      wx.compressImage({ src: fp, quality: 50, success: function (cr) {
        wx.getFileSystemManager().readFile({ filePath: cr.tempFilePath, encoding: 'base64', success: function (r) {
          that.setData({ fImg: 'data:image/jpeg;base64,' + r.data });
        }, fail: function () { wx.showToast({ title: '图片读取失败', icon: 'none' }); } });
      }, fail: function () { wx.showToast({ title: '图片压缩失败', icon: 'none' }); } });
    } });
  },
  onF: function (e) { var f = e.currentTarget.dataset.f; this.setData((function () { var o = {}; o[f] = e.detail.value; return o; })()); },
  onAvail: function (e) { this.setData({ fAvail: e.detail.value }); },
  closeDish: function () { this.setData({ showDish: false }); },
  saveDish: function () {
    var data = { name: this.data.fName.trim(), category: this.data.fCat.trim() || '其他', price: Number(this.data.fPrice) || 0, emoji: this.data.fEmoji.trim() || '🍽️', desc: this.data.fDesc.trim(), available: this.data.fAvail, image: this.data.fImg };
    if (!data.name) { wx.showToast({ title: '请填写名称', icon: 'none' }); return; }
    if (this.data.editId) Store.updateDish(this.data.editId, data); else Store.addDish(data);
    this.setData({ showDish: false });
    this.renderAll();
  },
  delDish: function (e) {
    var id = e.currentTarget.dataset.id; var that = this;
    wx.showModal({ title: '删除菜品', content: '确定删除？', success: function (r) { if (r.confirm) { Store.removeDish(id); that.renderAll(); } } });
  },

  // 白名单
  toggleWl: function () { this.setData({ 'wlForm.show': !this.data.wlForm.show }); },
  onWl: function (e) { var f = e.currentTarget.dataset.f; this.setData((function () { var o = {}; o['wlForm.' + f] = e.detail.value; return o; })()); },
  addWl: function () {
    var phone = this.data.wlForm.phone.trim();
    if (!/^\d{6,15}$/.test(phone)) { wx.showToast({ title: '手机号格式不正确', icon: 'none' }); return; }
    if (Store.findWhitelist(phone)) { wx.showToast({ title: '已在白名单', icon: 'none' }); return; }
    Store.addWhitelist({ phone: phone, name: this.data.wlForm.name.trim() });
    this.setData({ wlForm: { show: false, name: '', phone: '' } });
    this.renderAll();
  },
  delWl: function (e) {
    var phone = e.currentTarget.dataset.phone; var that = this;
    wx.showModal({ title: '删除白名单', content: '确定删除 ' + phone + '？', success: function (r) { if (r.confirm) { Store.removeWhitelist(phone); that.renderAll(); } } });
  },

  // 订单
  doneOrder: function (e) { Store.updateOrderStatus(e.currentTarget.dataset.id, 'done'); this.renderAll(); },
  cancelOrder: function (e) { Store.updateOrderStatus(e.currentTarget.dataset.id, 'cancelled'); this.renderAll(); },
  delOrder: function (e) {
    var id = e.currentTarget.dataset.id; var that = this;
    wx.showModal({ title: '删除订单', content: '确定删除该订单？', success: function (r) { if (r.confirm) { Store.removeOrder(id); that.renderAll(); } } });
  },

  // 设置
  onSet: function (e) { var f = e.currentTarget.dataset.f; this.setData((function () { var o = {}; o[f] = e.detail.value; return o; })()); },
  saveSettings: function () {
    var patch = { shopName: this.data.setShop.trim() || '订餐小程序' };
    var slots = this.data.setSlots.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (slots.length) patch.slots = slots;
    Store.updateSettings(patch);
    this.renderAll();
    wx.showToast({ title: '已保存', icon: 'success' });
  },
  resetAll: function () {
    var that = this;
    wx.showModal({ title: '重置', content: '将清空所有数据并恢复演示数据，确定？', success: function (r) {
      if (r.confirm) { Store.resetAll().then(function () { that.setData({ authed: false, pwd: '' }); wx.showToast({ title: '已重置', icon: 'success' }); }); }
    } });
  },
  noop: function () {}
});
