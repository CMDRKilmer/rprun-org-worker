import css from '@src/utils/css-utils.module.css';
import $style from './hide-form-errors.module.css';

function init() {
  // 隐藏表单组件中的错误消息
  // 当 molp 修复类名重复问题后移除硬编码的类名
  applyCssRule('.FormComponent__containerError___pN__L1Q', $style.containerError);
  applyCssRule('.FormComponent__containerError___jKoukmU', $style.containerError);
  applyCssRule('.FormComponent__errorMessage___mBdvpz5', css.hidden);
  applyCssRule('.FormComponent__errorMessage___R2eGj1h', css.hidden);
}

features.add(import.meta.url, init, '隐藏输入错误的表单字段的错误标签。');
