import css from '@src/utils/css-utils.module.css';
import $style from './lm-hide-rating.module.css';

function init() {
  applyCssRule('LM', `.${C.RatingIcon.container}`, css.hidden);
  applyCssRule('LM', `.${C.CommodityAd.text}`, $style.text);
}

features.add(import.meta.url, init, 'LM：隐藏广告中的评级图标。');
