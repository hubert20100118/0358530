// pages/index/index.js
var Store = require('../../utils/store.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function futureDates(n) {
  var arr = [], d = new Date();
  for (var i = 0; i < n; i++) {
    var x = new Date(d.getTime() + i * 86400000);
    arr.push(x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()));
  }
  return arr;
}

Page({
  data: {
    shopName: '阿布食堂',
    user: null,
    cats: ['全部'],
    activeCat: '全部',
    dishes: [],
    cart: {},
    cartCount: 0,
    cartTotal: 0,
    showOrder: false,
    dates: [],
    selDate: '',
    slots: [],
    selSlot: '',
    note: ''
  },

  onShow: function () {
    var that = this;
    Store.refresh().then(function () { that.paint(); });
  },

  paint: function () {
    var s = Store.getSettings();
    var cats = ['全部'].concat(Store.getCategories());
    this.setData({
      shopName: s.shopName,
      user: Store.getSession(),
      cats: cats,
      slots: s.slots,
      dates: futureDates(7)
    });
    this.refreshDishes();
    this.calcCart();
  },

  refreshDishes: function () {
    var menu = Store.getMenu();
    var list = this.data.activeCat === '全部' ? menu : menu.filter(function (d) { return d.category === this.data.activeCat; }, this);
    this.setData({ dishes: list });
  },

  selectCat: function (e) {
    this.setData({ activeCat: e.currentTarget.dataset.cat });
    this.refreshDishes();
  },

  changeQty: function (e) {
    var id = e.currentTarget.dataset.id;
    var act = e.currentTarget.dataset.act;
    var cart = Object.assign({}, this.data.cart);
    cart[id] = cart[id] || 0;
    if (act === 'inc') cart[id]++;
    if (act === 'dec') { cart[id]--; if (cart[id] <= 0) delete cart[id]; }
    this.setData({ cart: cart });
    this.calcCart();
    this.refreshDishes();
  },

  calcCart: function () {
    var menu = Store.getMenu();
    var total = 0, count = 0;
    Object.keys(this.data.cart).forEach(function (id) {
      var d = menu.filter(function (x) { return x.id === id; })[0];
      if (d) { total += d.price * this.data.cart[id]; count += this.data.cart[id]; }
    }, this);
    this.setData({ cartTotal: total, cartCount: count });
  },

  goOrder: function () {
    if (!this.data.user) {
      wx.showModal({ title: '提示', content: '请先登录/注册（仅白名单手机号可注册）', confirmText: '去登录', success: function (r) { if (r.confirm) wx.navigateTo({ url: '/pages/register/register' }); } });
      return;
    }
    if (this.data.cartCount === 0) { wx.showToast({ title: '请先选择菜品', icon: 'none' }); return; }
    this.setData({ showOrder: true, selDate: this.data.dates[0], selSlot: this.data.slots[0] || '', note: '' });
  },

  onDateChange: function (e) { this.setData({ selDate: e.detail.value }); },
  onSlotTap: function (e) { this.setData({ selSlot: e.currentTarget.dataset.slot }); },
  onNote: function (e) { this.setData({ note: e.detail.value }); },
  closeOrder: function () { this.setData({ showOrder: false }); },

  submitOrder: function () {
    var that = this;
    if (!this.data.selDate || !this.data.selSlot) { wx.showToast({ title: '请选择日期和时段', icon: 'none' }); return; }
    var menu = Store.getMenu();
    var items = [], total = 0;
    Object.keys(this.data.cart).forEach(function (id) {
      var d = menu.filter(function (x) { return x.id === id; })[0];
      if (!d) return;
      items.push({ dishId: d.id, name: d.name, price: d.price, qty: that.data.cart[id] });
      total += d.price * that.data.cart[id];
    });
    if (!items.length) { wx.showToast({ title: '购物车为空', icon: 'none' }); return; }
    Store.addOrder({ userId: this.data.user.id, userName: this.data.user.name, items: items, totalPrice: total, date: this.data.selDate, slot: this.data.selSlot, note: this.data.note });
    this.setData({ showOrder: false, cart: {}, cartCount: 0, cartTotal: 0 });
    this.refreshDishes();
    wx.showToast({ title: '下单成功', icon: 'success' });
    setTimeout(function () { wx.switchTab({ url: '/pages/my/my' }); }, 800);
  },

  goRegister: function () { wx.navigateTo({ url: '/pages/register/register' }); },
  noop: function () {}
});
