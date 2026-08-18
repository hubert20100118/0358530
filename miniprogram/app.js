// app.js
var Store = require('./utils/store.js');
App({
  onLaunch: function () {
    Store.init();
  },
  globalData: {
    Store: Store
  }
});
