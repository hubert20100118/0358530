// pages/register/register.js
var Store = require('../../utils/store.js');

Page({
  data: {
    tab: 'login',
    lPhone: '', lPwd: '',
    rName: '', rPhone: '', rPwd: ''
  },
  switchTab: function (e) { this.setData({ tab: e.currentTarget.dataset.tab }); },
  onInput: function (e) {
    var f = e.currentTarget.dataset.f;
    this.setData((function () { var o = {}; o[f] = e.detail.value; return o; })());
  },
  doLogin: function () {
    var that = this;
    Store.login(this.data.lPhone.trim(), this.data.lPwd).then(function (r) {
      if (!r.ok) { wx.showToast({ title: r.msg, icon: 'none' }); return; }
      Store.setSession(r.user);
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(function () { wx.switchTab({ url: '/pages/my/my' }); }, 600);
    });
  },
  doReg: function () {
    var d = this.data;
    Store.register(d.rName.trim(), d.rPhone.trim(), d.rPwd).then(function (r) {
      if (!r.ok) { wx.showToast({ title: r.msg, icon: 'none' }); return; }
      Store.setSession(r.user);
      wx.showToast({ title: '注册成功', icon: 'success' });
      setTimeout(function () { wx.switchTab({ url: '/pages/my/my' }); }, 600);
    });
  }
});
