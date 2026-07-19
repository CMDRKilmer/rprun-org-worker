import css from '@src/utils/css-utils.module.css';

function init() {
  applyCssRule(['FLT', 'FLTS', 'FLTP'], 'tr > :first-child', css.hidden);
}

features.add(import.meta.url, init, 'FLT：隐藏"应答器"列。');
