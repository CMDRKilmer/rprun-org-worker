import $style from './macos-antialiased-font.module.css';

function init() {
  applyCssRule('body', $style.body);
}

features.add(import.meta.url, init, '在 macOS 上对所有字体应用抗锯齿平滑。');
