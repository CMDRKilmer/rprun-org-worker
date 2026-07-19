import $style from './close-all-buffers.module.css';
import { sleep } from '@src/utils/sleep';

async function closeAllBuffers() {
  // 先恢复所有最小化的窗口，否则关闭按钮不生效。
  const minimizedIndicators = _$$(document.body, C.Dock.indicatorMinimized);
  for (const indicator of minimizedIndicators) {
    const dockItem = indicator.closest(`.${C.Dock.buffer}`) as HTMLElement | null;
    if (dockItem) {
      dockItem.click();
      await sleep(50);
    }
  }

  const windows = _$$(document.body, C.Window.window);
  for (const win of windows) {
    const closeBtn = _$$(win, C.Window.button).find((b: Element) => b.textContent === 'x');
    if (closeBtn) {
      (closeBtn as HTMLElement).click();
      await sleep(50);
    }
  }
}

async function onFooterReady(foot: HTMLElement) {
  if (foot.querySelector(`.${$style.closeAllBtn}`)) {
    return;
  }

  const btn = document.createElement('div');
  btn.className = $style.closeAllBtn;
  btn.title = '关闭所有浮动窗口';
  btn.textContent = '一键关闭';
  btn.addEventListener('click', () => {
    void closeAllBuffers();
  });

  foot.prepend(btn);
}

function init() {
  subscribe($$(document, C.Frame.foot), onFooterReady);
}

features.add(import.meta.url, init, '在底栏左侧添加”一键关闭”按钮，关闭所有浮动窗口。');
