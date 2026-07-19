import css from '@src/utils/css-utils.module.css';

function init() {
  applyCssRule('CXOS', 'tr > :first-child', css.hidden);
}

features.add(import.meta.url, init, 'CXOS：隐藏"交易所"列。');
