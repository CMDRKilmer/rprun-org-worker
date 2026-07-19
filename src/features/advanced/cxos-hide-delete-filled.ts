import css from '@src/utils/css-utils.module.css';

function init() {
  // 此选择器仅在过滤器隐藏时触发，因为此时
  // “清除材料过滤器”按钮和
  // 带有“删除已成交”按钮的操作栏之间没有其他元素。
  applyCssRule('CXOS', `.${C.Button.btn} + .${C.ActionBar.container}`, css.hidden);
}

features.add(import.meta.url, init, 'CXOS：当过滤器隐藏时隐藏"删除已成交"按钮。');
