// pages/my/my.js
var Store = require('../../utils/store.js');

var STATUS = { pending: '待处理', done: '已完成', cancelled: '已取消' };

Page({
  data: { user: null, orders: [] },
  onShow: function () {
    var that = this;
    Store.refreshMine().then(function () { that.paint(); });
  },
  paint: function () {
    this.setData({ user: Store.getSession(), orders: this.format(Store.getOrdersByUser((Store.getSession() || {}).id)) });
  },
  format: function (list) {
    return (list || []).slice().reverse().map(function (o) {
      o.statusText = STATUS[o.status] || o.status;
      o.itemsText = (o.items || []).map(function (i) { return i.name + ' x' + i.qty; }).join('、');
      return o;
    });
  },
  goRegister: function () { wx.navigateTo({ url: '/pages/register/register' }); },
  cancelOrder: function (e) {
    var id = e.currentTarget.dataset.id;
    var that = this;
    wx.showModal({ title: '取消订单', content: '确定取消该订单？', success: function (r) {
      if (r.confirm) { Store.updateOrderStatus(id, 'cancelled'); that.paint(); }
    } });
  },
  logout: function () {
    var that = this;
    wx.showModal({ title: '退出登录', content: '确定退出？', success: function (r) {
      if (r.confirm) { Store.logout(); that.paint(); }
    } });
  }
});
