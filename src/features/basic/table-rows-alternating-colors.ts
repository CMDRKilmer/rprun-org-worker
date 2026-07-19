import $style from './table-rows-alternating-colors.module.css';

function init() {
  applyCssRule('table', $style.table);
}

features.add(import.meta.url, init, '在所有表格中将偶数行着浅色。');
