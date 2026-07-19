import $style from './bbl-sticky-dividers.module.css';

function init() {
  applyCssRule('BBL', `.${C.SectionList.divider}`, $style.divider);
}

features.add(import.meta.url, init, 'BBL：使建筑类别分隔线置顶固定。');
